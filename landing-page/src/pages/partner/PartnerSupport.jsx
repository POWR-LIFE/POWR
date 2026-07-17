import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { LifeBuoy, Send, Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, MessageSquare, Mail, FileText, Plug, Award, Settings } from 'lucide-react';
import { SectionCard, RailRow, RailLink, INPUT } from './integrationShared';

// Stored in support_tickets.category — the partner_ prefix is what tells the
// admin triage view this came from the portal, keep it on any new entries.
const CATEGORIES = [
    { id: 'partner_setup',   label: 'Setup & Integration', hint: 'Getting started, Shopify, API keys, webhooks' },
    { id: 'partner_rewards', label: 'Rewards & Codes',     hint: 'Rewards, promo codes, redemptions' },
    { id: 'partner_account', label: 'Account & Team',      hint: 'Logins, team members, brand details' },
    { id: 'partner_other',   label: 'Something Else',      hint: 'Anything not covered above' },
];

const STATUS_CONFIG = {
    open:        { label: 'Open',        color: '#8a7600', bg: 'bg-[#E8D200]/10 border-[#E8D200]/30', icon: AlertCircle },
    in_progress: { label: 'In Progress', color: '#60A5FA', bg: 'bg-blue-500/10 border-blue-500/30',   icon: Clock       },
    resolved:    { label: 'Resolved',    color: '#16A34A', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    closed:      { label: 'Closed',      color: '#555',    bg: 'bg-[#EFEFEC] border-[#E6E6E1]',       icon: XCircle     },
};

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function PartnerSupport() {
    const toast = useToast();
    const { user, partnerData } = useAuth();

    const [category, setCategory] = useState('partner_setup');
    const [subject, setSubject]   = useState('');
    const [message, setMessage]   = useState('');
    const [sending, setSending]   = useState(false);

    const [tickets, setTickets]   = useState([]);
    const [loading, setLoading]   = useState(true);
    const [expanded, setExpanded] = useState(null);

    const fetchTickets = async () => {
        if (!user) return;
        const { data } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        setTickets(data ?? []);
        setLoading(false);
    };

    useEffect(() => { fetchTickets(); }, [user?.id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!subject.trim() || !message.trim()) {
            toast.error('Please add a subject and a message');
            return;
        }
        setSending(true);
        const { error } = await supabase.from('support_tickets').insert({
            user_id:    user.id,
            email:      user.email ?? '',
            brand_name: partnerData?.brand_name ?? partnerData?.name ?? null,
            category,
            subject:    subject.trim(),
            message:    message.trim(),
        });
        setSending(false);
        if (error) {
            toast.error('Could not send your message — please try again');
        } else {
            toast.success("Ticket sent — we'll reply within one business day");
            setSubject('');
            setMessage('');
            setCategory('partner_setup');
            fetchTickets();
        }
    };

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Help</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">Support</h1>
                <p className="text-[#666666] text-sm leading-relaxed max-w-lg">
                    Stuck getting set up, or something not working as expected? Send us a ticket
                    and the POWR team will get back to you within one business day.
                </p>
            </div>

            {/* Two-col like the integration pages: workspace left, sticky rail
                right on xl (rail stacks below on smaller screens — the form is
                the point of this page, so it stays first in DOM order). */}
            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            <div className="flex-1 min-w-0 max-w-3xl xl:order-1">

            {/* New ticket form */}
            <form onSubmit={handleSubmit} className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-6">New Ticket</h2>

                <div className="mb-6">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">What's it about?</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {CATEGORIES.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setCategory(c.id)}
                                className={`p-4 rounded-2xl border text-left transition-all ${
                                    category === c.id
                                        ? 'bg-[#E8D200]/10 border-[#E8D200]/50'
                                        : 'bg-[#F4F4F1] border-[#E6E6E1] hover:border-[#DDDDDD]'
                                }`}
                            >
                                <div className={`text-[11px] font-black uppercase tracking-[0.2em] mb-1 ${category === c.id ? 'text-[#8a7600]' : 'text-[#666666]'}`}>
                                    {c.label}
                                </div>
                                <div className="text-[11px] text-[#AAAAAA] leading-snug">{c.hint}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mb-6">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">Subject</div>
                    <input
                        type="text"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        placeholder="A short summary of the issue"
                        maxLength={120}
                        className={INPUT}
                    />
                </div>

                <div className="mb-8">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">Message</div>
                    <textarea
                        rows={6}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder="Tell us what happened, what you expected, and any error messages you saw…"
                        className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none resize-none transition-all"
                    />
                </div>

                <div className="flex items-center justify-between gap-6">
                    <p className="text-[10px] text-[#BBBBBB] font-black uppercase tracking-[0.3em]">
                        Replies go to {user?.email}
                    </p>
                    <button
                        type="submit"
                        disabled={sending || !subject.trim() || !message.trim()}
                        className="flex items-center gap-3 px-8 py-4 bg-[#E8D200] text-[#080808] font-black uppercase tracking-[0.3em] text-[11px] rounded-2xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-40 disabled:translate-y-0"
                    >
                        {sending
                            ? <div className="w-4 h-4 border-2 border-[#080808]/30 border-t-[#080808] rounded-full animate-spin" />
                            : <Send size={14} />}
                        {sending ? 'Sending…' : 'Send Ticket'}
                    </button>
                </div>
            </form>

            {/* Previous tickets */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">Your Tickets</h2>
                    {tickets.length > 0 && (
                        <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#999] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full px-3 py-1">
                            {tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length} awaiting reply
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : tickets.length === 0 ? (
                    <div className="text-center py-10">
                        <MessageSquare size={28} className="text-[#DDDDDD] mx-auto mb-4" />
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">No tickets yet</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {tickets.map(ticket => {
                            const cfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
                            const StatusIcon = cfg.icon;
                            const isOpen = expanded === ticket.id;
                            return (
                                <div key={ticket.id} className="border border-[#E6E6E1] rounded-2xl overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : ticket.id)}
                                        className="w-full p-5 flex items-center gap-4 text-left hover:bg-[#FAFAF8] transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-bold text-[#1A1A1A] truncate mb-1.5">{ticket.subject}</div>
                                            <div className="flex items-center gap-3 text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                                                <span>{CATEGORIES.find(c => c.id === ticket.category)?.label ?? 'Support'}</span>
                                                <span>·</span>
                                                <span>{timeAgo(ticket.created_at)}</span>
                                            </div>
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest shrink-0 ${cfg.bg}`} style={{ color: cfg.color }}>
                                            <StatusIcon size={10} />
                                            {cfg.label}
                                        </span>
                                        <span className="text-[#CCCCCC] shrink-0">
                                            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                        </span>
                                    </button>
                                    {isOpen && (
                                        <div className="border-t border-[#E6E6E1] p-5 space-y-5 bg-[#FAFAF8]">
                                            <div>
                                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-2">Your Message</div>
                                                <p className="text-[13px] text-[#666666] leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
                                            </div>
                                            {ticket.admin_reply ? (
                                                <div className="border-l-2 border-[#E8D200] pl-5 py-3 bg-[#E8D200]/5 rounded-r-xl pr-4">
                                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-2">POWR Support</div>
                                                    <p className="text-[13px] text-[#333333] leading-relaxed whitespace-pre-wrap">{ticket.admin_reply}</p>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black flex items-center gap-2">
                                                    <LifeBuoy size={12} /> Waiting on the POWR team
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            </div>

            {/* ── Sticky rail: what happens after you hit send, plus the
                   self-serve surfaces that answer most tickets on their own. */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6 mt-6 xl:mt-0">
                <SectionCard icon={Clock} title="What to Expect">
                    <RailRow
                        icon={Clock}
                        label="One business day"
                        detail="The POWR team replies to every ticket — usually much sooner during UK hours."
                    />
                    <RailRow
                        icon={Mail}
                        label="Replies land here"
                        detail={`Answers appear on the ticket below and go to ${user?.email ?? 'your email'}.`}
                    />
                    <RailRow
                        icon={FileText}
                        label="Detail speeds things up"
                        detail="Include the reward, member or exact error text involved so we can dig in straight away."
                    />
                </SectionCard>

                <SectionCard icon={LifeBuoy} title="Fix It Faster">
                    <RailLink
                        to="/partner/integration"
                        icon={Plug}
                        label="Integration status"
                        detail="Connection health and setup steps for your delivery method."
                    />
                    <RailLink
                        to="/partner/rewards"
                        icon={Award}
                        label="Reward listings"
                        detail="Edit imagery, descriptions and what members see in the app."
                    />
                    <RailLink
                        to="/partner/settings"
                        icon={Settings}
                        label="Team & account"
                        detail="Invite teammates or change your password."
                    />
                </SectionCard>
            </aside>
            </div>
        </div>
    );
}
