import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { ScrollText, Search, Shield, Clock, Filter } from 'lucide-react';

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const ACTION_COLORS = {
    session_approved: '#10B981',
    session_rejected: '#F43F5E',
    point_adjustment: '#E8D200',
    config_update: '#8B5CF6',
    default: '#555',
};

export default function AuditLog() {
    const toast = useToast();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => { fetchLogs(); }, []);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('admin_audit_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200);
            if (error) throw error;
            setLogs(data || []);
        } catch (e) {
            toast.error('Failed to load audit log');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = logs.filter(l =>
        !search || l.action.toLowerCase().includes(search.toLowerCase()) || l.target_type?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#F59E0B]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#F59E0B] font-black">Subsystem / Compliance</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">Audit Log</h1>
                <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Immutable record of all administrative actions performed on the platform.
                </p>
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-6 mb-10">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#1A1A1A] group-focus-within:text-[#E8D200] transition-colors" />
                    <input type="text" placeholder="FILTER BY ACTION OR TARGET..." className="w-full h-16 pl-16 pr-8 bg-[#0A0A0A] border border-[#151515] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#F2F2F2] placeholder-[#151515] focus:border-[#E8D200]/40 outline-none transition-all uppercase" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            {/* Log Table */}
            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#F59E0B]/20 border-t-[#F59E0B] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Scanning Audit Trail...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-20 text-center">
                        <ScrollText size={48} className="mx-auto text-[#151515] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No audit records found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#111]">
                        {filtered.map(log => (
                            <div key={log.id} className="flex items-center gap-8 p-8 group hover:bg-[#080808] transition-all">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ACTION_COLORS[log.action] || ACTION_COLORS.default }} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-4 mb-2">
                                        <span className="text-sm font-bold text-[#DDD] capitalize">{log.action.replace(/_/g, ' ')}</span>
                                        {log.target_type && (
                                            <span className="px-3 py-0.5 bg-[#050505] border border-[#151515] rounded-full text-[8px] font-black uppercase tracking-[0.3em] text-[#333]">{log.target_type}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-[0.3em] text-[#222]">
                                        <span>Admin: {log.admin_id.substring(0, 12)}...</span>
                                        {log.target_id && <span>Target: {log.target_id.substring(0, 12)}...</span>}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[11px] text-[#555] mb-1">{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                                    <div className="text-[9px] text-[#222] font-black uppercase tracking-[0.3em]">{timeAgo(log.created_at)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
