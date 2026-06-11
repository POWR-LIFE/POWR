import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    ChevronLeft, Activity, Users, Clock, BarChart3, MapPin,
    AlertTriangle, Shield, TrendingUp, Calendar, Dumbbell, Star
} from 'lucide-react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DURATION_BUCKETS = [
    { label: '<15m',  min: 0,    max: 900   },
    { label: '15–30m', min: 900,  max: 1800  },
    { label: '30–60m', min: 1800, max: 3600  },
    { label: '1–2h',  min: 3600, max: 7200  },
    { label: '2h+',   min: 7200, max: Infinity },
];

const fmtDuration = (sec) => {
    if (!sec || sec <= 0) return '0m';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};

const fmtDateShort = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const timeAgo = (iso) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const VERIFICATION_COLORS = {
    geofence: { bg: '#10B981', text: '#080808', label: 'Geofence' },
    manual:   { bg: '#8B5CF6', text: '#fff',    label: 'Manual'   },
    wearable: { bg: '#0EA5E9', text: '#fff',    label: 'Wearable' },
    health:   { bg: '#F59E0B', text: '#080808', label: 'Health'   },
};

export default function GymDetail() {
    const { partnerId } = useParams();
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [partner, setPartner] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [members, setMembers] = useState([]);
    const [sessionPage, setSessionPage] = useState(0);
    const [timeRange, setTimeRange] = useState(30); // days
    const PAGE_SIZE = 20;

    useEffect(() => {
        if (partnerId) fetchData();
    }, [partnerId, timeRange]);

    const fetchData = async () => {
        setLoading(true);
        setSessionPage(0);
        try {
            const cutoff = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000).toISOString();

            const [pRes, sRes] = await Promise.all([
                supabase.from('partners').select('*').eq('id', partnerId).single(),
                supabase
                    .from('activity_sessions')
                    .select('id, user_id, type, started_at, ended_at, duration_sec, distance_m, steps, hr_avg, verification, trust_score, flagged, flag_reason')
                    .eq('partner_id', partnerId)
                    .gte('started_at', cutoff)
                    .order('started_at', { ascending: false }),
            ]);

            if (pRes.error) throw pRes.error;
            setPartner(pRes.data);

            const sessionList = sRes.data || [];
            setSessions(sessionList);

            // Build member profiles from unique user_ids
            const userIds = [...new Set(sessionList.map(s => s.user_id))];
            if (userIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, username, display_name, avatar_url, level, is_pro')
                    .in('id', userIds);

                const profileMap = {};
                for (const p of profiles || []) profileMap[p.id] = p;

                // Aggregate per-member
                const memberStats = userIds.map(uid => {
                    const userSessions = sessionList.filter(s => s.user_id === uid);
                    const totalDur = userSessions.reduce((a, s) => a + (s.duration_sec || 0), 0);
                    const lastVisit = userSessions[0]?.started_at;
                    return {
                        ...profileMap[uid],
                        userId: uid,
                        sessionCount: userSessions.length,
                        totalDurSec: totalDur,
                        avgDurMin: userSessions.length > 0 ? Math.round(totalDur / userSessions.length / 60) : 0,
                        lastVisit,
                    };
                }).sort((a, b) => b.sessionCount - a.sessionCount);

                setMembers(memberStats);
            } else {
                setMembers([]);
            }
        } catch (e) {
            toast.error('Failed to load gym data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Derived stats
    const totalSessions = sessions.length;
    const uniqueMembers = new Set(sessions.map(s => s.user_id)).size;
    const totalDurSec = sessions.reduce((a, s) => a + (s.duration_sec || 0), 0);
    const avgDurMin = totalSessions > 0 ? Math.round(totalDurSec / totalSessions / 60) : 0;
    const totalHours = Math.round(totalDurSec / 3600 * 10) / 10;
    const flaggedCount = sessions.filter(s => s.flagged).length;
    const avgTrust = totalSessions > 0
        ? Math.round(sessions.reduce((a, s) => a + (s.trust_score || 0), 0) / totalSessions * 100)
        : 0;

    // Sessions in last 7 days
    const cutoff7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sessionsThisWeek = sessions.filter(s => new Date(s.started_at).getTime() > cutoff7).length;

    // Day-of-week distribution
    const dayDist = Array(7).fill(0);
    sessions.forEach(s => {
        if (s.started_at) dayDist[new Date(s.started_at).getDay()]++;
    });
    const maxDay = Math.max(...dayDist, 1);

    // Duration distribution
    const durationDist = DURATION_BUCKETS.map(b => ({
        ...b,
        count: sessions.filter(s => {
            const d = s.duration_sec || 0;
            return d >= b.min && d < b.max;
        }).length,
    }));
    const maxDurCount = Math.max(...durationDist.map(b => b.count), 1);

    // Weekly trend: last 8 weeks
    const weeklyTrend = Array(8).fill(0).map((_, i) => {
        const weekStart = Date.now() - (8 - i) * 7 * 24 * 60 * 60 * 1000;
        const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
        return {
            label: new Date(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            count: sessions.filter(s => {
                const t = new Date(s.started_at).getTime();
                return t >= weekStart && t < weekEnd;
            }).length,
        };
    });
    const maxWeek = Math.max(...weeklyTrend.map(w => w.count), 1);

    // Paginated sessions
    const pagedSessions = sessions.slice(sessionPage * PAGE_SIZE, (sessionPage + 1) * PAGE_SIZE);
    const totalPages = Math.ceil(sessions.length / PAGE_SIZE);

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Venue Data...</span>
        </div>
    );

    if (!partner) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-light text-[#1A1A1A] mb-4">Venue Not Found</h2>
            <Link to="/admin/performance" className="text-[#0EA5E9] text-sm uppercase tracking-widest font-black">Back to Performance</Link>
        </div>
    );

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Breadcrumb */}
            <Link to="/admin/performance" className="group flex items-center gap-3 mb-12 text-[#666666] hover:text-[#1A1A1A] transition-colors">
                <ChevronLeft size={16} />
                <span className="text-[10px] uppercase tracking-[0.4em] font-black">Back to Performance</span>
            </Link>

            {/* Header */}
            <header className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10 mb-16">
                <div className="flex items-center gap-10">
                    <div className="w-20 h-20 rounded-[2rem] bg-white border border-[#E6E6E1] flex items-center justify-center overflow-hidden shadow-2xl shrink-0">
                        {partner.logo_url ? (
                            <img src={partner.logo_url} alt="" className="w-full h-full object-contain p-3" />
                        ) : (
                            <Dumbbell size={32} className="text-[#888888]" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-3">
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] ${partner.active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#EFEFEC] text-[#BBB]'}`}>
                                {partner.active ? 'Live' : 'Inactive'}
                            </span>
                            <span className="px-3 py-1 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[9px] font-black uppercase tracking-[0.2em] text-[#555555] capitalize">
                                {partner.category}
                            </span>
                        </div>
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">{partner.name}</h1>
                        {partner.address && (
                            <div className="flex items-center gap-2 text-[#888888] text-xs">
                                <MapPin size={12} />
                                <span className="font-black uppercase tracking-[0.2em] text-[10px]">{partner.address}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Time range filter */}
                <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black">Period:</span>
                    {[7, 30, 90, 365].map(d => (
                        <button
                            key={d}
                            onClick={() => setTimeRange(d)}
                            className={`h-9 px-5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] transition-all ${
                                timeRange === d
                                    ? 'bg-[#1A1A1A] text-white'
                                    : 'bg-white border border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A]'
                            }`}
                        >
                            {d === 365 ? '1Y' : `${d}D`}
                        </button>
                    ))}
                </div>
            </header>

            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                {[
                    { label: 'Total Sessions',  value: totalSessions.toLocaleString(),  icon: Activity,   color: '#10B981' },
                    { label: 'Unique Members',  value: uniqueMembers.toLocaleString(),  icon: Users,      color: '#8a7600' },
                    { label: 'Avg Duration',    value: `${avgDurMin}m`,                icon: Clock,      color: '#0EA5E9' },
                    { label: 'Total Hours',     value: `${totalHours}h`,               icon: BarChart3,  color: '#8B5CF6' },
                ].map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-8 rounded-3xl">
                        <div className="flex items-center gap-3 mb-5">
                            <c.icon size={14} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">{c.label}</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none">
                            {totalSessions === 0 ? '0' : c.value}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
                {[
                    { label: 'This Week',    value: sessionsThisWeek.toLocaleString(), icon: Calendar,      color: '#10B981' },
                    { label: 'Flagged',      value: flaggedCount.toLocaleString(),     icon: AlertTriangle, color: flaggedCount > 0 ? '#EF4444' : '#CCCCCC' },
                    { label: 'Avg Trust',    value: `${avgTrust}%`,                   icon: Shield,        color: avgTrust >= 90 ? '#10B981' : avgTrust >= 70 ? '#F59E0B' : '#EF4444' },
                    { label: 'Locations',   value: (partner.locations?.length || 0).toString(), icon: MapPin, color: '#0EA5E9' },
                ].map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-8 rounded-3xl">
                        <div className="flex items-center gap-3 mb-5">
                            <c.icon size={14} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">{c.label}</span>
                        </div>
                        <div className="text-4xl font-light tracking-tighter leading-none" style={{ color: c.color }}>
                            {c.value}
                        </div>
                    </div>
                ))}
            </div>

            {totalSessions === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-24 text-center">
                    <Activity size={48} className="mx-auto text-[#CCCCCC] mb-6" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No sessions recorded in this period</p>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-3">Try extending the time range above</p>
                </div>
            ) : (
                <>
                    {/* Charts row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                        {/* Weekly trend */}
                        <div className="lg:col-span-2 bg-white border border-[#E6E6E1] rounded-3xl p-10">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Weekly Sessions</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">Last 8 weeks</p>
                                </div>
                                <TrendingUp size={18} className="text-[#666666]" />
                            </div>
                            <div className="flex items-end gap-3 h-32">
                                {weeklyTrend.map((w, i) => (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                                        <span className="text-[8px] font-black text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity">
                                            {w.count}
                                        </span>
                                        <div
                                            className="w-full rounded-t-xl transition-all"
                                            style={{
                                                height: `${Math.round((w.count / maxWeek) * 96) + (w.count > 0 ? 4 : 0)}px`,
                                                backgroundColor: i === 7 ? '#10B981' : '#E6E6E1',
                                                minHeight: w.count > 0 ? '4px' : '2px',
                                            }}
                                        />
                                        <span className="text-[7px] font-black text-[#BBBBBB] uppercase tracking-[0.2em] truncate w-full text-center">{w.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Day of week */}
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10">
                            <div className="mb-8">
                                <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Peak Days</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">Sessions by weekday</p>
                            </div>
                            <div className="space-y-3">
                                {DAY_NAMES.map((day, i) => (
                                    <div key={day} className="flex items-center gap-4">
                                        <span className="text-[9px] font-black text-[#888888] uppercase tracking-[0.2em] w-7 shrink-0">{day}</span>
                                        <div className="flex-1 bg-[#F4F4F1] rounded-full h-5 overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all"
                                                style={{
                                                    width: `${Math.round((dayDist[i] / maxDay) * 100)}%`,
                                                    backgroundColor: dayDist[i] === Math.max(...dayDist) ? '#10B981' : '#0EA5E9',
                                                    minWidth: dayDist[i] > 0 ? '12px' : '0',
                                                }}
                                            />
                                        </div>
                                        <span className="text-[9px] font-black text-[#888888] w-5 text-right">{dayDist[i]}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Duration distribution */}
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 mb-8">
                        <div className="mb-8">
                            <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Session Length Distribution</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">How long members stay</p>
                        </div>
                        <div className="grid grid-cols-5 gap-4">
                            {durationDist.map((b, i) => (
                                <div key={b.label} className="text-center">
                                    <div className="h-24 flex items-end justify-center mb-3">
                                        <div
                                            className="w-full rounded-t-2xl transition-all"
                                            style={{
                                                height: `${Math.round((b.count / maxDurCount) * 88) + (b.count > 0 ? 8 : 2)}px`,
                                                backgroundColor: ['#E6E6E1', '#8B5CF6', '#0EA5E9', '#10B981', '#8a7600'][i],
                                                opacity: b.count === 0 ? 0.3 : 1,
                                            }}
                                        />
                                    </div>
                                    <div className="text-xl font-light tracking-tighter text-[#222222] mb-1">{b.count}</div>
                                    <div className="text-[8px] uppercase tracking-[0.3em] text-[#888888] font-black">{b.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Members + Sessions grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-8">
                        {/* Top Members */}
                        <div className="lg:col-span-2 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                            <div className="p-10 border-b border-[#E6E6E1]">
                                <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Top Members</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">Ranked by visit frequency</p>
                            </div>
                            <div className="divide-y divide-[#E6E6E1]">
                                {members.slice(0, 10).map((m, i) => (
                                    <div key={m.userId} className="flex items-center gap-6 px-10 py-6 group hover:bg-[#F4F4F1] transition-all">
                                        <div className="text-lg font-light text-[#CCCCCC] w-6 text-center shrink-0">{i + 1}</div>
                                        <div className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] overflow-hidden shrink-0 flex items-center justify-center">
                                            {m.avatar_url ? (
                                                <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <Users size={14} className="text-[#888888]" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-[#222222] truncate">
                                                    {m.display_name || m.username || 'Anonymous'}
                                                </span>
                                                {m.is_pro && <Star size={10} className="text-[#E8D200] shrink-0" fill="#E8D200" />}
                                            </div>
                                            <div className="text-[8px] uppercase tracking-[0.2em] text-[#888888] font-black mt-0.5">
                                                Last: {timeAgo(m.lastVisit)}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-base font-light tracking-tighter text-[#10B981]">{m.sessionCount}</div>
                                            <div className="text-[8px] uppercase tracking-[0.2em] text-[#888888] font-black">visits</div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-base font-light tracking-tighter text-[#0EA5E9]">{m.avgDurMin}m</div>
                                            <div className="text-[8px] uppercase tracking-[0.2em] text-[#888888] font-black">avg</div>
                                        </div>
                                    </div>
                                ))}
                                {members.length === 0 && (
                                    <div className="p-16 text-center">
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No members in period</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Recent Sessions */}
                        <div className="lg:col-span-3 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                            <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Session Log</h3>
                                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">
                                        {totalSessions} sessions — showing {Math.min(PAGE_SIZE, totalSessions)} per page
                                    </p>
                                </div>
                                {flaggedCount > 0 && (
                                    <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full">
                                        <AlertTriangle size={12} className="text-red-500" />
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500">{flaggedCount} flagged</span>
                                    </div>
                                )}
                            </div>

                            {/* Column headers */}
                            <div className="grid grid-cols-[1fr_5rem_5rem_6rem_4rem] gap-4 px-10 py-4 border-b border-[#E6E6E1] bg-[#F4F4F1]">
                                {['Member', 'Date', 'Duration', 'Verification', 'Trust'].map(h => (
                                    <div key={h} className="text-[8px] uppercase tracking-[0.4em] text-[#999999] font-black">{h}</div>
                                ))}
                            </div>

                            <div className="divide-y divide-[#E6E6E1] max-h-[600px] overflow-y-auto">
                                {pagedSessions.map(s => {
                                    const member = members.find(m => m.userId === s.user_id);
                                    const vc = VERIFICATION_COLORS[s.verification] || { bg: '#E6E6E1', text: '#666666', label: s.verification };
                                    return (
                                        <div
                                            key={s.id}
                                            className={`grid grid-cols-[1fr_5rem_5rem_6rem_4rem] gap-4 items-center px-10 py-5 transition-all hover:bg-[#F4F4F1] ${s.flagged ? 'bg-red-500/3 border-l-2 border-red-400' : ''}`}
                                        >
                                            {/* Member */}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    {s.flagged && <AlertTriangle size={10} className="text-red-400 shrink-0" />}
                                                    <span className="text-sm font-bold text-[#222222] truncate">
                                                        {member?.display_name || member?.username || 'Anonymous'}
                                                    </span>
                                                </div>
                                                {s.flag_reason && (
                                                    <div className="text-[8px] uppercase tracking-[0.2em] text-red-400 font-black truncate mt-0.5">{s.flag_reason}</div>
                                                )}
                                            </div>

                                            {/* Date */}
                                            <div>
                                                <div className="text-[10px] font-black text-[#555555]">{fmtDateShort(s.started_at)}</div>
                                                <div className="text-[8px] text-[#888888] font-black uppercase tracking-[0.2em]">{timeAgo(s.started_at)}</div>
                                            </div>

                                            {/* Duration */}
                                            <div className="text-sm font-light tracking-tighter text-[#0EA5E9]">
                                                {fmtDuration(s.duration_sec)}
                                            </div>

                                            {/* Verification */}
                                            <div>
                                                <span
                                                    className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.2em]"
                                                    style={{ backgroundColor: vc.bg + '20', color: vc.bg }}
                                                >
                                                    {vc.label}
                                                </span>
                                            </div>

                                            {/* Trust */}
                                            <div className="text-sm font-light tracking-tighter" style={{
                                                color: (s.trust_score || 0) >= 0.9 ? '#10B981' : (s.trust_score || 0) >= 0.7 ? '#F59E0B' : '#EF4444'
                                            }}>
                                                {s.trust_score != null ? `${Math.round(s.trust_score * 100)}%` : '—'}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="p-8 border-t border-[#E6E6E1] flex items-center justify-between">
                                    <button
                                        onClick={() => setSessionPage(p => Math.max(0, p - 1))}
                                        disabled={sessionPage === 0}
                                        className="h-9 px-6 rounded-full text-[9px] font-black uppercase tracking-[0.3em] bg-[#F4F4F1] border border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        Prev
                                    </button>
                                    <span className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black">
                                        Page {sessionPage + 1} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setSessionPage(p => Math.min(totalPages - 1, p + 1))}
                                        disabled={sessionPage >= totalPages - 1}
                                        className="h-9 px-6 rounded-full text-[9px] font-black uppercase tracking-[0.3em] bg-[#F4F4F1] border border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Locations */}
                    {partner.locations?.length > 0 && (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                            <div className="p-10 border-b border-[#E6E6E1]">
                                <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Geofence Locations</h3>
                                <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-1">{partner.locations.length} active nodes</p>
                            </div>
                            <div className="divide-y divide-[#E6E6E1]">
                                {partner.locations.map((loc, i) => (
                                    <div key={i} className="flex items-center gap-8 px-10 py-8">
                                        <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                            <MapPin size={18} className="text-[#0EA5E9]" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-bold text-[#222222] mb-1">{loc.name || `Location ${i + 1}`}</div>
                                            <div className="flex items-center gap-6 text-[9px] font-black text-[#888888] uppercase tracking-[0.2em]">
                                                <span>Lat {loc.lat?.toFixed(5)}</span>
                                                <span>Lng {loc.lng?.toFixed(5)}</span>
                                                <span className="px-3 py-1 rounded-full border border-[#E6E6E1] text-[#555555]">{loc.radius}m radius</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
