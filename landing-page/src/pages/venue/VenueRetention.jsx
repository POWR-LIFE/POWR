import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChevronDown, Download, Lock, Search, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum, BTN_GHOST, BTN_GOLD, INPUT } from '../../components/portal/ui';
import { useToast } from '../../lib/toast';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { deleteOutreach, fetchRetention, logOutreach, nudgeQuietMembers } from './venueApi';
import { Columns } from './charts';
import { eventPushCopy } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import {
    agoParts, patternParts, personLineParts, quietParts, statusId,
} from '../../../../supabase/functions/_shared/retentionCopy.ts';
import { initials } from '../../../../shared/gymBoard.ts';
import { formatMemberId } from '../../../../shared/memberId.ts';
import { useMemberName } from './MemberPeople';

// Retention: who's drifting from the gym, each person against their own
// normal (gym_retention, migration 20261007120000). Visits AT this gym only,
// from POWR's check-ins; members can switch it off in the app (Settings,
// then Privacy, "Let gyms see my visits"). Clash+ sees the counts, the trend
// and the win-backs; Clash Pro names people, logs who reached out and nudges.
// Anyone POWR can't hear (phone silent a week, location off) is shown apart
// and never counted as drifting: they may still be training.

// Labels are keys, translated where they render.
const TABS = [
    ['drifting', 'venueMembers:retention.tabs.drifting'],
    ['slipping', 'venueMembers:retention.tabs.slipping'],
    ['lapsed', 'venueMembers:retention.tabs.lapsed'],
    ['new', 'venueMembers:retention.tabs.new'],
    ['regular', 'venueMembers:retention.tabs.regular'],
    ['cant_see', 'venueMembers:retention.tabs.cantSee'],
    ['all', 'venueMembers:retention.tabs.all'],
];
// What staff pick; the history then says it as CHANNEL_DONE ("Called", "Texted"…).
const CHANNELS = [
    ['call', 'venueMembers:retention.channels.call'],
    ['text', 'venueMembers:retention.channels.text'],
    ['email', 'venueMembers:retention.channels.email'],
    ['in_person', 'venueMembers:retention.channels.inPerson'],
    ['other', 'venueMembers:retention.channels.other'],
];
const AT_RISK = new Set(['slipping', 'drifting', 'lapsed']);

const bucket = (p) => (AT_RISK.has(p.status) && p.signal !== 'ok' ? 'cant_see' : p.status);

// Retention's words. retentionCopy.ts says them in English for the morning
// email; its *Parts twins give the same answers as ids, worded here in the
// reader's language (English comes out identical).
const STATUS_KEY = {
    drifting: 'venueMembers:retention.status.drifting',
    slipping: 'venueMembers:retention.status.slipping',
    lapsed: 'venueMembers:retention.status.lapsed',
    new: 'venueMembers:retention.status.new',
    regular: 'venueMembers:retention.status.regular',
    occasional: 'venueMembers:retention.status.occasional',
    unseen: 'venueMembers:retention.status.unseen',
    location_off: 'venueMembers:retention.status.locationOff',
    no_signal: 'venueMembers:retention.status.noSignal',
};
const CHANNEL_DONE = {
    call: 'venueMembers:retention.channelDone.call',
    text: 'venueMembers:retention.channelDone.text',
    email: 'venueMembers:retention.channelDone.email',
    in_person: 'venueMembers:retention.channelDone.inPerson',
    push: 'venueMembers:retention.channelDone.push',
    other: 'venueMembers:retention.channelDone.other',
};
const DAY_PART = {
    morning: 'venueMembers:retention.dayParts.morning',
    midday: 'venueMembers:retention.dayParts.midday',
    afternoon: 'venueMembers:retention.dayParts.afternoon',
    evening: 'venueMembers:retention.dayParts.evening',
};

