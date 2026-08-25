import {
    AlertTriangle, Camera, CheckCircle, Database, ExternalLink, HeartPulse, HelpCircle,
    RefreshCw, Radio, Send, Wallet, Zap, ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    SIGNALS,
    WORKSTREAMS,
    drivingSignal,
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
// One question: "are we still safe, and if not, which thing do we fix next?"
// Every signal is tied to a WORKSTREAM (W1–W5 from the 2026-08-25 scale review,
// plus Integrity) and a watch/act threshold with a one-line why. The header
// strip — six cards, worst-of — is the answer; the table is the evidence.
//
// Everything this page ASSERTS lives in shared/systemHealth.ts as pure functions
// with jest coverage (__tests__/systemHealth.test.ts): the pinned threshold list,
// green/watch/act/unknown, null-never-0%, interval-vs-lifetime for cumulative
// sources. Everything it READS comes from three SECURITY DEFINER RPCs that prove
// is_admin() server-side (supabase/migrations/20260825170000_admin_system_health.sql).
//
// ⚠ `unknown` is a real status here and renders grey, never green. Two signals
// are unknown BY DESIGN until their workstreams ship (balance drift → W1,
// due-per-tick → P2). That is the page being honest, not broken.

const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;

const STATUS = {
    act:     { label: 'ACT',     colour: '#F43F5E', bg: '#F43F5E0f', icon: AlertTriangle },
    watch:   { label: 'WATCH',   colour: '#F59E0B', bg: '#F59E0B0f', icon: AlertTriangle },
    unknown: { label: 'UNKNOWN', colour: '#888888', bg: '#8888880f', icon: HelpCircle },
    green:   { label: 'OK',      colour: '#10B981', bg: '#10B9810f', icon: CheckCircle },
};

const WORKSTREAM_ICON = {
    W1: Wallet, W2: Zap, W3: Radio, W4: Send, W5: Database, integrity: ShieldCheck,
};

const SECTION_TITLES = {
    W1: 'Ledger (W1)', W2: 'Claim chain (W2)', W3: 'Beacon (W3)', W4: 'Relay (W4)', W5: 'Database (W5)', integrity: 'Integrity',
};

const dayAndTime = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

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
    const [sortMode, setSortMode] = useState('severity'); // 'severity' | 'section'
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
    const attention = needsAttentionCount(judged);
    const notes = useMemo(() => evidenceNotes(doc, judged, nowMs), [doc, judged, nowMs]);

    const rows = useMemo(() => {
        if (sortMode === 'severity') return sortJudged(judged);
        return judged; // SIGNALS order is already grouped by workstream
    }, [judged, sortMode]);

    if (!ready) return <Loading label="Diagnosing…" />;

    return (
        <div className="space-y-14">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <HeartPulse size={18} className="text-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#888888] font-black">System Health</span>
                    </div>
                    <h1 className="text-3xl font-light tracking-tighter text-[#222222]">
                        {attention === 0
                            ? 'Nothing at the act line.'
                            : `${attention} signal${attention === 1 ? '' : 's'} at the act line.`}
                    </h1>
                    <p className="text-[11px] text-[#888888] font-bold mt-2">
                        Read {formatAgo(doc?.captured_at, nowMs)} · last snapshot {doc?.last_snapshot_at ? formatAgo(doc.last_snapshot_at, nowMs) : 'never'} · hourly cron
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
                        <Camera size={12} /> Snapshot now
                    </button>
                </div>
            </div>

            {/* Evidence notes — what this page cannot currently prove */}
            {notes.length > 0 && (
                <div className="px-6 py-4 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07] space-y-1">
                    {notes.map((n, i) => (
                        <p key={i} className="text-[10px] text-[#8a6a00] font-bold">{n}</p>
                    ))}
                </div>
            )}

            {/* Workstream strip — the answer */}
            <div>
                <Section title="What to work on next" />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {WORKSTREAMS.map(w => (
                        <WorkstreamCard
                            key={w.key}
                            info={w}
                            status={byWorkstream[w.key]}
                            driver={drivingSignal(judged, w.key)}
                        />
                    ))}
                </div>
            </div>

            {/* Signals */}
            <div>
                <div className="flex items-end justify-between gap-6 mb-6">
                    <Section title="Signals" />
                    <div className="flex gap-2 -mt-6">
                        {[['severity', 'By severity'], ['section', 'By workstream']].map(([k, l]) => (
                            <button
                                key={k}
                                onClick={() => setSortMode(k)}
                                className={`px-4 h-9 rounded-xl text-[9px] uppercase tracking-[0.3em] font-black border transition-all ${
                                    sortMode === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888888] hover:text-[#333333]'
                                }`}
                            >{l}</button>
                        ))}
                    </div>
                </div>

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
                                {rows.map((j, i) => (
                                    <SignalRow
                                        key={j.signal.key}
                                        judged={j}
                                        series={sparkSeries(j.signal, history?.[j.signal.key])}
                                        sectionBreak={sortMode === 'section' && (i === 0 || rows[i - 1].signal.workstream !== j.signal.workstream)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <p className="text-[10px] text-[#999999] font-bold mt-4">
                    Grey is <em>unknown</em> — not measured, not green. Two signals stay unknown until their workstream ships
                    (balance drift → W1, due-per-tick → P2). Percentages are null when nothing was measurable, never 0%.
                    Cumulative sources (pg_stat_*) are judged on the last snapshot interval; “lifetime” marks the fallback.
                </p>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-[#999999] font-bold">
                <ExternalLink size={12} />
                Edge-function exceptions are not re-implemented here — they stay in Sentry.
                Thresholds are pinned in <code className="text-[#666666]">shared/systemHealth.ts</code>; a change is a reviewed diff.
            </div>
        </div>
    );
}

function WorkstreamCard({ info, status, driver }) {
    const st = STATUS[status] ?? STATUS.unknown;
    const Icon = WORKSTREAM_ICON[info.key] ?? HeartPulse;
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 relative overflow-hidden" style={{ borderColor: `${st.colour}55` }}>
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                        <Icon size={16} style={{ color: st.colour }} />
                    </div>
                    <div>
                        <div className="text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black">{info.key === 'integrity' ? 'Invariants' : info.key}</div>
                        <div className="text-base font-bold text-[#222222] leading-tight">{info.title}</div>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>
            <p className="text-[11px] text-[#666666] font-bold leading-relaxed mb-4">{info.what}</p>
            {driver && (
                <div className="rounded-2xl bg-[#F9F9F7] border border-[#EFEFEC] px-4 py-3 mb-4">
                    <div className="text-[8px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black mb-1">Driven by</div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold text-[#333333] truncate">{driver.signal.label}</span>
                        <span className="text-sm font-bold shrink-0" style={{ color: st.colour }}>
                            {formatValue(driver.signal, driver.verdict.value)}
                            {driver.verdict.lifetime && <span className="text-[8px] text-[#AAAAAA] ml-1 font-black">LIFETIME</span>}
                        </span>
                    </div>
                    <div className="text-[10px] text-[#888888] font-bold mt-1">{driver.verdict.reason}</div>
                </div>
            )}
            <div className="text-[10px] text-[#999999] font-bold leading-relaxed">
                <span className="text-[#666666]">When it goes red:</span> {info.action}
            </div>
        </div>
    );
}

function SignalRow({ judged, series, sectionBreak }) {
    const { signal, verdict, fact } = judged;
    const st = STATUS[verdict.status] ?? STATUS.unknown;
    const t = signal.threshold;
    return (
        <>
            {sectionBreak && (
                <tr className="bg-[#F9F9F7]">
                    <td colSpan={6} className="px-6 py-2 text-[9px] uppercase tracking-[0.35em] text-[#888888] font-black">
                        {SECTION_TITLES[signal.workstream]}
                    </td>
                </tr>
            )}
            <tr className="border-b border-[#EFEFEC] last:border-b-0 align-top" style={{ background: verdict.status === 'act' ? st.bg : undefined }}>
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
        </>
    );
}

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
            style={{ color: st.colour, borderColor: `${st.colour}33`, background: st.bg }}
        >
            <Icon size={10} /> {st.label}
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
    // Break the path at nulls so a gap is visibly a gap.
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

function Section({ title }) {
    return (
        <div className="mb-6">
            <div className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">{title}</div>
            <div className="h-[1.5px] w-8 bg-[#E8D200]/70 mt-2"></div>
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
