import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Plus, Trash2, MapPin, ChevronLeft, Grid3x3, Sparkles, Eye, Footprints, Gift, Bell, Check, Circle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import PlacementGridMap from '../../components/PlacementGridMap';
import {
    ACTIVITIES, DOW, DEFAULT_CENTER, GOLD, RED,
    cellKey, parseKey, tileNW, tileBounds, boundsIntersect, buildWeekMask, mergeCells,
    startOfDayISO, endOfDayISO, isoToDateInput,
} from '../../lib/placementGrid';

// Brand self-serve placements are locked to the "sponsored boost" shape;
// POWR-only levers (priority bidding, exclusive visibility, first-party
// unpaid) are set here and never exposed to the brand. Kept in sync with the
// brand-scoped RLS in 20260704000006_reward_placement_partner_self_serve.sql.
const blankForm = () => ({
    id: null,
    campaign_name: '',
    reward_id: '',
    reward_fallback: null,
    center_lat: DEFAULT_CENTER.lat,
    center_lng: DEFAULT_CENTER.lng,
    cells: new Set(), // keys "z,x,y"
    starts_on: '',
    ends_on: '',
    active_days: [],
    active_hour_start: null,
    active_hour_end: null,
    target_activities: [],
    max_impressions_per_user_per_day: null,
    active: false,
});

const STEPS = [
    { label: 'Offer', detail: 'Choose the reward' },
    { label: 'Place & time', detail: 'Set where and when' },
    { label: 'Audience & review', detail: 'Confirm your plan' },
];

const statusLabel = (status) => ({
    draft: 'Draft',
    pending_review: 'In review',
    scheduled: 'Scheduled',
    live: 'Live',
    paused: 'Paused',
    ended: 'Ended',
    rejected: 'Needs changes',
}[status] || 'Live');

