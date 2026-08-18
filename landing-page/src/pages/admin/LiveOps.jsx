import {
    Activity, AlertTriangle, BellRing, CheckCircle, ChevronLeft, ChevronRight, Clock, MapPin,
    Radio, RefreshCw, Search, Smartphone, X, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    HISTORY_OUTCOMES,
    checkinPathLabel,
    collapseTimeline,
    displayRate,
    elapsedMinutes,
    formatAgo,
    formatDuration,
    formatRate,
    historyPageInfo,
    isNoisePush,
    isOtaBehind,
    journeyFindings,
    journeyStage,
    lastHeardLabel,
    partitionBoard,
    otaLabel,
    pushVerdict,
    stageDeltas,
    stageLabel,
    trendTotals,
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

// History reads gym_visit_journeys — the permanent rollup — so it can look past
// the retention horizon that limits the live board. One page is one RPC round
// trip; 50 keeps the widest row set inside a screen's worth of scrolling.
const HISTORY_PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

const PLATFORM_OPTIONS = [
    { key: '', label: 'All platforms' },
    { key: 'android', label: 'Android' },
    { key: 'ios', label: 'iOS' },
];

const timeOfDay = (iso) =>
    new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const dayAndTime = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** 'YYYY-MM-DD' in the admin's own timezone — the format <input type="date"> wants. */
const isoDay = (msAt) => new Date(msAt).toLocaleDateString('en-CA');

// A half-typed or cleared date input must never reach the RPC: `started_at >= null`
// matches nothing, so an empty box would silently render "no visits" instead of an
// error. Both ends fall back to the default window instead.
const rangeStart = (day) => {
    const t = Date.parse(`${day}T00:00:00`);
    return new Date(Number.isFinite(t) ? t : Date.now() - 29 * DAY_MS).toISOString();
};
const rangeEnd = (day) => {
    const t = Date.parse(`${day}T23:59:59.999`);
    return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
};

const defaultHistoryFilters = () => ({
    from: isoDay(Date.now() - 29 * DAY_MS),
    to: isoDay(Date.now()),
    query: '',
    outcome: 'all',
    platform: '',
});

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
    // Two defaults, because the two halves of this page want opposite things.
    // AGGREGATES / HISTORY are statistics: the dev accounts and the POWR office
    // run every field test and would swamp them, so they start EXCLUDED.
    // The LIVE BOARD *is* the field test — it exists to watch exactly those
    // accounts walk into exactly that venue. Defaulting it the other way meant a
    // founder standing in the POWR office mid-session was told "nobody is inside
    // a partner geofence right now", which was both useless and untrue.
    const [includeTest, setIncludeTest] = useState(false);
    const [boardIncludeTest, setBoardIncludeTest] = useState(true);
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

    // History. `filters` is the APPLIED set — the search box keeps its own draft
    // inside <History> so typing a name does not fire an RPC per keystroke.
    const [histFilters, setHistFilters] = useState(defaultHistoryFilters);
    const [histOffset, setHistOffset] = useState(0);
    const [histRows, setHistRows] = useState([]);
    const [histReady, setHistReady] = useState(false);
    const [histBusy, setHistBusy] = useState(false);
    const [trends, setTrends] = useState([]);
    const [trendsReady, setTrendsReady] = useState(false);
    const [trendsBusy, setTrendsBusy] = useState(false);

    const loadBoard = useCallback(async ({ quiet } = {}) => {
        if (!quiet) setBoardBusy(true);
        // ALWAYS fetch inclusively and filter in the client. The RPC cannot
        // report what it filtered out, so asking IT to exclude makes "no visits"
        // and "visits you are not being shown" identical on the wire — which is
        // exactly how this board came to claim nobody was in a gym while three
        // people were. Every row carries is_test; the filtering happens below,
        // where the hidden count is knowable and can be stated.
        const { data, error } = await supabase.rpc('admin_liveops_board', {
            p_window_hours: 12,
            p_include_test: true,
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
    }, []);

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

    // Rows and trends are two effects on purpose: the summary strip is a property
    // of the FILTERED WINDOW, not of the page you happen to be on, so paging
    // through results must not re-run the (much heavier) daily rollup query.
    const loadHistoryRows = useCallback(async () => {
        setHistBusy(true);
        const { data, error } = await supabase.rpc('admin_liveops_history', {
            p_from: rangeStart(histFilters.from),
            p_to: rangeEnd(histFilters.to),
            p_user_query: histFilters.query.trim() || null,
            p_outcome: histFilters.outcome,
            p_platform: histFilters.platform || null,
            p_include_test: includeTest,
            p_limit: HISTORY_PAGE_SIZE,
            p_offset: histOffset,
        });
        if (error) toastRef.current.error(error.message);
        else setHistRows(data ?? []);
        setHistReady(true);
        setHistBusy(false);
    }, [histFilters, histOffset, includeTest]);

    const loadTrends = useCallback(async () => {
        setTrendsBusy(true);
        const { data, error } = await supabase.rpc('admin_liveops_trends', {
            p_from: rangeStart(histFilters.from),
            p_to: rangeEnd(histFilters.to),
            p_include_test: includeTest,
            p_platform: histFilters.platform || null,
        });
        if (error) toastRef.current.error(error.message);
        else setTrends(data ?? []);
        setTrendsReady(true);
        setTrendsBusy(false);
    }, [histFilters, includeTest]);

    // A filter change invalidates the page number: page 5 of the old result set
    // is a different set of rows, and often past the end of the new one.
    const applyHistoryFilters = useCallback((next) => {
        setHistFilters(next);
        setHistOffset(0);
    }, []);

    useEffect(() => { if (tab === 'live') loadBoard(); }, [tab, loadBoard]);
    useEffect(() => { if (tab === 'aggregates') loadAggregates(); }, [tab, loadAggregates]);
    useEffect(() => { if (tab === 'history') loadHistoryRows(); }, [tab, loadHistoryRows]);
    useEffect(() => { if (tab === 'history') loadTrends(); }, [tab, loadTrends]);

    // Quiet re-poll: no spinner, no toast on a blip. A field test runs for hours
    // and a transient failure must not clear the board off the screen.
    useEffect(() => {
        if (tab !== 'live') return undefined;
        const id = setInterval(() => loadBoard({ quiet: true }), LIVE_POLL_MS);
        return () => clearInterval(id);
    }, [tab, loadBoard]);

    // What the filter is currently keeping off the screen. Never let this be
    // silent: a hidden row and a non-existent row must not look the same.
    // partitionBoard lives in shared/liveops.ts under test — the portal has no
    // test runner, and this is exactly the logic that told a founder nobody was
    // in a gym while he was standing in one.
    const { shown, open, recent, hiddenTotal, hiddenOpen } = partitionBoard(board, boardIncludeTest);
    const alerting = shown.filter(r => visitAlerts(r).length > 0);

    const testFilterOn = tab === 'live' ? boardIncludeTest : includeTest;

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
                        onClick={() => {
                            if (tab === 'live') loadBoard();
                            else if (tab === 'history') { loadHistoryRows(); loadTrends(); }
                            else loadAggregates();
                        }}
                        className="w-12 h-12 rounded-2xl bg-white border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={boardBusy || aggBusy || histBusy || trendsBusy ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Tabs + test toggle */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div className="flex gap-3">
                    {[{ k: 'live', l: 'Live Board' }, { k: 'history', l: 'History' }, { k: 'aggregates', l: 'Aggregates' }].map(t => (
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

                {/* One control, bound to whichever half of the page is showing —
                    the live board and the statistics keep their own answer.
                    The label names the VENUE too: the POWR office is excluded
                    alongside the dev accounts, and "test accounts" alone did not
                    explain why a real user standing in the office vanished. */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                    <span className="text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black">
                        Include test accounts &amp; POWR office
                    </span>
                    <span
                        onClick={() => {
                            if (tab === 'live') setBoardIncludeTest(v => !v);
                            else { setIncludeTest(v => !v); setHistOffset(0); }
                        }}
                        className={`w-11 h-6 rounded-full transition-all relative ${testFilterOn ? 'bg-[#E8D200]' : 'bg-[#E6E6E1]'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${testFilterOn ? 'left-[22px]' : 'left-0.5'}`} />
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

                    {hiddenTotal > 0 && (
                        <FilterNote
                            hiddenTotal={hiddenTotal}
                            hiddenOpen={hiddenOpen}
                            onShow={() => setBoardIncludeTest(true)}
                        />
                    )}

                    <Section title={`In a gym now (${open.length})`} />
                    {!boardReady ? (
                        <Loading label="Reading the detection layer…" />
                    ) : open.length === 0 ? (
                        // The empty state must never assert more than it knows.
                        // "Nobody is inside" is a claim about the world; with the
                        // filter on it can only speak for what got through it.
                        <Empty
                            text={hiddenOpen > 0
                                ? `No visits to show — but ${hiddenOpen} open visit${hiddenOpen === 1 ? ' is' : 's are'} hidden by the filter above.`
                                : 'Nobody is inside a partner geofence right now.'}
                        />
                    ) : (
                        <div className="grid gap-4 mb-16">
                            {open.map(r => <VisitCard key={r.visit_id} row={r} onOpen={() => setOpenVisit(r.visit_id)} />)}
                        </div>
                    )}

                    <Section title={`Closed in the last 12 hours (${recent.length})`} />
                    {recent.length === 0 && boardReady ? (
                        <Empty
                            text={hiddenTotal - hiddenOpen > 0
                                ? `Nothing to show — ${hiddenTotal - hiddenOpen} closed visit${hiddenTotal - hiddenOpen === 1 ? ' is' : 's are'} hidden by the filter above.`
                                : 'No visits closed in the last 12 hours.'}
                        />
                    ) : (
                        <div className="grid gap-4">
                            {recent.map(r => <VisitCard key={r.visit_id} row={r} onOpen={() => setOpenVisit(r.visit_id)} />)}
                        </div>
                    )}
                </>
            ) : tab === 'history' ? (
                <History
                    filters={histFilters}
                    onFilters={applyHistoryFilters}
                    rows={histRows}
                    rowsLoading={!histReady}
                    trends={trends}
                    trendsLoading={!trendsReady}
                    offset={histOffset}
                    onOffset={setHistOffset}
                    onOpen={setOpenVisit}
                />
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

// ─── History ──────────────────────────────────────────────────────────────────
//
// The live board only reaches as far back as geofence_region_events and
// push_send_log are retained. gym_visit_journeys is the permanent per-visit
// rollup, so this is the only surface that can answer "what happened on the 9th".
//
// ⚠ Nothing here decides anything. Stage, findings, rates and page arithmetic all
// come from shared/liveops.ts, under jest — the portal has no test runner, so a
// verdict computed in this file is a verdict nobody can check.

const INPUT_CLASS =
    'h-12 px-4 rounded-2xl bg-white border border-[#E6E6E1] text-[11px] font-bold text-[#333333] ' +
    'focus:outline-none focus:border-[#E8D200] transition-all';

const CELL_CLASS = 'px-5 py-4 text-[11px] font-bold text-[#666666] whitespace-nowrap align-top';

function History({ filters, onFilters, rows, rowsLoading, trends, trendsLoading, offset, onOffset, onOpen }) {
    // Only the free-text box is a draft: it applies on submit so that typing a
    // name does not fire one RPC per keystroke. Every other control is discrete
    // and applies on change.
    const [query, setQuery] = useState(filters.query);
    useEffect(() => { setQuery(filters.query); }, [filters.query]);

    const set = (patch) => onFilters({ ...filters, query, ...patch });

    const totals = useMemo(() => trendTotals(trends || []), [trends]);
    // total_count is a window count over the WHOLE filtered set, carried on every
    // row; the rows on screen are one page of it.
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const page = historyPageInfo(total, HISTORY_PAGE_SIZE, offset);
    const outcome = HISTORY_OUTCOMES.find(o => o.key === filters.outcome);
    const groups = [...new Set(HISTORY_OUTCOMES.map(o => o.group))];

    return (
        <>
            {/* Filters */}
            <form
                onSubmit={(e) => { e.preventDefault(); set({}); }}
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5 mb-12"
            >
                <Field label="From">
                    <input type="date" value={filters.from} onChange={e => set({ from: e.target.value })} className={INPUT_CLASS} />
                </Field>
                <Field label="To">
                    <input type="date" value={filters.to} onChange={e => set({ to: e.target.value })} className={INPUT_CLASS} />
                </Field>

                <Field label="User" hint="Email, username, display name, POWR ID, user id or visit id.">
                    <span className="relative flex">
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search — press enter"
                            className={`${INPUT_CLASS} w-full pr-11`}
                        />
                        <button type="submit" className="absolute right-3 top-0 h-12 flex items-center text-[#AAAAAA] hover:text-[#8a7600]" title="Search">
                            <Search size={14} />
                        </button>
                    </span>
                </Field>

                <Field label="Outcome" hint={outcome ? outcome.predicate : 'no filter'}>
                    <select
                        value={filters.outcome}
                        onChange={e => set({ outcome: e.target.value })}
                        title={outcome ? outcome.predicate : undefined}
                        className={INPUT_CLASS}
                    >
                        {groups.map(g => (
                            <optgroup key={g} label={g}>
                                {HISTORY_OUTCOMES.filter(o => o.group === g).map(o => (
                                    // The predicate rides on every option: "never claimed" and
                                    // "failed" are different questions, and a bare label loses that.
                                    <option key={o.key} value={o.key} title={o.predicate}>
                                        {o.label} — {o.predicate}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </Field>

                <Field label="Platform">
                    <select value={filters.platform} onChange={e => set({ platform: e.target.value })} className={INPUT_CLASS}>
                        {PLATFORM_OPTIONS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                </Field>
            </form>

            {/* Summary */}
            <Section title="Across the filtered window" />
            {trendsLoading ? (
                <Loading label="Rolling up the window…" />
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
                    <Metric label="Visits" value={totals.visits} sub={`${totals.evidenceComplete} evidenced`} title="Journeys rolled up in this window" />
                    <RateMetric label="Claim rate" rate={totals.claim} note="no visits fell in this window" />
                    <RateMetric label="Upgrade rate" rate={totals.upgrade} note="no visits fell in this window" />
                    <RateMetric label="OS enter" rate={totals.osEnter} note="no visit here still has its raw region events" />
                    <RateMetric label="Push display" rate={totals.pushDisplay} note="no push rode a transport that can prove display" />
                    <RateMetric label="Wake answered" rate={totals.wakeAnswer} note="no wake nudges were sent" />
                    <Metric label="Points" value={totals.points} sub="earned" title="Points credited across these visits" />
                </div>
            )}
            <p className="text-[10px] leading-relaxed text-[#999999] font-bold mb-16 max-w-3xl">
                A dash is not a zero. Each rate is scored only against what it can see — OS enter and exit over
                evidence-complete visits, display over fcm_direct pushes alone — so an empty denominator reads
                &quot;—&quot;, never &quot;0%&quot;. The pair beneath each figure is that denominator.
            </p>

            {/* Results */}
            <Section title={`Journeys — ${page.label}`} />
            {rowsLoading ? (
                <Loading label="Reading the journey rollup…" />
            ) : rows.length === 0 ? (
                <Empty text="No visits match these filters." />
            ) : (
                <>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1180px] text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-[#EFEFEC]">
                                        {['When', 'User', 'Venue', 'Platform', 'Stage', 'OS enter', 'Check-in path', 'Exit', 'Duration', 'Points', 'Findings'].map(h => (
                                            <th key={h} className="px-5 py-5 text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black whitespace-nowrap">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <JourneyTableRow key={r.visit_id} row={r} onOpen={() => onOpen(r.visit_id)} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-6 mt-8">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#888888] font-black">
                            {page.label} · page {page.page} of {page.pages}
                        </span>
                        <div className="flex gap-3">
                            <PageButton
                                disabled={!page.hasPrev}
                                onClick={() => onOffset(Math.max(0, offset - HISTORY_PAGE_SIZE))}
                                icon={ChevronLeft}
                                label="Newer"
                            />
                            <PageButton
                                disabled={!page.hasNext}
                                onClick={() => onOffset(offset + HISTORY_PAGE_SIZE)}
                                icon={ChevronRight}
                                label="Older"
                                trailing
                            />
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

function JourneyTableRow({ row, onOpen }) {
    const stage = journeyStage(row);
    const colour = STAGE_COLOUR[stage] ?? '#888888';
    const findings = journeyFindings(row);
    const evidenced = row.evidence_complete;

    return (
        <tr
            onClick={onOpen}
            className="border-b border-[#EFEFEC] last:border-b-0 cursor-pointer hover:bg-[#FBFBF8] transition-colors"
        >
            <td className={CELL_CLASS} title={formatAgo(row.started_at)}>
                <span className="text-[#333333]">{dayAndTime(row.started_at)}</span>
            </td>

            <td className="px-5 py-4 align-top min-w-0">
                <span className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-[#222222] truncate max-w-[180px]">
                        {row.display_name || row.username || row.email || row.user_id.slice(0, 8)}
                    </span>
                    {row.is_test && (
                        <span className="px-2 py-0.5 rounded-full border border-[#8B5CF6]/30 text-[8px] font-black tracking-[0.2em] text-[#8B5CF6]">TEST</span>
                    )}
                </span>
                <span className="block text-[10px] font-bold text-[#AAAAAA] truncate max-w-[220px] mt-1">{row.email || '—'}</span>
            </td>

            <td className={CELL_CLASS}>
                <span className="block truncate max-w-[180px]">{row.venue_name || row.partner_id?.slice(0, 8) || 'unknown venue'}</span>
            </td>

            <td className={CELL_CLASS}>{row.platform || '?'}</td>

            <td className="px-5 py-4 align-top whitespace-nowrap">
                <span
                    className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border"
                    style={{ color: colour, borderColor: `${colour}33`, background: `${colour}0f` }}
                >{stageLabel(stage)}</span>
            </td>

            {/* The three evidence-dependent cells. A purged rollup makes these
                unknowable, not failed — so they read '—', never a red cross. */}
            <EvidenceCell
                evidenced={evidenced}
                text={row.native_enter_at ? timeOfDay(row.native_enter_at) : null}
                missing="none"
            />
            <EvidenceCell
                evidenced={evidenced}
                text={row.checkin_via ? checkinPathLabel(row.checkin_via) : null}
                missing={checkinPathLabel(null)}
                missingNeutral
            />
            <EvidenceCell
                evidenced={evidenced}
                text={row.exit_detected_at ? timeOfDay(row.exit_detected_at) : null}
                missing={row.ended_at ? 'none' : 'still open'}
                missingNeutral={!row.ended_at}
            />

            <td className={CELL_CLASS}>{formatDuration(row.session_duration_sec)}</td>

            <td className={CELL_CLASS}>
                <span className="text-[#8a7600] font-bold">{row.points_earned > 0 ? `+${row.points_earned}` : '0'}</span>
            </td>

            <td className="px-5 py-4 align-top">
                {findings.length === 0 ? (
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#CCCCCC]">Clean</span>
                ) : (
                    <span className="flex flex-wrap gap-2 max-w-[380px]">
                        {findings.map((a, i) => {
                            const c = a.severity === 'bad' ? '#F43F5E' : '#F59E0B';
                            return (
                                <span
                                    // journeyFindings reuses AlertKeys across findings, so the
                                    // index is part of the identity.
                                    key={`${a.key}-${i}`}
                                    title={a.detail}
                                    className="px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-[0.2em]"
                                    style={{ color: c, borderColor: `${c}33`, background: `${c}0f` }}
                                >{a.label}</span>
                            );
                        })}
                    </span>
                )}
            </td>
        </tr>
    );
}

/**
 * native_enter_at / checkin_via / exit_detected_at are derived from raw rows that
 * get purged. When evidence_complete is false they are UNKNOWN — rendering them
 * as a failure would turn a retention policy into a fleet-wide detection outage.
 */
function EvidenceCell({ evidenced, text, missing, missingNeutral }) {
    if (!evidenced) {
        return (
            <td className={CELL_CLASS}>
                <span className="text-[#CCCCCC]" title="evidence expired — the raw rows were purged before rollup, so this is unknown, not failed">—</span>
            </td>
        );
    }
    if (text) return <td className={CELL_CLASS}>{text}</td>;
    return (
        <td className={CELL_CLASS}>
            <span style={{ color: missingNeutral ? '#AAAAAA' : '#F59E0B' }}>{missing}</span>
        </td>
    );
}

function Field({ label, hint, children }) {
    return (
        <label className="flex flex-col gap-2 min-w-0">
            <span className="text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black">{label}</span>
            {children}
            {hint && <span className="text-[9px] text-[#AAAAAA] font-bold leading-relaxed">{hint}</span>}
        </label>
    );
}

function Metric({ label, value, sub, title, muted }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6" title={title}>
            <div className={`text-3xl font-light tracking-tighter leading-none mb-2 ${muted ? 'text-[#AAAAAA]' : 'text-[#222222]'}`}>
                {value}
            </div>
            <div className="text-[9px] uppercase tracking-[0.35em] text-[#666666] font-black">{label}</div>
            {sub && <div className="text-[9px] font-black tracking-[0.2em] text-[#AAAAAA] mt-2">{sub}</div>}
        </div>
    );
}

/** pct === null renders as an em-dash with the reason in its tooltip — never 0%. */
function RateMetric({ label, rate, note }) {
    const d = formatRate(rate, note);
    return <Metric label={label} value={d.text} sub={d.ratio} title={d.title} muted={d.unmeasurable} />;
}

function PageButton({ disabled, onClick, icon: Icon, label, trailing }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`h-11 px-5 rounded-2xl text-[10px] uppercase tracking-[0.3em] font-black border flex items-center gap-2 transition-all ${
                disabled
                    ? 'bg-white border-[#EFEFEC] text-[#DDDDDD] cursor-not-allowed'
                    : 'bg-white border-[#E6E6E1] text-[#888888] hover:text-[#333333] hover:border-[#E8D200]/40'
            }`}
        >
            {!trailing && <Icon size={14} />}
            {label}
            {trailing && <Icon size={14} />}
        </button>
    );
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

/** Says what the filter is holding back, and offers to stop holding it back. */
function FilterNote({ hiddenTotal, hiddenOpen, onShow }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8 px-6 py-4 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07]">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#8a6a00] font-black">
                {hiddenTotal} visit{hiddenTotal === 1 ? '' : 's'} hidden
                {hiddenOpen > 0 && ` — ${hiddenOpen} of them open right now`}
                <span className="block normal-case tracking-normal text-[10px] text-[#999999] font-bold mt-1">
                    Test accounts and anything at the POWR office are filtered out.
                </span>
            </span>
            <button
                onClick={onShow}
                className="px-5 h-9 rounded-xl bg-[#1A1A1A] text-white text-[9px] uppercase tracking-[0.3em] font-black hover:bg-[#333333] transition-all shrink-0"
            >Show them</button>
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
