import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { TrendingUp, Users, Activity, BarChart3, Calendar, Zap } from 'lucide-react';

export default function Analytics() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [userGrowth, setUserGrowth] = useState([]);
    const [activityBreakdown, setActivityBreakdown] = useState([]);
    const [weeklyActive, setWeeklyActive] = useState(0);
    const [totalSessions, setTotalSessions] = useState(0);
    const [avgDuration, setAvgDuration] = useState(0);
    const [totalPoints, setTotalPoints] = useState(0);

    useEffect(() => { fetchAnalytics(); }, []);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const [profilesRes, sessionsRes, pointsRes] = await Promise.all([
                supabase.from('profiles').select('created_at'),
                supabase.from('activity_sessions').select('type, duration_sec, started_at, user_id'),
                supabase.from('point_transactions').select('amount'),
            ]);

            // User Growth by month
            const profiles = profilesRes.data || [];
            const monthMap = {};
            profiles.forEach(p => {
                const m = new Date(p.created_at).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
                monthMap[m] = (monthMap[m] || 0) + 1;
            });
            const growthData = Object.entries(monthMap).map(([month, count]) => ({ month, count }));
            setUserGrowth(growthData);

            // Activity breakdown
            const sessions = sessionsRes.data || [];
            setTotalSessions(sessions.length);
            const typeMap = {};
            let totalDur = 0;
            const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const weeklyUsers = new Set();

            sessions.forEach(s => {
                typeMap[s.type] = (typeMap[s.type] || 0) + 1;
                totalDur += s.duration_sec || 0;
                if (new Date(s.started_at).getTime() > weekAgo) weeklyUsers.add(s.user_id);
            });
            
            const actData = Object.entries(typeMap)
                .map(([type, count]) => ({ type, count, pct: Math.round((count / sessions.length) * 100) }))
                .sort((a, b) => b.count - a.count);
            setActivityBreakdown(actData);
            setWeeklyActive(weeklyUsers.size);
            setAvgDuration(sessions.length > 0 ? Math.round(totalDur / sessions.length / 60) : 0);

            // Points
            const points = pointsRes.data || [];
            setTotalPoints(points.reduce((a, p) => a + p.amount, 0));

        } catch (e) {
            toast.error('Analytics sync failed');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const COLORS = {
        walking: '#10B981', running: '#0EA5E9', cycling: '#8B5CF6', swimming: '#06B6D4',
        gym: '#E8D200', hiit: '#F43F5E', sports: '#F97316', yoga: '#EC4899',
    };

    const maxGrowth = Math.max(...userGrowth.map(d => d.count), 1);
    const maxActivity = Math.max(...activityBreakdown.map(d => d.count), 1);

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#8B5CF6]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8B5CF6] font-black">Subsystem / Intelligence</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Analytics</h1>
                <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Network-wide performance metrics and growth telemetry.
                </p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Weekly Active', value: weeklyActive, icon: Users, color: '#E8D200' },
                    { label: 'Total Sessions', value: totalSessions, icon: Activity, color: '#10B981' },
                    { label: 'Avg Duration', value: `${avgDuration}m`, icon: Calendar, color: '#0EA5E9' },
                    { label: 'Points Issued', value: totalPoints.toLocaleString(), icon: Zap, color: '#F59E0B' },
                ].map(c => (
                    <div key={c.label} className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-3xl group hover:border-[#202020] transition-all">
                        <div className="flex items-center gap-3 mb-6">
                            <c.icon size={16} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black">{c.label}</span>
                        </div>
                        <div className="text-5xl font-light tracking-tighter text-[#DDD] leading-none">
                            {loading ? '...' : c.value}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                {/* User Growth Chart */}
                <div className="bg-[#0A0A0A] border border-[#151515] p-12 rounded-[2rem]">
                    <div className="flex items-center justify-between mb-12">
                        <div>
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">User Growth</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Registrations by Month</p>
                        </div>
                        <TrendingUp size={20} className="text-[#222]" />
                    </div>
                    {loading ? (
                        <div className="h-48 flex items-center justify-center"><span className="text-[#222] text-xs">Loading...</span></div>
                    ) : userGrowth.length === 0 ? (
                        <div className="h-48 flex items-center justify-center"><span className="text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No data yet</span></div>
                    ) : (
                        <div className="flex items-end gap-4 h-48">
                            {userGrowth.map((d, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center gap-3">
                                    <span className="text-[11px] font-bold text-[#E8D200]">{d.count}</span>
                                    <div className="w-full rounded-t-xl transition-all hover:opacity-80" style={{
                                        height: `${(d.count / maxGrowth) * 100}%`,
                                        minHeight: '8px',
                                        background: 'linear-gradient(180deg, #E8D200, #E8D200/40)',
                                    }} />
                                    <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#333]">{d.month}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Activity Breakdown */}
                <div className="bg-[#0A0A0A] border border-[#151515] p-12 rounded-[2rem]">
                    <div className="flex items-center justify-between mb-12">
                        <div>
                            <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Activity Mix</h3>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Sessions by Type</p>
                        </div>
                        <BarChart3 size={20} className="text-[#222]" />
                    </div>
                    {loading ? (
                        <div className="h-48 flex items-center justify-center"><span className="text-[#222] text-xs">Loading...</span></div>
                    ) : activityBreakdown.length === 0 ? (
                        <div className="h-48 flex items-center justify-center"><span className="text-[#1A1A1A] text-[10px] uppercase tracking-[0.4em] font-black">No data yet</span></div>
                    ) : (
                        <div className="space-y-5">
                            {activityBreakdown.map((d, i) => (
                                <div key={d.type}>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#BBB] capitalize">{d.type}</span>
                                        <span className="text-[10px] font-black text-[#555]">{d.count} ({d.pct}%)</span>
                                    </div>
                                    <div className="w-full h-3 bg-[#111] rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-700" style={{
                                            width: `${(d.count / maxActivity) * 100}%`,
                                            backgroundColor: COLORS[d.type] || '#E8D200',
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
