import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, MapPin, Activity, Search, Filter } from 'lucide-react';

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

export default function SessionReview() {
    const toast = useToast();
    const { user } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('flagged'); // 'flagged', 'low_trust', 'all'
    const [search, setSearch] = useState('');

    useEffect(() => { fetchSessions(); }, [filter]);

    const fetchSessions = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('activity_sessions')
                .select('*, profiles!activity_sessions_user_id_fkey(display_name, username)')
                .order('started_at', { ascending: false });

            if (filter === 'flagged') query = query.eq('flagged', true);
            else if (filter === 'low_trust') query = query.lt('trust_score', 0.5);

            const { data, error } = await query.limit(100);
            if (error) throw error;
            setSessions(data || []);
        } catch (e) {
            toast.error('Failed to load session data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (session) => {
        const { error } = await supabase
            .from('activity_sessions')
            .update({ flagged: false, trust_score: 1.0 })
            .eq('id', session.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'session_approved', 'activity_session', session.id, { previous_trust: session.trust_score });
        toast.success('Session approved');
        setSessions(prev => prev.filter(s => s.id !== session.id));
    };

    const handleReject = async (session) => {
        const { error } = await supabase
            .from('activity_sessions')
            .delete()
            .eq('id', session.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'session_rejected', 'activity_session', session.id, { type: session.type, user_id: session.user_id });
        toast.success('Session rejected & removed');
        setSessions(prev => prev.filter(s => s.id !== session.id));
    };

    const filtered = sessions.filter(s => {
        if (!search) return true;
        const name = s.profiles?.display_name || s.profiles?.username || '';
        return name.toLowerCase().includes(search.toLowerCase()) || s.type.toLowerCase().includes(search.toLowerCase());
    });

    const flaggedCount = sessions.filter(s => s.flagged).length;
    const lowTrustCount = sessions.filter(s => s.trust_score < 0.5).length;

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#F43F5E]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#F43F5E] font-black">Subsystem / Integrity</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Session Review</h1>
                    <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Flagged and low-trust activity sessions pending human verification.
                    </p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
                {[
                    { label: 'Flagged Sessions', value: flaggedCount, icon: AlertTriangle, color: '#F43F5E', desc: 'CRITICAL' },
                    { label: 'Low Trust', value: lowTrustCount, icon: Shield, color: '#F59E0B', desc: 'WARNING' },
                    { label: 'Total In Queue', value: sessions.length, icon: Activity, color: '#0EA5E9', desc: 'QUEUE' },
                ].map(s => (
                    <div key={s.label} className="bg-[#0A0A0A] border border-[#151515] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#202020] transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#222] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
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
                    <input type="text" placeholder="SEARCH BY USER OR TYPE..." className="w-full h-16 pl-16 pr-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#F2F2F2] placeholder-[#151515] focus:border-[#E8D200]/40 outline-none transition-all uppercase" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="flex bg-[#0A0A0A] border border-[#151515] rounded-[2rem] p-2 gap-2">
                    {[
                        { key: 'flagged', label: 'Flagged' },
                        { key: 'low_trust', label: 'Low Trust' },
                        { key: 'all', label: 'All Sessions' },
                    ].map(t => (
                        <button key={t.key} onClick={() => setFilter(t.key)} className={`h-12 px-8 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${filter === t.key ? 'bg-[#F43F5E] text-white shadow-lg shadow-[#F43F5E]/10' : 'text-[#222] hover:text-[#555]'}`}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#F43F5E]/20 border-t-[#F43F5E] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Scanning Integrity Layer...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#050505] border-b border-[#151515]">
                                    {['User', 'Activity', 'Duration', 'Verification', 'Trust', 'Actions'].map(h => (
                                        <th key={h} className={`px-10 py-8 text-[10px] font-black uppercase tracking-[0.5em] text-[#1A1A1A] ${h === 'Actions' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#111]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-12 py-32 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <CheckCircle size={48} className="text-[#10B981]/30" />
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">All Clear — No Sessions Require Review</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(session => (
                                    <tr key={session.id} className="group hover:bg-[#080808] transition-all">
                                        <td className="px-10 py-8">
                                            <span className="text-base font-bold text-[#DDD] block mb-1">{session.profiles?.display_name || session.profiles?.username || 'Unknown'}</span>
                                            <span className="text-[9px] text-[#222] font-black uppercase tracking-[0.3em]">{timeAgo(session.started_at)}</span>
                                        </td>
                                        <td className="px-10 py-8">
                                            <span className="text-sm font-bold text-[#BBB] capitalize">{session.type}</span>
                                        </td>
                                        <td className="px-10 py-8">
                                            <div className="flex items-center gap-2 text-[11px] text-[#555]">
                                                <Clock size={14} /> {Math.floor(session.duration_sec / 60)}m
                                            </div>
                                        </td>
                                        <td className="px-10 py-8">
                                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border ${session.verification === 'geofence' ? 'border-[#10B981]/20 text-[#10B981]' : session.verification === 'gps' ? 'border-[#0EA5E9]/20 text-[#0EA5E9]' : 'border-[#151515] text-[#333]'}`}>
                                                {session.verification}
                                            </span>
                                        </td>
                                        <td className="px-10 py-8">
                                            <div className={`text-2xl font-light tracking-tighter ${session.trust_score >= 0.7 ? 'text-[#10B981]' : session.trust_score >= 0.4 ? 'text-[#F59E0B]' : 'text-[#F43F5E]'}`}>
                                                {(session.trust_score * 100).toFixed(0)}%
                                            </div>
                                        </td>
                                        <td className="px-10 py-8 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <button onClick={() => handleApprove(session)} className="h-10 px-5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#10B981]/20 transition-all flex items-center gap-2">
                                                    <CheckCircle size={14} /> Approve
                                                </button>
                                                <button onClick={() => handleReject(session)} className="h-10 px-5 rounded-full bg-[#F43F5E]/10 border border-[#F43F5E]/20 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#F43F5E]/20 transition-all flex items-center gap-2">
                                                    <XCircle size={14} /> Reject
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
