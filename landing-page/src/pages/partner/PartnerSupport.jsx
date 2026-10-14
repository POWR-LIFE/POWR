import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { LifeBuoy, Send, Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, MessageSquare, Mail, FileText, Plug, Award, Settings, BookOpen } from 'lucide-react';
import { SectionCard, RailRow, RailLink, INPUT } from './integrationShared';

// Stored in support_tickets.category — the partner_ prefix is what tells the
// admin triage view this came from the portal, keep it on any new entries.
// Labels and hints are keys, translated where they render.
const CATEGORIES = [
    { id: 'partner_setup',   label: 'brandShell:support.categories.setup.label',   hint: 'brandShell:support.categories.setup.hint' },
    { id: 'partner_rewards', label: 'brandShell:support.categories.rewards.label', hint: 'brandShell:support.categories.rewards.hint' },
    { id: 'partner_account', label: 'brandShell:support.categories.account.label', hint: 'brandShell:support.categories.account.hint' },
    { id: 'partner_other',   label: 'brandShell:support.categories.other.label',   hint: 'brandShell:support.categories.other.hint' },
];

const STATUS_CONFIG = {
    open:        { label: 'brandShell:support.status.open',       color: '#8a7600', bg: 'bg-[#E8D200]/10 border-[#E8D200]/30', icon: AlertCircle },
    in_progress: { label: 'brandShell:support.status.inProgress', color: '#60A5FA', bg: 'bg-blue-500/10 border-blue-500/30',   icon: Clock       },
    resolved:    { label: 'brandShell:support.status.resolved',   color: '#16A34A', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    closed:      { label: 'brandShell:support.status.closed',     color: '#555',    bg: 'bg-[#EFEFEC] border-[#E6E6E1]',       icon: XCircle     },
};

const timeAgo = (dateStr, t) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t('brandShell:support.timeAgo.justNow');
    if (m < 60) return t('brandShell:support.timeAgo.minutes', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('brandShell:support.timeAgo.hours', { n: h });
    return t('brandShell:support.timeAgo.days', { n: Math.floor(h / 24) });
};

export default function PartnerSupport() {
    const { t } = useTranslation();
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
            toast.error(t('brandShell:support.toast.missing'));
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
            toast.error(t('brandShell:support.toast.failed'));
        } else {
            toast.success(t('brandShell:support.toast.sent'));
            setSubject('');
            setMessage('');
            setCategory('partner_setup');
            fetchTickets();
        }
    };

    // A ticket row existing tells us nothing about whether anyone is waiting:
    // the admin inbox resolves a ticket the moment it replies, so the count
    // that matters is the one still sitting with us.
    const awaiting = tickets.filter(tk => tk.status === 'open' || tk.status === 'in_progress').length;

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandShell:support.eyebrow')}</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">{t('brandShell:support.title')}</h1>
                <p className="text-[#666666] text-sm leading-relaxed max-w-lg">
                    {t('brandShell:support.intro')}
                </p>
            </div>

            {/* Two-col like the integration pages: workspace left, sticky rail
                right on xl (rail stacks below on smaller screens — the form is
                the point of this page, so it stays first in DOM order). */}
            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            <div className="flex-1 min-w-0 max-w-3xl xl:order-1">

            {/* New ticket form */}
            <form onSubmit={handleSubmit} className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB] mb-6">{t('brandShell:support.newTicket')}</h2>

                <div className="mb-6">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">{t('brandShell:support.about')}</div>
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
                                    {t(c.label)}
                                </div>
                                <div className="text-[11px] text-[#AAAAAA] leading-snug">{t(c.hint)}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mb-6">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">{t('brandShell:support.subject')}</div>
                    <input
                        type="text"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        placeholder={t('brandShell:support.subjectPlaceholder')}
                        maxLength={120}
                        className={INPUT}
                    />
                </div>

                <div className="mb-8">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">{t('brandShell:support.message')}</div>
                    <textarea
                        rows={6}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder={t('brandShell:support.messagePlaceholder')}
                        className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl p-5 text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none resize-none transition-all"
                    />
                </div>

                <div className="flex items-center justify-between gap-6">
                    <p className="text-[10px] text-[#BBBBBB] font-black uppercase tracking-[0.3em]">
                        {t('brandShell:support.repliesTo', { email: user?.email ?? '' })}
                    </p>
                    <button
                        type="submit"
                        disabled={sending || !subject.trim() || !message.trim()}
                        className="flex items-center gap-3 px-8 py-4 bg-[#E8D200] text-[#080808] font-black uppercase tracking-[0.3em] text-[11px] rounded-2xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-40 disabled:translate-y-0"
                    >
                        {sending
                            ? <div className="w-4 h-4 border-2 border-[#080808]/30 border-t-[#080808] rounded-full animate-spin" />
                            : <Send size={14} />}
                        {sending ? t('brandShell:support.sending') : t('brandShell:support.send')}
                    </button>
                </div>
            </form>

            {/* Previous tickets */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">{t('brandShell:support.yourTickets')}</h2>
                    {awaiting > 0 ? (
                        <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#999] bg-[#F4F4F1] border border-[#E6E6E1] rounded-full px-3 py-1">
                            {t('brandShell:support.awaiting', { count: awaiting })}
                        </span>
                    ) : tickets.length > 0 ? (
                        <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#16A34A] bg-green-500/10 border border-green-500/30 rounded-full px-3 py-1">
                            {t('brandShell:support.caughtUp')}
                        </span>
                    ) : null}
                </div>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : tickets.length === 0 ? (
                    <div className="text-center py-10">
                        <MessageSquare size={28} className="text-[#DDDDDD] mx-auto mb-4" />
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">{t('brandShell:support.noTickets')}</p>
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
                                                <span>{t(CATEGORIES.find(c => c.id === ticket.category)?.label ?? 'brandShell:support.categoryFallback')}</span>
                                                <span>·</span>
                                                <span>{timeAgo(ticket.created_at, t)}</span>
                                            </div>
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest shrink-0 ${cfg.bg}`} style={{ color: cfg.color }}>
                                            <StatusIcon size={10} />
                                            {t(cfg.label)}
                                        </span>
                                        <span className="text-[#CCCCCC] shrink-0">
                                            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                        </span>
                                    </button>
                                    {isOpen && (
                                        <div className="border-t border-[#E6E6E1] p-5 space-y-5 bg-[#FAFAF8]">
                                            <div>
                                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-2">{t('brandShell:support.yourMessage')}</div>
                                                <p className="text-[13px] text-[#666666] leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
                                            </div>
                                            {ticket.admin_reply ? (
                                                <div className="border-l-2 border-[#E8D200] pl-5 py-3 bg-[#E8D200]/5 rounded-r-xl pr-4">
                                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-2">{t('brandShell:support.powrSupport')}</div>
                                                    <p className="text-[13px] text-[#333333] leading-relaxed whitespace-pre-wrap">{ticket.admin_reply}</p>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black flex items-center gap-2">
                                                    <LifeBuoy size={12} /> {t('brandShell:support.waiting')}
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
                <SectionCard icon={Clock} title={t('brandShell:support.expect.title')}>
                    <RailRow
                        icon={Clock}
                        label={t('brandShell:support.expect.dayLabel')}
                        detail={t('brandShell:support.expect.dayDetail')}
                    />
                    <RailRow
                        icon={Mail}
                        label={t('brandShell:support.expect.repliesLabel')}
                        detail={user?.email
                            ? t('brandShell:support.expect.repliesDetail', { email: user.email })
                            : t('brandShell:support.expect.repliesDetailNoEmail')}
                    />
                    <RailRow
                        icon={FileText}
                        label={t('brandShell:support.expect.detailLabel')}
                        detail={t('brandShell:support.expect.detailDetail')}
                    />
                </SectionCard>

                <SectionCard icon={LifeBuoy} title={t('brandShell:support.faster.title')}>
                    <RailLink
                        to="/docs/getting-started"
                        icon={BookOpen}
                        label={t('brandShell:support.faster.guidesLabel')}
                        detail={t('brandShell:support.faster.guidesDetail')}
                    />
                    <RailLink
                        to="/partner/integration"
                        icon={Plug}
                        label={t('brandShell:support.faster.integrationLabel')}
                        detail={t('brandShell:support.faster.integrationDetail')}
                    />
                    <RailLink
                        to="/partner/rewards"
                        icon={Award}
                        label={t('brandShell:support.faster.rewardsLabel')}
                        detail={t('brandShell:support.faster.rewardsDetail')}
                    />
                    <RailLink
                        to="/partner/settings"
                        icon={Settings}
                        label={t('brandShell:support.faster.teamLabel')}
                        detail={t('brandShell:support.faster.teamDetail')}
                    />
                </SectionCard>
            </aside>
            </div>
        </div>
    );
}
