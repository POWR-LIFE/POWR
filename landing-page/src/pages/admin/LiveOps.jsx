import {
    Activity, AlertTriangle, BellRing, CheckCircle, Clock, MapPin, Radio,
    RefreshCw, Smartphone, X, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    checkinPathLabel,
    collapseTimeline,
    displayRate,
    elapsedMinutes,
    formatAgo,
    formatDuration,
    isNoisePush,
    isOtaBehind,
    lastHeardLabel,
    otaLabel,
    pushVerdict,
    stageDeltas,
    stageLabel,
    visitAlerts,
    visitStage,
} from '../../../../shared/liveops.ts';

// The e2e geofence watcher (scripts/e2e-watch.sh) as a screen.
//
// Everything this page ASSERTS lives in shared/liveops.ts as pure functions with
// jest coverage (__tests__/liveops.test.ts) — stage, stuck badges, push verdicts,
// arm-burst collapse, OTA staleness, "last heard from". Everything it READS comes
// from three SECURITY DEFINER RPCs that prove is_admin() server-side
// (supabase/migrations/20260812170000_admin_liveops.sql).
//
// ⚠ Do not "simplify" this into direct table selects. gym_visits,
// gym_visit_events, geofence_region_events and push_send_log all carry admin
// read policies, so a bare select from an admin session returns EVERY user's
// location history and one forgotten .eq('user_id', …) leaks it. That has
// happened here before (the 14-site sweep).

// gym_visits and activity_sessions mutate IN PLACE — status, duration and every
// stage stamp are updates to an existing row. A created_at cursor would see a
// visit's first write and nothing after it, so the board re-polls in full.
const LIVE_POLL_MS = 15_000;

const WINDOWS = [
    { key: '24h', label: '24H', hours: 24 },
    { key: '7d',  label: '7D',  hours: 24 * 7 },
    { key: '30d', label: '30D', hours: 24 * 30 },
];

const STAGE_COLOUR = {
    checked_in: '#0EA5E9',
    claimed:    '#E8D200',
    upgraded:   '#10B981',
    closed:     '#888888',
    abandoned:  '#F43F5E',
};

const VERDICT_COLOUR = {
    good:    '#10B981',
    warn:    '#F59E0B',
    bad:     '#F43F5E',
    neutral: '#888888',
};

// Every leg is listed even when the window produced no samples, because an empty
// leg IS a finding ("nothing has been proven to draw in 30 days") and a table
// that quietly omits its empty rows hides exactly that.
const DELTA_LABELS = [
    { key: 'enter_to_checkin',     label: 'Enter → checked in' },
    { key: 'checkin_to_claim',     label: 'Checked in → claimed' },
    { key: 'claim_to_upgrade',     label: 'Claimed → upgraded' },
    { key: 'exit_to_close',        label: 'Exit → closed' },
    { key: 'close_to_push_sent',   label: 'Closed → push sent' },
    { key: 'push_sent_to_drawn',   label: 'Push sent → banner drawn' },
    { key: 'door_to_notification', label: 'Door → notification' },
];

const COUNTER_LABELS = [
    { key: 'exit_refuted',           label: 'Exits refuted (fix said still inside)' },
    { key: 'wake_starved_self_poll', label: 'Wake-starved self polls' },
    { key: 'coarse_rejected',        label: 'Coarse fixes rejected' },
    { key: 'sweep_no_permission',    label: 'Sweeps with no background permission' },
    { key: 'sweep_handoff',          label: 'Sweeps that handed off' },
    { key: 'sweep_session_active',   label: 'Sweeps no-oped (session active)' },
    { key: 'auth_stale',             label: 'Auth stale on a wake' },
    { key: 'stream_start_failed',    label: 'Dwell stream failed to start' },
    { key: 'sentinel_exit',          label: 'Sentinel exits (travel re-arm)' },
];

