import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Plus, Trash2, MapPin, ChevronLeft, Grid3x3, Sparkles, Eye, Footprints, Gift, Bell, Check, Circle, HelpCircle, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { serverErrorText } from '../../lib/serverErrors';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import PlacementGridMap from '../../components/PlacementGridMap';
import PlacementExplainer from '../../components/PlacementExplainer';
import {
    ACTIVITIES, ACTIVITY_KEYS, DOW, DOW_KEYS, DEFAULT_CENTER, GOLD, RED, AMBER,
    cellKey, parseKey, tileNW, tileBounds, boundsIntersect, buildWeekMask, mergeCells,
    startOfDayISO, endOfDayISO, isoToDateInput, effectiveStatus, STATUS_KEYS,
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
    { label: 'brandPlacements:placements.steps.offer', detail: 'brandPlacements:placements.steps.offerDetail' },
    { label: 'brandPlacements:placements.steps.place', detail: 'brandPlacements:placements.steps.placeDetail' },
    { label: 'brandPlacements:placements.steps.review', detail: 'brandPlacements:placements.steps.reviewDetail' },
]; // translation keys

export default function PartnerPlacements() {
    const { t } = useTranslation();
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
    // The explainer carries itself in the zero state; with campaigns on the page
    // it's on demand, so the list stays the point of the screen.
    const [showHow, setShowHow] = useState(false);

    const fetchData = async () => {
        if (!brand) return;
        setLoading(true);
        const [pl, rew] = await Promise.all([
            supabase
                .from('reward_placements')
                .select('id, campaign_name, status, review_note, active, reward_id, starts_at, ends_at, active_days, active_hour_start, active_hour_end, target_activities, max_impressions_per_user_per_day, created_at, rewards!inner(title, brand_name, image_url)')
                .ilike('rewards.brand_name', brand)
                .order('created_at', { ascending: false }),
            supabase.from('rewards').select('id, title, image_url, powr_cost').ilike('brand_name', brand).eq('active', true).order('title'),
        ]);
        if (pl.error) toast.error(t('brandPlacements:placements.toast.loadFailed'));
        else setPlacements(pl.data || []);
        if (rew.error) setRewardsState('error');
        else { setRewards(rew.data || []); setRewardsState('ready'); }

        const ids = (pl.data || []).map((p) => p.id);
        if (ids.length) {
            // Counted server-side: fetching cell rows to tally them hit
            // PostgREST's 1000-row cap once a single large area existed.
            const [{ data: cells }, { data: s }] = await Promise.all([
                supabase.rpc('get_placement_cell_counts', { p_placement_ids: ids }),
                supabase.rpc('get_placement_stats', { p_placement_ids: ids }),
            ]);
            const counts = {};
            for (const c of cells ?? []) counts[c.placement_id] = Number(c.cells);
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
        if (!form.reward_id) { toast.error(t('brandPlacements:placements.toast.chooseReward')); return; }
        if (!form.campaign_name.trim()) { toast.error(t('brandPlacements:placements.toast.nameCampaign')); return; }
        if (requireCells && form.cells.size === 0) { toast.error(t('brandPlacements:placements.toast.paintOne')); return; }
        if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) { toast.error(t('brandPlacements:placements.toast.endBeforeStart')); return; }
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
            if (/CELL_CONFLICT/.test(err.message)) toast.error(t('brandPlacements:placements.toast.cellConflict'));
            else toast.error(serverErrorText(err));
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
            if (error) { toast.error(serverErrorText(error)); return; }
        } else {
            // Create: the row is inserted with its final schedule, so the RPC's
            // stored-schedule conflict check already sees the right one. A conflict
            // leaves a cell-less row (which never resolves) and the form keeps the
            // id, so a retry becomes a clean update.
            const { data, error } = await supabase.from('reward_placements').insert([payload]).select('id').single();
            if (error) { setSaving(false); toast.error(serverErrorText(error)); return; }
            placementId = data.id;
            const { error: cellErr } = await supabase.rpc('set_placement_cells', { p_placement_id: placementId, p_cells: flat });
            setSaving(false);
            if (cellErr) { cellFail(cellErr); setForm((f) => f && ({ ...f, id: placementId })); return; }
        }
        setForm((current) => current && ({ ...current, id: placementId }));
        toast.success(t('brandPlacements:placements.toast.draftSaved'));
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
        if (error) { toast.error(serverErrorText(error)); return; }
        toast.success(t('brandPlacements:placements.toast.submitted'));
        setForm(null);
        fetchData();
    };

    const remove = async (id) => {
        if (!window.confirm(t('brandPlacements:placements.toast.confirmRemove'))) return;
        const { error } = await supabase.from('reward_placements').delete().eq('id', id);
        if (error) { toast.error(t('brandPlacements:placements.toast.deleteFailed')); return; }
        toast.success(t('brandPlacements:placements.toast.removed'));
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
        const rewardLabel = (r) => (r.inactive ? t('brandPlacements:placements.form.inactive', { title: r.title }) : r.title);
        const chosenReward = rewardChoices.find((r) => r.id === form.reward_id);
        return (
            <form onSubmit={(e) => { e.preventDefault(); submitForReview(); }} className="py-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
                <button type="button" onClick={() => setForm(null)} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#999] hover:text-[#8a7600] transition-colors mb-8">
                    <ChevronLeft size={14} /> {t('brandPlacements:placements.form.back')}
                </button>

                <div className="flex items-start justify-between gap-6 mb-10 flex-wrap">
                    <div>
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-3">{form.id ? t('brandPlacements:placements.form.editTitle') : t('brandPlacements:placements.form.newTitle')}</h1>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{t('brandPlacements:placements.form.subtitle')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {form.id && (
                            <button type="button" onClick={() => remove(form.id)} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 hover:text-red-500 transition-colors">{t('brandPlacements:placements.form.delete')}</button>
                        )}
                        <button type="button" onClick={() => setForm(null)} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors">{t('common:actions.cancel')}</button>
                        <button type="button" onClick={() => saveDraft({ requireCells: false })} disabled={saving} className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:text-[#222] transition-colors disabled:opacity-50">
                            {t('brandPlacements:placements.form.saveDraft')}
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
                                    <span className={`block text-[10px] font-black uppercase tracking-[0.18em] truncate ${current ? 'text-[#1A1A1A]' : 'text-[#999]'}`}>{t(item.label)}</span>
                                    <span className="hidden md:block text-[10px] text-[#AAA] mt-0.5 truncate">{t(item.detail)}</span>
                                </span>
                            </li>
                        );
                    })}
                </ol>

                <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
                    {step === 1 ? <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666]">{t('brandPlacements:placements.form.coverage')}</label>
                            <div className="flex items-center gap-4 text-[11px]">
                                <span className="flex items-center gap-1.5 text-[#666] font-bold"><Grid3x3 size={13} /> {t('brandPlacements:placements.squares', { count: form.cells.size })}</span>
                                {form.cells.size > 0 && (
                                    <button type="button" onClick={() => setField({ cells: new Set() })} className="text-[#8a7600] font-black uppercase tracking-[0.15em] text-[10px] hover:underline">{t('brandPlacements:placements.form.clear')}</button>
                                )}
                            </div>
                        </div>
                        <PlacementGridMap form={form} toggleCell={toggleCell} onPaint={paintCells} onEraseArea={eraseArea} excludeId={form.id} />
                        <div className="flex items-center gap-4 text-[10px] text-[#999] font-black uppercase tracking-[0.15em]">
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: GOLD, opacity: 0.6 }} /> {t('brandPlacements:placements.form.legend.selected')}</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: RED, opacity: 0.45 }} /> {t('brandPlacements:placements.form.legend.booked')}</span>
                            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: AMBER, opacity: 0.45 }} /> {t('brandPlacements:placements.form.legend.requested')}</span>
                        </div>
                    </div> : (
                        <div className="border border-[#E6E6E1] bg-white p-8 min-h-[420px] flex flex-col justify-between">
                            <div>
                                <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{step === 0 ? t('brandPlacements:placements.form.yourOffer') : t('brandPlacements:placements.form.summary')}</span>
                                <h2 className="text-3xl font-light tracking-tight text-[#1A1A1A] mt-4">{step === 0 ? t('brandPlacements:placements.form.startTitle') : form.campaign_name || t('brandPlacements:placements.form.untitled')}</h2>
                                <p className="text-sm text-[#777] leading-relaxed mt-3 max-w-md">
                                    {step === 0
                                        ? t('brandPlacements:placements.form.startBody')
                                        : t('brandPlacements:placements.form.reviewBody')}
                                </p>
                            </div>
                            {step === 2 && (
                                <dl className="border-t border-[#E6E6E1] pt-5 grid gap-4 text-sm">
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">{t('brandPlacements:placements.form.summaryReward')}</dt><dd className="text-[#222] font-semibold mt-1">{chosenReward ? rewardLabel(chosenReward) : t('brandPlacements:placements.form.notChosen')}</dd></div>
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">{t('brandPlacements:placements.form.summaryArea')}</dt><dd className="text-[#222] font-semibold mt-1">{form.cells.size ? t('brandPlacements:placements.form.selectedSquares', { count: form.cells.size }) : t('brandPlacements:placements.form.notChosen')}</dd></div>
                                    <div><dt className="text-[10px] uppercase tracking-[0.2em] text-[#AAA] font-black">{t('brandPlacements:placements.form.summaryTiming')}</dt><dd className="text-[#222] font-semibold mt-1">{form.starts_on || form.ends_on ? t('brandPlacements:placements.form.dateRange', { start: form.starts_on || t('brandPlacements:placements.form.open'), end: form.ends_on || t('brandPlacements:placements.form.open') }) : t('brandPlacements:placements.form.alwaysOn')}</dd></div>
                                </dl>
                            )}
                        </div>
                    )}

                    <div className="space-y-8 bg-white border border-[#E6E6E1] rounded-3xl p-8">
                        {step === 0 && <>
                        <div>
                            <label className={labelCls}>{t('brandPlacements:placements.form.campaignName')}</label>
                            <input value={form.campaign_name} onChange={(e) => setField({ campaign_name: e.target.value })} placeholder={t('brandPlacements:placements.form.campaignNamePlaceholder')}
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                            <p className="text-[11px] text-[#BBB] mt-2 font-medium">{t('brandPlacements:placements.form.campaignNameHint')}</p>
                        </div>
                        <div>
                            <label className={labelCls}>{t('brandPlacements:placements.form.reward')}</label>
                            <select value={form.reward_id} onChange={(e) => setField({ reward_id: e.target.value })} disabled={rewardsState === 'loading'}
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all disabled:opacity-50">
                                <option value="">{t('brandPlacements:placements.form.chooseReward')}</option>
                                {rewardChoices.map((r) => <option key={r.id} value={r.id}>{rewardLabel(r)}</option>)}
                            </select>
                            {rewardsState === 'loading' ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">{t('brandPlacements:placements.form.rewardsLoading')}</p>
                            ) : rewardsState === 'error' ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">{t('brandPlacements:placements.form.rewardsError')}</p>
                            ) : rewards.length === 0 ? (
                                <p className="text-[11px] text-[#BBB] mt-2 font-medium">{t('brandPlacements:placements.form.noRewards')}</p>
                            ) : null}
                        </div>
                        </>}

                        {step === 1 && <>
                        <div>
                            <label className={labelCls}><Trans i18nKey="brandPlacements:placements.form.runDates" components={{ muted: <span className="text-[#CCC] normal-case tracking-normal font-medium" /> }} /></label>
                            <div className="flex items-center gap-3">
                                <input type="date" value={form.starts_on} onChange={(e) => setField({ starts_on: e.target.value })}
                                    className="flex-1 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                                <span className="text-[#AAA] text-xs font-black uppercase">{t('brandPlacements:placements.form.dateTo')}</span>
                                <input type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setField({ ends_on: e.target.value })}
                                    className="flex-1 h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}><Trans i18nKey="brandPlacements:placements.form.days" components={{ muted: <span className="text-[#CCC] normal-case tracking-normal font-medium" /> }} /></label>
                            <div className="flex gap-2 flex-wrap">
                                {DOW.map((d, i) => (
                                    <button key={d} type="button" onClick={() => setField({ active_days: toggleIn(form.active_days, i) })} className={chip(form.active_days.includes(i))}>{t(DOW_KEYS[i])}</button>
                                ))}
                            </div>
                        </div>
                        </>}

                        {step === 2 && <>
                        <div>
                            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">
                                <input type="checkbox" checked={hoursOn} onChange={(e) => setField(e.target.checked ? { active_hour_start: 8, active_hour_end: 20 } : { active_hour_start: null, active_hour_end: null })} className="accent-[#E8D200]" />
                                {t('brandPlacements:placements.form.certainHours')}
                            </label>
                            {hoursOn && (
                                <div className="flex items-center gap-3">
                                    <select value={form.active_hour_start} onChange={(e) => setField({ active_hour_start: Number(e.target.value) })} className="h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                    <span className="text-[#AAA] text-xs font-black uppercase">{t('brandPlacements:placements.form.hourTo')}</span>
                                    <select value={form.active_hour_end} onChange={(e) => setField({ active_hour_end: Number(e.target.value) })} className="h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm">
                                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={labelCls}><Trans i18nKey="brandPlacements:placements.form.whoSees" components={{ muted: <span className="text-[#CCC] normal-case tracking-normal font-medium" /> }} /></label>
                            <div className="flex gap-2 flex-wrap">
                                {ACTIVITIES.map((a) => (
                                    <button key={a} type="button" onClick={() => setField({ target_activities: toggleIn(form.target_activities, a) })} className={chip(form.target_activities.includes(a)) + ' capitalize'}>{ACTIVITY_KEYS[a] ? t(ACTIVITY_KEYS[a]) : a}</button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#BBB] mt-2 font-medium">{t('brandPlacements:placements.form.whoSeesHint')}</p>
                        </div>

                        <div>
                            <label className={labelCls}><Trans i18nKey="brandPlacements:placements.form.showAtMost" components={{ muted: <span className="text-[#CCC] normal-case tracking-normal font-medium" /> }} /></label>
                            <input type="number" min={1} value={form.max_impressions_per_user_per_day ?? ''} placeholder={t('brandPlacements:placements.form.noLimit')}
                                onChange={(e) => setField({ max_impressions_per_user_per_day: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                                className="w-full h-14 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] focus:border-[#E8D200]/50 outline-none transition-all" />
                        </div>

                        <div className="flex items-start gap-3 p-4 rounded-2xl border border-[#E8D200]/40 bg-[#E8D200]/5">
                            <Sparkles size={15} className="text-[#8a7600] shrink-0 mt-0.5" />
                            <p className="text-[11px] text-[#8a7600] font-bold leading-relaxed">
                                {t('brandPlacements:placements.form.beta')}
                            </p>
                        </div>
                        </>}
                    </div>
                </div>

                <div className="flex items-center justify-between border-t border-[#E6E6E1] mt-8 pt-6">
                    <button type="button" onClick={() => moveStep(-1)} disabled={step === 0 || saving} className="h-11 px-5 text-[10px] font-black uppercase tracking-[0.2em] text-[#777] hover:text-[#222] disabled:opacity-30">{t('common:actions.back')}</button>
                    {step < STEPS.length - 1 ? (
                        <button type="button" onClick={() => moveStep(1)} disabled={saving} className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full disabled:opacity-50">{saving ? t('brandPlacements:placements.form.saving') : t('brandPlacements:placements.form.saveContinue')}</button>
                    ) : (
                        <button type="submit" disabled={saving} className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full disabled:opacity-50">{saving ? t('brandPlacements:placements.form.sending') : t('brandPlacements:placements.form.submit')}</button>
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
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandPlacements:placements.eyebrow')}</span>
                        {isAdmin && !placementsEnabled && (
                            <span className="px-2.5 py-1 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[8px] font-black uppercase tracking-[0.2em] text-[#8B5CF6]">{/* admin-only: stays English */}Admin preview · off for brands</span>
                        )}
                    </div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">{t('brandPlacements:placements.title')}</h1>
                    <p className="text-[#888] text-[11px] max-w-xl font-black uppercase tracking-[0.35em] leading-relaxed">
                        {t('brandPlacements:placements.intro')}
                    </p>
                    {placements.length > 0 && (
                        <button onClick={() => setShowHow((v) => !v)} className="flex items-center gap-2 mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-[#999] hover:text-[#8a7600] transition-colors">
                            {showHow ? <X size={13} /> : <HelpCircle size={13} />}
                            {showHow ? t('brandPlacements:placements.hideHow') : t('brandPlacements:placements.showHow')}
                        </button>
                    )}
                </div>
                <button onClick={openCreate} disabled={loading} className="flex items-center gap-3 h-12 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all hover:translate-y-[-2px] shadow-lg shadow-[#E8D200]/20 disabled:opacity-40 disabled:hover:translate-y-0">
                    <Plus size={15} /> {t('brandPlacements:placements.newPlacement')}
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-6">
                    <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666] font-black">{t('common:states.loading')}</span>
                </div>
            ) : placements.length === 0 ? (
                // Nothing to list yet, so the page has to explain the product
                // instead of just naming it — the explainer IS the zero state.
                <div className="space-y-4">
                    <PlacementExplainer brandName={brand} rewardTitle={rewards[0]?.title} logoUrl={rewards[0]?.image_url} points={rewards[0]?.powr_cost} />
                    {/* A placement only ever boosts a live reward, so without one
                        the wizard is a dead end — send them to get one live first. */}
                    {rewardsState === 'ready' && rewards.length === 0 ? (
                        <div className="flex flex-wrap items-center gap-6 bg-white border border-[#E6E6E1] rounded-3xl px-8 py-7">
                            <Gift size={24} className="text-[#8a7600] shrink-0" />
                            <div className="flex-1 min-w-[240px]">
                                <p className="text-sm font-bold text-[#1A1A1A]">{t('brandPlacements:placements.noReward.title')}</p>
                                <p className="text-xs text-[#999] mt-1 leading-relaxed">{t('brandPlacements:placements.noReward.body')}</p>
                            </div>
                            <Link to="/partner/rewards" className="inline-flex items-center h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                                {t('brandPlacements:placements.noReward.cta')}
                            </Link>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-6 bg-white border border-[#E6E6E1] rounded-3xl px-8 py-7">
                            <MapPin size={24} className="text-[#8a7600] shrink-0" />
                            <div className="flex-1 min-w-[240px]">
                                <p className="text-sm font-bold text-[#1A1A1A]">{t('brandPlacements:placements.ready.title')}</p>
                                <p className="text-xs text-[#999] mt-1 leading-relaxed">{t('brandPlacements:placements.ready.body')}</p>
                            </div>
                            <button onClick={openCreate} className="h-11 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/15">
                                {t('brandPlacements:placements.ready.cta')}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid gap-3">
                    {showHow && (
                        <div className="mb-5 animate-in fade-in slide-in-from-top-2 duration-500">
                            <PlacementExplainer brandName={brand} rewardTitle={rewards[0]?.title} logoUrl={rewards[0]?.image_url} points={rewards[0]?.powr_cost} />
                        </div>
                    )}
                    {placements.map((p) => {
                        const r = p.rewards || rewardById(p.reward_id);
                        const editable = p.status === 'draft' || p.status === 'rejected';
                        // Shown state folds in pause + flight window; the stored
                        // column only tracks review.
                        const shown = effectiveStatus(p);
                        const statusTone = shown === 'live'
                            ? 'bg-[#10B981]/10 text-[#10B981]'
                            : shown === 'scheduled'
                                ? 'bg-sky-50 text-sky-600'
                                : shown === 'rejected'
                                    ? 'bg-red-50 text-red-500'
                                    : shown === 'pending_review'
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
                                    <div className="text-sm font-bold text-[#1A1A1A] truncate">{p.campaign_name || r?.title || t('brandPlacements:placements.rewardFallback')}</div>
                                    {p.campaign_name && <div className="text-[11px] text-[#777] mt-0.5 truncate">{r?.title || t('brandPlacements:placements.rewardFallback')}</div>}
                                    <div className="text-[10px] text-[#AAA] font-black uppercase tracking-[0.15em] mt-1">
                                        {t('brandPlacements:placements.squares', { count: cellCounts[p.id] ?? 0 })}
                                        {' · '}{p.active_days?.length ? p.active_days.map((d) => (DOW_KEYS[d] ? t(DOW_KEYS[d]) : DOW[d])).join(' ') : t('brandPlacements:placements.anyDay')}
                                        {p.active_hour_start != null ? ` · ${p.active_hour_start}:00–${p.active_hour_end}:00` : ''}
                                        {(p.starts_at || p.ends_at) ? ` · ${isoToDateInput(p.starts_at) || '…'}→${isoToDateInput(p.ends_at) || '…'}` : ''}
                                        {p.target_activities?.length ? ` · ${p.target_activities.map((a) => (ACTIVITY_KEYS[a] ? t(ACTIVITY_KEYS[a]) : a)).join(', ')}` : ''}
                                    </div>
                                </div>
                                {stats[p.id] && (stats[p.id].surfaced > 0 || stats[p.id].notified > 0 || stats[p.id].redeemed > 0) && (
                                    <div className="hidden md:flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.1em] text-[#AAA] mr-1 shrink-0" title={t('brandPlacements:placements.statsTitle')}>
                                        <span className="flex items-center gap-1.5"><Eye size={13} /> {stats[p.id].surfaced}</span>
                                        <span className="flex items-center gap-1.5"><Footprints size={13} /> {stats[p.id].presence}</span>
                                        {stats[p.id].notified > 0 && <span className="flex items-center gap-1.5"><Bell size={13} /> {stats[p.id].notified}</span>}
                                        <span className="flex items-center gap-1.5 text-[#8a7600]"><Gift size={13} /> {stats[p.id].redeemed}</span>
                                    </div>
                                )}
                                <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shrink-0 ${statusTone}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${shown === 'live' ? 'bg-[#10B981] animate-pulse' : shown === 'pending_review' ? 'bg-[#8a7600]' : 'bg-current'}`} />
                                    {t(STATUS_KEYS[shown])}
                                </span>
                                {editable ? <>
                                    <button onClick={() => openEdit(p)} className="h-9 px-5 text-[9px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all shrink-0">{p.status === 'rejected' ? t('brandPlacements:placements.revise') : t('brandPlacements:placements.continue')}</button>
                                    <button onClick={() => remove(p.id)} className="text-[#CCC] hover:text-red-500 transition shrink-0"><Trash2 size={16} /></button>
                                </> : (
                                    <span className="text-[9px] text-[#999] font-black uppercase tracking-[0.15em] shrink-0">{p.status === 'pending_review' ? t('brandPlacements:placements.reviewing') : t('brandPlacements:placements.managed')}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
