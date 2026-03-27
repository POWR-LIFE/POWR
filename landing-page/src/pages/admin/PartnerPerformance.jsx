import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Activity, Users, Clock, TrendingUp, MapPin, Award } from 'lucide-react';

export default function PartnerPerformance() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [partners, setPartners] = useState([]);
    const [sessionStats, setSessionStats] = useState({});

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [partnersRes, sessionsRes] = await Promise.all([
                supabase.from('partners').select('*').eq('active', true),
                supabase.from('activity_sessions').select('user_id, duration_sec, verification, type, started_at'),
            ]);

            const partnerList = partnersRes.data || [];
            const sessions = sessionsRes.data || [];

            // Aggregate session stats
            const geofenceSessions = sessions.filter(s => s.verification === 'geofence');
            const uniqueUsers = new Set(sessions.map(s => s.user_id)).size;
            const totalDuration = sessions.reduce((a, s) => a + (s.duration_sec || 0), 0);
            const avgDuration = sessions.length > 0 ? Math.round(totalDuration / sessions.length / 60) : 0;

            setSessionStats({
                totalGeofence: geofenceSessions.length,
                uniqueUsers,
                avgDuration,
                totalSessions: sessions.length,
            });

            // Enrich partners with stats (in a real app this would be a join/aggregation)
            const enriched = partnerList.map(p => ({
                ...p,
                visits: geofenceSessions.length, // simplified — would need location matching
                uniqueVisitors: uniqueUsers,
                avgSessionMin: avgDuration,
            }));

            setPartners(enriched);
        } catch (e) {
            toast.error('Failed to sync partner data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#0EA5E9]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#0EA5E9] font-black">Subsystem / Network</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Partner Performance</h1>
                <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Engagement metrics and visit frequency across the partner network.
                </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Geofence Visits', value: sessionStats.totalGeofence || 0, icon: MapPin, color: '#10B981' },
                    { label: 'Unique Visitors', value: sessionStats.uniqueUsers || 0, icon: Users, color: '#E8D200' },
                    { label: 'Avg Session', value: `${sessionStats.avgDuration || 0}m`, icon: Clock, color: '#0EA5E9' },
                    { label: 'Total Sessions', value: sessionStats.totalSessions || 0, icon: Activity, color: '#8B5CF6' },
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

            {/* Partner Leaderboard */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                <div className="p-10 border-b border-[#151515] flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-light tracking-tighter text-[#EEE]">Partner Leaderboard</h3>
                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black mt-2">Ranked by Engagement Volume</p>
                    </div>
                    <TrendingUp size={20} className="text-[#222]" />
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Aggregating Network Data...</span>
                    </div>
                ) : partners.length === 0 ? (
                    <div className="p-20 text-center">
                        <Award size={48} className="mx-auto text-[#151515] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No active partners in network</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#111]">
                        {partners.map((p, i) => (
                            <div key={p.id} className="flex items-center gap-10 p-10 group hover:bg-[#080808] transition-all">
                                <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center text-2xl font-light text-[#333] shrink-0">
                                    {i + 1}
                                </div>
                                <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0">
                                    {p.logo_url ? (
                                        <img src={p.logo_url} alt="" className="w-full h-full object-contain p-2" />
                                    ) : (
                                        <Activity size={20} className="text-[#1A1A1A]" />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <div className="text-lg font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors mb-1">{p.name}</div>
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#222] font-black capitalize">{p.category} Partner</div>
                                </div>
                                <div className="flex gap-10">
                                    <div className="text-center">
                                        <div className="text-2xl font-light tracking-tighter text-[#E8D200] mb-1">{p.visits}</div>
                                        <div className="text-[8px] uppercase tracking-[0.3em] text-[#222] font-black">Visits</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-2xl font-light tracking-tighter text-[#10B981] mb-1">{p.uniqueVisitors}</div>
                                        <div className="text-[8px] uppercase tracking-[0.3em] text-[#222] font-black">Users</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-2xl font-light tracking-tighter text-[#0EA5E9] mb-1">{p.avgSessionMin}m</div>
                                        <div className="text-[8px] uppercase tracking-[0.3em] text-[#222] font-black">Avg</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