const timeOfDay = (iso) =>
    new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveOps() {
    const toast = useToast();
    // ⚠ NEVER put `toast` (or anything else whose identity is not stable) in the
    // dependency array of a loader that an effect then depends on. This page
    // strobed because of exactly that: fetch → setState → render → new callback →
    // effect fires → fetch, forever, hammering the RPC. useToast is memoised now,
    // but the ref makes this page immune to the mistake rather than reliant on
    // someone else's memo.
    const toastRef = useRef(toast);
    toastRef.current = toast;

    const [tab, setTab] = useState('live');
    const [includeTest, setIncludeTest] = useState(false);
    const [windowKey, setWindowKey] = useState('7d');

    const [board, setBoard] = useState([]);
    // `ready` is "we have asked at least once" — the full-page spinner is a
    // FIRST-load state only. Flipping it back on for every 15s poll would blank
    // the board and redraw it four times a minute, which is its own flicker.
    const [boardReady, setBoardReady] = useState(false);
    const [boardBusy, setBoardBusy] = useState(false);
    const [boardAt, setBoardAt] = useState(null);
    const [aggregates, setAggregates] = useState(null);
    const [aggReady, setAggReady] = useState(false);
    const [aggBusy, setAggBusy] = useState(false);
    const [openVisit, setOpenVisit] = useState(null);

    const loadBoard = useCallback(async ({ quiet } = {}) => {
        if (!quiet) setBoardBusy(true);
        const { data, error } = await supabase.rpc('admin_liveops_board', {
            p_window_hours: 12,
            p_include_test: includeTest,
            p_limit: 100,
        });
        if (error) {
            // The RPC refuses non-admins server-side; surface that rather than an
            // empty board, which would read as "nobody is in a gym". Quiet polls
            // stay silent — a field test runs for hours and one blip must not
            // stack up toasts or clear the board off the screen.
            if (!quiet) toastRef.current.error(error.message);
        } else {
            setBoard(data ?? []);
            setBoardAt(Date.now());
        }
        setBoardReady(true);
        setBoardBusy(false);
    }, [includeTest]);

    const loadAggregates = useCallback(async () => {
        setAggBusy(true);
        const hours = WINDOWS.find(w => w.key === windowKey)?.hours ?? 168;
        const { data, error } = await supabase.rpc('admin_liveops_aggregates', {
            p_from: new Date(Date.now() - hours * 3600_000).toISOString(),
            p_to: new Date().toISOString(),
            p_include_test: includeTest,
        });
        if (error) toastRef.current.error(error.message);
        else setAggregates(data ?? null);
        setAggReady(true);
        setAggBusy(false);
    }, [windowKey, includeTest]);

    useEffect(() => { if (tab === 'live') loadBoard(); }, [tab, loadBoard]);
    useEffect(() => { if (tab === 'aggregates') loadAggregates(); }, [tab, loadAggregates]);

    // Quiet re-poll: no spinner, no toast on a blip. A field test runs for hours
    // and a transient failure must not clear the board off the screen.
    useEffect(() => {
        if (tab !== 'live') return undefined;
        const id = setInterval(() => loadBoard({ quiet: true }), LIVE_POLL_MS);
        return () => clearInterval(id);
    }, [tab, loadBoard]);

    const open = board.filter(r => !r.ended_at);
    const recent = board.filter(r => r.ended_at);
    const alerting = board.filter(r => visitAlerts(r).length > 0);

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#10B981]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Subsystem / Detection</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Live Ops</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Who is in a gym right now, and how the earn chain is behaving — check-in, claim, upgrade, exit, push.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {tab === 'live' && (
                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black">
                            {boardAt ? `Updated ${formatAgo(new Date(boardAt).toISOString())}` : 'Loading…'}
                        </span>
                    )}
                    <button
                        onClick={() => (tab === 'live' ? loadBoard() : loadAggregates())}
                        className="w-12 h-12 rounded-2xl bg-white border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={boardBusy || aggBusy ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Tabs + test toggle */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div className="flex gap-3">
                    {[{ k: 'live', l: 'Live Board' }, { k: 'aggregates', l: 'Aggregates' }].map(t => (
                        <button
                            key={t.k}
                            onClick={() => setTab(t.k)}
                            className={`px-6 h-12 rounded-2xl text-[10px] uppercase tracking-[0.35em] font-black border transition-all ${
                                tab === t.k
                                    ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]'
                                    : 'bg-white border-[#E6E6E1] text-[#888888] hover:text-[#333333]'
                            }`}
                        >{t.l}</button>
                    ))}
                </div>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                    <span className="text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black">
                        Include test accounts
                    </span>
                    <span
                        onClick={() => setIncludeTest(v => !v)}
                        className={`w-11 h-6 rounded-full transition-all relative ${includeTest ? 'bg-[#E8D200]' : 'bg-[#E6E6E1]'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${includeTest ? 'left-[22px]' : 'left-0.5'}`} />
                    </span>
                </label>
            </div>

            {tab === 'live' ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                        <Stat label="In a gym now"   value={open.length}    icon={MapPin}        color="#10B981" desc="LIVE" loading={!boardReady} />
                        <Stat label="Needs a look"   value={alerting.length} icon={AlertTriangle} color="#F43F5E" desc="ALERTS" loading={!boardReady} />
                        <Stat label="Closed in 12h"  value={recent.length}  icon={Clock}         color="#0EA5E9" desc="RECENT" loading={!boardReady} />
                        <Stat
                            label="Pushes undrawn"
                            value={board.reduce((n, r) => n + (r.undrawn_push_count || 0), 0)}
                            icon={BellRing} color="#F97316" desc="NO RECEIPT" loading={!boardReady}
                        />
                    </div>

                    <Section title={`In a gym now (${open.length})`} />
                    {!boardReady ? (
                        <Loading label="Reading the detection layer…" />
                    ) : open.length === 0 ? (
                        <Empty text="Nobody is inside a partner geofence right now." />
                    ) : (
                        <div className="grid gap-4 mb-16">
                            {open.map(r => <VisitCard key={r.visit_id} row={r} onOpen={() => setOpenVisit(r.visit_id)} />)}
                        </div>
                    )}

                    <Section title={`Closed in the last 12 hours (${recent.length})`} />
                    {recent.length === 0 && boardReady ? (
                        <Empty text="No visits closed in the last 12 hours." />
                    ) : (
                        <div className="grid gap-4">
                            {recent.map(r => <VisitCard key={r.visit_id} row={r} onOpen={() => setOpenVisit(r.visit_id)} />)}
                        </div>
                    )}
                </>
            ) : (
                <Aggregates
                    doc={aggregates}
                    loading={!aggReady}
                    windowKey={windowKey}
                    onWindow={setWindowKey}
                />
            )}

            {openVisit && <VisitDrawer visitId={openVisit} onClose={() => setOpenVisit(null)} />}
        </div>
    );
}

