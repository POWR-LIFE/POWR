import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Card, Micro, Spinner, BTN_GHOST, fmtNum } from '../../components/portal/ui';
import { fetchMemberPeople } from './venueApi';
import { usePackage } from './packages';
import { boardName } from '../../../../shared/gymBoard.ts';
import { formatMemberId } from '../../../../shared/memberId.ts';
import { serverErrorText } from '../../lib/serverErrors';

// Named member detail (Clash Pro), ONLY for members who switched on "Share
// with <gym>" in the app: what they've done lately ANYWHERE (runs, rides,
// home workouts), and whether that's gone quiet. Drifting from the gym itself
// is Retention's job (/venue/retention), for everyone, from visits here.
// Activity only; never sleep, heart rate or location (gym_member_people).

// Labels are keys, translated where they render.
const STATUS = {
    quiet:    { label: 'venueMembers:people.status.quiet',    cls: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]' },
    slowing:  { label: 'venueMembers:people.status.slowing',  cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' },
    active:   { label: 'venueMembers:people.status.active',   cls: 'bg-[#DCFCE7] text-[#0B7A57] border-[#BBF7D0]' },
    inactive: { label: 'venueMembers:people.status.inactive', cls: 'bg-[#F4F4F1] text-[#888] border-[#E6E6E1]' },
};

const FILTERS = [['all', 'venueMembers:people.everyone'], ['quiet', 'venueMembers:people.status.quiet'], ['slowing', 'venueMembers:people.status.slowing']];

/**
 * shared/gymBoard's activityMeta(type).label ("Run", "Ride"…) as a key, for
 * the Members and Retention pages (gymBoard stays English for the big screens).
 */
const ACTIVITY_LABEL = {
    gym: 'venueMembers:activity.gym',
    running: 'venueMembers:activity.running',
    cycling: 'venueMembers:activity.cycling',
    swimming: 'venueMembers:activity.swimming',
    hiit: 'venueMembers:activity.hiit',
    yoga: 'venueMembers:activity.yoga',
    sports: 'venueMembers:activity.sports',
    dance: 'venueMembers:activity.dance',
    walking: 'venueMembers:activity.walking',
};
export const activityLabelKey = (type) => ACTIVITY_LABEL[type] ?? 'venueMembers:activity.other';

/** boardName(), with its "POWR member" fallback in the reader's language. */
export function useMemberName() {
    const { t } = useTranslation();
    return useCallback((row) => (row.display_name || row.username ? boardName(row) : t('venueMembers:memberName')), [t]);
}

function ago(t, iso) {
    if (!iso) return t('venueMembers:people.ago.none');
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return days <= 0 ? t('venueMembers:people.ago.today') : days === 1 ? t('venueMembers:people.ago.yesterday') : t('venueMembers:people.ago.days', { count: days });
}

function Avatar({ row }) {
    const name = useMemberName()(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-10 h-10 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[12px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

export default function MemberPeople({ gym }) {
    const { t } = useTranslation();
    const nameOf = useMemberName();
    const { pkg } = usePackage();
    const allowed = !!pkg?.features?.people;
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        if (!allowed) return undefined;
        let alive = true;
        fetchMemberPeople(gym.partner_id)
            .then((d) => { if (alive) setData(d); })
            .catch((err) => { if (alive) setError(err); });
        return () => { alive = false; };
    }, [gym.partner_id, allowed]);

    if (pkg && !allowed) {
        return (
            <Card className="p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-3"><Lock size={13} className="text-[#8a7600]" /><Micro gold>Clash Pro</Micro></div>
                <div className="text-2xl font-light tracking-tight">{t('venueMembers:people.locked.title')}</div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                    {t('venueMembers:people.locked.body')}
                </p>
                <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>{t('venueMembers:seePackages')}</Link>
            </Card>
        );
    }
    if (error) return <Card className="p-6 sm:p-8"><Micro>{t('venueMembers:people.title')}</Micro><p className="text-sm text-[#888] mt-3">{serverErrorText(error)}</p></Card>;
    if (!data) return <Spinner className="py-10" />;

    const people = data.people ?? [];
    const count = (s) => people.filter((p) => p.status === s).length;
    const shown = filter === 'all' ? people : people.filter((p) => p.status === filter);

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
                <div>
                    <Micro gold>{t('venueMembers:people.title')}</Micro>
                    <div className="text-2xl font-light tracking-tight mt-2">
                        {t('venueMembers:people.sharing', { count: data.members ?? 0, sharing: fmtNum(data.sharing), members: fmtNum(data.members) })}
                    </div>
                </div>
                {people.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {FILTERS.map(([k, l]) => {
                            const n = k === 'all' ? people.length : count(k);
                            return (
                                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                                    className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${filter === k ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                    {t(l)} · {n}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-3xl">
                {t('venueMembers:people.privacy', { gym: gym.name })}
            </p>

            {people.length === 0 ? (
                <p className="text-sm text-[#888] font-light">
                    {t('venueMembers:people.none')}
                </p>
            ) : shown.length === 0 ? (
                <p className="text-sm text-[#888] font-light">{t('venueMembers:people.emptyGroup')}</p>
            ) : (
                <div className="divide-y divide-[#F0F0EC]">
                    {shown.map((p) => {
                        const st = STATUS[p.status] ?? STATUS.active;
                        return (
                            <div key={p.user_id} className="flex flex-wrap sm:flex-nowrap items-start gap-4 py-4">
                                <Avatar row={p} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[14px] font-bold text-[#1A1A1A] truncate">{nameOf(p)}</span>
                                        <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[9px] font-black uppercase tracking-[0.15em] ${st.cls}`}>{t(st.label)}</span>
                                    </div>
                                    <div className="text-[11px] text-[#AAAAAA] font-bold mt-0.5">
                                        {t('venueMembers:people.idLine', { id: p.member_id ? formatMemberId(p.member_id) : '—', when: ago(t, p.last_active) })}
                                    </div>
                                    <div className="text-[12px] text-[#666] mt-2">
                                        {[
                                            p.usual_days > 0
                                                ? t('venueMembers:people.recentUsual', { count: p.recent_days ?? 0, usual: Math.max(1, Math.round(p.usual_days)) })
                                                : t('venueMembers:people.recent', { count: p.recent_days ?? 0 }),
                                            t('venueMembers:people.sessions', { count: p.sessions_4w ?? 0, sessions: fmtNum(p.sessions_4w) }),
                                            p.streak > 1 ? t('venueMembers:people.streak', { count: p.streak }) : null,
                                        ].filter(Boolean).join(' · ')}
                                    </div>
                                    {(p.top ?? []).length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {p.top.slice(0, 4).map((a) => (
                                                <span key={a.type} className="inline-flex items-center h-6 px-2.5 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[10px] font-bold text-[#555]">
                                                    {t(activityLabelKey(a.type))} · {a.sessions}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}
