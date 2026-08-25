import {
    AlertTriangle, Camera, CheckCircle, ChevronDown, ChevronRight, Database, HeartPulse, HelpCircle,
    RefreshCw, Radio, Send, Wallet, Zap, ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    WORKSTREAMS,
    evidenceNotes,
    formatAgo,
    formatValue,
    judgeAll,
    needsAttentionCount,
    sortJudged,
    sparkSeries,
    workstreamStatus,
} from '../../../../shared/systemHealth.ts';

// System Health — the running diagnosis behind docs/system-health-scope.md.
//
// READ TOP TO BOTTOM, STOP WHEN YOU HAVE ENOUGH:
//   1. One verdict line. "All clear" or "N things need action".
//   2. Only the things that need action, in plain English, with what to do.
//   3. Everything that is fine, folded. Everything we cannot measure yet, folded.
//   4. The engineer's table (keys, thresholds, sparklines, whys) behind one toggle.
//
// Everything this page ASSERTS lives in shared/systemHealth.ts as pure functions
// with jest coverage (__tests__/systemHealth.test.ts): the pinned threshold list,
// green/watch/act/unknown, null-never-0%, interval-vs-lifetime for cumulative
// sources, and the plain-English line for every signal. Everything it READS
// comes from SECURITY DEFINER RPCs that prove is_admin() server-side
// (supabase/migrations/20260825170000_admin_system_health.sql).
//
// ⚠ `unknown` is a real status here and renders grey, never green. Two signals
// are unknown BY DESIGN until their workstreams ship (balance drift → W1,
// due-per-tick → P2). That is the page being honest, not broken.

const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;

const STATUS = {
    act:     { label: 'NEEDS ACTION', short: 'ACT',     colour: '#F43F5E', icon: AlertTriangle },
    watch:   { label: 'KEEP AN EYE ON', short: 'WATCH', colour: '#F59E0B', icon: AlertTriangle },
    unknown: { label: 'CAN\'T MEASURE YET', short: 'N/A', colour: '#888888', icon: HelpCircle },
    green:   { label: 'ALL CLEAR', short: 'OK',        colour: '#10B981', icon: CheckCircle },
};

const WORKSTREAM_ICON = {
    W1: Wallet, W2: Zap, W3: Radio, W4: Send, W5: Database, integrity: ShieldCheck,
};

export default function SystemHealth() {
    const toast = useToast();
    // Same guard as Live Ops: never let an unstable identity into a loader's deps.
    const toastRef = useRef(toast);
    toastRef.current = toast;

    const [doc, setDoc] = useState(null);
    const [history, setHistory] = useState(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [snapshotting, setSnapshotting] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [showClear, setShowClear] = useState(false);
    const [showUnknown, setShowUnknown] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

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

    const act = judged.filter(j => j.verdict.status === 'act');
    const watch = judged.filter(j => j.verdict.status === 'watch');
    const clear = judged.filter(j => j.verdict.status === 'green');
    const unknown = judged.filter(j => j.verdict.status === 'unknown');
    const attention = needsAttentionCount(judged);

    if (!ready) return <Loading label="Diagnosing…" />;

    const verdict = attention > 0
        ? { text: `${attention} thing${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} action.`, colour: STATUS.act.colour }
        : watch.length > 0
            ? { text: `All clear — ${watch.length} thing${watch.length === 1 ? '' : 's'} to keep an eye on.`, colour: STATUS.watch.colour }
            : { text: 'All clear.', colour: STATUS.green.colour };

    return (
        <div className="space-y-12">
            {/* ── 1. Verdict ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <HeartPulse size={18} className="text-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#888888] font-black">System Health</span>
                    </div>
                    <h1 className="text-3xl font-light tracking-tighter" style={{ color: verdict.colour }}>{verdict.text}</h1>
                    <p className="text-[11px] text-[#888888] font-bold mt-2">
                        Checked {formatAgo(doc?.captured_at, nowMs)} · history saved every hour
                        {doc?.last_snapshot_at ? ` (last ${formatAgo(doc.last_snapshot_at, nowMs)})` : ' (none yet)'}
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => load()}
                        disabled={busy}
                        className="px-5 h-11 rounded-2xl bg-white border border-[#E6E6E1] text-[#333333] text-[9px] uppercase tracking-[0.3em] font-black hover:border-[#1A1A1A] transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button
                        onClick={snapshot}
                        disabled={snapshotting}
                        className="px-5 h-11 rounded-2xl bg-[#1A1A1A] text-white text-[9px] uppercase tracking-[0.3em] font-black hover:bg-[#333333] transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        <Camera size={12} /> Save snapshot
                    </button>
                </div>
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
                            {w.title}
                            <span className="w-2 h-2 rounded-full" style={{ background: st.colour }} />
                        </span>
                    );
                })}
            </div>

            {/* What this page cannot currently prove. Only when there is something to say. */}
            {notes.length > 0 && (
                <div className="px-6 py-4 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07] space-y-1">
                    {notes.map((n, i) => (
                        <p key={i} className="text-[10px] text-[#8a6a00] font-bold">{n}</p>
                    ))}
                </div>
            )}

            {/* ── 2. Things that need you ─────────────────────────────────── */}
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

            {/* ── 3. Folded: fine, and not-yet-measurable ─────────────────── */}
            <Fold
                open={showClear}
                onToggle={() => setShowClear(v => !v)}
                status="green"
                title={`${clear.length} thing${clear.length === 1 ? '' : 's'} fine`}
            >
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
                <Fold
                    open={showUnknown}
                    onToggle={() => setShowUnknown(v => !v)}
                    status="unknown"
                    title={`${unknown.length} thing${unknown.length === 1 ? '' : 's'} we can't measure yet`}
                >
                    {unknown.map(j => (
                        <div key={j.signal.key} className="py-3 border-b border-[#EFEFEC]">
                            <div className="text-[11px] font-bold text-[#444444]">{j.signal.label}</div>
                            <div className="text-[10px] text-[#888888] font-bold mt-0.5">{j.verdict.reason}</div>
                        </div>
                    ))}
                </Fold>
            )}

            {/* ── 4. The engineer's table ─────────────────────────────────── */}
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

/** A red or amber section: heading + its cards. */
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

/**
 * One thing that needs a person. Three lines, in the order a person needs them:
 * what it is (plain English), the number against its line, what to do.
 */
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
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-7 py-5 hover:bg-[#FAFAF8] transition-colors"
            >
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

// ── The engineer's table (unchanged in substance, behind the toggle) ──────────

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
                            <Th>7 days</Th>
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

const dayAndTime = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A compact line of the fact's detail — the forensic numbers behind the value. */
function Detail({ fact, signal }) {
    const d = fact?.detail;
    if (!d || typeof d !== 'object') return null;
    const parts = [];
    for (const [k, v] of Object.entries(d)) {
        if (k === 'note' || k === 'cumulative' || k === 'stats_since' || k === 'stats_reset' || k === 'visit_ids' || k === 'tables') continue;
        if (v == null) continue;
        if (typeof v === 'object') {
            if (Array.isArray(v)) { if (v.length) parts.push(`${k}: ${v.join(', ')}`); continue; }
            const inner = Object.entries(v).filter(([, x]) => x != null).map(([a, b]) => `${a} ${b}`).join(', ');
            if (inner) parts.push(`${k}: ${inner}`);
            continue;
        }
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { parts.push(`${k} ${dayAndTime(v)}`); continue; }
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
