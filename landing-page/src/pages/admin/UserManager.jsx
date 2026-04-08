import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { User, Search, Users, Activity, Award, ChevronRight, Filter, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function UserManager() {
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [stats, setStats] = useState({ total: 0, avgLevel: 0, activeToday: 0 });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // Fetch users
            const { data: profiles, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUsers(profiles || []);

            // Calculate stats
            const total = profiles.length;
            const avgLevel = total > 0 
                ? (profiles.reduce((acc, u) => acc + (u.level || 1), 0) / total).toFixed(1)
                : 0;
            
            // For activeToday, we could check activity_sessions, but for now let's just use profiles count
            setStats({ total, avgLevel, activeToday: total }); // Placeholder for active logic

        } catch (e) {
            toast.error('Failed to load user intelligence');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = users.filter(u => 
        !search || 
        (u.display_name?.toLowerCase().includes(search.toLowerCase())) ||
        (u.username?.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#E8D200] font-black">Subsystem / Intelligence</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">User Network</h1>
                    <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Global registry of active nodes and historical performance telemetry.
                    </p>
                </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
                {[
                    { label: 'Total Nodes', value: stats.total, icon: Users, color: '#E8D200', desc: 'SATELLITE' },
                    { label: 'Avg Performance', value: `LVL ${stats.avgLevel}`, icon: Award, color: '#10B981', desc: 'EFFICIENCY' },
                    { label: 'Active Uplinks', value: stats.activeToday, icon: Activity, color: '#0EA5E9', desc: 'TELEMETRY' },
                ].map(s => (
                    <div key={s.label} className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#202020] transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#222] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all">
                            <s.icon size={22} style={{ color: s.color }} />
                        </div>
                        <div>
                            <div className="text-4xl font-light tracking-tighter text-[#DDD] leading-none mb-2">
                                {loading ? '...' : s.value}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-6 mb-10">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#1A1A1A] group-focus-within:text-[#E8D200] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH NODE IDENTIFIER..."
                        className="w-full h-16 pl-16 pr-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#F2F2F2] placeholder-[#151515] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <button className="h-16 px-10 bg-[#0A0A0A] border border-[#151515] rounded-full flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#333] hover:text-[#E8D200] transition-all">
                    <Filter size={16} /> Filter Results
                </button>
            </div>

            {/* Content Container */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Syncing Node Hive...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['User Identity', 'Protocol Level', 'Location', 'Registration', 'Status', ''].map(h => (
                                        <th key={h} className={`px-12 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#1A1A1A] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#111]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-12 py-32 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#050505] border border-[#151515] flex items-center justify-center">
                                                    <Users size={32} className="text-[#151515]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">
                                                    No Nodes Detected
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(user => (
                                    <tr key={user.id} className="group hover:bg-[#080808] transition-all">
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-6">
                                                <div className="w-12 h-12 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center overflow-hidden shrink-0">
                                                    {user.avatar_url ? (
                                                        <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <User size={18} className="text-[#1A1A1A]" />
                                                    )}
                                                </div>
                                                <div>
                                                    <span className="text-base font-bold text-[#DDD] group-hover:text-[#F2F2F2] transition-colors block mb-1">
                                                        {user.display_name || user.username || 'Anonymous Node'}
                                                    </span>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#222] font-black">
                                                        @{user.username || 'unidentified'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-4">
                                                <span className="px-4 py-1.5 rounded-full bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em]">
                                                    LVL {user.level || 1}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            {user.location_granted ? (
                                                <div className="flex items-center gap-3">
                                                    <MapPin size={14} className="text-[#10B981]" />
                                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#10B981] font-black">Granted</span>
                                                </div>
                                            ) : (
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#333] font-black">Denied</span>
                                            )}
                                        </td>
                                        <td className="px-12 py-10 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] text-[#DDD] font-medium mb-1">
                                                    {new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#222] font-black">
                                                    {timeAgo(user.created_at)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10">
                                            <div className="flex items-center gap-4">
                                                <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.4)]"></div>
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#444] font-black">ACTIVE</span>
                                            </div>
                                        </td>
                                        <td className="px-12 py-10 text-right">
                                            <Link 
                                                to={`/admin/users/${user.id}`}
                                                className="inline-flex items-center gap-3 px-6 py-3 bg-[#050505] border border-[#151515] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#333] hover:text-[#E8D200] hover:border-[#E8D200]/40 transition-all group/btn"
                                            >
                                                Query Profile
                                                <ChevronRight size={14} className="text-[#151515] group-hover/btn:text-[#E8D200] transition-colors" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            
            <div className="mt-12 flex items-center justify-between px-12">
                <div className="flex items-center gap-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse"></div>
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Intra-Network Sync Active</span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.6em] text-[#151515] font-black">POWR / USR / V3.0</span>
            </div>
        </div>
    );
}
