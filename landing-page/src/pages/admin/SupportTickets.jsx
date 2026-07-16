import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { MessageSquare, Search, ChevronDown, ChevronUp, Send, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const CATEGORY_LABELS = {
    points_rewards: 'Points & Rewards',
    account:        'Account & Profile',
    health_sync:    'Health & Sync',
    gym_checkin:    'Gym Check-in',
    challenges:     'Challenges',
    technical:      'Technical Issue',
    feedback:       'Feedback / Other',
    brand_request:  'Brand Request',
    // partner_* categories come from the partner portal's Support page
    partner_setup:   'Setup & Integration',
    partner_rewards: 'Rewards & Codes',
    partner_account: 'Account & Team',
    partner_other:   'Partner / Other',
};

const STATUS_CONFIG = {
    open:        { label: 'Open',        color: '#8a7600', bg: 'bg-[#E8D200]/10 border-[#E8D200]/30', icon: AlertCircle },
    in_progress: { label: 'In Progress', color: '#60A5FA', bg: 'bg-blue-500/10 border-blue-500/30',   icon: Clock       },
    resolved:    { label: 'Resolved',    color: '#4ADE80', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    closed:      { label: 'Closed',      color: '#555',    bg: 'bg-[#EFEFEC] border-[#E6E6E1]',             icon: XCircle     },
};

export default function SupportTickets() {
    const toast = useToast();
    const [tickets, setTickets]     = useState([]);
    const [loading, setLoading]     = useState(true);
    const [search, setSearch]       = useState('');
    const [filterStatus, setFilter] = useState('all');
    const [expanded, setExpanded]   = useState(null);
    const [replyText, setReplyText] = useState({});
    const [saving, setSaving]       = useState(null);

    const counts = {
        all:         tickets.length,
        open:        tickets.filter(t => t.status === 'open').length,
        in_progress: tickets.filter(t => t.status === 'in_progress').length,
        resolved:    tickets.filter(t => t.status === 'resolved').length,
        closed:      tickets.filter(t => t.status === 'closed').length,
    };

    useEffect(() => { fetchTickets(); }, []);

    const fetchTickets = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) toast.error('Failed to load support tickets');
        else setTickets(data || []);
        setLoading(false);
    };

    const handleUpdateStatus = async (id, status) => {
        const { error } = await supabase
            .from('support_tickets')
            .update({ status })
            .eq('id', id);
        if (error) {
            toast.error('Failed to update status');
        } else {
            setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t));
            toast.success('Status updated');
        }
    };

    const handleSendReply = async (id) => {
        const reply = (replyText[id] ?? '').trim();
        if (!reply) return;
        setSaving(id);
        const { error } = await supabase
            .from('support_tickets')
            .update({ admin_reply: reply, status: 'resolved' })
            .eq('id', id);
        setSaving(null);
        if (error) {
            toast.error('Failed to send reply');
        } else {
            setTickets(prev => prev.map(t => t.id === id ? { ...t, admin_reply: reply, status: 'resolved' } : t));
            setReplyText(prev => ({ ...prev, [id]: '' }));
            toast.success('Reply sent');
        }
    };

    const filtered = tickets
        .filter(t => filterStatus === 'all' || t.status === filterStatus)
        .filter(t => !search ||
            t.email.toLowerCase().includes(search.toLowerCase()) ||
            t.subject.toLowerCase().includes(search.toLowerCase()) ||
            t.message.toLowerCase().includes(search.toLowerCase()) ||
            (t.brand_name ?? '').toLowerCase().includes(search.toLowerCase())
        );

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#60A5FA]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#60A5FA] font-black">Subsystem / Support</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Support Tickets</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Inbound user support requests. Triage, reply, and resolve.
                    </p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">
                {[
                    { key: 'open',        label: 'Open',        color: '#8a7600' },
                    { key: 'in_progress', label: 'In Progress', color: '#60A5FA' },
                    { key: 'resolved',    label: 'Resolved',    color: '#4ADE80' },
                    { key: 'closed',      label: 'Closed',      color: '#555'    },
                ].map(s => (
                    <button
                        key={s.key}
                        onClick={() => setFilter(filterStatus === s.key ? 'all' : s.key)}
                        className={`p-8 rounded-3xl border transition-all text-left ${
                            filterStatus === s.key
                                ? 'bg-white border-[#E8D200]/40'
                                : 'bg-white border-[#E6E6E1] hover:border-[#E6E6E1]'
                        }`}
                    >
                        <div className="text-4xl font-light tracking-tighter mb-2" style={{ color: s.color }}>
                            {counts[s.key]}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">{s.label}</div>
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative mb-10">
                <Search size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                <input
                    type="text"
                    placeholder="Search by email, subject or message..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full h-14 bg-white border border-[#E6E6E1] rounded-2xl pl-12 pr-5 text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all"
                />
            </div>

            {/* Ticket list */}
            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-32">
                    <MessageSquare size={40} className="text-[#CCCCCC] mx-auto mb-6" />
                    <p className="text-[#BBBBBB] text-sm uppercase tracking-widest font-black">No tickets found</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filtered.map(ticket => {
                        const cfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
                        const StatusIcon = cfg.icon;
                        const isOpen = expanded === ticket.id;

                        return (
                            <div key={ticket.id} className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden transition-all hover:border-[#E6E6E1]">
                                {/* Ticket header row */}
                                <button
                                    className="w-full p-8 flex items-start gap-6 text-left"
                                    onClick={() => setExpanded(isOpen ? null : ticket.id)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-4 flex-wrap mb-3">
                                            <span className="text-base font-bold text-[#1A1A1A] truncate">{ticket.subject}</span>
                                            {ticket.category === 'brand_request' && (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-[#8B5CF6]/10 border-[#8B5CF6]/30 text-[#8B5CF6]">
                                                    Brand Request
                                                </span>
                                            )}
                                            {ticket.category?.startsWith('partner_') && (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-[#0EA5E9]/10 border-[#0EA5E9]/30 text-[#0EA5E9]">
                                                    Partner{ticket.brand_name ? ` · ${ticket.brand_name}` : ''}
                                                </span>
                                            )}
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${cfg.bg}`} style={{ color: cfg.color }}>
                                                <StatusIcon size={10} />
                                                {cfg.label}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] text-[#BBBBBB] font-black uppercase tracking-[0.3em] flex-wrap">
                                            <span>{ticket.email}</span>
                                            <span>·</span>
                                            <span>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
                                            <span>·</span>
                                            <span>{timeAgo(ticket.created_at)}</span>
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0 text-[#BBBBBB] mt-1">
                                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                    </div>
                                </button>

                                {/* Expanded detail */}
                                {isOpen && (
                                    <div className="border-t border-[#E6E6E1] p-8 space-y-8">
                                        {/* User message */}
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-3">User Message</div>
                                            <p className="text-sm text-[#666666] leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
                                        </div>

                                        {/* Existing reply */}
                                        {ticket.admin_reply && (
                                            <div className="border-l-2 border-[#E8D200] pl-6 bg-[#E8D200]/5 py-4 pr-4 rounded-r-xl">
                                                <div className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black mb-2">POWR Support Reply</div>
                                                <p className="text-sm text-[#333333] leading-relaxed whitespace-pre-wrap">{ticket.admin_reply}</p>
                                            </div>
                                        )}

                                        {/* Status controls */}
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-3">Update Status</div>
                                            <div className="flex flex-wrap gap-3">
                                                {Object.entries(STATUS_CONFIG).map(([key, s]) => (
                                                    <button
                                                        key={key}
                                                        onClick={() => handleUpdateStatus(ticket.id, key)}
                                                        className={`px-5 py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-[0.3em] transition-all ${
                                                            ticket.status === key
                                                                ? `${s.bg} opacity-100`
                                                                : 'bg-white border-[#E6E6E1] text-[#BBBBBB] hover:border-[#DDDDDD]'
                                                        }`}
                                                        style={ticket.status === key ? { color: s.color } : {}}
                                                    >
                                                        {s.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Reply box */}
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.5em] text-[#BBBBBB] font-black mb-3">
                                                {ticket.admin_reply ? 'Update Reply' : 'Send Reply'}
                                            </div>
                                            <textarea
                                                rows={4}
                                                value={replyText[ticket.id] ?? (ticket.admin_reply ?? '')}
                                                onChange={e => setReplyText(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                                                placeholder="Type your reply to the user…"
                                                className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none resize-none transition-all"
                                            />
                                            <div className="flex justify-end mt-4">
                                                <button
                                                    onClick={() => handleSendReply(ticket.id)}
                                                    disabled={saving === ticket.id || !(replyText[ticket.id] ?? '').trim()}
                                                    className="flex items-center gap-3 px-8 py-4 bg-[#E8D200] text-[#080808] font-black uppercase tracking-[0.3em] text-[11px] rounded-2xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-40 disabled:translate-y-0"
                                                >
                                                    {saving === ticket.id
                                                        ? <div className="w-4 h-4 border-2 border-[#E6E6E1] border-t-transparent rounded-full animate-spin" />
                                                        : <Send size={14} />}
                                                    {saving === ticket.id ? 'Sending…' : 'Send & Resolve'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