export default function PartnerPlacements() {
    const toast = useToast();
    const { partnerData, isAdmin, placementsEnabled } = useAuth();
    const brand = partnerData?.brand_name || null;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [placements, setPlacements] = useState([]);
    const [cellCounts, setCellCounts] = useState({});
    const [stats, setStats] = useState({});
    const [rewards, setRewards] = useState([]);
    // Tracked apart from the list itself so a rewards fetch that fails still
    // settles the wizard instead of leaving it to speak for an empty array.
    const [rewardsState, setRewardsState] = useState('loading'); // loading | ready | error
    const [form, setForm] = useState(null);
    const [step, setStep] = useState(0);

    const fetchData = async () => {
        if (!brand) return;
        setLoading(true);
        const [pl, rew] = await Promise.all([
            supabase
                .from('reward_placements')
                .select('id, campaign_name, status, review_note, active, reward_id, starts_at, ends_at, active_days, active_hour_start, active_hour_end, target_activities, max_impressions_per_user_per_day, created_at, rewards!inner(title, brand_name, image_url)')
                .ilike('rewards.brand_name', brand)
                .order('created_at', { ascending: false }),
            supabase.from('rewards').select('id, title, image_url').ilike('brand_name', brand).eq('active', true).order('title'),
        ]);
        if (pl.error) toast.error('Failed to load placements');
        else setPlacements(pl.data || []);
        if (rew.error) setRewardsState('error');
        else { setRewards(rew.data || []); setRewardsState('ready'); }

        const ids = (pl.data || []).map((p) => p.id);
        if (ids.length) {
            const [{ data: cells }, { data: s }] = await Promise.all([
                supabase.from('reward_placement_cells').select('placement_id').in('placement_id', ids),
                supabase.rpc('get_placement_stats', { p_placement_ids: ids }),
            ]);
            const counts = {};
            for (const c of cells ?? []) counts[c.placement_id] = (counts[c.placement_id] ?? 0) + 1;
            setCellCounts(counts);
            const m = {};
            for (const r of s ?? []) m[r.placement_id] = r;
            setStats(m);
        } else {
            setCellCounts({});
            setStats({});
        }
        setLoading(false);
    };

    useEffect(() => { fetchData(); }, [brand]);

    const openCreate = () => { setStep(0); setForm(blankForm()); };
    const openEdit = async (p) => {
        const { data } = await supabase.from('reward_placement_cells').select('z, x, y').eq('placement_id', p.id);
        const cells = new Set((data ?? []).map((c) => cellKey(c.z, c.x, c.y)));
        const first = (data ?? [])[0];
        const center = first ? tileNW(first.z, first.x, first.y) : DEFAULT_CENTER;
        setForm({
            id: p.id,
            campaign_name: p.campaign_name ?? '',
            reward_id: p.reward_id,
            // The picker only knows what is live today, so keep the joined
            // title: a reward switched off since this draft was written must
            // still name itself rather than read back as nothing.
            reward_fallback: p.rewards?.title ? { id: p.reward_id, title: p.rewards.title } : null,
            center_lat: center.lat,
            center_lng: center.lng,
            cells,
            starts_on: isoToDateInput(p.starts_at),
            ends_on: isoToDateInput(p.ends_at),
            active_days: p.active_days ?? [],
            active_hour_start: p.active_hour_start,
            active_hour_end: p.active_hour_end,
            target_activities: p.target_activities ?? [],
            max_impressions_per_user_per_day: p.max_impressions_per_user_per_day,
            active: p.active,
        });
        setStep(0);
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

    const saveDraft = async ({ requireCells = false } = {}) => {
        if (!form.reward_id) { toast.error('Choose which reward to place'); return; }
        if (!form.campaign_name.trim()) { toast.error('Name this campaign so you can find it later'); return; }
        if (requireCells && form.cells.size === 0) { toast.error('Paint at least one square on the map'); return; }
        if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) { toast.error('End date is before the start date'); return; }
        setSaving(true);
        // Locked self-serve shape — must satisfy the draft-only brand RLS.
        const payload = {
            campaign_name: form.campaign_name.trim(),
            reward_id: form.reward_id,
            geo_mode: 'grid',
            paid: true,
            priority: 0,
            visibility: 'boost',
            partner_id: null,
            center_lat: null, center_lng: null, radius_m: null,
            starts_at: startOfDayISO(form.starts_on),
            ends_at: endOfDayISO(form.ends_on),
            active_days: form.active_days.length ? form.active_days : null,
            active_hour_start: form.active_hour_start,
            active_hour_end: form.active_hour_end,
            target_activities: form.target_activities.length ? form.target_activities : null,
            affordability: 'any',
            activity_recency: 'any',
            activity_window_hours: null,
            audience_history: 'any',
            max_impressions_per_user_per_day: form.max_impressions_per_user_per_day,
            cooldown_hours: null,
            max_impressions_per_user_total: null,
            week_mask: buildWeekMask(form.active_days, form.active_hour_start, form.active_hour_end),
            status: 'draft',
            active: false,
            updated_at: new Date().toISOString(),
        };

        const flat = [];
        for (const key of form.cells) { const { z, x, y } = parseKey(key); flat.push(z, x, y); }
        const cellFail = (err) => {
            if (/CELL_CONFLICT/.test(err.message)) toast.error('Some squares are already booked for these times (shown in red). Erase them and try again.');
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
        setForm((current) => current && ({ ...current, id: placementId }));
        toast.success('Draft saved');
        fetchData();
        return placementId;
    };

    const moveStep = async (direction) => {
        if (direction > 0) {
            const placementId = await saveDraft({ requireCells: step >= 1 });
            if (!placementId) return;
        }
        setStep((current) => Math.max(0, Math.min(STEPS.length - 1, current + direction)));
    };

    const submitForReview = async () => {
        const placementId = await saveDraft({ requireCells: true });
        if (!placementId) return;
        setSaving(true);
        const { error } = await supabase.rpc('submit_reward_placement', { p_placement_id: placementId });
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        toast.success('Campaign submitted for review');
        setForm(null);
        fetchData();
    };

    const remove = async (id) => {
        if (!window.confirm('Remove this placement?')) return;
        const { error } = await supabase.from('reward_placements').delete().eq('id', id);
        if (error) { toast.error('Delete failed'); return; }
        toast.success('Placement removed');
        setForm(null);
        fetchData();
    };

    // Gate: hidden for brands unless the flag is on; admins always get in (testing).
    if (!isAdmin && !placementsEnabled) return <Navigate to="/partner" replace />;

    const rewardById = (id) => rewards.find((r) => r.id === id);
    const hoursOn = form && form.active_hour_start != null;

    // ── Form view ────────────────────────────────────────────────────────────
    if (form) {
        const labelCls = 'block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3';
        const chip = (on) => `px-3.5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition ${on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#888] hover:border-[#CCC]'}`;
        // A lapsed reward stays selectable and named, marked for what it is.
        const lapsed = form.reward_fallback && !rewards.some((r) => r.id === form.reward_fallback.id)
            ? { ...form.reward_fallback, inactive: true }
            : null;
        const rewardChoices = lapsed ? [...rewards, lapsed] : rewards;
        const rewardLabel = (r) => (r.inactive ? `${r.title} (inactive)` : r.title);
        const chosenReward = rewardChoices.find((r) => r.id === form.reward_id);
        return (
            <form onSubmit={(e) => { e.preventDefault(); submitForReview(); }} className="py-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
                <button type="button" onClick={() => setForm(null)} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#999] hover:text-[#8a7600] transition-colors mb-8">
                    <ChevronLeft size={14} /> Back to Placements
                </button>

                <div className="flex items-start justify-between gap-6 mb-10 flex-wrap">
                    <div>
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-3">{form.id ? 'Edit campaign' : 'New campaign'}</h1>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Build a draft in stages, then send it to POWR for review</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {form.id && (
                            <button type="button" onClick={() => remove(form.id)} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 hover:text-red-500 transition-colors">Delete</button>
                        )}
                        <button type="button" onClick={() => setForm(null)} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors">Cancel</button>
                        <button type="button" onClick={() => saveDraft({ requireCells: false })} disabled={saving} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">
                            Save draft
                        </button>
                    </div>
                </div>

                <ol className="grid grid-cols-3 border-y border-[#E6E6E1] mb-8">
                    {STEPS.map((item, index) => {
                        const complete = index < step;
                        const current = index === step;
                        return (
                            <li key={item.label} className={`min-w-0 py-4 flex items-center gap-3 ${index > 0 ? 'border-l border-[#E6E6E1] pl-5' : 'pr-5'}`}>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${complete ? 'bg-[#E8D200] text-[#080808]' : current ? 'border-2 border-[#8a7600] text-[#8a7600]' : 'border border-[#D8D8D2] text-[#AAA]'}`}>
                                    {complete ? <Check size={13} strokeWidth={3} /> : <Circle size={7} fill="currentColor" />}
                                </span>
                                <span className="min-w-0">
                                    <span className={`block text-[10px] font-black uppercase tracking-[0.18em] truncate ${current ? 'text-[#1A1A1A]' : 'text-[#999]'}`}>{item.label}</span>
                                    <span className="hidden md:block text-[10px] text-[#AAA] mt-0.5 truncate">{item.detail}</span>
                                </span>
                            </li>
                        );
                    })}
                </ol>

                <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
                    {step === 1 ? <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666]">Coverage area</label>
                            <div className="flex items-center gap-4 text-[11px]">
                                <span className="flex items-center gap-1.5 text-[#666] font-bold"><Grid3x3 size={13} /> {form.cells.size} square{form.cells.size === 1 ? '' : 's'}</span>
                                {form.cells.size > 0 && (
                                    <button type="button" onClick={() => setField({ cells: new Set() })} className="text-[#8a7600] font-black uppercase tracking-[0.15em] text-[10px] hover:underline">Clear</button>
                                )}
                            </div>
                        </div>
                        <PlacementGridMap form={form} toggleCell={toggleCell} onPaint={paintCells} onEraseArea={eraseArea} excludeId={form.id} />
                        <div className="flex items-center gap-4 text-[10px] text-[#999] font-black uppercase tracking-[0.15em]">
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: GOLD, opacity: 0.6 }} /> Selected</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: RED, opacity: 0.45 }} /> Booked (these times)</span>
                        </div>
                    </div> : (
                        <div className="border border-[#E6E6E1] bg-white p-8 min-h-[420px] flex flex-col justify-between">
                            <div>
                                <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{step === 0 ? 'Your offer' : 'Campaign summary'}</span>
                                <h2 className="text-3xl font-light tracking-tight text-[#1A1A1A] mt-4">{step === 0 ? 'Start with the member reward.' : form.campaign_name || 'Untitled campaign'}</h2>
                                <p className="text-sm text-[#777] leading-relaxed mt-3 max-w-md">
                                    {step === 0
                                        ? 'Choose the reward you want to put in front of nearby POWR members. You can save this and return before choosing a place.'
                                        : 'Check the choices below. Submission keeps this campaign off until the POWR team has reviewed it.'}
                                </p>
                            </div>
                            {step === 2 && (
                                <dl className="border-t border-[#E6E6E1] pt-5 grid gap-4 text-sm">
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">Reward</dt><dd className="text-[#222] font-semibold mt-1">{chosenReward ? rewardLabel(chosenReward) : 'Not chosen'}</dd></div>
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">Area</dt><dd className="text-[#222] font-semibold mt-1">{form.cells.size ? `${form.cells.size} selected square${form.cells.size === 1 ? '' : 's'}` : 'Not chosen'}</dd></div>
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">Timing</dt><dd className="text-[#222] font-semibold mt-1">{form.starts_on || form.ends_on ? `${form.starts_on || 'Open'} to ${form.ends_on || 'Open'}` : 'Always on'}</dd></div>
                                </dl>
                            )}
                        </div>
                    )}

                    <div className="space-y-8 bg-white border border-[#E6E6E1] rounded-3xl p-8">
                        {step === 0 && <>
                        <div>
                            <label className={labelCls}>Campaign name *</label>
                            <input value={form.campaign_name} onChange={(e) => setField({ campaign_name: e.target.value })} placeholder="e.g. Weekend studio launch"
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                            <p className="text-[11px] text-[#BBB] mt-2 font-medium">This is private to your team and makes campaigns easier to find later.</p>
                        </div>
                        <div>
                            <label className={labelCls}>Reward *</label>
                            <select value={form.reward_id} onChange={(e) => setField({ reward_id: e.target.value })} disabled={rewardsState === 'loading'}
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all disabled:opacity-50">
                                <option value="">Choose a reward…</option>
                                {rewardChoices.map((r) => <option key={r.id} value={r.id}>{rewardLabel(r)}</option>)}
                            </select>
                            {rewardsState === 'loading' ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">Checking which of your rewards are live…</p>
                            ) : rewardsState === 'error' ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">Your rewards failed to load — refresh the page to try again.</p>
                            ) : rewards.length === 0 ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">You have no live rewards yet — add one under My Rewards first.</p>
                            ) : null}
                        </div>
                        </>}

                        {step === 1 && <>
                        <div>
                            <label className={labelCls}>Run dates <span className="text-[#CCC] normal-case tracking-normal font-medium">(empty = always live)</span></label>
                            <div className="flex items-center gap-3">
                                <input type="date" value={form.starts_on} onChange={(e) => setField({ starts_on: e.target.value })}
                                    className="flex-1 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                                <span className="text-[#AAA] text-xs font-black uppercase">to</span>
                                <input type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setField({ ends_on: e.target.value })}
                                    className="flex-1 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>Days <span className="text-[#CCC] normal-case tracking-normal font-medium">(none = every day)</span></label>
                            <div className="flex gap-2 flex-wrap">
                                {DOW.map((d, i) => (
                                    <button key={d} type="button" onClick={() => setField({ active_days: toggleIn(form.active_days, i) })} className={chip(form.active_days.includes(i))}>{d}</button>
                                ))}
                            </div>
                        </div>
                        </>}

                        {step === 2 && <>
                        <div>
                            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">
                                <input type="checkbox" checked={hoursOn} onChange={(e) => setField(e.target.checked ? { active_hour_start: 8, active_hour_end: 20 } : { active_hour_start: null, active_hour_end: null })} className="accent-[#E8D200]" />
                                Only certain hours
                            </label>
                            {hoursOn && (
                                <div className="flex items-center gap-3">
                                    <select value={form.active_hour_start} onChange={(e) => setField({ active_hour_start: Number(e.target.value) })} className="h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                    <span className="text-[#AAA] text-xs font-black uppercase">to</span>
                                    <select value={form.active_hour_end} onChange={(e) => setField({ active_hour_end: Number(e.target.value) })} className="h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={labelCls}>Who sees it <span className="text-[#CCC] normal-case tracking-normal font-medium">(none = everyone nearby)</span></label>
                            <div className="flex gap-2 flex-wrap">
                                {ACTIVITIES.map((a) => (
                                    <button key={a} type="button" onClick={() => setField({ target_activities: toggleIn(form.target_activities, a) })} className={chip(form.target_activities.includes(a)) + ' capitalize'}>{a}</button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#BBB] mt-2 font-medium">Match members by the activities they care about.</p>
                        </div>

                        <div>
                            <label className={labelCls}>Show at most <span className="text-[#CCC] normal-case tracking-normal font-medium">(per member / day)</span></label>
                            <input type="number" min={1} value={form.max_impressions_per_user_per_day ?? ''} placeholder="No limit"
                                onChange={(e) => setField({ max_impressions_per_user_per_day: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                        </div>

                        <div className="flex items-start gap-3 p-4 rounded-2xl border border-[#E8D200]/40 bg-[#E8D200]/5">
                            <Sparkles size={15} className="text-[#8a7600] shrink-0 mt-0.5" />
                            <p className="text-[11px] text-[#8a7600] font-bold leading-relaxed">
                                This programme is in beta. Sending your campaign for review never makes it live automatically; the POWR team confirms availability and launch timing first.
                            </p>
                        </div>
                        </>}
                    </div>
                </div>

                <div className="flex items-center justify-between border-t border-[#E6E6E1] mt-8 pt-6">
                    <button type="button" onClick={() => moveStep(-1)} disabled={step === 0 || saving} className="h-11 px-5 text-[10px] font-black uppercase tracking-[0.2em] text-[#777] hover:text-[#222] disabled:opacity-30">Back</button>
                    {step < STEPS.length - 1 ? (
                        <button type="button" onClick={() => moveStep(1)} disabled={saving} className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full disabled:opacity-50">{saving ? 'Saving...' : 'Save & continue'}</button>
                    ) : (
                        <button type="submit" disabled={saving} className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full disabled:opacity-50">{saving ? 'Sending...' : 'Submit for review'}</button>
                    )}
                </div>
            </form>
        );
    }

    // ── List view ────────────────────────────────────────────────────────────
    return (
        <div className="py-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex items-start justify-between gap-6 mb-12 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="h-[1px] w-10 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Location Boosts</span>
                        {isAdmin && !placementsEnabled && (
                            <span className="px-2.5 py-1 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[8px] font-black uppercase tracking-[0.2em] text-[#8B5CF6]">Admin preview · off for brands</span>
                        )}
                    </div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">Placements</h1>
                    <p className="text-[#888] text-[11px] max-w-xl font-black uppercase tracking-[0.35em] leading-relaxed">
                        Boost one of your rewards for members in a place, at the times that matter.
                    </p>
                </div>
                <button onClick={openCreate} disabled={loading} className="flex items-center gap-3 h-12 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-40 disabled:hover:translate-y-0">
                    <Plus size={15} /> New Placement
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-6">
                    <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666] font-black">Loading…</span>
                </div>
            ) : placements.length === 0 ? (
                // A placement only ever boosts a live reward, so without one the
                // wizard is a dead end — send them to get a reward live first.
                rewardsState === 'ready' && rewards.length === 0 ? (
                    <div className="py-28 text-center border border-dashed border-[#E0E0DB] rounded-3xl bg-white/40">
                        <Gift size={32} className="text-[#E6E6E1] mx-auto mb-4" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCC] font-black mb-2">No live rewards to boost</p>
                        <p className="text-xs text-[#BBB] mb-6 max-w-sm mx-auto leading-relaxed">A placement puts one of your live rewards in front of members in a place. Get a reward live first, then come back and paint its area.</p>
                        <Link to="/partner/rewards" className="inline-flex items-center h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                            Go to my rewards
                        </Link>
                    </div>
                ) : (
                    <div className="py-28 text-center border border-dashed border-[#E0E0DB] rounded-3xl bg-white/40">
                        <MapPin size={32} className="text-[#E6E6E1] mx-auto mb-4" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCC] font-black mb-2">No placements yet</p>
                        <p className="text-xs text-[#BBB] mb-6">Pick a reward and paint the area where it should shine.</p>
                        <button onClick={openCreate} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                            Create your first placement
                        </button>
                    </div>
                )
            ) : (
                <div className="grid gap-3">
                    {placements.map((p) => {
                        const r = p.rewards || rewardById(p.reward_id);
                        const editable = p.status === 'draft' || p.status === 'rejected';
                        const statusTone = p.status === 'live'
                            ? 'bg-[#10B981]/10 text-[#10B981]'
                            : p.status === 'rejected'
                                ? 'bg-red-50 text-red-500'
                                : p.status === 'pending_review'
                                    ? 'bg-[#E8D200]/15 text-[#8a7600]'
                                    : 'bg-[#F4F4F1] text-[#888]';
                        return (
                            <div key={p.id} className="flex items-center gap-5 bg-white border border-[#E6E6E1] rounded-3xl px-7 py-5">
                                {r?.image_url ? (
                                    <img src={r.image_url} alt="" className="w-11 h-11 rounded-2xl object-contain border border-[#E6E6E1] p-1 shrink-0" />
                                ) : (
                                    <div className="w-11 h-11 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                        <MapPin size={17} className="text-[#8a7600]" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-[#1A1A1A] truncate">{p.campaign_name || r?.title || 'Reward'}</div>
                                    {p.campaign_name && <div className="text-[11px] text-[#777] mt-0.5 truncate">{r?.title || 'Reward'}</div>}
                                    <div className="text-[10px] text-[#AAA] font-black uppercase tracking-[0.15em] mt-1">
                                        {cellCounts[p.id] ?? 0} square{(cellCounts[p.id] ?? 0) === 1 ? '' : 's'}
                                        {' · '}{p.active_days?.length ? p.active_days.map((d) => DOW[d]).join(' ') : 'any day'}
                                        {p.active_hour_start != null ? ` · ${p.active_hour_start}:00–${p.active_hour_end}:00` : ''}
                                        {(p.starts_at || p.ends_at) ? ` · ${isoToDateInput(p.starts_at) || '…'}→${isoToDateInput(p.ends_at) || '…'}` : ''}
                                        {p.target_activities?.length ? ` · ${p.target_activities.join(', ')}` : ''}
                                    </div>
                                </div>
                                {stats[p.id] && (stats[p.id].surfaced > 0 || stats[p.id].notified > 0 || stats[p.id].redeemed > 0) && (
                                    <div className="hidden md:flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.1em] text-[#AAA] mr-1 shrink-0" title="Seen · Visited · Pushed · Redeemed">
                                        <span className="flex items-center gap-1.5"><Eye size={13} /> {stats[p.id].surfaced}</span>
                                        <span className="flex items-center gap-1.5"><Footprints size={13} /> {stats[p.id].presence}</span>
                                        {stats[p.id].notified > 0 && <span className="flex items-center gap-1.5"><Bell size={13} /> {stats[p.id].notified}</span>}
                                        <span className="flex items-center gap-1.5 text-[#8a7600]"><Gift size={13} /> {stats[p.id].redeemed}</span>
                                    </div>
                                )}
                                <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shrink-0 ${statusTone}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${p.status === 'live' ? 'bg-[#10B981] animate-pulse' : p.status === 'pending_review' ? 'bg-[#8a7600]' : 'bg-current'}`} />
                                    {statusLabel(p.status)}
                                </span>
                                {editable ? <>
                                    <button onClick={() => openEdit(p)} className="h-9 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all shrink-0">{p.status === 'rejected' ? 'Revise' : 'Continue'}</button>
                                    <button onClick={() => remove(p.id)} className="text-[#CCC] hover:text-red-500 transition shrink-0"><Trash2 size={16} /></button>
                                </> : (
                                    <span className="text-[9px] text-[#999] font-black uppercase tracking-[0.15em] shrink-0">{p.status === 'pending_review' ? 'POWR is reviewing' : 'Managed by POWR'}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
