import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    TrendingUp, Users, Activity, BarChart3, Calendar, Zap,
    ShieldCheck, Gift, Clock, ArrowUpRight, ArrowDownRight, Footprints, Heart,
} from 'lucide-react';

// ---- palette ----
const ACTIVITY_COLORS = {
    walking: '#0EA5E9', running: '#F97316', cycling: '#10B981', swimming: '#06B6D4',
    gym: '#E8D200', hiit: '#F43F5E', sports: '#8a7600', yoga: '#A78BFA', sleep: '#8B5CF6',
};
const VERIFY_COLORS = {
    health: '#10B981', wearable: '#0EA5E9', geofence: '#E8D200',
    manual: '#F97316', gps: '#8B5CF6', hr: '#F43F5E',
};
const SOURCE_COLORS = {
    health_sync: '#10B981', manual_log: '#F97316', weekly_challenge: '#8B5CF6',
    activity: '#0EA5E9', streak: '#E8D200', '(none)': '#CCCCCC',
};
const RANGES = [
    { key: '7d', label: '7D', days: 7 },
    { key: '30d', label: '30D', days: 30 },
    { key: '90d', label: '90D', days: 90 },
    { key: 'all', label: 'ALL', days: null },
];

const fmt = (n) => (n ?? 0).toLocaleString();
const fmtPts = (n) => {
    if (n == null) return '0';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
};
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export default function Analytics() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30d');
    const [raw, setRaw] = useState({ profiles: [], sessions: [], points: [], redemptions: [] });

    useEffect(() => { fetchAnalytics(); }, []);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const [profilesRes, sessionsRes, pointsRes, redemptionsRes] = await Promise.all([
                supabase.from('profiles').select('created_at, is_pro, active_health_provider'),
                supabase.from('activity_sessions').select('type, duration_sec, distance_m, steps, hr_avg, trust_score, verification, flagged, started_at, user_id'),
                supabase.from('point_transactions').select('amount, type, source, created_at'),
                supabase.from('redemptions').select('powr_spent, status, partner_name, redeemed_at'),
            ]);
            setRaw({
                profiles: profilesRes.data || [],
                sessions: sessionsRes.data || [],
                points: pointsRes.data || [],
                redemptions: redemptionsRes.data || [],
            });
        } catch (e) {
            toast.error('Analytics sync failed');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const rangeDays = RANGES.find(r => r.key === range)?.days ?? null;

    // ---- everything derived in one memo, recomputed on range change ----
    const a = useMemo(() => {
        const { profiles, sessions, points, redemptions } = raw;
        const now = Date.now();
        const cutoff = rangeDays != null ? now - rangeDays * 86_400_000 : 0;
        const inRange = (ts) => ts && new Date(ts).getTime() >= cutoff;

        const sess = sessions.filter(s => inRange(s.started_at));
        const pts = points.filter(p => inRange(p.created_at));
        const reds = redemptions.filter(r => inRange(r.redeemed_at));

        // ---- headline KPIs (current window vs previous equal window for deltas) ----
        const prevCutoff = rangeDays != null ? cutoff - rangeDays * 86_400_000 : 0;
        const inPrev = (ts) => ts && new Date(ts).getTime() >= prevCutoff && new Date(ts).getTime() < cutoff;
        const prevSess = rangeDays != null ? sessions.filter(s => inPrev(s.started_at)) : [];

        const weeklyUsers = new Set();
        const wk = now - 7 * 86_400_000;
        let totalDur = 0, hrSum = 0, hrN = 0, distSum = 0, stepSum = 0, trustSum = 0, trustN = 0, flagged = 0;
        const typeMap = {}, verifyMap = {}, hourMap = {}, dowMap = {};
        const dayMap = {}; // session count per day
        for (const s of sess) {
            typeMap[s.type] = (typeMap[s.type] || 0) + 1;
            if (s.verification) verifyMap[s.verification] = (verifyMap[s.verification] || 0) + 1;
            totalDur += s.duration_sec || 0;
            if (s.hr_avg > 0) { hrSum += s.hr_avg; hrN++; }
            if (s.distance_m > 0) distSum += s.distance_m;
            if (s.steps > 0) stepSum += s.steps;
            if (s.trust_score != null) { trustSum += s.trust_score; trustN++; }
            if (s.flagged) flagged++;
            const d = new Date(s.started_at);
            if (d.getTime() > wk) weeklyUsers.add(s.user_id);
            hourMap[d.getHours()] = (hourMap[d.getHours()] || 0) + 1;
            dowMap[d.getDay()] = (dowMap[d.getDay()] || 0) + 1;
            dayMap[dayKey(s.started_at)] = (dayMap[dayKey(s.started_at)] || 0) + 1;
        }

        const activityMix = Object.entries(typeMap)
            .map(([type, count]) => ({ type, count, pct: Math.round((count / (sess.length || 1)) * 100) }))
            .sort((x, y) => y.count - x.count);
        const verifyMix = Object.entries(verifyMap)
            .map(([k, count]) => ({ k, count, pct: Math.round((count / (sess.length || 1)) * 100) }))
            .sort((x, y) => y.count - x.count);

        // peak hours (0-23 dense)
        const byHour = Array.from({ length: 24 }, (_, h) => ({ h, n: hourMap[h] || 0 }));
        const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const byDow = DOW.map((d, i) => ({ d, n: dowMap[i] || 0 }));

        // ---- daily session trend (dense series across the window, capped at 60 pts) ----
        const spanDays = rangeDays != null ? rangeDays : Math.max(1, Math.ceil((now - (sessions.reduce((m, s) => Math.min(m, new Date(s.started_at).getTime()), now))) / 86_400_000));
        const trendLen = Math.min(60, Math.max(7, spanDays));
        const trend = [];
        for (let i = trendLen - 1; i >= 0; i--) {
            const d = new Date(now - i * 86_400_000);
            trend.push({ day: dayKey(d), count: dayMap[dayKey(d)] || 0 });
        }

        // ---- cumulative user growth (always full history, by month) ----
        const monthMap = {};
        profiles.forEach(p => { const m = dayKey(p.created_at).slice(0, 7); monthMap[m] = (monthMap[m] || 0) + 1; });
        const months = Object.keys(monthMap).sort();
        let run = 0;
        const userGrowth = months.map(m => {
            run += monthMap[m];
            const dt = new Date(`${m}-01`);
            return { month: dt.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), added: monthMap[m], total: run };
        });

        // ---- points economy ----
        let issued = 0, redeemed = 0;
        const sourceMap = {}, ptTypeMap = {};
        for (const p of pts) {
            if (p.amount > 0) issued += p.amount; else redeemed += -p.amount;
            const src = p.source || '(none)';
            sourceMap[src] = (sourceMap[src] || 0) + Math.abs(p.amount);
            ptTypeMap[p.type] = (ptTypeMap[p.type] || 0) + Math.abs(p.amount);
        }
        const pointsBySource = Object.entries(sourceMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);

        // ---- redemptions ----
        const redSpent = reds.reduce((s, r) => s + (r.powr_spent || 0), 0);
        const redByStatus = {};
        reds.forEach(r => { redByStatus[r.status] = (redByStatus[r.status] || 0) + 1; });
        const topBrands = Object.values(reds.reduce((acc, r) => {
            const b = r.partner_name || 'Other';
            acc[b] = acc[b] || { brand: b, n: 0, spent: 0 };
            acc[b].n++; acc[b].spent += r.powr_spent || 0;
            return acc;
        }, {})).sort((x, y) => y.spent - x.spent).slice(0, 6);

        // ---- provider adoption (all-time, from profiles) ----
        const provMap = {};
        profiles.forEach(p => { const k = p.active_health_provider || 'none'; provMap[k] = (provMap[k] || 0) + 1; });
        const providers = Object.entries(provMap).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
        const proCount = profiles.filter(p => p.is_pro).length;

        const sessDelta = prevSess.length > 0
            ? Math.round(((sess.length - prevSess.length) / prevSess.length) * 100)
            : (sess.length > 0 && rangeDays != null ? 100 : 0);

        return {
            sessionCount: sess.length, sessDelta,
            weeklyActive: weeklyUsers.size,
            avgDuration: sess.length ? Math.round(totalDur / sess.length / 60) : 0,
            totalHours: Math.round(totalDur / 3600),
            avgHr: hrN ? Math.round(hrSum / hrN) : 0,
            totalKm: Math.round(distSum / 1000),
            totalSteps: stepSum,
            avgTrust: trustN ? Math.round((trustSum / trustN) * 100) : 0,
            flagged, flagRate: sess.length ? ((flagged / sess.length) * 100).toFixed(1) : '0.0',
            activityMix, verifyMix, byHour, byDow, trend, userGrowth,
            issued, redeemed, pointsBySource, ptTypeMap,
            redSpent, redCount: reds.length, redByStatus, topBrands,
            providers, proCount, totalUsers: profiles.length,
        };
    }, [raw, rangeDays]);

    // ================= chart primitives =================
    const LineChart = ({ data, valueKey = 'count', color = '#8a7600', height = 180 }) => {
        const W = 600, P = 8;
        if (!data.length) return <div style={{ height }} />;
        const max = Math.max(1, ...data.map(d => d[valueKey]));
        const stepX = (W - P * 2) / Math.max(1, data.length - 1);
        const pts = data.map((d, i) => [P + i * stepX, height - P - (d[valueKey] / max) * (height - P * 2)]);
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const area = `${line} L${pts.at(-1)[0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
        const gid = `g-${color.slice(1)}`;
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
    };

    const Donut = ({ segments, centerLabel, centerValue, size = 150 }) => {
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
    };

    const Legend = ({ items }) => (
        <div className="space-y-2.5 flex-1 min-w-0">
            {items.map(it => (
                <div key={it.label} className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: it.color }} />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#888888] capitalize flex-1 truncate">{it.label}</span>
                    <span className="text-[10px] font-black text-[#BBBBBB]">{it.value}</span>
                </div>
            ))}
        </div>
    );

    const HBars = ({ data, labelKey, valueKey, colorFn, suffix }) => {
        const max = Math.max(1, ...data.map(d => d[valueKey]));
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
    };

    // peak-hours histogram
    const HourChart = ({ data }) => {
        const max = Math.max(1, ...data.map(d => d.n));
        const peak = data.reduce((m, d) => d.n > m.n ? d : m, data[0]);
        return (
            <div>
                <div className="flex items-end gap-[3px] h-40">
                    {data.map(d => (
                        <div key={d.h} className="flex-1 flex flex-col justify-end group relative">
                            <div className="rounded-t transition-all" style={{
                                height: `${(d.n / max) * 100}%`, minHeight: d.n ? '3px' : '0',
                                background: d.h === peak.h ? '#8a7600' : '#E8D200',
                                opacity: d.h === peak.h ? 1 : 0.55,
                            }} />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1A1A1A] text-white text-[8px] font-black px-1.5 py-1 rounded whitespace-nowrap z-10">
                                {String(d.h).padStart(2, '0')}:00 · {d.n}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">
                    <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
                </div>
            </div>
        );
    };

    const Card = ({ accent, title, sub, icon: Icon, right, children, className = '' }) => (
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

    const Empty = ({ h = 'h-40' }) => (
        <div className={`${h} flex items-center justify-center text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black`}>No data in range</div>
    );

    const kpis = [
        { label: 'Sessions', value: fmt(a.sessionCount), delta: a.sessDelta, icon: Activity, color: '#10B981' },
        { label: 'Weekly Active', value: fmt(a.weeklyActive), sub: 'Unique · 7d', icon: Users, color: '#8a7600' },
        { label: 'Avg Duration', value: `${a.avgDuration}m`, sub: `${fmt(a.totalHours)}h total`, icon: Clock, color: '#0EA5E9' },
        { label: 'Points Issued', value: fmtPts(a.issued), sub: `${fmtPts(a.redeemed)} redeemed`, icon: Zap, color: '#F59E0B' },
        { label: 'Data Trust', value: `${a.avgTrust}%`, sub: `${a.flagged} flagged`, icon: ShieldCheck, color: a.avgTrust >= 80 ? '#10B981' : '#F43F5E' },
        { label: 'Redemptions', value: fmt(a.redCount), sub: `${fmtPts(a.redSpent)} POWR`, icon: Gift, color: '#8B5CF6' },
    ];

    return (
        <div className="px-4 lg:px-0 py-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="h-[1px] w-12 bg-[#8B5CF6]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8B5CF6] font-black">Subsystem / Intelligence</span>
                    </div>
                    <h1 className="text-5xl lg:text-6xl font-light tracking-tighter text-[#1A1A1A] mb-4">Analytics</h1>
                    <p className="text-[#888888] text-[10px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Network-wide performance metrics &amp; growth telemetry
                    </p>
                </div>
                {/* Range selector */}
                <div className="flex items-center gap-1 bg-white border border-[#E6E6E1] rounded-full p-1">
                    {RANGES.map(r => (
                        <button key={r.key} onClick={() => setRange(r.key)}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all ${range === r.key ? 'bg-[#1A1A1A] text-white' : 'text-[#AAAAAA] hover:text-[#1A1A1A]'}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
                {kpis.map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-6 rounded-2xl">
                        <div className="flex items-center gap-2 mb-4">
                            <c.icon size={13} style={{ color: c.color }} />
                            <span className="text-[8px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black truncate">{c.label}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none">{loading ? '—' : c.value}</span>
                            {!loading && c.delta != null && (
                                <span className="flex items-center text-[10px] font-black" style={{ color: c.delta >= 0 ? '#10B981' : '#F43F5E' }}>
                                    {c.delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(c.delta)}%
                                </span>
                            )}
                        </div>
                        <div className="text-[8px] text-[#CCCCCC] font-black uppercase tracking-[0.3em] mt-2 h-[10px]">{c.sub || ''}</div>
                    </div>
                ))}
            </div>

            {/* Row 1: session trend (wide) + activity mix */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#E8D200" title="Session Volume" sub={`Daily · ${range.toUpperCase()}`} icon={TrendingUp} className="lg:col-span-2">
                    {loading ? <Empty h="h-44" /> : a.trend.every(d => !d.count) ? <Empty h="h-44" /> : (
                        <>
                            <LineChart data={a.trend} valueKey="count" color="#8a7600" height={180} />
                            <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.2em] text-[#CCCCCC] font-black">
                                <span>{a.trend[0]?.day}</span><span>Today</span>
                            </div>
                        </>
                    )}
                </Card>
                <Card accent="#0EA5E9" title="Activity Mix" sub="Sessions by type" icon={BarChart3}>
                    {loading ? <Empty /> : a.activityMix.length === 0 ? <Empty /> : (
                        <HBars data={a.activityMix} labelKey="type" valueKey="count"
                            colorFn={d => ACTIVITY_COLORS[d.type] || '#E8D200'}
                            suffix="" />
                    )}
                </Card>
            </div>

            {/* Row 2: peak hours (wide) + day of week */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#F97316" title="Peak Hours" sub="When members train (local)" icon={Clock} className="lg:col-span-2">
                    {loading ? <Empty /> : a.sessionCount === 0 ? <Empty /> : <HourChart data={a.byHour} />}
                </Card>
                <Card accent="#10B981" title="By Day" sub="Sessions per weekday" icon={Calendar}>
                    {loading ? <Empty /> : a.sessionCount === 0 ? <Empty /> : (
                        <HBars data={a.byDow} labelKey="d" valueKey="n" colorFn={() => '#10B981'} />
                    )}
                </Card>
            </div>

            {/* Row 3: verification donut + points economy donut + points by source */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#8B5CF6" title="Data Sources" sub="How sessions verify" icon={ShieldCheck}>
                    {loading ? <Empty /> : a.verifyMix.length === 0 ? <Empty /> : (
                        <div className="flex items-center gap-6">
                            <Donut size={140}
                                segments={a.verifyMix.map(v => ({ value: v.count, color: VERIFY_COLORS[v.k] || '#CCC' }))}
                                centerValue={fmt(a.sessionCount)} centerLabel="sessions" />
                            <Legend items={a.verifyMix.map(v => ({ label: v.k, value: `${v.pct}%`, color: VERIFY_COLORS[v.k] || '#CCC' }))} />
                        </div>
                    )}
                </Card>
                <Card accent="#F59E0B" title="Points Economy" sub="Issued vs redeemed" icon={Zap}>
                    {loading ? <Empty /> : (a.issued + a.redeemed) === 0 ? <Empty /> : (
                        <div className="flex items-center gap-6">
                            <Donut size={140}
                                segments={[{ value: a.issued, color: '#10B981' }, { value: a.redeemed, color: '#F43F5E' }]}
                                centerValue={fmtPts(a.issued - a.redeemed)} centerLabel="net" />
                            <Legend items={[
                                { label: 'Issued', value: fmtPts(a.issued), color: '#10B981' },
                                { label: 'Redeemed', value: fmtPts(a.redeemed), color: '#F43F5E' },
                            ]} />
                        </div>
                    )}
                </Card>
                <Card accent="#0EA5E9" title="Points by Source" sub="Where POWR comes from" icon={Activity}>
                    {loading ? <Empty /> : a.pointsBySource.length === 0 ? <Empty /> : (
                        <HBars data={a.pointsBySource.slice(0, 6)} labelKey="k" valueKey="v"
                            colorFn={d => SOURCE_COLORS[d.k] || '#E8D200'} />
                    )}
                </Card>
            </div>

            {/* Row 4: cumulative growth (wide) + engagement depth stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card accent="#8a7600" title="User Growth" sub="Cumulative registrations" icon={TrendingUp} className="lg:col-span-2">
                    {loading ? <Empty h="h-44" /> : a.userGrowth.length === 0 ? <Empty h="h-44" /> : (
                        <>
                            <LineChart data={a.userGrowth} valueKey="total" color="#8a7600" height={180} />
                            <div className="flex justify-between mt-2 text-[8px] uppercase tracking-[0.25em] text-[#AAAAAA] font-black">
                                {a.userGrowth.map((m, i) => <span key={i}>{m.month}</span>)}
                            </div>
                        </>
                    )}
                </Card>
                <Card accent="#F43F5E" title="Engagement Depth" sub="Effort & integrity">
                    <div className="grid grid-cols-2 gap-y-7 gap-x-4">
                        {[
                            { icon: Footprints, label: 'Total Steps', value: fmtPts(a.totalSteps), color: '#0EA5E9' },
                            { icon: Activity, label: 'Distance', value: `${fmt(a.totalKm)} km`, color: '#10B981' },
                            { icon: Heart, label: 'Avg Heart Rate', value: a.avgHr ? `${a.avgHr} bpm` : '—', color: '#F43F5E' },
                            { icon: Clock, label: 'Active Hours', value: fmt(a.totalHours), color: '#F97316' },
                            { icon: ShieldCheck, label: 'Avg Trust', value: `${a.avgTrust}%`, color: '#8B5CF6' },
                            { icon: BarChart3, label: 'Flag Rate', value: `${a.flagRate}%`, color: '#E8D200' },
                        ].map(s => (
                            <div key={s.label}>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <s.icon size={11} style={{ color: s.color }} />
                                    <span className="text-[7px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">{s.label}</span>
                                </div>
                                <div className="text-2xl font-light tracking-tighter text-[#1A1A1A] leading-none">{loading ? '—' : s.value}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Row 5: top brands + provider adoption */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card accent="#8B5CF6" title="Top Reward Brands" sub="By POWR spent" icon={Gift}>
                    {loading ? <Empty /> : a.topBrands.length === 0 ? <Empty /> : (
                        <div className="divide-y divide-[#F4F4F1] -my-2">
                            {a.topBrands.map((b, i) => (
                                <div key={b.brand} className="flex items-center gap-4 py-3">
                                    <span className="text-[10px] font-black text-[#DDDDDD] w-4">{i + 1}</span>
                                    <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[#444444] flex-1 truncate">{b.brand}</span>
                                    <span className="text-[9px] uppercase tracking-[0.2em] text-[#BBBBBB] font-black">{b.n} redeemed</span>
                                    <span className="text-base font-light tracking-tight text-[#8B5CF6] w-20 text-right">{fmtPts(b.spent)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
                <Card accent="#10B981" title="Health Providers" sub={`Connected · ${fmt(a.proCount)} Pro of ${fmt(a.totalUsers)}`} icon={Heart}>
                    {loading ? <Empty /> : a.providers.length === 0 ? <Empty /> : (
                        <HBars data={a.providers} labelKey="k" valueKey="v"
                            colorFn={(d) => d.k === 'none' ? '#DDDDDD' : (VERIFY_COLORS[d.k] || '#10B981')} suffix=" users" />
                    )}
                </Card>
            </div>
        </div>
    );
}