/** sinceLabel: "today", "yesterday", "12 days ago", "5 weeks ago", "not yet". */
function agoText(t, a) {
    switch (a.id) {
        case 'not_yet': return t('venueMembers:retention.ago.notYet');
        case 'today': return t('venueMembers:retention.ago.today');
        case 'yesterday': return t('venueMembers:retention.ago.yesterday');
        case 'weeks': return t('venueMembers:retention.ago.weeks', { count: a.n });
        default: return t('venueMembers:retention.ago.days', { count: a.n });
    }
}
const sinceText = (t, gapDays) => agoText(t, agoParts(gapDays));

/** quietLabel: "12 days quiet", "5 weeks quiet". */
function quietText(t, gapDays) {
    const q = quietParts(gapDays);
    return q.id === 'weeks' ? t('venueMembers:retention.quiet.weeks', { count: q.n }) : t('venueMembers:retention.quiet.days', { count: q.n });
}

/** statusLabel: the status, or the phone's signal for anyone at risk. */
function statusText(t, status, signal) {
    const id = statusId(status, signal);
    return STATUS_KEY[id] ? t(STATUS_KEY[id]) : id;
}

const channelText = (t, channel) => (CHANNEL_DONE[channel] ? t(CHANNEL_DONE[channel]) : channel);

