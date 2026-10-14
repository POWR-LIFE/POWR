import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { Card, Micro, BTN_GHOST, fmtNum } from '../../components/portal/ui';
import { fetchEventPushes, sendStandingsNow, setEventPush } from './venueApi';
import { fmtDayTime } from './eventUi';
import { eventPushCopy } from '../../../../supabase/functions/_shared/eventPushCopy.ts';

// The pushes a gym switches on for one event. POWR writes every word: the
// previews render _shared/eventPushCopy.ts, the same code send-push builds
// the real push with, from the same facts (gym_event_push_status.payload).
// The gym only chooses which go out and when the daily standings land.
//
// The previews show what members receive, so they stay English until they
// follow each member's own language; the words around them are the portal's.

export const STANDINGS_HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);   // 7am–9pm, as gym_event_set_push allows

/** "7am" in English; French and Spanish read the 24-hour clock ("07:00"). */
function hourLabel(h) {
    if ((i18n.language || 'en') !== 'en') return `${String(h).padStart(2, '0')}:00`;
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
}

function people(n) {
    return i18n.t('venueEvents:pushes.people', { count: n, n: fmtNum(n) });
}

export function Switch({ on, disabled, onChange, label }) {
    return (
        <button
            type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
            onClick={() => onChange(!on)}
            className="h-11 px-1 flex items-center shrink-0 disabled:opacity-40"
        >
            <span className={`relative w-12 h-7 rounded-full border transition-colors ${on ? 'bg-[#E8D200] border-[#E8D200]' : 'bg-[#F4F4F1] border-[#E6E6E1]'}`}>
                <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white border border-black/5 transition-all ${on ? 'left-[24px]' : 'left-[3px]'}`} />
            </span>
        </button>
    );
}

// What lands on a member's phone, word for word — English until previews
// follow the member's language (eventPushCopy takes a lang for that).
export function Preview({ type, payload, off }) {
    const { title, body } = eventPushCopy(type, payload ?? {});
    return (
        <div className={`mt-3 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] px-4 py-3 max-w-md transition-opacity ${off ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
                <span className="w-4 h-4 rounded-[5px] bg-[#0d0d0d] flex items-center justify-center text-[7px] font-black text-[#E8D200]">P</span>
                <span className="text-[9px] uppercase tracking-[0.2em] font-black text-[#AAAAAA]">POWR · now</span>
            </div>
            <div className="text-[12.5px] font-bold text-[#1A1A1A] leading-snug">{title}</div>
            <div className="text-[12px] text-[#666] leading-snug mt-0.5">{body}</div>
        </div>
    );
}

function Row({ title, detail, sent, control, children }) {
    return (
        <div className="py-5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[#1A1A1A]">{title}</div>
                    <p className="text-[12px] text-[#888] leading-relaxed mt-1">{detail}</p>
                    {sent && <p className="text-[11px] font-bold text-[#0B7A57] mt-1.5">{sent}</p>}
                </div>
                {control}
            </div>
            {children}
        </div>
    );
}

