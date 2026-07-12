import React, { useEffect, useState } from 'react';
import { Plus, Trash2, MapPin, ArrowLeft, Grid3x3, Eye, Footprints, Gift, Bell, Check, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import PlacementGridMap from '../../components/PlacementGridMap';
import {
    ACTIVITIES, DOW, DEFAULT_CENTER, GOLD, RED,
    cellKey, parseKey, tileNW, tileBounds, boundsIntersect, buildWeekMask, mergeCells,
    startOfDayISO, endOfDayISO, isoToDateInput,
} from '../../lib/placementGrid';

const blankForm = () => ({
    id: null,
    reward_id: '',
    center_lat: DEFAULT_CENTER.lat,
    center_lng: DEFAULT_CENTER.lng,
    cells: new Set(), // keys "z,x,y"
    paid: false,
    billing_status: 'beta',
    priority: 0,
    visibility: 'boost',
    starts_on: '',   // yyyy-mm-dd (flight window; '' = open-ended)
    ends_on: '',
    active_days: [],
    active_hour_start: null,
    active_hour_end: null,
    target_activities: [],
    affordability: 'any',
    activity_recency: 'any',
    activity_window_hours: null,
    audience_history: 'any',
    max_impressions_per_user_per_day: null,
    cooldown_hours: null,
    max_impressions_per_user_total: null,
    active: true,
});

const EDITOR_SECTIONS = [
    { id: 'setup', label: 'Setup' },
    { id: 'audience', label: 'Audience' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'commercial', label: 'Commercial' },
];

export default function RewardPlacements() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [placements, setPlacements] = useState([]);
    const [cellCounts, setCellCounts] = useState({});
    const [stats, setStats] = useState({});
    const [rewards, setRewards] = useState([]);
    const [form, setForm] = useState(null);
    const [editorSection, setEditorSection] = useState('setup');

    const fetchData = async () => {
        setLoading(true);
        const [pl, rew, cells] = await Promise.all([
            supabase
                .from('reward_placements')
                .select('id, campaign_name, status, review_note, reward_id, geo_mode, paid, billing_status, visibility, priority, starts_at, ends_at, active_days, active_hour_start, active_hour_end, target_activities, affordability, activity_recency, activity_window_hours, audience_history, max_impressions_per_user_per_day, cooldown_hours, max_impressions_per_user_total, active, created_at, rewards(title, brand_name)')
                .order('created_at', { ascending: false }),
            supabase.from('rewards').select('id, title, brand_name').eq('active', true).order('title'),
            supabase.from('reward_placement_cells').select('placement_id'),
        ]);
        if (pl.error) toast.error('Failed to load placements');
        else setPlacements(pl.data || []);
        if (rew.data) setRewards(rew.data);
        const counts = {};
        for (const c of cells.data ?? []) counts[c.placement_id] = (counts[c.placement_id] ?? 0) + 1;
        setCellCounts(counts);
        // Funnel stats (surfaced → present → redeemed). Resilient: if the RPC
        // isn't deployed yet, rows just render without a performance line.
        const ids = (pl.data || []).map((p) => p.id);
        if (ids.length) {
            const { data: s } = await supabase.rpc('get_placement_stats', { p_placement_ids: ids });
            const m = {};
            for (const r of s ?? []) m[r.placement_id] = r;
            setStats(m);
        } else {
            setStats({});
        }
        setLoading(false);
    };

    // Compact funnel shown on a list row. Hidden entirely until there's data.
    const StatLine = ({ id }) => {
        const s = stats[id];
        if (!s || (!s.surfaced && !s.redeemed)) return null;
        return (
            <div className="hidden md:flex items-center gap-3 text-[11px] font-semibold text-[#999999] mr-1" title="Surfaced · Present · Pushed · Redeemed">
                <span className="flex items-center gap-1"><Eye size={12} /> {s.surfaced}</span>
                <span className="flex items-center gap-1"><Footprints size={12} /> {s.presence}</span>
                {s.notified > 0 && <span className="flex items-center gap-1"><Bell size={12} /> {s.notified}</span>}
                <span className="flex items-center gap-1 text-[#8a7600]"><Gift size={12} /> {s.redeemed}</span>
            </div>
        );
    };

    useEffect(() => { fetchData(); }, []);

    const openCreate = () => { setEditorSection('setup'); setForm(blankForm()); };
    const openEdit = async (p) => {
        const { data } = await supabase.from('reward_placement_cells').select('z, x, y').eq('placement_id', p.id);
        const cells = new Set((data ?? []).map((c) => cellKey(c.z, c.x, c.y)));
        const first = (data ?? [])[0];
        const center = first ? tileNW(first.z, first.x, first.y) : DEFAULT_CENTER;
        setForm({
            id: p.id,
            reward_id: p.reward_id,
            status: p.status ?? (p.active ? 'live' : 'paused'),
            center_lat: center.lat,
            center_lng: center.lng,
            cells,
            paid: p.paid,
            billing_status: p.billing_status ?? 'beta',
            priority: p.priority,
            visibility: p.visibility,
            starts_on: isoToDateInput(p.starts_at),
            ends_on: isoToDateInput(p.ends_at),
            active_days: p.active_days ?? [],
            active_hour_start: p.active_hour_start,
            active_hour_end: p.active_hour_end,
            target_activities: p.target_activities ?? [],
            affordability: p.affordability ?? 'any',
            activity_recency: p.activity_recency ?? 'any',
            activity_window_hours: p.activity_window_hours ?? null,
            audience_history: p.audience_history ?? 'any',
            max_impressions_per_user_per_day: p.max_impressions_per_user_per_day,
            cooldown_hours: p.cooldown_hours ?? null,
            max_impressions_per_user_total: p.max_impressions_per_user_total ?? null,
            active: p.active,
        });
        setEditorSection('setup');
    };

    const setField = (patch) => setForm((f) => f && ({ ...f, ...patch }));
    const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    const toggleCell = (z, x, y) => setForm((f) => {
        if (!f) return f;
        const key = cellKey(z, x, y);
        if (f.cells.has(key)) { const next = new Set(f.cells); next.delete(key); return { ...f, cells: next }; }
        return { ...f, cells: mergeCells(f.cells, [{ z, x, y }]) };
    });
    const paintCells = (list) => setForm((f) => (f ? { ...f, cells: mergeCells(f.cells, list) } : f));
    const eraseArea = (bounds) => setForm((f) => {
        if (!f) return f;
        const next = new Set(f.cells);
        for (const key of f.cells) { const { z, x, y } = parseKey(key); if (boundsIntersect(tileBounds(z, x, y), bounds)) next.delete(key); }
        return { ...f, cells: next };
    });

    const save = async (e) => {
        e.preventDefault();
        if (!form.reward_id) { toast.error('Select a reward'); return; }
        if (form.cells.size === 0) { toast.error('Select at least one square on the map'); return; }
        if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) { toast.error('End date is before the start date'); return; }
        setSaving(true);
        const payload = {
            reward_id: form.reward_id,
            geo_mode: 'grid',
            center_lat: null, center_lng: null, radius_m: null,
            paid: form.paid,
            billing_status: form.billing_status,
            priority: form.priority,
            visibility: form.visibility,
            starts_at: startOfDayISO(form.starts_on),
            ends_at: endOfDayISO(form.ends_on),
            active_days: form.active_days.length ? form.active_days : null,
            active_hour_start: form.active_hour_start,
            active_hour_end: form.active_hour_end,
            target_activities: form.target_activities.length ? form.target_activities : null,
            affordability: form.affordability,
            activity_recency: form.activity_recency,
            activity_window_hours: form.activity_recency === 'any' ? null : (form.activity_window_hours ?? (form.activity_recency === 'lapsed' ? 168 : 24)),
            audience_history: form.audience_history,
            max_impressions_per_user_per_day: form.max_impressions_per_user_per_day,
            cooldown_hours: form.cooldown_hours,
            max_impressions_per_user_total: form.max_impressions_per_user_total,
            week_mask: buildWeekMask(form.active_days, form.active_hour_start, form.active_hour_end),
            active: form.active,
            updated_at: new Date().toISOString(),
        };

        const flat = [];
        for (const key of form.cells) { const { z, x, y } = parseKey(key); flat.push(z, x, y); }
        const cellFail = (err) => {
            if (/CELL_CONFLICT/.test(err.message)) toast.error('Some squares are already taken for these times (shown in red). Erase them and save again.');
            else toast.error(err.message);
        };

        let placementId = form.id;
        if (placementId) {
            // Cells + schedule go through the atomic RPC FIRST: the conflict check
            // runs against the NEW schedule and a conflict writes nothing, so the
            // row can never be left with a widened schedule that double-books its
            // old cells.
            const { error: cellErr } = await supabase.rpc('set_placement_cells', {
                p_placement_id: placementId,
                p_cells: flat,
                p_schedule: {
                    starts_at: payload.starts_at,
                    ends_at: payload.ends_at,
                    week_mask: payload.week_mask,
                    active_days: payload.active_days,
                    active_hour_start: payload.active_hour_start,
                    active_hour_end: payload.active_hour_end,
                },
            });
            if (cellErr) { setSaving(false); cellFail(cellErr); return; }
            const { error } = await supabase.from('reward_placements').update(payload).eq('id', placementId);
            setSaving(false);
            if (error) { toast.error(error.message); return; }
        } else {
            // Create: the row is inserted with its final schedule, so the RPC's
            // stored-schedule conflict check already sees the right one. A conflict
            // leaves a cell-less row (which never resolves) and the form keeps the
            // id, so a retry becomes a clean update.
            const { data, error } = await supabase.from('reward_placements').insert([payload]).select('id').single();
            if (error) { setSaving(false); toast.error(error.message); return; }
            placementId = data.id;
            const { error: cellErr } = await supabase.rpc('set_placement_cells', { p_placement_id: placementId, p_cells: flat });
            setSaving(false);
            if (cellErr) { cellFail(cellErr); setForm((f) => f && ({ ...f, id: placementId })); return; }
        }
        toast.success(form.id ? 'Placement updated' : 'Placement created');
        setForm(null);
        fetchData();
    };

    const remove = async (id) => {
        if (!window.confirm('Delete this placement?')) return;
        const { error } = await supabase.from('reward_placements').delete().eq('id', id);
        if (error) { toast.error('Delete failed'); return; }
        toast.success('Placement removed');
        setForm(null);
        fetchData();
    };

    const review = async (id, decision) => {
        const note = decision === 'reject'
            ? window.prompt('Tell the partner what needs to change (optional):')
            : null;
        if (decision === 'reject' && note === null) return;
        const { error } = await supabase.rpc('review_reward_placement', {
            p_placement_id: id,
            p_decision: decision,
            p_note: note,
        });
        if (error) { toast.error(error.message); return; }
        toast.success(decision === 'approve' ? 'Campaign approved and live' : 'Changes requested');
        fetchData();
    };

    const rewardLabel = (r) => `${r.title}${r.brand_name ? ` · ${r.brand_name}` : ''}`;
    const hoursOn = form && form.active_hour_start != null;

    if (form) {
        const labelCls = 'block text-[11px] uppercase tracking-[0.25em] font-bold text-[#888888] mb-2';
        const chip = (on) => `px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666666] hover:border-[#CCCCCC]'}`;
        return (
            <form onSubmit={save} className="w-full max-w-[1500px]">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setForm(null)} className="w-9 h-9 rounded-xl border border-[#E6E6E1] bg-white flex items-center justify-center text-[#666666] hover:text-[#1A1A1A]">
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-xl font-black tracking-tight text-[#1A1A1A]">{form.id ? 'Edit Placement' : 'New Placement'}</h1>
                            <p className="text-[12px] text-[#999999]">Zoom out for big areas, in for precision · Paint/Erase to drag a box · red = taken for these times.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {form.id && (
                            <button type="button" onClick={() => remove(form.id)} className="text-[12px] uppercase tracking-[0.2em] font-semibold text-red-400 hover:text-red-500">Delete</button>
                        )}
                        <button type="button" onClick={() => setForm(null)} className="text-[13px] font-semibold text-[#888888] hover:text-[#555555]">Cancel</button>
                        <button type="submit" disabled={saving} className="bg-[#E8D200] text-[#080808] font-bold text-[13px] uppercase tracking-[0.15em] px-5 py-2.5 rounded-xl hover:brightness-95 transition disabled:opacity-60">
                            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create placement'}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-1 overflow-x-auto border-b border-[#E6E6E1] mb-6">
                    {EDITOR_SECTIONS.map((section) => (
                        <button key={section.id} type="button" onClick={() => setEditorSection(section.id)}
                            className={`h-10 px-4 text-[11px] uppercase tracking-[0.18em] font-bold border-b-2 transition whitespace-nowrap ${editorSection === section.id ? 'border-[#E8D200] text-[#1A1A1A]' : 'border-transparent text-[#999999] hover:text-[#555555]'}`}>
                            {section.label}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-6">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className={labelCls + ' mb-0'}>Coverage grid</label>
                            <div className="flex items-center gap-4 text-[12px]">
                                <span className="flex items-center gap-1.5 text-[#666]"><Grid3x3 size={13} /> {form.cells.size} square{form.cells.size === 1 ? '' : 's'}</span>
                                {form.cells.size > 0 && (
                                    <button type="button" onClick={() => setField({ cells: new Set() })} className="text-[#8a7600] font-semibold hover:underline">Clear</button>
                                )}
                            </div>
                        </div>
                        <PlacementGridMap form={form} toggleCell={toggleCell} onPaint={paintCells} onEraseArea={eraseArea} excludeId={form.id} />
                        <div className="flex items-center gap-4 text-[11px] text-[#999]">
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: GOLD, opacity: 0.6 }} /> Selected</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: RED, opacity: 0.45 }} /> Taken (these times)</span>
                        </div>
                    </div>

                    <div className="space-y-6 bg-white border border-[#E6E6E1] rounded-2xl p-5">
                        {editorSection === 'setup' && <>
                        <div>
                            <label className={labelCls}>Reward</label>
                            <select value={form.reward_id} onChange={(e) => setField({ reward_id: e.target.value })}
                                className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px] text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]">
                                <option value="">Select a reward…</option>
                                {rewards.map((r) => <option key={r.id} value={r.id}>{rewardLabel(r)}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className={labelCls}>Campaign window <span className="text-[#CCCCCC] normal-case tracking-normal">(empty = always live)</span></label>
                            <div className="flex items-center gap-3">
                                <input type="date" value={form.starts_on} onChange={(e) => setField({ starts_on: e.target.value })}
                                    className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px] text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]" />
                                <span className="text-[#AAAAAA] text-sm">to</span>
                                <input type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setField({ ends_on: e.target.value })}
                                    className="flex-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px] text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]" />
                            </div>
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Two placements can also share a square across non-overlapping date ranges.</p>
                        </div>

                        <div>
                            <label className={labelCls}>Active days <span className="text-[#CCCCCC] normal-case tracking-normal">(none = any)</span></label>
                            <div className="flex gap-2 flex-wrap">
                                {DOW.map((d, i) => (
                                    <button key={d} type="button" onClick={() => setField({ active_days: toggleIn(form.active_days, i) })} className={chip(form.active_days.includes(i))}>{d}</button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] font-bold text-[#888888] mb-2">
                                <input type="checkbox" checked={hoursOn} onChange={(e) => setField(e.target.checked ? { active_hour_start: 8, active_hour_end: 20 } : { active_hour_start: null, active_hour_end: null })} className="accent-[#E8D200]" />
                                Restrict to hours
                            </label>
                            {hoursOn && (
                                <div className="flex items-center gap-3">
                                    <select value={form.active_hour_start} onChange={(e) => setField({ active_hour_start: Number(e.target.value) })} className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2 text-[14px]">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                    <span className="text-[#AAAAAA] text-sm">to</span>
                                    <select value={form.active_hour_end} onChange={(e) => setField({ active_hour_end: Number(e.target.value) })} className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2 text-[14px]">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                </div>
                            )}
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Two placements can share a square at non-overlapping days/hours.</p>
                        </div>
                        </>}

                        {editorSection === 'audience' && <>
                        <div>
                            <label className={labelCls}>Audience <span className="text-[#CCCCCC] normal-case tracking-normal">(none = everyone)</span></label>
                            <div className="flex gap-2 flex-wrap">
                                {ACTIVITIES.map((a) => (
                                    <button key={a} type="button" onClick={() => setField({ target_activities: toggleIn(form.target_activities, a) })} className={chip(form.target_activities.includes(a)) + ' capitalize'}>{a}</button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>Affordability</label>
                            <div className="flex gap-2 flex-wrap">
                                {[['any', 'Any'], ['affordable', 'Can afford'], ['within_reach', 'Within reach']].map(([v, l]) => (
                                    <button key={v} type="button" onClick={() => setField({ affordability: v })} className={chip(form.affordability === v)}>{l}</button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Only surface to users whose balance can afford (or is ≥ 60% of) the reward.</p>
                        </div>

                        <div>
                            <label className={labelCls}>Activity moment</label>
                            <div className="flex gap-2 flex-wrap">
                                {[['any', 'Any'], ['active', 'Recently active'], ['lapsed', 'Lapsed']].map(([v, l]) => (
                                    <button key={v} type="button"
                                        onClick={() => setForm((f) => f && ({ ...f, activity_recency: v, activity_window_hours: v === 'any' ? null : (f.activity_window_hours ?? (v === 'lapsed' ? 168 : 24)) }))}
                                        className={chip(form.activity_recency === v)}>{l}</button>
                                ))}
                            </div>
                            {form.activity_recency !== 'any' && (
                                <div className="flex gap-2 flex-wrap mt-2">
                                    {(form.activity_recency === 'active'
                                        ? [[3, '3h'], [24, '24h'], [72, '3d'], [168, '7d']]
                                        : [[168, '7d'], [336, '14d'], [720, '30d']]
                                    ).map(([h, l]) => (
                                        <button key={h} type="button" onClick={() => setField({ activity_window_hours: h })} className={chip(form.activity_window_hours === h)}>{l}</button>
                                    ))}
                                </div>
                            )}
                            <p className="text-[11px] text-[#AAAAAA] mt-2">
                                {form.activity_recency === 'active' ? 'Only users who logged a session within the window (e.g. just worked out).'
                                    : form.activity_recency === 'lapsed' ? 'Only users with no session in the window (re-engagement).'
                                        : 'No activity filter.'}
                            </p>
                        </div>

                        <div>
                            <label className={labelCls}>Brand history</label>
                            <div className="flex gap-2 flex-wrap">
                                {[['any', 'Any'], ['new', 'New to brand'], ['returning', 'Returning']].map(([v, l]) => (
                                    <button key={v} type="button" onClick={() => setField({ audience_history: v })} className={chip(form.audience_history === v)}>{l}</button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#AAAAAA] mt-2">
                                {form.audience_history === 'new' ? 'Only users who’ve never redeemed this brand (acquisition).'
                                    : form.audience_history === 'returning' ? 'Only users who’ve redeemed this brand before (loyalty).'
                                        : 'No brand-history filter.'}
                            </p>
                        </div>
                                </>}

                                {editorSection === 'delivery' && <>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>Daily cap / user <span className="text-[#CCCCCC] normal-case tracking-normal">(∞)</span></label>
                                <input type="number" min={1} value={form.max_impressions_per_user_per_day ?? ''} placeholder="Unlimited"
                                    onChange={(e) => setField({ max_impressions_per_user_per_day: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                                    className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px]" />
                            </div>
                            <div>
                                <label className={labelCls}>Priority</label>
                                <input type="number" value={form.priority} onChange={(e) => setField({ priority: Number(e.target.value) || 0 })}
                                    className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px]" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>Cooldown (hrs) <span className="text-[#CCCCCC] normal-case tracking-normal">(off)</span></label>
                                <input type="number" min={1} value={form.cooldown_hours ?? ''} placeholder="None"
                                    onChange={(e) => setField({ cooldown_hours: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                                    className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px]" />
                            </div>
                            <div>
                                <label className={labelCls}>Lifetime cap / user <span className="text-[#CCCCCC] normal-case tracking-normal">(∞)</span></label>
                                <input type="number" min={1} value={form.max_impressions_per_user_total ?? ''} placeholder="Unlimited"
                                    onChange={(e) => setField({ max_impressions_per_user_total: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                                    className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 text-[14px]" />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>Visibility</label>
                            <div className={chip(true) + ' inline-flex px-4 py-2 rounded-xl'}>Boost</div>
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Moves an eligible reward ahead of the normal vault order without hiding other rewards.</p>
                        </div>
                        </>}

                        {editorSection === 'commercial' && <>
                        <div className="flex items-center gap-6 pt-1">
                            <label className="flex items-center gap-2 text-[13px] text-[#444444] font-medium">
                                <input type="checkbox" checked={form.paid} onChange={(e) => setField({ paid: e.target.checked })} className="accent-[#E8D200] w-4 h-4" />
                                Paid <span className="text-[#AAAAAA]">(Sponsored)</span>
                            </label>
                            {['draft', 'pending_review', 'rejected'].includes(form.status) ? (
                                <span className="text-[12px] text-[#999999]">Activation is controlled by campaign review.</span>
                            ) : (
                                <label className="flex items-center gap-2 text-[13px] text-[#444444] font-medium">
                                    <input type="checkbox" checked={form.active} onChange={(e) => setField({ active: e.target.checked })} className="accent-[#E8D200] w-4 h-4" />
                                    Active
                                </label>
                            )}
                        </div>

                        {form.paid && (
                            <div>
                                <label className={labelCls}>Billing</label>
                                <div className="flex gap-2 flex-wrap">
                                    {[['beta', 'Beta (free)'], ['billable', 'Billable'], ['comped', 'Comped']].map(([v, l]) => (
                                        <button key={v} type="button" onClick={() => setField({ billing_status: v })} className={chip(form.billing_status === v)}>{l}</button>
                                    ))}
                                </div>
                                <p className="text-[11px] text-[#AAAAAA] mt-2">Brand self-serve placements stay “Beta (free)” until payments go live.</p>
                            </div>
                        )}
                        </>}
                    </div>
                </div>
            </form>
        );
    }

    return (
        <div className="max-w-[1100px]">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-[#1A1A1A]">Reward Placements</h1>
                    <p className="text-[13px] text-[#888888] mt-1 max-w-xl">
                        Paint a grid over places; the reward is boosted for users inside it during the chosen times.
                        Cell size follows the map zoom, squares are exclusive per time slice, and they never affect gym check-in points.
                    </p>
                </div>
                <button onClick={openCreate} className="flex items-center gap-2 bg-[#E8D200] text-[#080808] font-bold text-[13px] uppercase tracking-[0.15em] px-4 py-2.5 rounded-xl hover:brightness-95 transition">
                    <Plus size={16} /> New Placement
                </button>
            </div>

            {loading ? (
                <div className="text-[#AAAAAA] text-sm py-16 text-center">Loading…</div>
            ) : placements.length === 0 ? (
                <div className="text-[#AAAAAA] text-sm py-16 text-center border border-dashed border-[#E0E0DB] rounded-2xl">No placements yet. Paint your first grid.</div>
            ) : (
                <div className="grid gap-3">
                    {placements.map((p) => (
                        <div key={p.id} className="flex items-center gap-4 bg-white border border-[#E6E6E1] rounded-2xl px-5 py-4">
                            <div className="w-9 h-9 rounded-xl bg-[#F4F4F1] flex items-center justify-center flex-shrink-0">
                                <MapPin size={17} className="text-[#8a7600]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[14px] font-semibold text-[#1A1A1A] truncate">
                                    {p.campaign_name || p.rewards?.title || 'Reward'}
                                    {p.rewards?.brand_name ? <span className="text-[#AAAAAA] font-normal"> · {p.rewards.brand_name}</span> : null}
                                </div>
                                <div className="text-[12px] text-[#999999] mt-0.5">
                                    {p.campaign_name && <>{p.rewards?.title || 'Reward'} · </>}
                                    {p.geo_mode === 'grid' ? `${cellCounts[p.id] ?? 0} squares` : `${p.geo_mode}`} · {p.active_days?.length ? p.active_days.map((d) => DOW[d]).join(' ') : 'any day'}
                                    {p.active_hour_start != null ? ` · ${p.active_hour_start}:00–${p.active_hour_end}:00` : ''}
                                    {(p.starts_at || p.ends_at) ? ` · ${isoToDateInput(p.starts_at) || '…'}→${isoToDateInput(p.ends_at) || '…'}` : ''}
                                    {p.target_activities?.length ? ` · ${p.target_activities.join(', ')}` : ''}
                                </div>
                                {p.status === 'rejected' && p.review_note && <div className="text-[11px] text-red-500 mt-1 truncate">Feedback: {p.review_note}</div>}
                            </div>
                            <StatLine id={p.id} />
                            <span className={`text-[9px] font-black uppercase tracking-[0.18em] px-2 py-1 rounded-md ${p.status === 'live' ? 'bg-emerald-50 text-emerald-600' : p.status === 'pending_review' ? 'bg-[#E8D200]/20 text-[#8a7600]' : p.status === 'rejected' ? 'bg-red-50 text-red-500' : 'bg-[#F4F4F1] text-[#888]'}`}>
                                {(p.status || (p.active ? 'live' : 'paused')).replace('_', ' ')}
                            </span>
                            {p.paid && <span className="text-[9px] font-black uppercase tracking-[0.2em] bg-[#E8D200] text-[#080808] px-2 py-1 rounded-md">Paid</span>}
                            {p.status === 'pending_review' && <>
                                <button onClick={() => review(p.id, 'approve')} className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] font-semibold text-emerald-600 hover:text-emerald-700"><Check size={14} /> Approve</button>
                                <button onClick={() => review(p.id, 'reject')} className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] font-semibold text-red-400 hover:text-red-500"><X size={14} /> Changes</button>
                            </>}
                            <button onClick={() => openEdit(p)} className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#8a7600] hover:underline">Edit</button>
                            <button onClick={() => remove(p.id)} className="text-[#CCCCCC] hover:text-red-500 transition"><Trash2 size={16} /></button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