/** dowList: "Mon, Wed & Fri" (en-GB's short weekday names). */
function dowText(t, dows) {
    const names = dows.map((d) => new Intl.DateTimeFormat(formatLocale(), { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 4 + d)));
    if (names.length <= 1) return names.join('');
    return t('venueMembers:retention.pattern.lastDay', { rest: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

/** patternLine: "Usually 3× a week, mornings · Mon, Wed & Fri". */
function patternText(t, parts) {
    if (!parts) return '';
    const f = parts.frequency;
    const frequency = f.id === 'most_days' ? t('venueMembers:retention.frequency.mostDays')
        : f.id === 'per_week' ? t('venueMembers:retention.frequency.perWeek', { n: f.n })
        : f.id === 'weekly' ? t('venueMembers:retention.frequency.weekly')
        : t('venueMembers:retention.frequency.fortnightly');
    const head = parts.part
        ? t('venueMembers:retention.pattern.withPart', { frequency, part: t(DAY_PART[parts.part]) })
        : t('venueMembers:retention.pattern.base', { frequency });
    const days = dowText(t, parts.dows);
    return days ? `${head} · ${days}` : head;
}

/** personLine: "Last visit 16 days ago · Usually 2× a week, mornings · Mon & Thu". */
function personText(t, p) {
    const line = personLineParts(p);
    if (line.id === 'unseen') return t('venueMembers:retention.line.unseen');
    if (line.id === 'new') {
        const when = agoText(t, line.first);
        return line.visits != null ? t('venueMembers:retention.line.newBack', { when, n: line.visits }) : t('venueMembers:retention.line.newOnce', { when });
    }
    const since = !line.since ? ''
        : line.since.id === 'in_today' ? t('venueMembers:retention.line.inToday')
        : t('venueMembers:retention.line.lastVisit', { when: agoText(t, line.since.ago) });
    if (line.id === 'phone_quiet') return `${since} · ${t('venueMembers:retention.line.phoneQuiet')}`;
    if (line.id === 'occasional') return `${since} · ${t('venueMembers:retention.line.occasional')}`;
    return [since, patternText(t, line.pattern)].filter(Boolean).join(' · ');
}

// "12 days quiet" in the trailer's amber for drifting; the rest in their own tone.
function Chip({ p }) {
    const { t } = useTranslation();
    const b = bucket(p);
    const tone = {
        drifting: 'bg-[#FFF7E6] border-[#F5A524]/60 text-[#B45309]',
        slipping: 'bg-[#FEFCE8] border-[#E8D200]/60 text-[#8a7600]',
        lapsed:   'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]',
        new:      'bg-[#ECFDF5] border-[#BBF7D0] text-[#0B7A57]',
        regular:  'bg-[#F0FDF4] border-[#DCFCE7] text-[#0B7A57]',
    }[b] ?? 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]';
    const label = b === 'drifting' ? quietText(t, p.gap_days)
        : b === 'slipping' ? t('venueMembers:retention.slippingChip', { days: p.gap_days })
        : statusText(t, p.status, p.signal);
    return <span className={`inline-flex items-center h-7 px-3 rounded-full border text-[9px] font-black uppercase tracking-[0.18em] whitespace-nowrap ${tone}`}>{label}</span>;
}

function Avatar({ p }) {
    const name = useMemberName()(p);
    return p.avatar_url
        ? <img src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-10 h-10 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[11px] font-black text-[#666] uppercase shrink-0">{initials(name) || '?'}</div>;
}

function Fact({ label, value, note, tone }) {
    const colour = tone === 'amber' ? 'text-[#B45309]' : tone === 'green' ? 'text-[#0B7A57]' : 'text-[#1A1A1A]';
    return (
        <div className="min-w-0">
            <Micro>{label}</Micro>
            <div className={`mt-1.5 text-3xl font-extralight tracking-tighter tabular-nums leading-none ${colour}`}>{fmtNum(value)}</div>
            {note && <div className="text-[10px] text-[#AAAAAA] font-bold mt-1.5 leading-snug">{note}</div>}
        </div>
    );
}

// Twelve weeks of visits, a column a week, Monday at the top. Days still to
// come are left empty, not grey, so the last column doesn't read as missed.
function VisitStrip({ visits, asOf }) {
    const { t } = useTranslation();
    const set = useMemo(() => new Set(visits ?? []), [visits]);
    const today = new Date(`${asOf}T00:00:00Z`);
    const monday = new Date(today);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 11 * 7);
    const weeks = Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, d) => {
        const day = new Date(monday);
        day.setUTCDate(monday.getUTCDate() + w * 7 + d);
        const iso = day.toISOString().slice(0, 10);
        return { iso, future: day > today, hit: set.has(iso) };
    }));
    const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return (
        <figure className="m-0" aria-label={t('venueMembers:retention.strip.label')}>
            <div className="flex gap-[3px]">
                {weeks.map((col, w) => (
                    <div key={w} className="flex flex-col gap-[3px]">
                        {col.map((c) => (
                            <span
                                key={c.iso}
                                title={c.hit ? t('venueMembers:retention.strip.dayIn', { date: fmt(c.iso) }) : fmt(c.iso)}
                                className={`block w-3 h-3 rounded-[3px] ${c.future ? 'bg-transparent' : c.hit ? 'bg-[#8a7600]' : 'bg-[#F0F0EC]'}`}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <figcaption className="flex justify-between text-[9px] font-bold text-[#BBBBBB] mt-1.5 tabular-nums" style={{ width: 12 * 15 - 3 }}>
                <span>{fmt(weeks[0][0].iso)}</span><span>{t('venueMembers:retention.strip.today')}</span>
            </figcaption>
            <div className="sr-only">{t('venueMembers:retention.strip.list', { count: (visits ?? []).length, list: (visits ?? []).map(fmt).join(', ') })}</div>
        </figure>
    );
}

function PersonDetail({ p, gym, asOf, canDelete, onChanged }) {
    const { t } = useTranslation();
    const nameOf = useMemberName();
    const toast = useToast();
    const [channel, setChannel] = useState(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(null);
    const nudgedDays = p.nudged_at ? Math.floor((Date.now() - new Date(p.nudged_at).getTime()) / 86400000) : null;
    const canNudge = AT_RISK.has(p.status) && p.signal === 'ok';
    const cooling = nudgedDays != null && nudgedDays < 14;

    const log = async () => {
        if (!channel) return;
        setBusy('log');
        try {
            await logOutreach(gym.partner_id, p.user_id, channel, note.trim());
            setChannel(null); setNote('');
            toast.success(t('venueMembers:retention.detail.logged'));
            onChanged();
        } catch (e) { toast.error(serverErrorText(e)); }
        finally { setBusy(null); }
    };
    const nudge = async () => {
        if (!window.confirm(t('venueMembers:retention.detail.nudgeConfirm', { name: nameOf(p) }))) return;
        setBusy('nudge');
        try {
            const r = await nudgeQuietMembers(gym.partner_id, false, p.user_id);
            toast.success(r.recipients ? t('venueMembers:retention.detail.sent') : t('venueMembers:retention.detail.hadOne'));
            onChanged();
        } catch (e) { toast.error(serverErrorText(e)); }
        finally { setBusy(null); }
    };
    const remove = async (id) => {
        setBusy(id);
        try { await deleteOutreach(gym.partner_id, id); onChanged(); }
        catch (e) { toast.error(serverErrorText(e)); }
        finally { setBusy(null); }
    };
    // What the member's phone shows: stays English until push previews follow
    // the member's language (the push itself goes out in theirs).
    const preview = eventPushCopy('gym_quiet_nudge', { gym_name: gym.name, weeks: Math.floor((p.gap_days ?? 0) / 7) });

    return (
        <div className="pl-0 sm:pl-14 pb-5 pt-1 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10">
            <div className="space-y-4">
                <VisitStrip visits={p.visits} asOf={asOf} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px] max-w-[260px]">
                    <div><dt className="text-[#AAAAAA] font-bold">{t('venueMembers:retention.detail.lastVisit')}</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{sinceText(t, p.gap_days)}</dd></div>
                    <div><dt className="text-[#AAAAAA] font-bold">{t('venueMembers:retention.detail.last4')}</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{t('venueMembers:retention.detail.visits', { count: p.recent_28 ?? 0 })}</dd></div>
                    {p.drift_after != null && <div><dt className="text-[#AAAAAA] font-bold">{t('venueMembers:retention.detail.usualGap')}</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{t('venueMembers:retention.detail.days', { count: Math.round(Number(p.usual_gap)) })}</dd></div>}
                    {p.drift_after != null && <div><dt className="text-[#AAAAAA] font-bold">{t('venueMembers:retention.detail.driftingAfter')}</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{t('venueMembers:retention.detail.driftAfterDays', { count: p.drift_after })}</dd></div>}
                </dl>
                <p className="text-[11px] text-[#999] leading-relaxed max-w-[260px]">
                    {p.is_member ? t('venueMembers:retention.detail.picked', { gym: gym.name }) : t('venueMembers:retention.detail.notPicked')}
                    {p.location === 'while_using' ? ` ${t('venueMembers:retention.detail.whileUsing')}` : ''}
                    {p.drifting_since ? ` ${t('venueMembers:retention.detail.driftingSince', { date: new Date(`${p.drifting_since}T00:00:00Z`).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }) })}` : ''}
                    {p.shares_all ? <>{' '}<Trans i18nKey="venueMembers:retention.detail.sharesAll" components={{ members: <Link to="/venue/members" className="underline" /> }} /></> : null}
                </p>
            </div>

            <div className="space-y-5 min-w-0">
                <div>
                    <Micro>{t('venueMembers:retention.detail.logTitle')}</Micro>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {CHANNELS.map(([c, label]) => (
                            <button key={c} type="button" onClick={() => setChannel(channel === c ? null : c)} aria-pressed={channel === c}
                                className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${channel === c ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                {t(label)}
                            </button>
                        ))}
                    </div>
                    {channel && (
                        <div className="flex flex-col sm:flex-row gap-2 mt-3">
                            <input className={`${INPUT} h-11`} maxLength={280} placeholder={t('venueMembers:retention.detail.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
                            <button type="button" onClick={log} disabled={busy === 'log'} className={`${BTN_GOLD} h-11 px-6 shrink-0`}>{busy === 'log' ? t('common:actions.saving') : t('venueMembers:retention.detail.logIt')}</button>
                        </div>
                    )}
                </div>

                {canNudge && (
                    <div className="rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{t('venueMembers:retention.detail.pushLabel')}</div>
                            <div className="text-[12px] font-bold text-[#1A1A1A] mt-1">{preview.title}</div>
                            <div className="text-[12px] text-[#666]">{preview.body}</div>
                        </div>
                        {cooling
                            ? <span className="text-[11px] font-bold text-[#888]">{t('venueMembers:retention.detail.nudged', { when: sinceText(t, nudgedDays) })}</span>
                            : <button type="button" onClick={nudge} disabled={busy === 'nudge'} className={`${BTN_GHOST} h-10 px-5`}><Send size={12} /> {busy === 'nudge' ? t('venueMembers:retention.detail.sending') : t('venueMembers:retention.detail.sendNudge')}</button>}
                    </div>
                )}

                {(p.outreach ?? []).length > 0 && (
                    <div>
                        <Micro>{t('venueMembers:retention.detail.teamDid')}</Micro>
                        <ul className="mt-2 divide-y divide-[#F0F0EC]">
                            {p.outreach.map((o) => (
                                <li key={o.id} className="flex items-start gap-3 py-2.5 text-[12px]">
                                    <div className="flex-1 min-w-0">
                                        <span className="font-bold text-[#1A1A1A]">{channelText(t, o.channel)}</span>
                                        <span className="text-[#AAAAAA]"> · {new Date(o.at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short' })}{o.by ? ` · ${o.by}` : ''}</span>
                                        {o.note && <div className="text-[#666] mt-0.5 break-words">{o.note}</div>}
                                    </div>
                                    {o.channel !== 'push' && (o.mine || canDelete) && (
                                        <button type="button" onClick={() => remove(o.id)} disabled={busy === o.id} aria-label={t('venueMembers:retention.detail.removeNote')} className="text-[#BBBBBB] hover:text-[#B91C1C] p-1"><Trash2 size={13} /></button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

function PersonRow({ p, gym, asOf, open, onToggle, canDelete, onChanged }) {
    const { t } = useTranslation();
    const nameOf = useMemberName();
    const last = (p.outreach ?? [])[0];
    const lastDays = last ? Math.floor((Date.now() - new Date(last.at).getTime()) / 86400000) : null;
    return (
        <li className={open ? 'bg-[#FCFCFA]' : ''}>
            <button type="button" onClick={onToggle} aria-expanded={open}
                className="w-full flex items-center gap-4 py-4 text-left group">
                <Avatar p={p} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[14px] font-bold text-[#1A1A1A] truncate">{nameOf(p)}</span>
                        {p.member_id && <span className="hidden sm:inline text-[10px] font-bold text-[#BBBBBB] tabular-nums shrink-0">{formatMemberId(p.member_id)}</span>}
                    </div>
                    <div className="text-[12px] text-[#888] mt-0.5 sm:truncate">{personText(t, { ...p, as_of: asOf })}</div>
                    {/* On a phone the chip sits under the line, so the line gets the width. */}
                    <div className="sm:hidden flex flex-wrap items-center gap-2 mt-2">
                        <Chip p={p} />
                        {last && <span className="text-[10px] font-bold text-[#AAAAAA]">{t('venueMembers:retention.line.lastReach', { channel: channelText(t, last.channel), when: sinceText(t, lastDays) })}</span>}
                    </div>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                    <Chip p={p} />
                    {last && <span className="text-[10px] font-bold text-[#AAAAAA]">{t('venueMembers:retention.line.lastReach', { channel: channelText(t, last.channel), when: sinceText(t, lastDays) })}</span>}
                </div>
                <ChevronDown size={14} className={`text-[#CCCCCC] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <PersonDetail p={p} gym={gym} asOf={asOf} canDelete={canDelete} onChanged={onChanged} />}
        </li>
    );
}

// Everyone drifting, one push from POWR, at most once a day.
function NudgeAll({ gym, drifting, onSent }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [plan, setPlan] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true;
        nudgeQuietMembers(gym.partner_id, true).then((r) => { if (alive) setPlan(r); }).catch(() => { if (alive) setPlan({ recipients: 0, cooling: 0, unavailable: true }); });
        return () => { alive = false; };
    }, [gym.partner_id, drifting]);
    const send = async () => {
        if (!plan?.recipients) return;
        if (!window.confirm(t('venueMembers:retention.nudgeAll.confirm', { count: plan.recipients }))) return;
        setBusy(true);
        try {
            const r = await nudgeQuietMembers(gym.partner_id, false);
            toast.success(t('venueMembers:retention.nudgeAll.sentTo', { count: r.recipients ?? 0 }));
            onSent();
        } catch (e) { toast.error(serverErrorText(e)); }
        finally { setBusy(false); }
    };
    return (
        <div className="mt-5 pt-5 border-t border-[#F0F0EC]">
            <p className="text-[12px] text-[#888] leading-relaxed">
                {plan == null ? t('venueMembers:retention.nudgeAll.counting')
                    : plan.unavailable ? t('venueMembers:retention.nudgeAll.unavailable')
                    : plan.recipients ? (plan.cooling
                        ? t('venueMembers:retention.nudgeAll.planCooling', { count: plan.recipients, cooling: plan.cooling })
                        : t('venueMembers:retention.nudgeAll.plan', { count: plan.recipients }))
                    : plan.cooling ? t('venueMembers:retention.nudgeAll.allCooling') : t('venueMembers:retention.nudgeAll.nobody')}
            </p>
            <button type="button" onClick={send} disabled={busy || !plan?.recipients} className={`${BTN_GHOST} h-10 px-5 mt-3`}><Send size={12} /> {busy ? t('venueMembers:retention.detail.sending') : t('venueMembers:retention.nudgeAll.button', { n: plan?.recipients ?? 0 })}</button>
        </div>
    );
}

// The header row stays English (columns other tools may match on); the
// cells are in the reader's language.
function csv(rows, asOf, t, nameOf) {
    const head = ['Name', 'Username', 'POWR ID', 'Status', 'Last visit', 'Days since', 'Usual pattern', 'Picked this gym', 'Last reach-out'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((p) => [
        nameOf(p), p.username, formatMemberId(p.member_id), statusText(t, p.status, p.signal), p.last_visit, p.gap_days,
        patternText(t, patternParts(p)), p.is_member ? t('venueMembers:retention.csv.yes') : t('venueMembers:retention.csv.no'),
        p.outreach?.[0] ? `${channelText(t, p.outreach[0].channel)} ${new Date(p.outreach[0].at).toISOString().slice(0, 10)}` : '',
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retention-${asOf}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function VenueRetention() {
    const { t } = useTranslation();
    const nameOf = useMemberName();
    const { gym } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState(null);
    const [open, setOpen] = useState(null);
    const [q, setQ] = useState('');

    const load = useCallback(() => {
        fetchRetention(gym.partner_id).then(setData).catch((e) => setError(e));
    }, [gym.partner_id]);
    useEffect(() => { load(); }, [load]);

    const people = useMemo(() => data?.people ?? [], [data]);
    const groups = useMemo(() => {
        const g = { all: people };
        for (const p of people) (g[bucket(p)] ??= []).push(p);
        return g;
    }, [people]);
    // Open on whoever needs a word first.
    const active = tab ?? (['drifting', 'slipping', 'lapsed', 'new'].find((k) => groups[k]?.length) ?? 'all');
    const shown = (groups[active] ?? []).filter((p) => !q || `${nameOf(p)} ${p.username ?? ''} ${p.member_id ?? ''}`.toLowerCase().includes(q.toLowerCase()));

    if (error) return <Empty title={t('venueMembers:retention.loadError')} action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>{t('common:actions.retry')}</button>}>{serverErrorText(error)}</Empty>;
    if (!data) return <Spinner />;

    if (data.too_few) {
        return (
            <Page>
                <PageTitle eyebrow={t('venueMembers:retention.eyebrow')} title={t('venueMembers:retention.title')} sub={gym.name} />
                <Empty title={t('venueMembers:retention.tooFewTitle')}>
                    {t('venueMembers:retention.tooFew', { min: data.min_people ?? 5, gym: gym.name })}
                </Empty>
            </Page>
        );
    }

    const c = data.counts ?? {};
    const tz = data.tz ?? 'Europe/London';
    const fmtDay = (iso) => new Intl.DateTimeFormat(formatLocale(), { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));
    const trend = (data.trend ?? []).map((w) => ({
        key: w.week_end,
        tick: fmtDay(w.week_end),
        tip: t('venueMembers:retention.trend.tip', { date: fmtDay(w.week_end), drifting: w.drifting, slipping: w.slipping }),
        value: w.drifting ?? 0,
        ghost: (w.drifting ?? 0) + (w.slipping ?? 0),
    }));
    const wb = data.winback ?? { reached: 0, back: 0, waiting: 0 };
    const decided = Math.max(0, wb.reached - wb.waiting);
    const named = !!data.named;
    // Anyone can remove their own note; the owner (and POWR) anyone's.
    const canDelete = ['owner', 'admin'].includes(gym.role);

    return (
        <Page>
            <PageTitle
                eyebrow={t('venueMembers:retention.eyebrow')}
                title={t('venueMembers:retention.title')}
                sub={t('venueMembers:retention.sub', { gym: gym.name })}
                right={named && people.length > 0 && (
                    <button type="button" onClick={() => csv(people, data.as_of, t, nameOf)} className={BTN_GHOST}><Download size={13} /> {t('venueMembers:retention.export')}</button>
                )}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <Card glow className="p-6 sm:p-8 lg:col-span-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`text-6xl font-extralight tracking-tighter tabular-nums leading-none ${c.drifting ? 'text-[#B45309]' : 'text-[#1A1A1A]'}`}>{fmtNum(c.drifting)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueMembers:retention.headline', { count: c.drifting ?? 0 })}</span>
                    </div>
                    <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
                        <Fact label={t('venueMembers:retention.tabs.regular')} value={c.regular} note={t('venueMembers:retention.facts.regularNote')} tone={c.regular ? 'green' : undefined} />
                        <Fact label={t('venueMembers:retention.tabs.slipping')} value={c.slipping} note={t('venueMembers:retention.facts.slippingNote')} />
                        <Fact label={t('venueMembers:retention.tabs.lapsed')} value={c.lapsed} note={t('venueMembers:retention.facts.lapsedNote')} />
                        <Fact label={t('venueMembers:retention.tabs.new')} value={c.new} note={t('venueMembers:retention.facts.newNote')} />
                    </div>
                    {trend.length > 0 && (
                        <div className="mt-8">
                            <Micro className="mb-6">{t('venueMembers:retention.trend.title')}</Micro>
                            <Columns data={trend} label={t('venueMembers:retention.tabs.drifting')} height={120} tickEvery={3} ghostLabel={t('venueMembers:retention.trend.ghost')} />
                        </div>
                    )}
                </Card>

                <div className="flex flex-col gap-4 sm:gap-6">
                    <Card className="p-6 sm:p-8">
                        <Micro gold>{t('venueMembers:retention.wonBack.title')}</Micro>
                        {wb.reached === 0 ? (
                            <>
                                <div className="text-2xl font-light tracking-tight mt-2">{t('venueMembers:retention.wonBack.nothingYet')}</div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                    {named ? t('venueMembers:retention.wonBack.nothingNamed') : t('venueMembers:retention.wonBack.nothingPlus')}
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-5xl font-extralight tracking-tighter tabular-nums text-[#0B7A57]">{fmtNum(wb.back)}</span>
                                    <span className="text-[12px] text-[#888]">{t('venueMembers:retention.wonBack.cameBack', { reached: fmtNum(wb.reached) })}</span>
                                </div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                    {t('venueMembers:retention.wonBack.note')}
                                    {decided > 0 ? ` ${t('venueMembers:retention.wonBack.rate', { pct: Math.round((wb.back / decided) * 100) })}` : ''}
                                    {wb.waiting ? ` ${t('venueMembers:retention.wonBack.waiting', { count: wb.waiting, n: fmtNum(wb.waiting) })}` : ''}
                                </p>
                            </>
                        )}
                        {named && c.drifting > 0 && <NudgeAll gym={gym} drifting={c.drifting} onSent={load} />}
                    </Card>
                    {c.cant_see > 0 && (
                        <Card className="p-6">
                            <Micro>{t('venueMembers:retention.cantSee.title')}</Micro>
                            <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                {t('venueMembers:retention.cantSee.body', { count: c.cant_see, n: fmtNum(c.cant_see) })}
                            </p>
                        </Card>
                    )}
                </div>
            </div>

            {named ? (
                <Card className="p-6 sm:p-8">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        {/* One swipeable row on a phone; wraps on wider screens. */}
                        <div className="flex gap-2 overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible [scrollbar-width:none]">
                            {TABS.map(([k, l]) => {
                                const n = (groups[k] ?? []).length;
                                if (!n && k !== 'all' && k !== 'drifting') return null;
                                return (
                                    <button key={k} type="button" onClick={() => { setTab(k); setOpen(null); }} aria-pressed={active === k}
                                        className={`shrink-0 whitespace-nowrap h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${active === k ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                        {t(l)} · {n}
                                    </button>
                                );
                            })}
                        </div>
                        {people.length > 10 && (
                            <label className="relative w-full sm:w-64">
                                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                                <input className={`${INPUT} h-10 pl-10`} placeholder={t('venueMembers:retention.find')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('venueMembers:retention.find')} />
                            </label>
                        )}
                    </div>
                    {shown.length === 0 ? (
                        <p className="text-sm text-[#888] font-light mt-6">
                            {active === 'drifting' ? t('venueMembers:retention.noneDrifting') : t('venueMembers:retention.noneHere')}
                        </p>
                    ) : (
                        <ul className="mt-4 divide-y divide-[#F0F0EC]">
                            {shown.map((p) => (
                                <PersonRow key={p.user_id} p={p} gym={gym} asOf={data.as_of} canDelete={canDelete}
                                    open={open === p.user_id} onToggle={() => setOpen(open === p.user_id ? null : p.user_id)} onChanged={load} />
                            ))}
                        </ul>
                    )}
                </Card>
            ) : (
                <Card className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-3"><Lock size={13} className="text-[#8a7600]" /><Micro gold>Clash Pro</Micro></div>
                    <div className="text-2xl font-light tracking-tight">{t('venueMembers:retention.locked.title')}</div>
                    <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                        {t('venueMembers:retention.locked.body')}
                    </p>
                    <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>{t('venueMembers:seePackages')}</Link>
                </Card>
            )}

            <Card className="p-6 sm:p-8">
                <Micro>{t('venueMembers:retention.how.title')}</Micro>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 text-[12px] text-[#777] leading-relaxed">
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">{t('venueMembers:retention.how.normalTitle')}</span>{t('venueMembers:retention.how.normalBody')}</p>
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">{t('venueMembers:retention.how.hereTitle')}</span>{t('venueMembers:retention.how.hereBody', { gym: gym.name })}</p>
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">{t('venueMembers:retention.how.choiceTitle')}</span>{t('venueMembers:retention.how.choiceBody')}</p>
                </div>
                <p className="text-[10px] text-[#BBBBBB] font-bold mt-5">{t('venueMembers:retention.asOf', { date: fmtDay(data.as_of), tz: tz.replace('_', ' ') })}</p>
            </Card>
        </Page>
    );
}
