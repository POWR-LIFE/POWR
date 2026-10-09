import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Card, Micro, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymTickets, submitGymTicket } from './venueApi';

// Settings → Help: the team writes to POWR (a gym_help ticket in
// /admin/support, plus a Slack line) and sees everything it has asked POWR
// for, with POWR's answers. Package changes, Clash Nights and first-event
// reviews open their own tickets automatically, so they're listed here too.
// The how-to guides (/docs/gyms) answer most questions before they're asked.

const TOPICS = ['Something’s not working', 'Package and billing', 'Events', 'Screens and the board', 'Studio', 'Other'];

const KIND = {
    gym_help: 'Question',
    gym_package: 'Package change',
    gym_clash_night: 'Clash Night',
    gym_clash_cancel: 'Clash Night called off',
    gym_event_review: 'Event review',
};

const STATUS = {
    open:        { label: 'With POWR', cls: 'bg-[#FFFBE0] border-[#E8D200]/50 text-[#8a7600]' },
    in_progress: { label: 'On it',     cls: 'bg-[#60A5FA]/10 border-[#60A5FA]/30 text-[#2563EB]' },
    resolved:    { label: 'Answered',  cls: 'bg-[#0B7A57]/10 border-[#0B7A57]/30 text-[#0B7A57]' },
    closed:      { label: 'Closed',    cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#AAAAAA]' },
};

const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });

export default function GymHelp({ supportEmail, gymName }) {
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const [tickets, setTickets] = useState(null);
    const [open, setOpen] = useState(false);
    const [topic, setTopic] = useState(TOPICS[0]);
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => { fetchGymTickets(gym.partner_id).then(setTickets).catch(() => setTickets([])); }, [gym.partner_id]);

    const send = async (e) => {
        e.preventDefault();
        if (isActingGym) { toast.error('Preview only. Write to the gym from the admin pages.'); return; }
        setBusy(true);
        try {
            setTickets(await submitGymTicket(gym.partner_id, { topic, subject, message }));
            toast.success('Sent. A person at POWR answers, usually the same day.');
            setSubject(''); setMessage(''); setOpen(false);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4"><LifeBuoy size={15} className="text-[#8a7600]" /><Micro>Help</Micro></div>
            <p className="text-[13px] text-[#1A1A1A] leading-relaxed">Stuck, or something looks wrong? Ask us here and a person answers, usually the same day. The answer shows up below.</p>

            {open ? (
                <form onSubmit={send} className="space-y-4 mt-5">
                    <div>
                        <span className={LABEL}>About</span>
                        <div className="flex flex-wrap gap-2">
                            {TOPICS.map((t) => (
                                <button key={t} type="button" onClick={() => setTopic(t)} aria-pressed={topic === t}
                                    className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${topic === t ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className={LABEL} htmlFor="help-subject">Subject</label>
                        <input id="help-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required className={INPUT} placeholder="e.g. The board on our TV stopped updating" />
                    </div>
                    <div>
                        <label className={LABEL} htmlFor="help-message">What’s happening</label>
                        <textarea id="help-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} required minLength={10}
                            className={`${INPUT} h-auto py-3 resize-none`} placeholder="What you expected, what happened instead, and when." />
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={busy} className={BTN_GOLD}>{busy ? 'Sending…' : 'Send to POWR'}</button>
                        <button type="button" onClick={() => setOpen(false)} className={BTN_GHOST}>Cancel</button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-wrap gap-3 mt-5">
                    <button type="button" onClick={() => setOpen(true)} className={BTN_GOLD}>Ask POWR</button>
                    <a href="/docs/gyms" target="_blank" rel="noopener" className={BTN_GHOST}>How-to guides</a>
                    <Link to="/venue/screens" className={BTN_GHOST}>Putting the board on a TV</Link>
                    <Link to="/venue/poster" className={BTN_GHOST}>The join poster</Link>
                </div>
            )}

            {tickets?.length > 0 && (
                <div className="mt-8">
                    <Micro className="mb-2">Your requests</Micro>
                    <div className="divide-y divide-[#F0F0EC]">
                        {tickets.map((t) => {
                            const st = STATUS[t.status] ?? STATUS.open;
                            const isOpen = expanded === t.id;
                            return (
                                <div key={t.id} className="py-3">
                                    <button type="button" onClick={() => setExpanded(isOpen ? null : t.id)} className="w-full flex items-start gap-3 text-left" aria-expanded={isOpen}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{t.subject}</div>
                                            <div className="text-[11px] text-[#AAAAAA] mt-0.5">{KIND[t.category] ?? 'Request'} · {when(t.created_at)}</div>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center h-6 px-2.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] ${st.cls}`}>{st.label}</span>
                                    </button>
                                    {isOpen && (
                                        <div className="mt-3 space-y-3">
                                            <p className="text-[12px] text-[#666] leading-relaxed whitespace-pre-wrap">{t.message.replace(/\n\nTo do:[\s\S]*$/, '')}</p>
                                            {t.reply && (
                                                <div className="border-l-2 border-[#E8D200] pl-4 py-2 bg-[#E8D200]/5 rounded-r-xl">
                                                    <div className="text-[9px] uppercase tracking-[0.3em] text-[#8a7600] font-black mb-1">POWR</div>
                                                    <p className="text-[12px] text-[#333] leading-relaxed whitespace-pre-wrap">{t.reply}</p>
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
                Or email <a className="underline" href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${gymName} · gym portal`)}`}>{supportEmail}</a>.
            </p>
        </Card>
    );
}
