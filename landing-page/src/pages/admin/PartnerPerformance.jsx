import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Activity, Users, Clock, TrendingUp, MapPin, Award, ChevronRight, BarChart3 } from 'lucide-react';

export default function PartnerPerformance() {
    const toast = useToast();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [partners, setPartners] = useState([]);
    const [totals, setTotals] = useState({ sessions: 0, users: 0, avgMin: 0, hours: 0 });
    const [filter, setFilter] = useState('all'); // all | active | inactive

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [partnersRes, sessionsRes] = await Promise.all([
                supabase.from('partners').select('id, name, logo_url, category, active, address'),
                supabase.from('activity_sessions').select('id, user_id, partner_id, duration_sec, started_at, flagged'),
            ]);

            const partnerList = partnersRes.data || [];
            const sessions = sessionsRes.data || [];

            // Group sessions by partner_id
            const byPartner = {};
            for (const s of sessions) {
                if (!s.partner_id) continue;
                if (!byPartner[s.partner_id]) byPartner[s.partner_id] = [];
                byPartner[s.partner_id].push(s);
            }

            const enriched = partnerList.map(p => {
                const ps = byPartner[p.id] || [];
                const uniqueUsers = new Set(ps.map(s => s.user_id)).size;
                const totalDurSec = ps.reduce((a, s) => a + (s.duration_sec || 0), 0);
                const avgMin = ps.length > 0 ? Math.round(totalDurSec / ps.length / 60) : 0;
                const totalHours = Math.round(totalDurSec / 3600 * 10) / 10;
                const flaggedCount = ps.filter(s => s.flagged).length;

                // Sessions in last 7 days
                const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
                const recentSessions = ps.filter(s => new Date(s.started_at).getTime() > cutoff).length;

                return { ...p, totalSessions: ps.length, uniqueUsers, avgMin, totalHours, flaggedCount, recentSessions };
            });

            // Sort by total sessions desc
            enriched.sort((a, b) => b.totalSessions - a.totalSessions);

            // Overall totals (only sessions linked to a partner)
            const linked = sessions.filter(s => s.partner_id);
            const allUsers = new Set(linked.map(s => s.user_id)).size;
            const allDurSec = linked.reduce((a, s) => a + (s.duration_sec || 0), 0);
            setTotals({
                sessions: linked.length,
                users: allUsers,
                avgMin: linked.length > 0 ? Math.round(allDurSec / linked.length / 60) : 0,
                hours: Math.round(allDurSec / 3600),
            });

            setPartners(enriched);
        } catch (e) {
            toast.error('Failed to load performance data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = partners.filter(p => {
        if (filter === 'active') return p.active;
        if (filter === 'inactive') return !p.active;
        return true;
    });

    const activeWithSessions = partners.filter(p => p.active && p.totalSessions > 0).length;

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#0EA5E9]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#0EA5E9] font-black">Subsystem / Network</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Partner Performance</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Real engagement metrics and visit data across the partner network.
                </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Network Sessions', value: loading ? '...' : totals.sessions.toLocaleString(), icon: Activity, color: '#10B981' },
                    { label: 'Unique Members', value: loading ? '...' : totals.users.toLocaleString(), icon: Users, color: '#8a7600' },
                    { label: 'Avg Session', value: loading ? '...' : `${totals.avgMin}m`, icon: Clock, color: '#0EA5E9' },
                    { label: 'Total Hours', value: loading ? '...' : totals.hours.toLocaleString(), icon: BarChart3, color: '#8B5CF6' },
                ].map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl">
                        <div className="flex items-center gap-3 mb-6">
                            <c.icon size={16} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">{c.label}</span>
                        </div>
                        <div className="text-5xl font-light tracking-tighter text-[#222222] leading-none">{c.value}</div>
                    </div>
                ))}
            </div>

            {/* Partner Leaderboard */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                <div className="p-10 border-b border-[#E6E6E1] flex items-center justify-between flex-wrap gap-6">
                    <div>
                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Partner Leaderboard</h3>
                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">
                            {loading ? '...' : `${activeWithSessions} venues with recorded sessions`}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {['all', 'active', 'inactive'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`h-9 px-5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] transition-all ${
                                    filter === f
                                        ? 'bg-[#1A1A1A] text-white'
                                        : 'bg-[#F4F4F1] border border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A]'
                                }`}
                            >
                                {f}
                            </button>
                        ))}
                        <TrendingUp size={18} className="text-[#666666] ml-2" />
                    </div>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Aggregating Network Data...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-20 text-center">
                        <Award size={48} className="mx-auto text-[#333333] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No partners found</p>
                    </div>
                ) : (
                    <>
                        {/* Table header */}
                        <div className="hidden lg:grid grid-cols-[3rem_3rem_1fr_8rem_8rem_8rem_8rem_3rem] gap-6 px-10 py-5 border-b border-[#E6E6E1] bg-[#F4F4F1]">
                            {['#', '', 'Venue', 'Sessions', 'Members', 'Avg', 'Hours', ''].map((h, i) => (
                                <div key={i} className="text-[9px] uppercase tracking-[0.4em] text-[#999999] font-black">{h}</div>
                            ))}
                        </div>
                        <div className="divide-y divide-[#E6E6E1]">
                            {filtered.map((p, i) => (
                                <button
                                    key={p.id}
                                    onClick={() => navigate(`/admin/performance/${p.id}`)}
                                    className="w-full text-left flex lg:grid lg:grid-cols-[3rem_3rem_1fr_8rem_8rem_8rem_8rem_3rem] gap-4 lg:gap-6 items-center px-10 py-8 group hover:bg-[#F4F4F1] transition-all"
                                >
                                    {/* Rank */}
                                    <div className="text-xl font-light text-[#CCCCCC] w-8 shrink-0 text-center">{i + 1}</div>

                                    {/* Logo */}
                                    <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                                        {p.logo_url ? (
                                            <img src={p.logo_url} alt="" className="w-full h-full object-contain p-1.5" />
                                        ) : (
                                            <Activity size={18} className="text-[#888888]" />
                                        )}
                                    </div>

                                    {/* Name + meta */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors truncate">{p.name}</span>
                                            {p.flaggedCount > 0 && (
                                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[8px] font-black uppercase tracking-[0.2em]">
                                                    {p.flaggedCount} flagged
                                                </span>
                                            )}
                                            {p.recentSessions > 0 && (
                                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#10B981]/10 text-[#10B981] text-[8px] font-black uppercase tracking-[0.2em]">
                                                    +{p.recentSessions} this week
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black">
                                            <span className={`px-2 py-0.5 rounded-full ${p.active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#EFEFEC] text-[#BBB]'}`}>
                                                {p.active ? 'Live' : 'Inactive'}
                                            </span>
                                            <span className="capitalize">{p.category}</span>
                                            {p.address && <span className="truncate hidden xl:block">{p.address}</span>}
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <StatCell value={p.totalSessions.toLocaleString()} label="Sessions" color="#10B981" zero={p.totalSessions === 0} />
                                    <StatCell value={p.uniqueUsers.toLocaleString()} label="Members" color="#8a7600" zero={p.uniqueUsers === 0} />
                                    <StatCell value={p.totalSessions > 0 ? `${p.avgMin}m` : '—'} label="Avg" color="#0EA5E9" zero={p.totalSessions === 0} />
                                    <StatCell value={p.totalSessions > 0 ? `${p.totalHours}h` : '—'} label="Hours" color="#8B5CF6" zero={p.totalSessions === 0} />

                                    {/* Arrow */}
                                    <ChevronRight size={16} className="text-[#CCCCCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function StatCell({ value, label, color, zero }) {
    return (
        <div className="hidden lg:block text-center">
            <div className="text-xl font-light tracking-tighter mb-1" style={{ color: zero ? '#CCCCCC' : color }}>{value}</div>
            <div className="text-[8px] uppercase tracking-[0.3em] text-[#999999] font-black">{label}</div>
        </div>
    );
}
