import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { Card, Micro, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymTickets, submitGymTicket } from './venueApi';

// Settings → Help: the team writes to POWR (a gym_help ticket in
// /admin/support, plus a Slack line) and sees everything it has asked POWR
// for, with POWR's answers. Package changes, Clash Nights and first-event
// reviews open their own tickets automatically, so they're listed here too.
// The how-to guides (/docs/gyms) answer most questions before they're asked.

// `value` is what the ticket is filed under (sent to the server, stays
// English for POWR's inbox); `label` is the key the button shows.
const TOPICS = [
    { value: 'Something’s not working', label: 'venueShell:help.topics.broken' },
    { value: 'Package and billing', label: 'venueShell:help.topics.billing' },
    { value: 'Events', label: 'venueShell:help.topics.events' },
    { value: 'Screens and the board', label: 'venueShell:help.topics.screens' },
    { value: 'Studio', label: 'venueShell:help.topics.studio' },
    { value: 'Other', label: 'venueShell:help.topics.other' },
];

const KIND = {
    gym_help: 'venueShell:help.kinds.question',
    gym_package: 'venueShell:help.kinds.package',
    gym_clash_night: 'venueShell:help.kinds.clashNight',
    gym_clash_cancel: 'venueShell:help.kinds.clashCancel',
    gym_event_review: 'venueShell:help.kinds.eventReview',
};

const STATUS = {
    open:        { label: 'venueShell:help.status.open', cls: 'bg-[#FFFBE0] border-[#E8D200]/50 text-[#8a7600]' },
    in_progress: { label: 'venueShell:help.status.inProgress', cls: 'bg-[#60A5FA]/10 border-[#60A5FA]/30 text-[#2563EB]' },
    resolved:    { label: 'venueShell:help.status.resolved', cls: 'bg-[#0B7A57]/10 border-[#0B7A57]/30 text-[#0B7A57]' },
    closed:      { label: 'venueShell:help.status.closed', cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#AAAAAA]' },
};

const when = (iso) => new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', timeZone: 'Europe/London' });

export default function GymHelp({ supportEmail, gymName }) {
    const { t } = useTranslation();
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const [tickets, setTickets] = useState(null);
    const [open, setOpen] = useState(false);
    const [topic, setTopic] = useState(TOPICS[0].value);
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => { fetchGymTickets(gym.partner_id).then(setTickets).catch(() => setTickets([])); }, [gym.partner_id]);

    const send = async (e) => {
        e.preventDefault();
        // Admin preview only: stays English.
        if (isActingGym) { toast.error('Preview only. Write to the gym from the admin pages.'); return; }
        setBusy(true);
        try {
            setTickets(await submitGymTicket(gym.partner_id, { topic, subject, message }));
            toast.success(t('venueShell:help.sent'));
            setSubject(''); setMessage(''); setOpen(false);
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4"><LifeBuoy size={15} className="text-[#8a7600]" /><Micro>{t('venueShell:help.title')}</Micro></div>
            <p className="text-[13px] text-[#1A1A1A] leading-relaxed">{t('venueShell:help.intro')}</p>

            {open ? (
                <form onSubmit={send} className="space-y-4 mt-5">
                    <div>
                        <span className={LABEL}>{t('venueShell:help.about')}</span>
                        <div className="flex flex-wrap gap-2">
                            {TOPICS.map((tp) => (
                                <button key={tp.value} type="button" onClick={() => setTopic(tp.value)} aria-pressed={topic === tp.value}
                                    className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${topic === tp.value ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                    {t(tp.label)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className={LABEL} htmlFor="help-subject">{t('venueShell:help.subject')}</label>
                        <input id="help-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required className={INPUT} placeholder={t('venueShell:help.subjectPlaceholder')} />
                    </div>
                    <div>
                        <label className={LABEL} htmlFor="help-message">{t('venueShell:help.message')}</label>
                        <textarea id="help-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} required minLength={10}
                            className={`${INPUT} h-auto py-3 resize-none`} placeholder={t('venueShell:help.messagePlaceholder')} />
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={busy} className={BTN_GOLD}>{busy ? t('venueShell:auth.sending') : t('venueShell:help.send')}</button>
                        <button type="button" onClick={() => setOpen(false)} className={BTN_GHOST}>{t('common:actions.cancel')}</button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-wrap gap-3 mt-5">
                    <button type="button" onClick={() => setOpen(true)} className={BTN_GOLD}>{t('venueShell:help.ask')}</button>
                    <a href="/docs/gyms" target="_blank" rel="noopener" className={BTN_GHOST}>{t('venueShell:help.guides')}</a>
                    <Link to="/venue/screens" className={BTN_GHOST}>{t('venueShell:help.boardOnTv')}</Link>
                    <Link to="/venue/poster" className={BTN_GHOST}>{t('venueShell:help.joinPoster')}</Link>
                </div>
            )}

            {tickets?.length > 0 && (
                <div className="mt-8">
                    <Micro className="mb-2">{t('venueShell:help.yourRequests')}</Micro>
                    <div className="divide-y divide-[#F0F0EC]">
                        {tickets.map((tk) => {
                            const st = STATUS[tk.status] ?? STATUS.open;
                            const isOpen = expanded === tk.id;
                            return (
                                <div key={tk.id} className="py-3">
                                    <button type="button" onClick={() => setExpanded(isOpen ? null : tk.id)} className="w-full flex items-start gap-3 text-left" aria-expanded={isOpen}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{tk.subject}</div>
                                            <div className="text-[11px] text-[#AAAAAA] mt-0.5">{t(KIND[tk.category] ?? 'venueShell:help.kinds.request')} · {when(tk.created_at)}</div>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center h-6 px-2.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] ${st.cls}`}>{t(st.label)}</span>
                                    </button>
                                    {isOpen && (
                                        <div className="mt-3 space-y-3">
                                            <p className="text-[12px] text-[#666] leading-relaxed whitespace-pre-wrap">{tk.message.replace(/\n\nTo do:[\s\S]*$/, '')}</p>
                                            {tk.reply && (
                                                <div className="border-l-2 border-[#E8D200] pl-4 py-2 bg-[#E8D200]/5 rounded-r-xl">
                                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-1">POWR</div>
                                                    <p className="text-[12px] text-[#333] leading-relaxed whitespace-pre-wrap">{tk.reply}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <p className="text-[11px] text-[#AAAAAA] mt-6">
                {/* The mail subject goes to POWR's inbox: stays English. */}
                <Trans i18nKey="venueShell:help.orEmail" values={{ email: supportEmail }}
                    components={{ mail: <a className="underline" href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${gymName} · gym portal`)}`} /> }} />
            </p>
        </Card>
    );
}
