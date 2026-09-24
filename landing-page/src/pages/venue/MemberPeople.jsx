import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Card, Micro, Spinner, BTN_GHOST, fmtNum } from '../../components/portal/ui';
import { fetchMemberPeople } from './venueApi';
import { usePackage } from './packages';
import { boardName, activityMeta } from '../../../../shared/gymBoard.ts';
import { formatMemberId } from '../../../../shared/memberId.ts';

// Named member detail (Clash Pro), ONLY for members who switched on "Share
// with <gym>" in the app: what they've done lately and whether they've gone
// quiet, so staff can reach out before someone cancels. Activity only; never
// sleep, heart rate or location (gym_member_people).

const STATUS = {
    quiet:    { label: 'Gone quiet',    cls: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]' },
    slowing:  { label: 'Slowing down',  cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' },
    active:   { label: 'Active',        cls: 'bg-[#DCFCE7] text-[#0B7A57] border-[#BBF7D0]' },
    inactive: { label: 'Not active yet', cls: 'bg-[#F4F4F1] text-[#888] border-[#E6E6E1]' },
};

const FILTERS = [['all', 'Everyone'], ['quiet', 'Gone quiet'], ['slowing', 'Slowing down']];

function ago(iso) {
    if (!iso) return 'no activity yet';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-10 h-10 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[12px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

export default function MemberPeople({ gym }) {
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
            .catch((err) => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id, allowed]);

    if (pkg && !allowed) {
        return (
            <Card className="p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-3"><Lock size={13} className="text-[#8a7600]" /><Micro gold>Clash Pro</Micro></div>
                <div className="text-2xl font-light tracking-tight">See who’s gone quiet</div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                    Clash Pro names the members who share their activity with you: what they’ve been doing, and an early
                    warning when someone goes quiet, so you can reach out before they cancel.
                </p>
                <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>See packages</Link>
            </Card>
        );
    }
    if (error) return <Card className="p-6 sm:p-8"><Micro>Members who share with you</Micro><p className="text-sm text-[#888] mt-3">{error}</p></Card>;
    if (!data) return <Spinner className="py-10" />;

    const people = data.people ?? [];
    const count = (s) => people.filter((p) => p.status === s).length;
    const shown = filter === 'all' ? people : people.filter((p) => p.status === filter);

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
                <div>
                    <Micro gold>Members who share with you</Micro>
                    <div className="text-2xl font-light tracking-tight mt-2">
                        {fmtNum(data.sharing)} of {fmtNum(data.members)} member{data.members === 1 ? '' : 's'}
                    </div>
                </div>
                {people.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {FILTERS.map(([k, l]) => {
                            const n = k === 'all' ? people.length : count(k);
                            return (
                                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                                    className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${filter === k ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                    {l} · {n}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-3xl">
                Members switch this on in the POWR app (Settings, then Privacy, then Share with {gym.name}) and can switch it off any
                time. You see what they do and when, never their sleep, heart rate or where they are.
            </p>

            {people.length === 0 ? (
                <p className="text-sm text-[#888] font-light">
                    Nobody shares yet. Mention it at the front desk: members who share get noticed when they drift off, not when they cancel.
                </p>
            ) : shown.length === 0 ? (
                <p className="text-sm text-[#888] font-light">Nobody in this group right now.</p>
            ) : (
                <div className="divide-y divide-[#F0F0EC]">
                    {shown.map((p) => {
                        const st = STATUS[p.status] ?? STATUS.active;
                        return (
                            <div key={p.user_id} className="flex flex-wrap sm:flex-nowrap items-start gap-4 py-4">
                                <Avatar row={p} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[14px] font-bold text-[#1A1A1A] truncate">{boardName(p)}</span>
                                        <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[9px] font-black uppercase tracking-[0.15em] ${st.cls}`}>{st.label}</span>
                                    </div>
                                    <div className="text-[11px] text-[#AAAAAA] font-bold mt-0.5">
                                        POWR ID {p.member_id ? formatMemberId(p.member_id) : '—'} · last active {ago(p.last_active)}
                                    </div>
                                    <div className="text-[12px] text-[#666] mt-2">
                                        {p.recent_days} active day{p.recent_days === 1 ? '' : 's'} in the last 2 weeks
                                        {p.usual_days > 0 ? ` (usually about ${Math.max(1, Math.round(p.usual_days))})` : ''}
                                        {` · ${fmtNum(p.sessions_4w)} session${p.sessions_4w === 1 ? '' : 's'} in 4 weeks`}
                                        {p.streak > 1 ? ` · ${p.streak}-day streak` : ''}
                                    </div>
                                    {(p.top ?? []).length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {p.top.slice(0, 4).map((t) => (
                                                <span key={t.type} className="inline-flex items-center h-6 px-2.5 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[10px] font-bold text-[#555]">
                                                    {activityMeta(t.type).label} · {t.sessions}
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
