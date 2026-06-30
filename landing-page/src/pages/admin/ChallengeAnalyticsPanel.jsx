import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { CATALOG } from '../../../../shared/weeklyChallenges.js';
import {
    Activity, Award, BarChart3, Calendar, ChevronRight, Layers, RefreshCw,
    Target, TrendingUp, Trophy, UserCheck, Users, Zap,
} from 'lucide-react';

// ── palette ───────────────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
    gym: '#E8D200', walking: '#0EA5E9', running: '#F97316', cycling: '#10B981',
    multi: '#F43F5E', other: '#CCCCCC',
};
const TIER_COLORS = { easy: '#10B981', medium: '#8a7600', hard: '#FF5C00' };
const STATUS_COLORS = {
    forming: '#0EA5E9', live: '#E8D200', completed: '#10B981',
    expired: '#AAAAAA', cancelled: '#F43F5E',
};
const KIND_COLORS = { parallel: '#8B5CF6', pooled: '#0EA5E9' };

const RANGES = [
    { key: '7d', label: '7D', days: 7 },
    { key: '30d', label: '30D', days: 30 },
    { key: '90d', label: '90D', days: 90 },
    { key: 'all', label: 'ALL', days: null },
];

const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
const SUPPORTED_CATALOG = CATALOG.filter((c) => c.supported !== false);