// ─── Live board ───────────────────────────────────────────────────────────────

function VisitCard({ row, onOpen }) {
    const stage = visitStage(row);
    const alerts = visitAlerts(row);
    const colour = STAGE_COLOUR[stage] ?? '#888888';
    const isOpen = !row.ended_at;

    return (
        <button
            onClick={onOpen}
            className="w-full text-left bg-white border border-[#E6E6E1] rounded-3xl p-8 hover:border-[#E8D200]/40 transition-all group"
        >
            <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                        {isOpen && <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />}
                        <span className="text-xl font-bold text-[#222222] truncate">
                            {row.display_name || row.username || row.email || row.user_id.slice(0, 8)}
                        </span>
                        {row.is_test && (
                            <span className="px-2 py-0.5 rounded-full border border-[#8B5CF6]/30 text-[8px] font-black tracking-[0.2em] text-[#8B5CF6]">TEST</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#888888] font-black">
                        <MapPin size={12} />
                        <span className="truncate">{row.venue_name || row.partner_id?.slice(0, 8) || 'unknown venue'}</span>
                        <span className="text-[#DDDDDD]">/</span>
                        <span>{row.platform || '?'}</span>
                    </div>
                </div>

                <div className="text-right shrink-0">
                    <span
                        className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border"
                        style={{ color: colour, borderColor: `${colour}33`, background: `${colour}0f` }}
                    >{stageLabel(stage)}</span>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#888888] font-black mt-2">
                        {formatDuration(elapsedMinutes(row) * 60)}{isOpen ? ' inside' : ''}
                    </div>
                </div>
            </div>

            {/* Stage rail */}
            <div className="flex items-center gap-2 mt-8">
                {[
                    ['IN',      row.checked_in_at],
                    ['CLAIM',   row.claimed_at],
                    ['UPGRADE', row.upgraded_at],
                    ['EXIT',    row.ended_at],
                    ['PUSH',    row.completed_push_at],
                ].map(([label, at], i, arr) => (
                    <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full border ${at ? 'bg-[#E8D200] border-[#E8D200]' : 'bg-transparent border-[#E6E6E1]'}`} />
                            <span className={`text-[7px] font-black tracking-[0.2em] ${at ? 'text-[#666666]' : 'text-[#CCCCCC]'}`}>{label}</span>
                        </div>
                        {i < arr.length - 1 && (
                            <span className={`h-[1.5px] flex-1 mb-4 ${at ? 'bg-[#E8D200]/40' : 'bg-[#EFEFEC]'}`} />
                        )}
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6 text-[10px] uppercase tracking-[0.25em] text-[#888888] font-black">
                <span className="flex items-center gap-2">
                    <Activity size={12} /> Last heard {lastHeardLabel(row.last_heard_at, row.last_heard_kind)}
                </span>
                {row.close_reason && <span>closed · {row.close_reason}</span>}
            </div>

            {alerts.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-6">
                    {alerts.map(a => {
                        const c = a.severity === 'bad' ? '#F43F5E' : '#F59E0B';
                        return (
                            <span
                                key={a.key}
                                className="px-4 py-2 rounded-2xl border text-[9px] font-black uppercase tracking-[0.2em]"
                                style={{ color: c, borderColor: `${c}33`, background: `${c}0f` }}
                            >
                                {a.label}
                                <span className="ml-2 text-[#888888] normal-case tracking-normal font-bold">{a.detail}</span>
                            </span>
                        );
                    })}
                </div>
            )}
        </button>
    );
}

// ─── Visit drawer ─────────────────────────────────────────────────────────────

function VisitDrawer({ visitId, onClose }) {
    const toast = useToast();
    const toastRef = useRef(toast);
    toastRef.current = toast;

    const [doc, setDoc] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showNoise, setShowNoise] = useState(false);

    const load = useCallback(async ({ quiet } = {}) => {
        const { data, error } = await supabase.rpc('admin_liveops_visit', {
            p_visit_id: visitId,
            p_event_limit: 600,
        });
        if (error) { if (!quiet) toastRef.current.error(error.message); }
        else setDoc(data ?? null);
        setLoading(false);
    }, [visitId]);

    useEffect(() => { load(); }, [load]);

    // An open visit is still moving; a closed one is finished history, so stop
    // asking. Read through a ref rather than depending on `doc` — every poll
    // replaces `doc`, so a doc-keyed effect would tear down and rebuild the
    // interval on each tick and never settle.
    const endedRef = useRef(false);
    endedRef.current = !!doc?.visit?.ended_at;

    useEffect(() => {
        const id = setInterval(() => {
            if (!endedRef.current) load({ quiet: true });
        }, LIVE_POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    const timeline = useMemo(() => (doc ? collapseTimeline(doc.events || []) : []), [doc]);
    const signal = timeline.filter(e => !e.noise);
    const visible = showNoise ? timeline : signal;
    const hidden = timeline.length - signal.length;
    const pushes = (doc?.pushes || []).filter(p => !isNoisePush(p.type));

    return (
        <div className="fixed inset-0 z-[200] flex justify-end">
            <div className="absolute inset-0 bg-[#1A1A1A]/30 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl h-full bg-[#F4F4F1] border-l border-[#E6E6E1] overflow-y-auto animate-in slide-in-from-right duration-300">
                {/* Drawer header */}
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[#E6E6E1] px-8 py-6 flex items-center justify-between gap-6">
                    <div className="min-w-0">
                        <div className="text-xl font-bold text-[#222222] truncate">
                            {doc?.visit?.display_name || doc?.visit?.username || 'Visit'}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black mt-1 truncate">
                            {doc?.visit?.venue_name || '—'}
                            {doc ? ` · ${stageLabel(visitStage(doc.visit))}` : ''}
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-xl border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#333333] hover:bg-[#F4F4F1] transition-all">
                        <X size={16} />
                    </button>
                </div>

                {loading ? (
                    <Loading label="Reconstructing the journey…" />
                ) : !doc ? (
                    <Empty text="That visit no longer exists." />
                ) : (
                    <div className="px-8 py-10 space-y-12">
                        {/* Device */}
                        <div>
                            <Section title="Device" small />
                            <Panel>
                                <PanelRow label="Platform" value={doc.device?.platform || doc.visit.platform || 'unknown'} />
                                <PanelRow
                                    label="App version"
                                    value={doc.device?.app_version ? `${doc.device.app_version} (${doc.device.app_build || '?'})` : 'unknown'}
                                />
                                <PanelRow
                                    label="OTA bundle"
                                    value={`${otaLabel(doc.device)}${doc.device?.ota_channel ? ` · ${doc.device.ota_channel}` : ''}`}
                                    badge={isOtaBehind(doc.device) ? 'BEHIND' : null}
                                    badgeColour="#F97316"
                                />
                                {isOtaBehind(doc.device) && (
                                    <PanelNote>
                                        Newest bundle seen on the {doc.device?.ota_channel || 'same'} channel is{' '}
                                        {doc.device?.newest_ota_on_channel?.slice(0, 8)} — this handset has not fetched it, so
                                        whatever you are testing may not be on it yet.
                                    </PanelNote>
                                )}
                                <PanelRow
                                    label="Last heard from"
                                    value={lastHeardLabel(doc.last_heard?.at, doc.last_heard?.kind)}
                                    last
                                />
                                <PanelNote>
                                    Silence cannot distinguish a dead app from a user who went nowhere. This is the freshest
                                    footprint of any kind — not a health verdict.
                                </PanelNote>
                            </Panel>
                        </div>

                        {/* Alerts */}
                        {visitAlerts(doc.visit).length > 0 && (
                            <div>
                                <Section title="Alerts" small />
                                <div className="space-y-3">
                                    {visitAlerts(doc.visit).map(a => {
                                        const c = a.severity === 'bad' ? '#F43F5E' : '#F59E0B';
                                        return (
                                            <div key={a.key} className="rounded-2xl border p-5" style={{ borderColor: `${c}33`, background: `${c}0d` }}>
                                                <div className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: c }}>{a.label}</div>
                                                <div className="text-[11px] text-[#666666] font-bold mt-1">{a.detail}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Journey */}
                        <div>
                            <Section title="Journey" small />
                            <Panel>
                                <PanelRow label="Check-in path" value={checkinPathLabel(doc.checkin_via)} />
                                {stageDeltas(doc).map((d, i, arr) => (
                                    <div
                                        key={d.key}
                                        className={`flex items-start justify-between gap-6 py-4 ${i === arr.length - 1 ? '' : 'border-b border-[#EFEFEC]'}`}
                                    >
                                        <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black">{d.label}</span>
                                        {d.seconds != null ? (
                                            <span className="text-right shrink-0">
                                                <span className="text-sm font-bold text-[#222222]">{formatDuration(d.seconds)}</span>
                                                {d.vsThresholdSec != null && (
                                                    <span
                                                        className="block text-[9px] font-black uppercase tracking-[0.2em] mt-1"
                                                        style={{ color: d.vsThresholdSec > 0 ? '#F59E0B' : '#10B981' }}
                                                    >
                                                        {d.vsThresholdSec > 0 ? '+' : ''}{formatDuration(d.vsThresholdSec)} vs {d.thresholdLabel}
                                                    </span>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-[#AAAAAA] font-bold text-right max-w-[55%] leading-relaxed">
                                                {d.missing || '—'}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </Panel>
                        </div>

                        {/* Session */}
                        {doc.session && (
                            <div>
                                <Section title="Session" small />
                                <Panel>
                                    <PanelRow label="Type" value={doc.session.type} />
                                    <PanelRow label="Duration" value={formatDuration(doc.session.duration_sec)} />
                                    <PanelRow label="Verification" value={doc.session.verification || '—'} />
                                    <PanelRow
                                        label="Trust"
                                        value={doc.session.trust_score != null ? Number(doc.session.trust_score).toFixed(2) : '—'}
                                        badge={doc.session.flagged ? 'FLAGGED' : null}
                                        badgeColour="#F43F5E"
                                        last
                                    />
                                </Panel>
                            </div>
                        )}

                        {/* Points */}
                        {doc.points?.length > 0 && (
                            <div>
                                <Section title="Points awarded in this window" small />
                                <Panel>
                                    {doc.points.map((p, i) => (
                                        <PanelRow
                                            key={`${p.created_at}-${i}`}
                                            label={p.description || p.source || p.type}
                                            value={`${p.amount > 0 ? '+' : ''}${p.amount}`}
                                            valueColour="#8a7600"
                                            sub={timeOfDay(p.created_at)}
                                            last={i === doc.points.length - 1}
                                        />
                                    ))}
                                </Panel>
                            </div>
                        )}

                        {/* Pushes */}
                        <div>
                            <Section title="Pushes" small />
                            <Panel>
                                {pushes.length === 0 ? (
                                    <div className="py-6 text-[11px] text-[#AAAAAA] font-bold uppercase tracking-[0.2em]">
                                        No pushes sent during this visit.
                                    </div>
                                ) : pushes.map((p, i) => {
                                    const v = pushVerdict(p);
                                    return (
                                        <div
                                            key={p.id}
                                            className={`flex items-start justify-between gap-6 py-4 ${i === pushes.length - 1 ? '' : 'border-b border-[#EFEFEC]'}`}
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-sm font-bold text-[#222222] truncate">{p.title || p.type}</span>
                                                <span className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mt-1">
                                                    {timeOfDay(p.created_at)} · {p.transport || 'expo'} · {p.status}
                                                </span>
                                            </span>
                                            <span
                                                className="text-[9px] font-black uppercase tracking-[0.2em] text-right shrink-0 max-w-[45%]"
                                                style={{ color: VERDICT_COLOUR[v.severity] }}
                                            >{v.label}</span>
                                        </div>
                                    );
                                })}
                                <PanelNote>
                                    fence_refresh sends are hidden — that is the wake loop&apos;s own traffic and never draws a
                                    banner. Only the fcm_direct path stamps a device receipt, so an unstamped Expo push means
                                    &quot;we cannot see&quot;, not &quot;it failed&quot;.
                                </PanelNote>
                            </Panel>
                        </div>

                        {/* Timeline */}
                        <div>
                            <div className="flex items-center justify-between gap-6">
                                <Section title={`Timeline (${visible.length})`} small />
                                <label className="flex items-center gap-3 cursor-pointer select-none pb-6">
                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black">Show noise</span>
                                    <span
                                        onClick={() => setShowNoise(v => !v)}
                                        className={`w-11 h-6 rounded-full transition-all relative ${showNoise ? 'bg-[#E8D200]' : 'bg-[#E6E6E1]'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showNoise ? 'left-[22px]' : 'left-0.5'}`} />
                                    </span>
                                </label>
                            </div>

                            {doc.events_total > (doc.events?.length || 0) && (
                                <p className="text-[10px] text-[#888888] font-bold mb-4">
                                    Showing the most recent {doc.events.length} of {doc.events_total} events in this window.
                                </p>
                            )}
                            {hidden > 0 && !showNoise && (
                                <p className="text-[10px] text-[#888888] font-bold mb-4">
                                    {hidden} row{hidden === 1 ? '' : 's'} hidden: stream ticks, and exits for regions this device
                                    never entered — OS initial-state noise, not departures.
                                </p>
                            )}

                            <Panel>
                                {visible.length === 0 ? (
                                    <div className="py-6 text-[11px] text-[#AAAAAA] font-bold uppercase tracking-[0.2em]">
                                        No events recorded in this window.
                                    </div>
                                ) : visible.map((e, i) => (
                                    <TimelineRow key={e.key} entry={e} last={i === visible.length - 1} />
                                ))}
                            </Panel>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function TimelineRow({ entry, last }) {
    const colour =
        entry.collapsed ? '#8B5CF6'
        : entry.noise ? '#CCCCCC'
        : ['exit', 'closed_stale'].includes(entry.event) ? '#F97316'
        : ['claimed', 'upgraded', 'check_in'].includes(entry.event) ? '#8a7600'
        : ['enter', 'checked_in'].includes(entry.event) ? '#10B981'
        : '#666666';

    const detail = entry.collapsed
        ? `armed ${entry.collapsed.armed}× · ${entry.collapsed.enters} enters, ${entry.collapsed.exits} exits absorbed`
        : summariseDetail(entry.detail);

    return (
        <div className={`flex gap-5 py-3 ${last ? '' : 'border-b border-[#EFEFEC]'}`}>
            <span className="text-[10px] font-black tracking-[0.15em] text-[#AAAAAA] w-20 shrink-0 pt-0.5">
                {timeOfDay(entry.at)}
            </span>
            <span className="min-w-0">
                <span className="block text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: colour }}>
                    {entry.collapsed ? 'Arm burst' : entry.event}
                </span>
                {!!detail && <span className="block text-[10px] text-[#999999] font-bold mt-1 break-words">{detail}</span>}
            </span>
        </div>
    );
}

/** The detail blobs are small and irregular — show them, but keep them to a line. */
function summariseDetail(detail) {
    const entries = Object.entries(detail || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return '';
    return entries
        .slice(0, 6)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('  ');
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

function Aggregates({ doc, loading, windowKey, onWindow }) {
    const rate = useMemo(() => displayRate(doc?.push || []), [doc]);
    const deltas = useMemo(
        () => Object.fromEntries((doc?.deltas || []).map(d => [d.key, d])),
        [doc],
    );

    return (
        <>
            <div className="flex gap-3 mb-12">
                {WINDOWS.map(w => (
                    <button
                        key={w.key}
                        onClick={() => onWindow(w.key)}
                        className={`px-6 h-11 rounded-2xl text-[10px] uppercase tracking-[0.3em] font-black border transition-all ${
                            windowKey === w.key
                                ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                : 'bg-white border-[#E6E6E1] text-[#888888] hover:text-[#333333]'
                        }`}
                    >{w.label}</button>
                ))}
            </div>

            {loading ? (
                <Loading label="Aggregating…" />
            ) : !doc ? (
                <Empty text="No data for this window." />
            ) : (
                <div className="space-y-16">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <Stat label="Visits"          value={doc.visits.total}          icon={MapPin}      color="#0EA5E9" desc="TOTAL" />
                        <Stat label="Claimed"         value={doc.visits.claimed}        icon={CheckCircle} color="#E8D200" desc="BASE POINT" />
                        <Stat label="Upgraded"        value={doc.visits.upgraded}       icon={Zap}         color="#10B981" desc="TIER" />
                        <Stat label="Closed by exit"  value={doc.visits.closed_by_exit} icon={Radio}       color="#8B5CF6" desc="DETECTED" />
                    </div>

                    {doc.visits.excluded_over_12h > 0 && (
                        <p className="text-[10px] text-[#888888] font-bold -mt-10">
                            {doc.visits.excluded_over_12h} visit{doc.visits.excluded_over_12h === 1 ? '' : 's'} ran 12h or longer and
                            {' '}are excluded from the deltas below — those are late-write artifacts, not 12-hour workouts.
                        </p>
                    )}

                    {/* Stage deltas */}
                    <div>
                        <Section
                            title={`Stage deltas — p50 / p90 · thresholds ${doc.thresholds.dwell_minutes}m / ${doc.thresholds.upgrade_minutes}m`}
                        />
                        <Panel>
                            {DELTA_LABELS.map(({ key, label }, i) => {
                                const d = deltas[key];
                                return (
                                    <div
                                        key={key}
                                        className={`flex items-center justify-between gap-6 py-4 ${i === DELTA_LABELS.length - 1 ? '' : 'border-b border-[#EFEFEC]'}`}
                                    >
                                        <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black">{label}</span>
                                        {d ? (
                                            <span className="flex items-baseline gap-3 shrink-0">
                                                <span className="text-sm font-bold text-[#222222]">{formatDuration(d.p50_s)}</span>
                                                <span className="text-[#DDDDDD]">/</span>
                                                <span className="text-sm font-bold text-[#8a7600]">{formatDuration(d.p90_s)}</span>
                                                <span className="text-[9px] font-black text-[#AAAAAA] tracking-[0.2em]">n={d.n}</span>
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-[#CCCCCC] font-black uppercase tracking-[0.2em]">no samples</span>
                                        )}
                                    </div>
                                );
                            })}
                        </Panel>
                    </div>

                    {/* Push display rate */}
                    <div>
                        <Section title="Push display rate" />
                        <Panel>
                            <div className="flex items-center justify-between gap-6 py-4 border-b border-[#EFEFEC]">
                                <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black">Banners proven drawn</span>
                                <span
                                    className="text-2xl font-light tracking-tighter"
                                    style={{ color: rate.pct == null ? '#AAAAAA' : rate.pct > 80 ? '#10B981' : '#F43F5E' }}
                                >
                                    {rate.pct == null ? 'unmeasurable' : `${rate.pct.toFixed(0)}%`}
                                    {rate.pct != null && (
                                        <span className="text-[10px] font-black text-[#888888] tracking-[0.2em] ml-3">
                                            {rate.drawn}/{rate.measurable}
                                        </span>
                                    )}
                                </span>
                            </div>
                            <PanelNote>
                                Only the fcm_direct display path stamps a device receipt, so only those sends can prove a banner
                                drew. Everything else is counted but not scored — an unstamped Expo push means we cannot see,
                                not that it failed.
                            </PanelNote>
                            {(doc.push || []).slice(0, 12).map((p, i, arr) => (
                                <div
                                    key={`${p.type}-${p.transport}`}
                                    className={`flex items-center justify-between gap-6 py-3 ${i === arr.length - 1 ? '' : 'border-b border-[#EFEFEC]'}`}
                                >
                                    <span className="text-[11px] font-bold text-[#666666] truncate">{p.type}</span>
                                    <span className="flex items-center gap-4 shrink-0">
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#AAAAAA]">{p.transport}</span>
                                        <span className="text-sm font-bold text-[#222222]">{p.drawn}/{p.accepted}</span>
                                        {p.transport === 'fcm_direct' && p.accepted_no_receipt > 0 && (
                                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#F43F5E]">
                                                {p.accepted_no_receipt} undrawn
                                            </span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </Panel>
                    </div>

                    {/* Check-in path */}
                    <div>
                        <Section title="Check-in path" />
                        <Panel>
                            {(doc.checkin_paths || []).map(p => (
                                <Breakdown key={p.path} label={checkinPathLabel(p.path)} n={p.n} total={doc.visits.total} />
                            ))}
                            <div className="flex items-center justify-between gap-6 py-4">
                                <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black">
                                    OS delivered a region enter
                                </span>
                                <span className="text-sm font-bold text-[#222222]">
                                    {doc.native_enter?.with_enter ?? 0} yes
                                    <span className="text-[#DDDDDD] mx-2">·</span>
                                    {doc.native_enter?.without_enter ?? 0} no
                                </span>
                            </div>
                            <PanelNote>
                                A check-in with no preceding enter came from the arm-time burst or a poll — on iOS the OS
                                routinely never delivers the crossing at all.
                            </PanelNote>
                        </Panel>
                    </div>

                    {/* Close reasons */}
                    <div>
                        <Section title="Close reason" />
                        <Panel>
                            {(doc.close_reasons || []).map(r => (
                                <Breakdown key={r.reason} label={r.reason} n={r.n} total={doc.visits.total} />
                            ))}
                        </Panel>
                    </div>

                    {/* Counters */}
                    <div>
                        <Section title="Detection counters" />
                        <Panel>
                            {COUNTER_LABELS.map(({ key, label }) => (
                                <PanelRow key={key} label={label} value={String(doc.counters?.[key] ?? 0)} />
                            ))}
                            <PanelRow
                                label="Wake nudges sent / failed"
                                value={`${doc.nudges?.sent ?? 0} / ${doc.nudges?.failed ?? 0}`}
                                valueColour={(doc.nudges?.failed ?? 0) > 0 ? '#F97316' : undefined}
                                last
                            />
                        </Panel>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Stat({ label, value, icon: Icon, color, desc, loading }) {
    return (
        <div className="bg-white border border-[#E6E6E1] p-8 rounded-3xl flex items-center gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-5">
                <span className="text-[9px] font-black text-[#666666] uppercase tracking-[0.4em]">{desc}</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                <Icon size={20} style={{ color }} />
            </div>
            <div>
                <div className="text-3xl font-light tracking-tighter text-[#222222] leading-none mb-2">
                    {loading ? '…' : value}
                </div>
                <div className="text-[9px] uppercase tracking-[0.35em] text-[#666666] font-black">{label}</div>
            </div>
        </div>
    );
}

function Section({ title, small }) {
    return (
        <div className={small ? 'mb-4' : 'mb-6'}>
            <div className={`${small ? 'text-[10px]' : 'text-[11px]'} uppercase tracking-[0.4em] text-[#888888] font-black`}>{title}</div>
            <div className="h-[1.5px] w-8 bg-[#E8D200]/70 mt-2"></div>
        </div>
    );
}

function Panel({ children }) {
    return <div className="bg-white border border-[#E6E6E1] rounded-3xl px-8 py-2">{children}</div>;
}

function PanelRow({ label, value, sub, badge, badgeColour, valueColour, last }) {
    return (
        <div className={`flex items-center justify-between gap-6 py-4 ${last ? '' : 'border-b border-[#EFEFEC]'}`}>
            <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black min-w-0 truncate">{label}</span>
            <span className="flex items-center gap-3 shrink-0">
                {sub && <span className="text-[9px] font-black tracking-[0.2em] text-[#AAAAAA]">{sub}</span>}
                <span className="text-sm font-bold" style={{ color: valueColour || '#222222' }}>{value}</span>
                {badge && (
                    <span
                        className="px-2 py-0.5 rounded-full border text-[8px] font-black tracking-[0.2em]"
                        style={{ color: badgeColour, borderColor: `${badgeColour}33`, background: `${badgeColour}0f` }}
                    >{badge}</span>
                )}
            </span>
        </div>
    );
}

function PanelNote({ children }) {
    return <p className="text-[10px] leading-relaxed text-[#999999] font-bold py-4 border-b border-[#EFEFEC] last:border-b-0">{children}</p>;
}

function Breakdown({ label, n, total }) {
    const pct = total > 0 ? Math.min(100, (n / total) * 100) : 0;
    return (
        <div className="flex items-center justify-between gap-6 py-4 border-b border-[#EFEFEC] last:border-b-0">
            <span className="text-[11px] uppercase tracking-[0.25em] text-[#666666] font-black min-w-0 truncate">{label}</span>
            <span className="flex items-center gap-4 shrink-0">
                <span className="w-24 h-1.5 rounded-full bg-[#F0F0EC] overflow-hidden">
                    <span className="block h-full bg-[#E8D200]" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-sm font-bold text-[#222222] w-8 text-right">{n}</span>
            </span>
        </div>
    );
}

function Loading({ label }) {
    return (
        <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">{label}</span>
        </div>
    );
}

function Empty({ text }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl py-20 flex flex-col items-center gap-5">
            <Smartphone size={40} className="text-[#E6E6E1]" />
            <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black text-center px-8">{text}</p>
        </div>
    );
}
