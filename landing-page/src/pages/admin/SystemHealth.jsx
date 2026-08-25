import {
    AlertTriangle, Camera, CheckCircle, ChevronDown, ChevronRight, Database, HeartPulse, HelpCircle,
    RefreshCw, Radio, Send, Wallet, Zap, ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    COMPONENTS,
    STATE_LABEL,
    WORKSTREAMS,
    componentState,
    dayCells,
    evidenceNotes,
    formatAgo,
    formatValue,
    hourlyTimeline,
    incidents,
    judgeAll,
    needsAttentionCount,
    sortJudged,
    sparkSeries,
    uptimePct,
    workstreamStatus,
} from '../../../../shared/systemHealth.ts';

// System Health — the running diagnosis behind docs/system-health-scope.md.
//
// TWO TABS, ONE SOURCE OF TRUTH.
//   Status       — what any large company's status page shows: each service
//                  Operational / Degraded / Disrupted, a 30-day bar, uptime,
//                  active issues and past incidents. For anyone.
//   Engineering  — the same signals with numbers, thresholds, sparklines and
//                  the technical why, for whoever has to fix something.
// Both are derived from the same judged signals and the same hourly snapshots
// (shared/systemHealth.ts), so they can never disagree.
//
// Everything this page ASSERTS lives in shared/systemHealth.ts as pure functions
// with jest coverage (__tests__/systemHealth.test.ts). Everything it READS comes
// from SECURITY DEFINER RPCs that prove is_admin() server-side
// (supabase/migrations/20260825170000_admin_system_health.sql).
//
// ⚠ Grey is "no data", never green. A day with no snapshots is a gap, not uptime.

const HISTORY_DAYS = 30;
const DAY_MS = 86_400_000;

const STATUS = {
    act:     { label: 'NEEDS ACTION',      short: 'ACT',   colour: '#F43F5E', icon: AlertTriangle },
    watch:   { label: 'KEEP AN EYE ON',    short: 'WATCH', colour: '#F59E0B', icon: AlertTriangle },
    unknown: { label: 'CAN\'T MEASURE YET', short: 'N/A',  colour: '#888888', icon: HelpCircle },
    green:   { label: 'ALL CLEAR',         short: 'OK',    colour: '#10B981', icon: CheckCircle },
};

const STATE_COLOUR = {
    operational: '#10B981',
    degraded:    '#F59E0B',
    disrupted:   '#F43F5E',
    unknown:     '#C8C8C4',
};

const CELL_COLOUR = { green: '#10B981', watch: '#F59E0B', act: '#F43F5E', unknown: '#C8C8C4', nodata: '#EDEDEA' };

const WORKSTREAM_ICON = {
    W1: Wallet, W2: Zap, W3: Radio, W4: Send, W5: Database, integrity: ShieldCheck,
};