const fmt = (n) => (n ?? 0).toLocaleString();
const fmtPts = (n) => {
    if (n == null) return '0';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
};
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── chart primitives (mirrored from Analytics.jsx) ─────────────────────────────
function LineChart({ data, valueKey = 'count', color = '#8a7600', height = 180 }) {
    const W = 600, P = 8;
    if (!data.length) return <div style={{ height }} />;
    const max = Math.max(1, ...data.map((d) => d[valueKey]));
    const stepX = (W - P * 2) / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => [P + i * stepX, height - P - (d[valueKey] / max) * (height - P * 2)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts.at(-1)[0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
    const gid = `cg-${color.slice(1)}`;
    return (
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="3.5" fill={color} />
        </svg>
    );
}

function Donut({ segments, centerLabel, centerValue, size = 150 }) {
    const r = size / 2 - 14, c = 2 * Math.PI * r, total = segments.reduce((s, x) => s + x.value, 0) || 1;
    let off = 0;
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F0F0EC" strokeWidth="12" />
                {segments.map((s, i) => {
                    const len = (s.value / total) * c;
                    const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                        strokeWidth="12" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off}
                        style={{ transition: 'stroke-dasharray 0.7s ease' }} />;
                    off += len; return el;
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-light tracking-tighter text-[#1A1A1A] leading-none">{centerValue}</span>
                <span className="text-[8px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black mt-1">{centerLabel}</span>
            </div>
        </div>
    );
}

function Legend({ items }) {
    return (
        <div className="space-y-2.5 flex-1 min-w-0">
            {items.map((it) => (
                <div key={it.label} className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: it.color }} />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#888888] capitalize flex-1 truncate">{it.label}</span>
                    <span className="text-[10px] font-black text-[#BBBBBB]">{it.value}</span>
                </div>
            ))}
        </div>
    );
}

function HBars({ data, labelKey, valueKey, colorFn, suffix }) {
    const max = Math.max(1, ...data.map((d) => d[valueKey]));
    return (
        <div className="space-y-3.5">
            {data.map((d, i) => (
                <div key={i}>
                    <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#888888] capitalize truncate pr-2">{d[labelKey]}</span>
                        <span className="text-[10px] font-black text-[#AAAAAA] flex-shrink-0">{fmt(d[valueKey])}{suffix || ''}</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#F0F0EC] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${(d[valueKey] / max) * 100}%`, backgroundColor: colorFn(d, i) }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function Card({ accent, title, sub, icon: Icon, right, children, className = '' }) {
    return (
        <div className={`bg-white border border-[#E6E6E1] rounded-[2rem] p-8 ${className}`}>
            <div className="flex items-start justify-between mb-7">
                <div className="flex items-center gap-3">
                    <div className="h-[2px] w-5" style={{ background: accent }} />
                    <div>
                        <h3 className="text-base font-light tracking-tighter text-[#1A1A1A]">{title}</h3>
                        {sub && <p className="text-[8px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mt-1">{sub}</p>}
                    </div>
                </div>
                {right || (Icon && <Icon size={16} className="text-[#CCCCCC]" />)}
            </div>
            {children}
        </div>
    );
}

function Empty({ h = 'h-40', label = 'No data in range' }) {
    return <div className={`${h} flex items-center justify-center text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black`}>{label}</div>;
}

function KpiCard({ label, value, sub, icon: Icon, color, loading }) {
    return (
        <div className="bg-white border border-[#E6E6E1] p-6 rounded-2xl">
            <div className="flex items-center gap-2 mb-4">
                <Icon size={13} style={{ color }} />
                <span className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black truncate">{label}</span>
            </div>
            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none">{loading ? '—' : value}</div>
            <div className="text-[8px] text-[#CCCCCC] font-black uppercase tracking-[0.3em] mt-2 h-[10px]">{sub || ''}</div>
        </div>
    );
}

// ── panel ───────────────────────────────────────────────────────────────────
export default function ChallengeAnalyticsPanel() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30d');
    const [raw, setRaw] = useState({ completions: [], shared: [], participants: [], templates: [], profiles: [] });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [comp, sc, parts, tpl, prof] = await Promise.all([
                supabase.from('user_challenge_completions').select('user_id, challenge_id, challenge_week, activity_type, points_awarded, completed_at'),
                supabase.from('shared_challenges').select('id, kind, status, template, category, base_points, created_at, settled_at, ends_at'),
                supabase.from('shared_challenge_participants').select('challenge_id, user_id, state, completed, bonus_awarded, contribution, created_at'),
                supabase.from('shared_challenge_templates').select('title, category, tier, mode, active'),
                supabase.from('profiles').select('id, username, display_name'),
            ]);
            const firstErr = comp.error || sc.error || parts.error || tpl.error || prof.error;
            if (firstErr) throw firstErr;
            setRaw({
                completions: comp.data || [],
                shared: sc.data || [],
                participants: parts.data || [],
                templates: tpl.data || [],
                profiles: prof.data || [],
            });
        } catch (e) {
            toast.error('Challenge analytics failed to load');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;

    const profileMap = useMemo(() => {
        const m = {};
        raw.profiles.forEach((p) => { m[p.id] = p.display_name || p.username || `${String(p.id).slice(0, 8)}…`; });
        return m;
    }, [raw.profiles]);

    const a = useMemo(() => {
        const { completions, shared, participants, templates } = raw;
        const now = Date.now();
        const cutoff = rangeDays != null ? now - rangeDays * 86_400_000 : 0;
        const inRange = (ts) => ts && new Date(ts).getTime() >= cutoff;

        // ============ WEEKLY ============
        const comps = completions.filter((c) => inRange(c.completed_at));
        const prevCutoff = rangeDays != null ? cutoff - rangeDays * 86_400_000 : 0;
        const inPrev = (ts) => ts && new Date(ts).getTime() >= prevCutoff && new Date(ts).getTime() < cutoff;
        const prevComps = rangeDays != null ? completions.filter((c) => inPrev(c.completed_at)) : [];

        const wMembers = new Set();
        let wPoints = 0;
        const chMap = {}, catMap = {}, tierMap = {}, weekMap = {}, memberMap = {}, dayMap = {};
        const completedIds = new Set();
        for (const c of comps) {
            wMembers.add(c.user_id);
            wPoints += c.points_awarded || 0;
            chMap[c.challenge_id] = (chMap[c.challenge_id] || 0) + 1;
            completedIds.add(c.challenge_id);
            const meta = CATALOG_BY_ID[c.challenge_id];
            const cat = meta?.category || 'other';
            catMap[cat] = (catMap[cat] || 0) + 1;
            const tier = meta?.tier;
            if (tier) tierMap[tier] = (tierMap[tier] || 0) + 1;
            if (c.challenge_week) weekMap[c.challenge_week] = (weekMap[c.challenge_week] || 0) + 1;
            memberMap[c.user_id] = (memberMap[c.user_id] || 0) + 1;
            dayMap[dayKey(c.completed_at)] = (dayMap[dayKey(c.completed_at)] || 0) + 1;
        }

        const topChallenges = Object.entries(chMap)
            .map(([id, count]) => ({ id, count, title: CATALOG_BY_ID[id]?.title || id, category: CATALOG_BY_ID[id]?.category || 'other' }))
            .sort((x, y) => y.count - x.count).slice(0, 8);
        const byCategory = Object.entries(catMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
        const TIER_ORDER = { easy: 0, medium: 1, hard: 2 };
        const byTier = Object.entries(tierMap).map(([k, v]) => ({ k, v })).sort((x, y) => (TIER_ORDER[x.k] ?? 9) - (TIER_ORDER[y.k] ?? 9));
        const byWeek = Object.entries(weekMap).map(([k, v]) => ({ k, v })).sort((x, y) => (x.k < y.k ? 1 : -1)).slice(0, 10).reverse();
        const topMembers = Object.entries(memberMap).map(([id, count]) => ({ id, count })).sort((x, y) => y.count - x.count).slice(0, 8);

        // dense daily trend
        const spanDays = rangeDays != null ? rangeDays
            : Math.max(7, Math.ceil((now - completions.reduce((m, c) => Math.min(m, new Date(c.completed_at).getTime()), now)) / 86_400_000));
        const trendLen = Math.min(60, Math.max(7, spanDays));
        const wTrend = [];
        for (let i = trendLen - 1; i >= 0; i--) {
            const d = new Date(now - i * 86_400_000);
            wTrend.push({ day: dayKey(d), count: dayMap[dayKey(d)] || 0 });
        }

        const neverCompleted = SUPPORTED_CATALOG.filter((c) => !completedIds.has(c.id));
        const coveredAllTime = new Set(completions.map((c) => c.challenge_id));
        const coverageDone = SUPPORTED_CATALOG.filter((c) => coveredAllTime.has(c.id)).length;

        const wDelta = prevComps.length > 0
            ? Math.round(((comps.length - prevComps.length) / prevComps.length) * 100)
            : (comps.length > 0 && rangeDays != null ? 100 : 0);

        // ============ SHARED ============
        const sc = shared.filter((c) => inRange(c.created_at));
        const scIds = new Set(sc.map((c) => c.id));
        const parts = participants.filter((p) => scIds.has(p.challenge_id));

        const statusMap = {}, kindMap = {}, tplMap = {}, scDayMap = {}, groupSizeMap = {};
        for (const c of sc) {
            statusMap[c.status] = (statusMap[c.status] || 0) + 1;
            kindMap[c.kind] = (kindMap[c.kind] || 0) + 1;
            const tplTitle = c.template?.title || titleCase(c.category) || 'Custom';
            tplMap[tplTitle] = (tplMap[tplTitle] || 0) + 1;
            scDayMap[dayKey(c.created_at)] = (scDayMap[dayKey(c.created_at)] || 0) + 1;
        }
        const perChallenge = {};
        let bonusPaid = 0;
        let acceptedCount = 0, completedCount = 0;
        for (const p of parts) {
            perChallenge[p.challenge_id] = (perChallenge[p.challenge_id] || 0) + 1;
            bonusPaid += p.bonus_awarded || 0;
            if (p.completed || p.state === 'accepted') acceptedCount++;
            if (p.completed) completedCount++;
        }
        Object.values(perChallenge).forEach((n) => {
            const bucket = n >= 6 ? '6+' : String(n);
            groupSizeMap[bucket] = (groupSizeMap[bucket] || 0) + 1;
        });

        const byStatus = Object.entries(statusMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
        const byKind = Object.entries(kindMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
        const topTemplates = Object.entries(tplMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v).slice(0, 8);
        const GROUP_ORDER = ['1', '2', '3', '4', '5', '6+'];
        const groupSizes = GROUP_ORDER.filter((b) => groupSizeMap[b]).map((b) => ({ k: b, v: groupSizeMap[b] }));

        const terminal = (statusMap.completed || 0) + (statusMap.expired || 0) + (statusMap.cancelled || 0);
        const completionRate = terminal > 0 ? Math.round(((statusMap.completed || 0) / terminal) * 100) : 0;
        const avgGroup = sc.length ? (parts.length / sc.length) : 0;

        const scSpan = rangeDays != null ? rangeDays : 30;
        const scTrendLen = Math.min(60, Math.max(7, scSpan));
        const scTrend = [];
        for (let i = scTrendLen - 1; i >= 0; i--) {
            const d = new Date(now - i * 86_400_000);
            scTrend.push({ day: dayKey(d), count: scDayMap[dayKey(d)] || 0 });
        }

        const activeTemplates = templates.filter((t) => t.active);
        const activeSolo = activeTemplates.filter((t) => t.mode === 'solo').length;
        const activePooled = activeTemplates.filter((t) => t.mode === 'pooled').length;

        return {
            // weekly
            wCount: comps.length, wDelta, wMembers: wMembers.size, wPoints,
            wAvgPerMember: wMembers.size ? (comps.length / wMembers.size) : 0,
            topChallenges, byCategory, byTier, byWeek, topMembers, wTrend,
            neverCompleted, coverageDone, coverageTotal: SUPPORTED_CATALOG.length,
            // shared
            scCount: sc.length, completionRate, totalParticipants: parts.length,
            avgGroup, bonusPaid, acceptedCount, completedCount,
            byStatus, byKind, topTemplates, groupSizes, scTrend,
            activeTemplates: activeTemplates.length, activeSolo, activePooled,
        };
    }, [raw, rangeDays]);

    const SectionHead = ({ tag, color }) => (
        <div className="flex items-center gap-3 mb-6 mt-4">
            <div className="h-[1px] w-12" style={{ background: color }} />
            <span className="text-[10px] uppercase tracking-[0.5em] font-black" style={{ color }}>{tag}</span>
        </div>
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Range selector + refresh */}
            <div className="flex items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-1 bg-white border border-[#E6E6E1] rounded-full p-1">
                    {RANGES.map((r) => (
                        <button key={r.key} onClick={() => setRange(r.key)}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all ${range === r.key ? 'bg-[#1A1A1A] text-white' : 'text-[#AAAAAA] hover:text-[#1A1A1A]'}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
                <button onClick={fetchData} disabled={loading}
                    className="h-9 px-5 rounded-full border border-[#E6E6E1] bg-white text-[#999999] text-[9px] font-black uppercase tracking-[0.25em] flex items-center gap-2 hover:text-[#1A1A1A] transition-colors disabled:opacity-50">
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* ════════ WEEKLY ════════ */}
            <SectionHead tag="Weekly Challenges" color="#E8D200" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <KpiCard label="Completions" loading={loading} icon={Target} color="#E8D200"
                    value={fmt(a.wCount)} sub={a.wDelta != null && rangeDays != null ? `${a.wDelta >= 0 ? '+' : ''}${a.wDelta}% vs prev` : ''} />
                <KpiCard label="Members" loading={loading} icon={Users} color="#0EA5E9"
                    value={fmt(a.wMembers)} sub="Completed ≥1" />
                <KpiCard label="Points Awarded" loading={loading} icon={Zap} color="#F59E0B"
                    value={fmtPts(a.wPoints)} sub="From challenges" />
                <KpiCard label="Avg / Member" loading={loading} icon={Activity} color="#10B981"
                    value={a.wAvgPerMember.toFixed(1)} sub="Completions each" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#E8D200" title="Completions Over Time" sub={`Daily · ${range.toUpperCase()}`} icon={TrendingUp} className="lg:col-span-2">
                    {loading ? <Empty h="h-44" /> : a.wTrend.every((d) => !d.count) ? <Empty h="h-44" /> : (
                        <>
                            <LineChart data={a.wTrend} valueKey="count" color="#8a7600" height={180} />
                            <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">
                                <span>{a.wTrend[0]?.day}</span><span>Today</span>
                            </div>
                        </>
                    )}
                </Card>
                <Card accent="#0EA5E9" title="By Category" sub="Completions split" icon={Layers}>
                    {loading ? <Empty /> : a.byCategory.length === 0 ? <Empty /> : (
                        <div className="flex items-center gap-6">
                            <Donut size={140}
                                segments={a.byCategory.map((v) => ({ value: v.v, color: CATEGORY_COLORS[v.k] || '#CCC' }))}
                                centerValue={fmt(a.wCount)} centerLabel="done" />
                            <Legend items={a.byCategory.map((v) => ({ label: v.k, value: v.v, color: CATEGORY_COLORS[v.k] || '#CCC' }))} />
                        </div>
                    )}
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#F97316" title="Top Challenges" sub="Most completed" icon={Trophy} className="lg:col-span-2">
                    {loading ? <Empty /> : a.topChallenges.length === 0 ? <Empty /> : (
                        <HBars data={a.topChallenges} labelKey="title" valueKey="count"
                            colorFn={(d) => CATEGORY_COLORS[d.category] || '#E8D200'} />
                    )}
                </Card>
                <Card accent="#FF5C00" title="By Difficulty" sub="Tier appetite" icon={BarChart3}>
                    {loading ? <Empty /> : a.byTier.length === 0 ? <Empty /> : (
                        <HBars data={a.byTier} labelKey="k" valueKey="v" colorFn={(d) => TIER_COLORS[d.k] || '#CCC'} />
                    )}
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#10B981" title="By Week" sub="Rotation engagement" icon={Calendar}>
                    {loading ? <Empty /> : a.byWeek.length === 0 ? <Empty /> : (
                        <HBars data={a.byWeek} labelKey="k" valueKey="v" colorFn={() => '#10B981'} />
                    )}
                </Card>
                <Card accent="#8B5CF6" title="Top Members" sub="By completions" icon={Award}>
                    {loading ? <Empty /> : a.topMembers.length === 0 ? <Empty /> : (
                        <div className="divide-y divide-[#F4F4F1] -my-2">
                            {a.topMembers.map((m, i) => (
                                <Link key={m.id} to={`/admin/users/${m.id}`}
                                    className="flex items-center gap-4 py-3 group">
                                    <span className="text-[10px] font-black text-[#DDDDDD] w-4">{i + 1}</span>
                                    <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[#444444] flex-1 truncate group-hover:text-[#8a7600] transition-colors">{profileMap[m.id] || `${m.id.slice(0, 8)}…`}</span>
                                    <span className="text-base font-light tracking-tight text-[#8B5CF6]">{m.count}</span>
                                    <ChevronRight size={13} className="text-[#DDDDDD] group-hover:text-[#8a7600] transition-colors" />
                                </Link>
                            ))}
                        </div>
                    )}
                </Card>
                <Card accent="#0EA5E9" title="Catalog Coverage" sub="Challenges ever completed" icon={Target}>
                    {loading ? <Empty /> : (
                        <>
                            <div className="flex items-baseline gap-2 mb-5">
                                <span className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none">{a.coverageDone}</span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">of {a.coverageTotal}</span>
                            </div>
                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mb-3">
                                Never completed · {a.neverCompleted.length}
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                                {a.neverCompleted.slice(0, 24).map((c) => (
                                    <span key={c.id} className="inline-flex items-center gap-1.5 border border-[#EFEFEC] rounded-full px-2.5 py-1 text-[9px] text-[#999999]">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[c.category] || '#CCC' }} />
                                        {c.title}
                                    </span>
                                ))}
                                {a.neverCompleted.length > 24 && (
                                    <span className="text-[9px] text-[#BBBBBB] font-black self-center">+{a.neverCompleted.length - 24} more</span>
                                )}
                            </div>
                        </>
                    )}
                </Card>
            </div>

            {/* ════════ SHARED ════════ */}
            <SectionHead tag="Shared Challenges" color="#8B5CF6" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <KpiCard label="Created" loading={loading} icon={Users} color="#8B5CF6" value={fmt(a.scCount)} sub="In range" />
                <KpiCard label="Completion" loading={loading} icon={UserCheck} color="#10B981" value={`${a.completionRate}%`} sub="Of finished" />
                <KpiCard label="Participants" loading={loading} icon={Users} color="#0EA5E9" value={fmt(a.totalParticipants)} sub="Total invited" />
                <KpiCard label="Avg Group" loading={loading} icon={Layers} color="#E8D200" value={a.avgGroup.toFixed(1)} sub="Members each" />
                <KpiCard label="Bonus Paid" loading={loading} icon={Zap} color="#F59E0B" value={fmtPts(a.bonusPaid)} sub="Group bonus pts" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#8B5CF6" title="Creation Over Time" sub={`Daily · ${range.toUpperCase()}`} icon={TrendingUp} className="lg:col-span-2">
                    {loading ? <Empty h="h-44" /> : a.scTrend.every((d) => !d.count) ? <Empty h="h-44" /> : (
                        <>
                            <LineChart data={a.scTrend} valueKey="count" color="#8B5CF6" height={180} />
                            <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">
                                <span>{a.scTrend[0]?.day}</span><span>Today</span>
                            </div>
                        </>
                    )}
                </Card>
                <Card accent="#10B981" title="By Status" sub="Lifecycle split" icon={Activity}>
                    {loading ? <Empty /> : a.byStatus.length === 0 ? <Empty /> : (
                        <div className="flex items-center gap-6">
                            <Donut size={140}
                                segments={a.byStatus.map((v) => ({ value: v.v, color: STATUS_COLORS[v.k] || '#CCC' }))}
                                centerValue={fmt(a.scCount)} centerLabel="total" />
                            <Legend items={a.byStatus.map((v) => ({ label: v.k, value: v.v, color: STATUS_COLORS[v.k] || '#CCC' }))} />
                        </div>
                    )}
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#F97316" title="Template Popularity" sub="Challenges spawned" icon={Trophy} className="lg:col-span-2">
                    {loading ? <Empty /> : a.topTemplates.length === 0 ? <Empty /> : (
                        <HBars data={a.topTemplates} labelKey="k" valueKey="v" colorFn={() => '#F97316'} />
                    )}
                </Card>
                <Card accent="#0EA5E9" title="Participant Funnel" sub="Invited → completed" icon={UserCheck}>
                    {loading ? <Empty /> : a.totalParticipants === 0 ? <Empty /> : (
                        <HBars
                            data={[
                                { k: 'Invited', v: a.totalParticipants },
                                { k: 'Accepted', v: a.acceptedCount },
                                { k: 'Completed', v: a.completedCount },
                            ]}
                            labelKey="k" valueKey="v"
                            colorFn={(_, i) => ['#0EA5E9', '#E8D200', '#10B981'][i]} />
                    )}
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card accent="#8B5CF6" title="By Kind" sub="Parallel vs pooled" icon={Layers}>
                    {loading ? <Empty /> : a.byKind.length === 0 ? <Empty /> : (
                        <HBars data={a.byKind} labelKey="k" valueKey="v" colorFn={(d) => KIND_COLORS[d.k] || '#CCC'} />
                    )}
                </Card>
                <Card accent="#E8D200" title="Group Size" sub="Members per challenge" icon={Users}>
                    {loading ? <Empty /> : a.groupSizes.length === 0 ? <Empty /> : (
                        <HBars data={a.groupSizes} labelKey="k" valueKey="v" colorFn={() => '#E8D200'} suffix=" challenges" />
                    )}
                </Card>
                <Card accent="#10B981" title="Template Catalog" sub="Live presets members can pick" icon={Layers}>
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { label: 'Active', value: a.activeTemplates, color: '#10B981' },
                            { label: 'Solo', value: a.activeSolo, color: '#0EA5E9' },
                            { label: 'Pooled', value: a.activePooled, color: '#8B5CF6' },
                        ].map((s) => (
                            <div key={s.label}>
                                <div className="text-[7px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black mb-2">{s.label}</div>
                                <div className="text-3xl font-light tracking-tighter leading-none" style={{ color: s.color }}>{loading ? '—' : s.value}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}
