import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { User, Globe, Download, ExternalLink, Loader2, Search, Trash2, Users, Activity, ClipboardList, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

// --- Helpers ---
const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function WaitlistManager() {
    const toast = useToast();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [selected, setSelected] = useState(new Set());

    useEffect(() => { fetchWaitlist(); }, []);

    const fetchWaitlist = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('waitlist').select('*').order('created_at', { ascending: false });
        if (error) toast.error('Failed to load access queue');
        else setEntries(data || []);
        setLoading(false);
    };

    const filtered = entries
        .filter(e => !search || e.email.toLowerCase().includes(search.toLowerCase()))
        .filter(e => filterType === 'all' || e.typ === filterType);

    const userCount = entries.filter(e => e.typ === 'user').length;
    const partnerCount = entries.filter(e => e.typ === 'partner').length;

    const handleDelete = async (id) => {
        const { error } = await supabase.from('waitlist').delete().eq('id', id);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success('Access entry terminated');
            setEntries(prev => prev.filter(e => e.id !== id));
        }
        setConfirmDeleteId(null);
    };

    const exportToCSV = () => {
        if (entries.length === 0) { toast.info('Queue empty'); return; }
        const headers = ['Email', 'Type', 'Website', 'Created At'];
        const rows = entries.map(e => [`"${e.email}"`, e.typ, e.website || '', new Date(e.created_at).toISOString()]);
        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `powr_access_telemetry_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${entries.length} telemetry records`);
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#F43F5E]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#F43F5E] font-black">Subsystem / Access</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Inbound Queue</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Authorized early-access requests and strategic partnership inquiries. 
                    </p>
                </div>
                <button
                    onClick={exportToCSV}
                    className="flex items-center gap-4 h-16 px-10 bg-white border border-[#E6E6E1] rounded-full text-[11px] font-black uppercase tracking-[0.3em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all group shrink-0"
                >
                    <Download size={16} className="text-[#666666] group-hover:text-[#8a7600] transition-colors" /> Export Telemetry
                </button>
                {selected.size > 0 && (
                    <button
                        onClick={async () => {
                            const ids = Array.from(selected);
                            const { error } = await supabase.from('waitlist').delete().in('id', ids);
                            if (error) toast.error(error.message);
                            else {
                                toast.success(`${ids.length} entries terminated`);
                                setEntries(prev => prev.filter(e => !selected.has(e.id)));
                                setSelected(new Set());
                            }
                        }}
                        className="flex items-center gap-4 h-16 px-10 bg-red-500/10 border border-red-500/20 rounded-full text-[11px] font-black uppercase tracking-[0.3em] text-red-500 hover:bg-red-500/20 transition-all shrink-0"
                    >
                        <Trash2 size={16} /> Delete {selected.size} Selected
                    </button>
                )}
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
                {[
                    { label: 'Total Requests', value: entries.length,  icon: Users, color: '#F43F5E', desc: 'GLOBAL' },
                    { label: 'Platform Users', value: userCount,       icon: User,  color: '#0EA5E9', desc: 'FOUNDATION' },
                    { label: 'Partner Nodes',  value: partnerCount,    icon: Globe, color: '#8a7600', desc: 'STRATEGIC' },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#E6E6E1] transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#666666] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all">
                            <s.icon size={22} style={{ color: s.color }} />
                        </div>
                        <div>
                            <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none mb-2">
                                {loading ? '...' : s.value}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-6 mb-10">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#8a7600] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH ACCESS IDENTIFIER..."
                        className="w-full h-16 pl-16 pr-8 bg-white border border-[#E6E6E1] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex bg-white border border-[#E6E6E1] rounded-[2rem] p-2 gap-2">
                    {['all', 'user', 'partner'].map(t => (
                        <button
                            key={t}
                            onClick={() => setFilterType(t)}
                            className={`h-12 px-8 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all ${
                                filterType === t
                                    ? 'bg-[#E8D200] text-[#080808] shadow-lg shadow-[#E8D200]/10'
                                    : 'text-[#666666] hover:text-[#BBB]'
                            }`}
                        >
                            {t === 'all' ? 'All Channels' : t === 'user' ? `Users (${userCount})` : `Partners (${partnerCount})`}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Container */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Synchronizing Data...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    <th className="px-6 py-5">
                                        <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={e => {
                                            if (e.target.checked) setSelected(new Set(filtered.map(f => f.id)));
                                            else setSelected(new Set());
                                        }} className="w-4 h-4 accent-[#E8D200]" />
                                    </th>
                                    {['Identifier', 'Protocol', 'Source', 'Timestamp', ''].map(h => (
                                        <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#888888] ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E6E6E1]">
                                {filtered.length === 0 ? (
                                    <tr>
                                         <td colSpan={6} className="px-6 py-24 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                                                    <Users size={32} className="text-[#333333]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">
                                                    {entries.length === 0 ? 'Queue Empty' : 'No Records Match Query'}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(entry => (
                                    <tr key={entry.id} className="group hover:bg-[#F4F4F1] transition-all">
                                        <td className="px-6 py-5">
                                            <input type="checkbox" checked={selected.has(entry.id)} onChange={e => {
                                                const next = new Set(selected);
                                                if (e.target.checked) next.add(entry.id); else next.delete(entry.id);
                                                setSelected(next);
                                            }} className="w-4 h-4 accent-[#E8D200]" />
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-6">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xs font-black shrink-0 pointer-events-none ${entry.typ === 'partner' ? 'bg-[#E8D200]/5 border border-[#E8D200]/20 text-[#8a7600]' : 'bg-[#F4F4F1] border border-[#E6E6E1] text-[#666666]'}`}>
                                                    {entry.typ === 'partner' ? <Globe size={18} /> : <User size={18} />}
                                                </div>
                                                <div>
                                                    <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors block mb-1">{entry.email}</span>
                                                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">Direct Access Request</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className={`px-4 py-1.5 rounded-full text-[9px] uppercase font-black tracking-[0.3em] inline-block ${entry.typ === 'partner' ? 'bg-[#E8D200] text-[#080808]' : 'bg-[#F4F4F1] border border-[#E6E6E1] text-[#555555]'}`}>
                                                {entry.typ}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5">
                                            {entry.website ? (
                                                <a href={entry.website} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[#BBB] group-hover:text-[#8a7600] transition-colors font-black">
                                                    <span className="text-[11px] uppercase tracking-[0.2em] truncate max-w-48">{entry.website.replace(/^https?:\/\//, '')}</span>
                                                    <ExternalLink size={12} className="shrink-0" />
                                                </a>
                                            ) : (
                                                <span className="text-[11px] uppercase tracking-[0.4em] text-[#333333] font-black">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] text-[#222222] font-medium mb-1">
                                                    {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">Capture Date</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            {confirmDeleteId === entry.id ? (
                                                <div className="flex items-center justify-end gap-3 scale-90 origin-right transition-all">
                                                    <button onClick={() => handleDelete(entry.id)} className="h-10 px-6 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:bg-red-500/20 transition-all border border-red-500/20 shadow-lg shadow-red-500/5">CONFIRM</button>
                                                    <button onClick={() => setConfirmDeleteId(null)} className="h-10 px-6 bg-[#F4F4F1] text-[#666666] text-[10px] font-black uppercase tracking-[0.3em] rounded-full hover:text-[#333333] transition-all border border-[#E6E6E1]">CANCEL</button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteId(entry.id)}
                                                    className="w-12 h-12 flex items-center justify-center text-[#333333] hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
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
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Real-time Data Stream Active</span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.6em] text-[#333333] font-black">POWR / ACC / V3.0</span>
            </div>
        </div>
    );
}