const dayAndTime = (ms) =>
    new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayLabel = (yyyymmdd) =>
    new Date(`${yyyymmdd}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const durationLabel = (ms) => {
    const m = Math.round(ms / 60_000);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};

export default function SystemHealth() {
    const toast = useToast();
    // Same guard as Live Ops: never let an unstable identity into a loader's deps.
    const toastRef = useRef(toast);
    toastRef.current = toast;

    const [tab, setTab] = useState('status');
    const [doc, setDoc] = useState(null);
    const [history, setHistory] = useState(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [snapshotting, setSnapshotting] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const load = useCallback(async ({ quiet } = {}) => {
        if (!quiet) setBusy(true);
        const [live, hist] = await Promise.all([
            supabase.rpc('admin_system_health_live'),
            supabase.rpc('admin_system_health_history', {
                p_from: new Date(Date.now() - HISTORY_DAYS * DAY_MS).toISOString(),
                p_to: new Date().toISOString(),
            }),
        ]);
        if (live.error) {
            // The RPC refuses non-admins server-side; say so rather than render an
            // empty page that reads as "everything is fine".
            if (!quiet) toastRef.current.error(live.error.message);
        } else {
            setDoc(live.data ?? null);
        }
        if (hist.error) {
            if (!quiet) toastRef.current.error(hist.error.message);
        } else {
            setHistory(hist.data ?? {});
        }
        setNowMs(Date.now());
        setReady(true);
        setBusy(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const snapshot = useCallback(async () => {
        setSnapshotting(true);
        const { data, error } = await supabase.rpc('admin_system_health_snapshot');
        if (error) toastRef.current.error(error.message);
        else if (data === 0) toastRef.current.info('Snapshot already current — one was taken under a minute ago.');
        else toastRef.current.success(`Snapshot saved — ${data} signals.`);
        setSnapshotting(false);
        load({ quiet: true });
    }, [load]);

    const judged = useMemo(() => judgeAll(doc, history), [doc, history]);
    const byWorkstream = useMemo(() => workstreamStatus(judged), [judged]);
    const notes = useMemo(() => evidenceNotes(doc, judged, nowMs), [doc, judged, nowMs]);

    if (!ready) return <Loading label="Checking…" />;

    return (
        <div className="space-y-10">
            {/* Header + tabs */}
            <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <HeartPulse size={18} className="text-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#888888] font-black">System Health</span>
                    </div>
                    <div className="flex gap-2">
                        {[['status', 'Status'], ['engineering', 'Engineering']].map(([k, l]) => (
                            <button
                                key={k}
                                onClick={() => setTab(k)}
                                className={`px-6 h-11 rounded-2xl text-[10px] uppercase tracking-[0.3em] font-black border transition-all ${
                                    tab === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888888] hover:text-[#333333]'
                                }`}
                            >{l}</button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => load()}
                        disabled={busy}
                        className="px-5 h-11 rounded-2xl bg-white border border-[#E6E6E1] text-[#333333] text-[9px] uppercase tracking-[0.3em] font-black hover:border-[#1A1A1A] transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
                    </button>
                    {tab === 'engineering' && (
                        <button
                            onClick={snapshot}
                            disabled={snapshotting}
                            className="px-5 h-11 rounded-2xl bg-[#1A1A1A] text-white text-[9px] uppercase tracking-[0.3em] font-black hover:bg-[#333333] transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            <Camera size={12} /> Save snapshot
                        </button>
                    )}
                </div>
            </div>

            {tab === 'status'
                ? <StatusTab doc={doc} history={history} judged={judged} byWorkstream={byWorkstream} nowMs={nowMs} />
                : <EngineeringTab doc={doc} history={history} judged={judged} byWorkstream={byWorkstream} notes={notes} nowMs={nowMs} />}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// STATUS — the public-status-page shape
// ═════════════════════════════════════════════════════════════════════════════

function StatusTab({ doc, history, judged, byWorkstream, nowMs }) {
    const components = useMemo(() => COMPONENTS.map(c => {
        const timeline = hourlyTimeline(history, c.key);
        return {
            ...c,
            state: componentState(byWorkstream[c.key]),
            cells: dayCells(timeline, HISTORY_DAYS, nowMs),
            uptime: uptimePct(timeline),
        };
    }), [history, byWorkstream, nowMs]);

    const worst = components.reduce((w, c) => {
        const rank = { disrupted: 3, degraded: 2, unknown: 1, operational: 0 };
        return rank[c.state] > rank[w] ? c.state : w;
    }, 'operational');

    const banner = worst === 'disrupted'
        ? { text: 'Service disruption', colour: STATE_COLOUR.disrupted }
        : worst === 'degraded'
            ? { text: 'Degraded performance', colour: STATE_COLOUR.degraded }
            : worst === 'unknown' && components.every(c => c.state === 'unknown')
                ? { text: 'No data yet', colour: STATE_COLOUR.unknown }
                : { text: 'All systems operational', colour: STATE_COLOUR.operational };

    // Active issues come from the LIVE read (finer than the hourly history);
    // past incidents come from the snapshots.
    const active = judged.filter(j => j.verdict.status === 'act' || j.verdict.status === 'watch');
    const past = useMemo(() => incidents(history).filter(i => i.endedAt !== null), [history]);

    return (
        <div className="space-y-10">
            {/* Banner */}
            <div className="rounded-3xl px-8 py-7 text-white flex flex-wrap items-center justify-between gap-4" style={{ background: banner.colour }}>
                <div className="text-2xl font-light tracking-tight">{banner.text}</div>
                <div className="text-[10px] uppercase tracking-[0.3em] font-black opacity-80">
                    Checked {formatAgo(doc?.captured_at, nowMs)}
                </div>
            </div>

            {/* Components */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                <div className="px-8 py-4 border-b border-[#EFEFEC] flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">Services</span>
                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">Last {HISTORY_DAYS} days</span>
                </div>
                {components.map((c, i) => (
                    <ComponentRow key={c.key} component={c} last={i === components.length - 1} />
                ))}
                <div className="px-8 py-3 flex flex-wrap gap-5 text-[9px] uppercase tracking-[0.25em] text-[#AAAAAA] font-black border-t border-[#EFEFEC]">
                    <Legend colour={CELL_COLOUR.green}>Operational</Legend>
                    <Legend colour={CELL_COLOUR.watch}>Degraded</Legend>
                    <Legend colour={CELL_COLOUR.act}>Disrupted</Legend>
                    <Legend colour={CELL_COLOUR.unknown}>Not measurable</Legend>
                    <Legend colour={CELL_COLOUR.nodata}>No data</Legend>
                </div>
            </div>

            {/* Active issues */}
            <div>
                <SectionTitle>Active issues</SectionTitle>
                {active.length === 0 ? (
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl py-10 flex items-center justify-center gap-3">
                        <CheckCircle size={16} style={{ color: STATE_COLOUR.operational }} />
                        <span className="text-[10px] uppercase tracking-[0.35em] text-[#888888] font-black">No active issues</span>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {active.map(j => <IssueCard key={j.signal.key} judged={j} />)}
                    </div>
                )}
            </div>

            {/* Past incidents */}
            <div>
                <SectionTitle>Past incidents · last {HISTORY_DAYS} days</SectionTitle>
                {past.length === 0 ? (
                    <p className="text-[11px] text-[#999999] font-bold">None recorded.</p>
                ) : (
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl px-8 py-2">
                        {past.map((inc, i) => {
                            const c = COMPONENTS.find(x => x.key === inc.workstream);
                            const state = componentState(inc.status);
                            return (
                                <div key={`${inc.workstream}-${inc.startedAt}`} className={`py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 ${i === past.length - 1 ? '' : 'border-b border-[#EFEFEC]'}`}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATE_COLOUR[state] }} />
                                        <span className="text-[12px] font-bold text-[#222222]">{c?.name ?? inc.workstream}</span>
                                        <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: STATE_COLOUR[state] }}>{STATE_LABEL[state]}</span>
                                        {inc.driver && <span className="text-[11px] text-[#888888] font-bold truncate">— {inc.driver.label}</span>}
                                    </div>
                                    <div className="text-[10px] text-[#999999] font-bold whitespace-nowrap">
                                        {dayAndTime(inc.startedAt)} → {dayAndTime(inc.endedAt)} · {durationLabel(inc.endedAt - inc.startedAt)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function ComponentRow({ component: c, last }) {
    const Icon = WORKSTREAM_ICON[c.key] ?? HeartPulse;
    const colour = STATE_COLOUR[c.state];
    return (
        <div className={`px-8 py-5 grid grid-cols-1 lg:grid-cols-[minmax(220px,1.2fr)_minmax(240px,2fr)_auto_auto] gap-x-8 gap-y-3 items-center ${last ? '' : 'border-b border-[#EFEFEC]'}`}>
            <div className="flex items-center gap-4 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                    <Icon size={14} style={{ color: colour }} />
                </div>
                <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#222222] truncate">{c.name}</div>
                    <div className="text-[10px] text-[#999999] font-bold truncate">{c.blurb}</div>
                </div>
            </div>
            <div className="flex gap-[3px] items-end" title={`${HISTORY_DAYS} days, oldest on the left`}>
                {c.cells.map(cell => (
                    <span
                        key={cell.day}
                        className="flex-1 h-7 rounded-[3px]"
                        style={{ background: CELL_COLOUR[cell.status] }}
                        title={`${dayLabel(cell.day)} — ${cell.status === 'nodata' ? 'no data' : cell.status === 'unknown' ? 'not measurable' : STATE_LABEL[componentState(cell.status)]}${cell.points ? ` (${cell.points} checks)` : ''}`}
                    />
                ))}
            </div>
            <div className="text-right whitespace-nowrap">
                <div className="text-sm font-bold text-[#222222]">{c.uptime == null ? '—' : `${c.uptime.toFixed(c.uptime >= 99.95 ? 2 : 1)}%`}</div>
                <div className="text-[8px] uppercase tracking-[0.25em] text-[#AAAAAA] font-black">uptime</div>
            </div>
            <span
                className="justify-self-start lg:justify-self-end inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[9px] font-black tracking-[0.2em] uppercase whitespace-nowrap"
                style={{ color: colour, borderColor: `${colour}44`, background: `${colour}12` }}
            >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: colour }} />
                {STATE_LABEL[c.state]}
            </span>
        </div>
    );
}

/** One live issue, for a person: which service, what it is, what to do. */
function IssueCard({ judged }) {
    const { signal, verdict } = judged;
    const state = componentState(verdict.status);
    const colour = STATE_COLOUR[state];
    const c = COMPONENTS.find(x => x.key === signal.workstream);
    const ws = WORKSTREAMS.find(w => w.key === signal.workstream);
    const t = signal.threshold;
    return (
        <div className="bg-white border rounded-3xl px-7 py-5" style={{ borderColor: `${colour}55` }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[9px] font-black tracking-[0.2em] uppercase px-2 py-0.5 rounded-full" style={{ color: colour, background: `${colour}12` }}>{STATE_LABEL[state]}</span>
                    <span className="text-[10px] uppercase tracking-[0.25em] text-[#AAAAAA] font-black truncate">{c?.name}</span>
                </div>
                <div className="text-xl font-light tracking-tighter" style={{ color: colour }}>
                    {formatValue(signal, verdict.value)}
                    {t && (
                        <span className="text-[9px] text-[#AAAAAA] font-black tracking-[0.15em] ml-3">
                            {verdict.status === 'act' ? 'LIMIT' : 'WATCH FROM'} {formatValue(signal, verdict.status === 'act' ? t.act : t.watch)}
                        </span>
                    )}
                </div>
            </div>
            <div className="text-[13px] font-bold text-[#222222] mt-2">{signal.label}</div>
            <p className="text-[12px] text-[#555555] font-bold leading-relaxed mt-1">{signal.plain}</p>
            {ws && (
                <p className="text-[11px] text-[#888888] font-bold leading-relaxed mt-2">
                    <span className="text-[#333333]">What to do:</span> {ws.action}
                </p>
            )}
        </div>
    );
}

function Legend({ colour, children }) {
    return (
        <span className="inline-flex items-center gap-2">
            <span className="w-3 h-3 rounded-[3px]" style={{ background: colour }} />
            {children}
        </span>
    );
}

function SectionTitle({ children }) {
    return (
        <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">{children}</div>
            <div className="h-[1.5px] w-8 bg-[#E8D200]/70 mt-2"></div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// ENGINEERING — numbers, thresholds, sparklines, whys
// ═════════════════════════════════════════════════════════════════════════════

function EngineeringTab({ doc, history, judged, byWorkstream, notes, nowMs }) {
    const [showClear, setShowClear] = useState(false);
    const [showUnknown, setShowUnknown] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const act = judged.filter(j => j.verdict.status === 'act');
    const watch = judged.filter(j => j.verdict.status === 'watch');
    const clear = judged.filter(j => j.verdict.status === 'green');
    const unknown = judged.filter(j => j.verdict.status === 'unknown');
    const attention = needsAttentionCount(judged);

    const verdict = attention > 0
        ? { text: `${attention} thing${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} action.`, colour: STATUS.act.colour }
        : watch.length > 0
            ? { text: `All clear — ${watch.length} thing${watch.length === 1 ? '' : 's'} to keep an eye on.`, colour: STATUS.watch.colour }
            : { text: 'All clear.', colour: STATUS.green.colour };

    return (
        <div className="space-y-12">
            <div>
                <h1 className="text-3xl font-light tracking-tighter" style={{ color: verdict.colour }}>{verdict.text}</h1>
                <p className="text-[11px] text-[#888888] font-bold mt-2">
                    Checked {formatAgo(doc?.captured_at, nowMs)} · history saved every hour
                    {doc?.last_snapshot_at ? ` (last ${formatAgo(doc.last_snapshot_at, nowMs)})` : ' (none yet)'}
                </p>
            </div>

            {/* Six areas, one dot each. */}
            <div className="flex flex-wrap gap-2">
                {WORKSTREAMS.map(w => {
                    const st = STATUS[byWorkstream[w.key]] ?? STATUS.unknown;
                    const Icon = WORKSTREAM_ICON[w.key] ?? HeartPulse;
                    return (
                        <span
                            key={w.key}
                            title={w.what}
                            className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-white border border-[#E6E6E1] text-[10px] font-black tracking-[0.15em] text-[#333333]"
                        >
                            <Icon size={12} style={{ color: st.colour }} />
                            {w.key === 'integrity' ? '' : `${w.key} · `}{w.title}
                            <span className="w-2 h-2 rounded-full" style={{ background: st.colour }} />
                        </span>
                    );
                })}
            </div>

            {notes.length > 0 && (
                <div className="px-6 py-4 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07] space-y-1">
                    {notes.map((n, i) => (
                        <p key={i} className="text-[10px] text-[#8a6a00] font-bold">{n}</p>
                    ))}
                </div>
            )}

            {act.length > 0 && (
                <Group status="act" count={act.length}>
                    {act.map(j => <ActionCard key={j.signal.key} judged={j} />)}
                </Group>
            )}
            {watch.length > 0 && (
                <Group status="watch" count={watch.length}>
                    {watch.map(j => <ActionCard key={j.signal.key} judged={j} />)}
                </Group>
            )}
            {act.length === 0 && watch.length === 0 && (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-16 flex flex-col items-center gap-4">
                    <CheckCircle size={36} style={{ color: STATUS.green.colour }} />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">Nothing needs action right now</p>
                </div>
            )}

            <Fold open={showClear} onToggle={() => setShowClear(v => !v)} status="green" title={`${clear.length} thing${clear.length === 1 ? '' : 's'} fine`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                    {clear.map(j => (
                        <div key={j.signal.key} className="flex items-center justify-between gap-6 py-3 border-b border-[#EFEFEC]">
                            <span className="text-[11px] font-bold text-[#444444] min-w-0 truncate" title={j.signal.plain}>{j.signal.label}</span>
                            <span className="text-[11px] font-bold text-[#222222] shrink-0">
                                {formatValue(j.signal, j.verdict.value)}
                                {j.verdict.lifetime && <span className="text-[8px] text-[#AAAAAA] ml-1 font-black">LIFETIME</span>}
                            </span>
                        </div>
                    ))}
                </div>
            </Fold>

            {unknown.length > 0 && (
                <Fold open={showUnknown} onToggle={() => setShowUnknown(v => !v)} status="unknown" title={`${unknown.length} thing${unknown.length === 1 ? '' : 's'} we can't measure yet`}>
                    {unknown.map(j => (
                        <div key={j.signal.key} className="py-3 border-b border-[#EFEFEC]">
                            <div className="text-[11px] font-bold text-[#444444]">{j.signal.label}</div>
                            <div className="text-[10px] text-[#888888] font-bold mt-0.5">{j.verdict.reason}</div>
                        </div>
                    ))}
                </Fold>
            )}

            <div>
                <button
                    onClick={() => setShowDetails(v => !v)}
                    className="flex items-center gap-2 text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black hover:text-[#333333] transition-colors"
                >
                    {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {showDetails ? 'Hide' : 'Show'} the full table
                </button>
                {showDetails && (
                    <div className="mt-6">
                        <DetailsTable rows={sortJudged(judged)} history={history} />
                        <p className="text-[10px] text-[#999999] font-bold mt-4">
                            Grey is <em>unknown</em> — not measured, not green. Percentages are null when nothing was measurable, never 0%.
                            Cumulative sources (pg_stat_*) are judged on the last snapshot interval; “lifetime” marks the fallback.
                            Thresholds are pinned in <code className="text-[#666666]">shared/systemHealth.ts</code>; a change is a reviewed diff.
                            Edge-function exceptions stay in Sentry.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function Group({ status, count, children }) {
    const st = STATUS[status];
    return (
        <div>
            <div className="flex items-center gap-3 mb-5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.colour }} />
                <span className="text-[11px] uppercase tracking-[0.4em] font-black" style={{ color: st.colour }}>{st.label}</span>
                <span className="text-[11px] text-[#AAAAAA] font-black">{count}</span>
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function ActionCard({ judged }) {
    const { signal, verdict } = judged;
    const st = STATUS[verdict.status] ?? STATUS.unknown;
    const ws = WORKSTREAMS.find(w => w.key === signal.workstream);
    const t = signal.threshold;
    return (
        <div className="bg-white border rounded-3xl px-7 py-6" style={{ borderColor: `${st.colour}55` }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <div className="text-base font-bold text-[#222222]">{signal.label}</div>
                <div className="text-2xl font-light tracking-tighter" style={{ color: st.colour }}>
                    {formatValue(signal, verdict.value)}
                    {t && (
                        <span className="text-[10px] text-[#AAAAAA] font-black tracking-[0.15em] ml-3">
                            {verdict.status === 'act' ? 'ACTS AT' : 'WATCH FROM'} {formatValue(signal, verdict.status === 'act' ? t.act : t.watch)}
                        </span>
                    )}
                    {verdict.lifetime && <span className="text-[8px] text-[#AAAAAA] ml-2 font-black">LIFETIME</span>}
                </div>
            </div>
            <p className="text-[12px] text-[#555555] font-bold leading-relaxed mt-3">{signal.plain}</p>
            <p className="text-[10px] text-[#999999] font-bold leading-relaxed mt-2">{signal.why}</p>
            {ws && (
                <p className="text-[11px] text-[#888888] font-bold leading-relaxed mt-3">
                    <span className="text-[#333333]">What to do:</span> {ws.action}
                </p>
            )}
        </div>
    );
}

function Fold({ open, onToggle, status, title, children }) {
    const st = STATUS[status];
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
            <button onClick={onToggle} className="w-full flex items-center justify-between px-7 py-5 hover:bg-[#FAFAF8] transition-colors">
                <span className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.colour }} />
                    <span className="text-[11px] uppercase tracking-[0.35em] font-black text-[#444444]">{title}</span>
                </span>
                {open ? <ChevronDown size={14} className="text-[#AAAAAA]" /> : <ChevronRight size={14} className="text-[#AAAAAA]" />}
            </button>
            {open && <div className="px-7 pb-5 -mt-1">{children}</div>}
        </div>
    );
}

function DetailsTable({ rows, history }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-[#EFEFEC]">
                            <Th>Status</Th>
                            <Th>Signal</Th>
                            <Th right>Now</Th>
                            <Th right>Watch / Act</Th>
                            <Th>{HISTORY_DAYS} days</Th>
                            <Th>Why</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(j => (
                            <SignalRow key={j.signal.key} judged={j} series={sparkSeries(j.signal, history?.[j.signal.key])} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function SignalRow({ judged, series }) {
    const { signal, verdict, fact } = judged;
    const st = STATUS[verdict.status] ?? STATUS.unknown;
    const t = signal.threshold;
    return (
        <tr className="border-b border-[#EFEFEC] last:border-b-0 align-top">
            <td className="px-6 py-4"><StatusPill status={verdict.status} /></td>
            <td className="px-6 py-4">
                <div className="text-[12px] font-bold text-[#222222]">{signal.label}</div>
                <div className="text-[9px] text-[#AAAAAA] font-black tracking-[0.15em] mt-0.5">{signal.key}</div>
            </td>
            <td className="px-6 py-4 text-right whitespace-nowrap">
                <div className="text-sm font-bold" style={{ color: verdict.value == null ? '#AAAAAA' : st.colour }}>
                    {formatValue(signal, verdict.value)}
                </div>
                {verdict.lifetime && <div className="text-[8px] text-[#AAAAAA] font-black tracking-[0.2em]">LIFETIME MEAN</div>}
                <Detail fact={fact} signal={signal} />
            </td>
            <td className="px-6 py-4 text-right whitespace-nowrap text-[11px] font-bold text-[#888888]">
                {t ? `${formatValue(signal, t.watch)} / ${formatValue(signal, t.act)}` : 'trend only'}
                {t && t.direction === 'below' && <div className="text-[8px] text-[#AAAAAA] font-black tracking-[0.2em]">LOWER IS WORSE</div>}
            </td>
            <td className="px-6 py-4"><Sparkline series={series} colour={st.colour} /></td>
            <td className="px-6 py-4 min-w-[260px]">
                <div className="text-[10px] text-[#666666] font-bold leading-relaxed">{signal.why}</div>
                <div className="text-[10px] text-[#999999] font-bold mt-1">{verdict.reason}</div>
            </td>
        </tr>
    );
}

/** A compact line of the fact's detail — the forensic numbers behind the value. */
function Detail({ fact, signal }) {
    const d = fact?.detail;
    if (!d || typeof d !== 'object') return null;
    const parts = [];
    for (const [k, v] of Object.entries(d)) {
        if (k === 'note' || k === 'cumulative' || k === 'stats_since' || k === 'stats_reset' || k === 'visit_ids' || k === 'tables' || k === 'drifted') continue;
        if (v == null) continue;
        if (typeof v === 'object') {
            if (Array.isArray(v)) { if (v.length) parts.push(`${k}: ${v.join(', ')}`); continue; }
            const inner = Object.entries(v).filter(([, x]) => x != null).map(([a, b]) => `${a} ${b}`).join(', ');
            if (inner) parts.push(`${k}: ${inner}`);
            continue;
        }
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { parts.push(`${k} ${dayAndTime(Date.parse(v))}`); continue; }
        parts.push(`${k} ${typeof v === 'number' ? v.toLocaleString('en-GB') : v}`);
    }
    if (signal.kind === 'pct' && fact.numerator != null && fact.denominator != null) {
        parts.unshift(`${Number(fact.numerator).toLocaleString('en-GB')} / ${Number(fact.denominator).toLocaleString('en-GB')}`);
    }
    if (!parts.length) return null;
    return <div className="text-[9px] text-[#AAAAAA] font-bold mt-1 max-w-[220px] whitespace-normal text-right">{parts.join(' · ')}</div>;
}

function StatusPill({ status }) {
    const st = STATUS[status] ?? STATUS.unknown;
    const Icon = st.icon;
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[8px] font-black tracking-[0.2em]"
            style={{ color: st.colour, borderColor: `${st.colour}33`, background: `${st.colour}0f` }}
        >
            <Icon size={10} /> {st.short}
        </span>
    );
}

/** Nulls are gaps. No data at all draws nothing — an empty chart is a finding. */
function Sparkline({ series, colour }) {
    const w = 120, h = 28, pad = 2;
    const nums = series.filter(v => v != null);
    if (nums.length < 2) {
        return <span className="text-[9px] text-[#CCCCCC] font-black tracking-[0.2em]">{series.length ? 'ONE POINT' : 'NO SNAPSHOTS'}</span>;
    }
    const min = Math.min(...nums), max = Math.max(...nums);
    const span = max - min || 1;
    const x = (i) => pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    let d = '';
    let pen = false;
    series.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
    });
    return (
        <svg width={w} height={h} className="block">
            <path d={d} fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

function Th({ children, right }) {
    return (
        <th className={`px-6 py-4 text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black ${right ? 'text-right' : 'text-left'}`}>
            {children}
        </th>
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
