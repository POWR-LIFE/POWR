import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Compass, Dumbbell, Sparkles, Trophy } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymInsights, fetchMemberActivity } from './venueApi';
import { BarRow, Columns, INK, Stacked } from './charts';
import MemberPeople, { activityLabelKey, useMemberName } from './MemberPeople';
import { usePackage } from './packages';
import { memberInsights, changeLabel } from '../../../../shared/memberInsights.ts';
import { hourLabel } from '../../../../shared/gymBoard.ts';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';

// The gym's members on POWR, one question per row and nothing shown twice:
// how many, how engaged (active anywhere, trained here, drifting, new); what
// the numbers say; what they do, where and how often; when they come here;
// and, on Pro, the members who share their activity by name.
//
// Two sources: gym_insights is sessions AT the gym (anyone who checked in);
// gym_member_activity (Clash+) is what the members who chose this gym do
// ANYWHERE, anonymous and only from 5 members up. Never sleep, heart rate,
// steps or location.

const WEEKS = 12;
// Labels are keys, translated where they render.
const WHERE = [
    { key: 'here',       label: 'venueMembers:members.where.here',       color: INK },
    { key: 'other_gyms', label: 'venueMembers:members.where.otherGyms',  color: '#1A1A1A' },
    { key: 'elsewhere',  label: 'venueMembers:members.where.elsewhere',  color: '#D8D8D2' },
];
const BANDS = [
    { key: 'high', label: 'venueMembers:members.bands.high', color: '#8a7600' },
    { key: 'mid',  label: 'venueMembers:members.bands.mid',  color: '#B8A600' },
    { key: 'low',  label: 'venueMembers:members.bands.low',  color: '#DCCF66' },
    { key: 'none', label: 'venueMembers:members.bands.none', color: '#ECECE8' },
];

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

function Head({ icon: Icon, children, sub }) {
    return (
        <div className="mb-5">
            <div className="flex items-center gap-2.5"><Icon size={14} className="text-[#8a7600]" /><Micro>{children}</Micro></div>
            {sub && <p className="text-[11px] text-[#AAAAAA] mt-1.5 leading-relaxed">{sub}</p>}
        </div>
    );
}

function Change({ pct }) {
    const label = changeLabel(pct);
    if (!label) return null;
    const tone = pct > 0 ? 'text-[#0B7A57]' : pct < 0 ? 'text-[#B45309]' : 'text-[#AAAAAA]';
    return <span className={`text-[10px] font-black tabular-nums ${tone}`}>{label}</span>;
}