export default function EventPushes({ ev, gymName, toast }) {
    const { t } = useTranslation();
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = useCallback(() => {
        fetchEventPushes(ev.id).then(setStatus).catch(err => setError(serverErrorText(err)));
    }, [ev.id]);
    // Publishing, joins and sends all change what this card says.
    useEffect(() => { load(); }, [load, ev.status, ev.participants]);

    if (error) return <Card className="p-6 sm:p-8"><Micro>{t('venueEvents:pushes.title')}</Micro><p className="text-sm text-[#888] mt-3">{error}</p></Card>;
    if (!status) return null;

    const open = status.editable && ev.editable;
    const unpublished = ev.status === 'draft';
    const sends = (kind) => (status.sent ?? []).filter(s => s.kind === kind);
    const once = (kind) => {
        const s = sends(kind)[0];
        return s ? t('venueEvents:pushes.sent', { when: fmtDayTime(s.at), people: people(s.recipients) }) : null;
    };

    const change = async (patch, ok) => {
        setBusy(Object.keys(patch)[0]);
        try {
            setStatus(await setEventPush(ev.id, patch));
            toast.success(ok);
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const sendNow = async () => {
        setBusy('send');
        try {
            const dry = await sendStandingsNow(ev.id, true);
            const n = dry?.recipients ?? 0;
            if (!n) { toast.error(t('venueEvents:pushes.nobodyOnBoard')); return; }
            if (!window.confirm(t('venueEvents:pushes.confirmSend', { people: people(n) }))) return;
            const res = await sendStandingsNow(ev.id, false);
            toast.success(t('venueEvents:pushes.sentTo', { people: people(res?.recipients ?? n) }));
            load();
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const a = status.audience ?? { people: 0, reachable: 0 };
    const r = status.registrants ?? { people: 0, reachable: 0 };
    const audience = a.people > 0
        ? t('venueEvents:pushes.audience', { people: people(a.people), reachable: fmtNum(a.reachable) })
        : t('venueEvents:pushes.audienceNone', { gym: gymName });
    const joined = unpublished
        ? t('venueEvents:pushes.joinedDraft')
        : t('venueEvents:pushes.joined', { people: people(r.people), reachable: fmtNum(r.reachable) });
    const rankSends = sends('rank');
    const lastRank = rankSends[0];

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-2"><BellRing size={15} className="text-[#8a7600]" /><Micro>{t('venueEvents:pushes.title')}</Micro></div>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-2xl">
                {t('venueEvents:pushes.intro')}
                {unpublished && ` ${t('venueEvents:pushes.introDraft')}`}
                {!status.editable && ` ${t('venueEvents:pushes.introOver')}`}
            </p>

            <div className="divide-y divide-[#F0F0EC]">
                <Row
                    title={t('venueEvents:pushes.announce')}
                    detail={`${audience} ${t('venueEvents:pushes.announceWhen')}`}
                    sent={once('announce')}
                    control={<Switch label={t('venueEvents:pushes.announce')} on={status.announce} disabled={!open || !!busy}
                        onChange={on => change({ announce: on }, on ? t('venueEvents:pushes.announceOn') : t('venueEvents:pushes.announceOff'))} />}
                >
                    <Preview type="event_announced" payload={status.payload} off={!status.announce} />
                </Row>

                <Row
                    title={t('venueEvents:pushes.kickoff')}
                    detail={`${joined} ${t('venueEvents:pushes.kickoffWhen')}`}
                    sent={once('kickoff')}
                    control={<Switch label={t('venueEvents:pushes.kickoff')} on={status.kickoff} disabled={!open || !!busy}
                        onChange={on => change({ kickoff: on }, on ? t('venueEvents:pushes.kickoffOn') : t('venueEvents:pushes.kickoffOff'))} />}
                >
                    <Preview type="event_kickoff" payload={status.payload} off={!status.kickoff} />
                </Row>

                {status.finale && (
                    <Row
                        title={t('venueEvents:pushes.doors')}
                        detail={`${joined} ${t('venueEvents:pushes.doorsWhen')}`}
                        sent={once('doors')}
                        control={<Switch label={t('venueEvents:pushes.doors')} on={status.doors} disabled={!open || !!busy}
                            onChange={on => change({ doors: on }, on ? t('venueEvents:pushes.doorsOn') : t('venueEvents:pushes.doorsOff'))} />}
                    >
                        <Preview type="event_doors_open" payload={status.payload} off={!status.doors} />
                    </Row>
                )}

                <Row
                    title={t('venueEvents:pushes.standings')}
                    detail={t('venueEvents:pushes.standingsDetail')}
                    sent={!lastRank ? null : t(lastRank.source === 'manual' ? 'venueEvents:pushes.lastSentTeam' : 'venueEvents:pushes.lastSent', { when: fmtDayTime(lastRank.at), people: people(lastRank.recipients) })}
                    control={
                        <select
                            aria-label={t('venueEvents:pushes.standingsTimeA11y')}
                            value={status.rank_at ?? ''}
                            disabled={!open || !!busy}
                            onChange={e => {
                                const v = e.target.value || null;
                                change({ rank_at: v }, v ? t('venueEvents:pushes.standingsAt', { time: hourLabel(Number(v.slice(0, 2))) }) : t('venueEvents:pushes.standingsOff'));
                            }}
                            className="h-11 pl-4 pr-8 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[12px] font-bold text-[#1A1A1A] disabled:opacity-40 focus:outline-none focus:border-[#E8D200]/60"
                        >
                            <option value="">{t('venueEvents:pushes.off')}</option>
                            {STANDINGS_HOURS.map(h => {
                                const v = `${String(h).padStart(2, '0')}:00`;
                                return <option key={h} value={v}>{hourLabel(h)}</option>;
                            })}
                        </select>
                    }
                >
                    {open && status.rank_ready && (
                        <button type="button" onClick={sendNow} disabled={!!busy} className={`${BTN_GHOST} mt-4 h-10`}>
                            <Send size={12} /> {busy === 'send' ? t('venueEvents:pushes.sending') : t('venueEvents:pushes.sendNow')}
                        </button>
                    )}
                </Row>
            </div>
        </Card>
    );
}