function Avatar({ row }) {
    const name = useMemberName()(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-7 h-7 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

export default function VenueMembers() {
    const { t, i18n } = useTranslation();
    const nameOf = useMemberName();
    const { gym } = useAuth();
    const { pkg } = usePackage();
    const [venue, setVenue] = useState(null);        // gym_insights: sessions at the gym
    const [activity, setActivity] = useState(null);  // gym_member_activity: members anywhere (Clash+)
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([fetchGymInsights(gym.partner_id, WEEKS), fetchMemberActivity(gym.partner_id, WEEKS).catch(() => null)])
            .then(([v, a]) => { if (alive) { setVenue(v); setActivity(a); } })
            .catch(err => { if (alive) setError(err); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title={t('venueMembers:members.loadError')} action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>{t('common:actions.retry')}</button>}>{serverErrorText(error)}</Empty>;
    if (!venue) return <Spinner />;

    const tz = venue.tz ?? 'Europe/London';
    const fmtWeek = (iso) => new Intl.DateTimeFormat(formatLocale(), { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso));
    const vWeeks = venue.weeks ?? [];
    const weekCols = vWeeks.map((w, i) => ({
        key: w.week_start,
        tick: i === vWeeks.length - 1 ? t('venueMembers:members.weekly.now') : fmtWeek(w.week_start),
        tip: i === vWeeks.length - 1 ? t('venueMembers:members.weekly.thisWeek') : t('venueMembers:members.weekly.weekOf', { date: fmtWeek(w.week_start) }),
        value: w.athletes ?? 0,
        partial: i === vWeeks.length - 1,
    }));
    const newThisWeek = vWeeks.length ? (vWeeks[vWeeks.length - 1].new_athletes ?? 0) : 0;
    const quietVenue = vWeeks.every(w => !w.sessions);

    // English keeps the wall's "6pm"; other languages say the hour the 24-hour way ("18:00").
    const hourText = (h) => (i18n.language === 'en' ? hourLabel(h)
        : new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5, h)));
    // 5 January 2026 was a Monday: i = 0 → Monday (en-GB: "Mon" / "Monday").
    const dayText = (i, weekday) => new Intl.DateTimeFormat(formatLocale(), { weekday, timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5 + i));
    const hours = (venue.hours ?? []).map((n, h) => ({ key: h, tick: hourText(h), tip: `${hourText(h)}–${hourText((h + 1) % 24)}`, value: n }));
    const days = (venue.days ?? []).map((n, i) => ({ key: i, tick: dayText(i, 'short'), tip: dayText(i, 'long'), value: n }));
    const peakHour = hours.reduce((best, h) => (h.value > (best?.value ?? 0) ? h : best), null);
    const peakDay = days.reduce((best, d) => (d.value > (best?.value ?? 0) ? d : best), null);

    const rich = !!activity && !activity.too_few;
    const insights = rich ? memberInsights(activity, { gymName: gym.name, canSeePeople: !!pkg?.features?.people, t, locale: formatLocale() }).slice(0, 3) : [];
    const mix = rich ? (activity.mix ?? []).slice(0, 6) : [];
    const mixMax = Math.max(1, ...mix.map(r => r.sessions));
    const where = rich ? (activity.gym_sessions ?? {}) : null;
    const bands = rich ? (activity.consistency ?? {}) : null;
    const members = activity?.members ?? venue.members ?? 0;

    return (
        <Page>
            <PageTitle eyebrow={t('venueMembers:members.eyebrow')} title={t('venueMembers:members.title')} sub={gym.name} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <Card glow className="p-6 sm:p-8 lg:col-span-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-6xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(members)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueMembers:members.chose', { count: members, gym: gym.name })}</span>
                    </div>
                    <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
                        {rich ? (
                            <>
                                <Fact label={t('venueMembers:members.facts.active')} value={activity.active_4w} note={activity.active_prev_4w != null ? t('venueMembers:members.facts.activeNotePrev', { prev: fmtNum(activity.active_prev_4w) }) : t('venueMembers:members.facts.activeNote')} />
                                <Fact label={t('venueMembers:members.facts.trainedHere')} value={venue.athletes_28d} note={t('venueMembers:members.facts.trainedHereNote')} />
                                <Link to="/venue/retention" className="min-w-0 rounded-xl -m-1 p-1 hover:bg-[#FAFAF8]">
                                    <Fact label={t('venueMembers:members.facts.drifting')} value={activity.quiet ?? 0} note={activity.slowing ? t('venueMembers:members.facts.driftingNoteSlipping', { slipping: activity.slowing }) : t('venueMembers:members.facts.driftingNote')} tone={(activity.quiet ?? 0) > 0 ? 'amber' : undefined} />
                                </Link>
                                <Fact label={t('venueMembers:members.facts.newHere')} value={newThisWeek} note={t('venueMembers:members.facts.newHereNote')} tone={newThisWeek > 0 ? 'green' : undefined} />
                            </>
                        ) : (
                            <>
                                <Fact label={t('venueMembers:members.facts.trainedHere')} value={venue.athletes_28d} note={t('venueMembers:members.facts.trainedHereNote')} />
                                <Fact label={t('venueMembers:members.facts.newHere')} value={newThisWeek} note={t('venueMembers:members.facts.newHereNote')} tone={newThisWeek > 0 ? 'green' : undefined} />
                                <div className="col-span-2 self-end text-[11px] text-[#AAAAAA] leading-relaxed">
                                    {activity?.too_few
                                        ? t('venueMembers:members.tooFew', { min: activity.min_members ?? 5 })
                                        : t('venueMembers:members.unavailable')}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="mt-8">
                        <Micro className="mb-6">{t('venueMembers:members.weekly.title')}</Micro>
                        {quietVenue ? (
                            <p className="text-[13px] text-[#888] font-light leading-relaxed">{t('venueMembers:members.weekly.empty', { gym: gym.name })}</p>
                        ) : (
                            <Columns data={weekCols} label={t('venueMembers:members.weekly.title')} height={190} tickEvery={2} />
                        )}
                    </div>
                </Card>

                <Card className="p-6 sm:p-8 flex flex-col min-h-0">
                    <Head icon={Trophy} sub={t('venueMembers:members.board.sub', { gym: gym.name })}>{t('venueMembers:members.board.title')}</Head>
                    {(venue.top ?? []).length === 0 ? (
                        <p className="text-[13px] text-[#888] font-light">{t('venueMembers:members.board.empty')}</p>
                    ) : (
                        <ol className="divide-y divide-[#F0F0EC]">
                            {venue.top.slice(0, 10).map(row => (
                                <li key={row.rank} className="flex items-center gap-3 py-1.5 first:pt-0">
                                    <span className={`w-4 text-[12px] font-black tabular-nums ${row.rank === 1 ? 'text-[#8a7600]' : 'text-[#BBBBBB]'}`}>{row.rank}</span>
                                    <Avatar row={row} />
                                    <span className="flex-1 min-w-0 text-[13px] font-bold text-[#1A1A1A] truncate">{nameOf(row)}</span>
                                    <span className="text-[10px] font-bold text-[#AAAAAA] tabular-nums">{row.sessions}×</span>
                                    <span className="w-12 text-right text-[14px] font-light tabular-nums text-[#8a7600]">{fmtNum(row.points)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="text-[10px] text-[#BBBBBB] mt-auto pt-4 leading-relaxed">{t('venueMembers:members.board.note')}</p>
                </Card>
            </div>

            {insights.length > 0 && (
                <Card className="p-6 sm:p-8">
                    <Head icon={Sparkles}>{t('venueMembers:members.numbers')}</Head>
                    <div className="divide-y divide-[#F0F0EC]">
                        {insights.map(i => (
                            <div key={i.key} className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-8 py-3.5 first:pt-0 last:pb-0">
                                <div className="text-[13px] text-[#777] leading-snug">{i.finding}</div>
                                <div className="text-[13px] font-bold text-[#1A1A1A] leading-snug">{i.action}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                {rich && (
                    <Card className="p-6 sm:p-8">
                        <Head icon={Dumbbell} sub={t('venueMembers:members.mix.sub')}>{t('venueMembers:members.mix.title')}</Head>
                        {mix.length === 0 ? (
                            <p className="text-[13px] text-[#888] font-light">{t('venueMembers:members.mix.empty')}</p>
                        ) : (
                            <div className="space-y-3.5">
                                {mix.map(r => (
                                    <BarRow key={r.type} label={t(activityLabelKey(r.type))} sub={t('venueMembers:members.mix.members', { count: r.members ?? 0 })} value={r.sessions} max={mixMax}
                                        right={<span className="inline-flex items-baseline gap-2"><Change pct={r.change_pct} />{fmtNum(r.sessions)}</span>} />
                                ))}
                            </div>
                        )}
                    </Card>
                )}

                {rich && (
                    <Card className="p-6 sm:p-8">
                        <Head icon={Compass} sub={t('venueMembers:members.where.sub')}>{t('venueMembers:members.where.title')}</Head>
                        <div className="space-y-7">
                            <Stacked label={t('venueMembers:members.where.whereLabel')} segments={WHERE.map(s => ({ ...s, label: t(s.label), value: where?.[s.key] ?? 0 }))} />
                            <Stacked label={t('venueMembers:members.where.daysLabel')} segments={BANDS.map(s => ({ ...s, label: t(s.label), value: bands?.[s.key] ?? 0 }))} />
                        </div>
                        <p className="text-[10px] text-[#BBBBBB] mt-5 leading-relaxed">{t('venueMembers:members.where.note')}</p>
                    </Card>
                )}

                <Card className={`p-6 sm:p-8 ${rich ? '' : 'lg:col-span-3'}`}>
                    <Head icon={Clock} sub={!peakDay?.value ? t('venueMembers:members.when.sub', { gym: gym.name })
                        : peakHour?.value ? t('venueMembers:members.when.subDayHour', { gym: gym.name, day: peakDay.tip, hour: peakHour.tick })
                        : t('venueMembers:members.when.subDay', { gym: gym.name, day: peakDay.tip })}>{t('venueMembers:members.when.title')}</Head>
                    {quietVenue ? (
                        <p className="text-[13px] text-[#888] font-light">{t('venueMembers:members.when.empty')}</p>
                    ) : (
                        <div className={`grid gap-8 ${rich ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
                            <div>
                                <Micro className="mb-6">{t('venueMembers:members.when.byHour')}</Micro>
                                <Columns data={hours} label={t('venueMembers:members.when.byHourLabel')} tickEvery={6} height={110} />
                            </div>
                            <div>
                                <Micro className="mb-6">{t('venueMembers:members.when.byDay')}</Micro>
                                <Columns data={days} label={t('venueMembers:members.when.byDayLabel')} height={110} />
                            </div>
                        </div>
                    )}
                </Card>
            </div>

            <MemberPeople gym={gym} />

            <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-3xl">
                {t('venueMembers:members.footer', { gym: gym.name })}
            </p>
        </Page>
    );
}
