import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Download, Lock, Search, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum, BTN_GHOST, BTN_GOLD, INPUT } from '../../components/portal/ui';
import { useToast } from '../../lib/toast';
import { deleteOutreach, fetchRetention, logOutreach, nudgeQuietMembers } from './venueApi';
import { Columns } from './charts';
import { eventPushCopy } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import {
    CHANNEL_LABEL, patternLine, personLine, quietLabel, sinceLabel, statusLabel,
} from '../../../../supabase/functions/_shared/retentionCopy.ts';
import { boardName, initials } from '../../../../shared/gymBoard.ts';
import { formatMemberId } from '../../../../shared/memberId.ts';

// Retention: who's drifting from the gym, each person against their own
// normal (gym_retention, migration 20261007120000). Visits AT this gym only,
// from POWR's check-ins; members can switch it off in the app (Settings,
// then Privacy, "Let gyms see my visits"). Clash+ sees the counts, the trend
// and the win-backs; Clash Pro names people, logs who reached out and nudges.
// Anyone POWR can't hear (phone silent a week, location off) is shown apart
// and never counted as drifting: they may still be training.

const TABS = [
    ['drifting', 'Drifting'],
    ['slipping', 'Slipping'],
    ['lapsed', 'Lapsed'],
    ['new', 'New'],
    ['regular', 'On track'],
    ['cant_see', 'Can’t see'],
    ['all', 'Everyone'],
];
// What staff pick; the history then says it as CHANNEL_LABEL ("Called", "Texted"…).
const CHANNELS = [['call', 'Called'], ['text', 'Texted'], ['email', 'Emailed'], ['in_person', 'In person'], ['other', 'Other']];
const AT_RISK = new Set(['slipping', 'drifting', 'lapsed']);

const bucket = (p) => (AT_RISK.has(p.status) && p.signal !== 'ok' ? 'cant_see' : p.status);

// "12 days quiet" in the trailer's amber for drifting; the rest in their own tone.
function Chip({ p }) {
    const b = bucket(p);
    const tone = {
        drifting: 'bg-[#FFF7E6] border-[#F5A524]/60 text-[#B45309]',
        slipping: 'bg-[#FEFCE8] border-[#E8D200]/60 text-[#8a7600]',
        lapsed:   'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]',
        new:      'bg-[#ECFDF5] border-[#BBF7D0] text-[#0B7A57]',
        regular:  'bg-[#F0FDF4] border-[#DCFCE7] text-[#0B7A57]',
    }[b] ?? 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]';
    const label = b === 'drifting' ? quietLabel(p.gap_days)
        : b === 'slipping' ? `Slipping · ${p.gap_days}d`
        : statusLabel(p.status, p.signal);
    return <span className={`inline-flex items-center h-7 px-3 rounded-full border text-[9px] font-black uppercase tracking-[0.18em] whitespace-nowrap ${tone}`}>{label}</span>;
}

function Avatar({ p }) {
    const name = boardName(p);
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
    const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return (
        <figure className="m-0" aria-label="Visits over the last 12 weeks">
            <div className="flex gap-[3px]">
                {weeks.map((col, w) => (
                    <div key={w} className="flex flex-col gap-[3px]">
                        {col.map((c) => (
                            <span
                                key={c.iso}
                                title={`${fmt(c.iso)}${c.hit ? ': in' : ''}`}
                                className={`block w-3 h-3 rounded-[3px] ${c.future ? 'bg-transparent' : c.hit ? 'bg-[#8a7600]' : 'bg-[#F0F0EC]'}`}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <figcaption className="flex justify-between text-[9px] font-bold text-[#BBBBBB] mt-1.5 tabular-nums" style={{ width: 12 * 15 - 3 }}>
                <span>{fmt(weeks[0][0].iso)}</span><span>Today</span>
            </figcaption>
            <div className="sr-only">{(visits ?? []).length} visits: {(visits ?? []).map(fmt).join(', ')}</div>
        </figure>
    );
}

function PersonDetail({ p, gym, asOf, canDelete, onChanged }) {
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
            toast.success('Logged. We’ll tell you if they come back.');
            onChanged();
        } catch (e) { toast.error(e.message); }
        finally { setBusy(null); }
    };
    const nudge = async () => {
        if (!window.confirm(`Send ${boardName(p)} one push from POWR? They get it once, and not again for a fortnight.`)) return;
        setBusy('nudge');
        try {
            const r = await nudgeQuietMembers(gym.partner_id, false, p.user_id);
            toast.success(r.recipients ? 'Sent.' : 'They had one in the last fortnight.');
            onChanged();
        } catch (e) { toast.error(e.message); }
        finally { setBusy(null); }
    };
    const remove = async (id) => {
        setBusy(id);
        try { await deleteOutreach(gym.partner_id, id); onChanged(); }
        catch (e) { toast.error(e.message); }
        finally { setBusy(null); }
    };
    const preview = eventPushCopy('gym_quiet_nudge', { gym_name: gym.name, weeks: Math.floor((p.gap_days ?? 0) / 7) });

    return (
        <div className="pl-0 sm:pl-14 pb-5 pt-1 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10">
            <div className="space-y-4">
                <VisitStrip visits={p.visits} asOf={asOf} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px] max-w-[260px]">
                    <div><dt className="text-[#AAAAAA] font-bold">Last visit</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{sinceLabel(p.gap_days)}</dd></div>
                    <div><dt className="text-[#AAAAAA] font-bold">Last 4 weeks</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{p.recent_28} visit{p.recent_28 === 1 ? '' : 's'}</dd></div>
                    {p.drift_after != null && <div><dt className="text-[#AAAAAA] font-bold">Usual gap</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{Math.round(Number(p.usual_gap))} day{Math.round(Number(p.usual_gap)) === 1 ? '' : 's'}</dd></div>}
                    {p.drift_after != null && <div><dt className="text-[#AAAAAA] font-bold">Drifting after</dt><dd className="text-[#1A1A1A] font-bold mt-0.5">{p.drift_after} days</dd></div>}
                </dl>
                <p className="text-[11px] text-[#999] leading-relaxed max-w-[260px]">
                    {p.is_member ? `Picked ${gym.name} as their gym in POWR.` : 'Checks in here; hasn’t picked you as their gym in POWR.'}
                    {p.location === 'while_using' ? ' Their location is set to “while using”, so POWR only sees visits when they open the app here.' : ''}
                    {p.drifting_since ? ` Drifting since ${new Date(`${p.drifting_since}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.` : ''}
                    {p.shares_all ? <> Shares all their training with you: <Link to="/venue/members" className="underline">Members</Link>.</> : null}
                </p>
            </div>

            <div className="space-y-5 min-w-0">
                <div>
                    <Micro>Log a reach-out</Micro>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {CHANNELS.map(([c, label]) => (
                            <button key={c} type="button" onClick={() => setChannel(channel === c ? null : c)} aria-pressed={channel === c}
                                className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${channel === c ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/50'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    {channel && (
                        <div className="flex flex-col sm:flex-row gap-2 mt-3">
                            <input className={`${INPUT} h-11`} maxLength={280} placeholder="A note for the team (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                            <button type="button" onClick={log} disabled={busy === 'log'} className={`${BTN_GOLD} h-11 px-6 shrink-0`}>{busy === 'log' ? 'Saving…' : 'Log it'}</button>
                        </div>
                    )}
                </div>

                {canNudge && (
                    <div className="rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">POWR · push</div>
                            <div className="text-[12px] font-bold text-[#1A1A1A] mt-1">{preview.title}</div>
                            <div className="text-[12px] text-[#666]">{preview.body}</div>
                        </div>
                        {cooling
                            ? <span className="text-[11px] font-bold text-[#888]">Nudged {sinceLabel(nudgedDays)}</span>
                            : <button type="button" onClick={nudge} disabled={busy === 'nudge'} className={`${BTN_GHOST} h-10 px-5`}><Send size={12} /> {busy === 'nudge' ? 'Sending…' : 'Send nudge'}</button>}
                    </div>
                )}

                {(p.outreach ?? []).length > 0 && (
                    <div>
                        <Micro>What the team did</Micro>
                        <ul className="mt-2 divide-y divide-[#F0F0EC]">
                            {p.outreach.map((o) => (
                                <li key={o.id} className="flex items-start gap-3 py-2.5 text-[12px]">
                                    <div className="flex-1 min-w-0">
                                        <span className="font-bold text-[#1A1A1A]">{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
                                        <span className="text-[#AAAAAA]"> · {new Date(o.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{o.by ? ` · ${o.by}` : ''}</span>
                                        {o.note && <div className="text-[#666] mt-0.5 break-words">{o.note}</div>}
                                    </div>
                                    {o.channel !== 'push' && (o.mine || canDelete) && (
                                        <button type="button" onClick={() => remove(o.id)} disabled={busy === o.id} aria-label="Remove this note" className="text-[#BBBBBB] hover:text-[#B91C1C] p-1"><Trash2 size={13} /></button>
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
    const last = (p.outreach ?? [])[0];
    const lastDays = last ? Math.floor((Date.now() - new Date(last.at).getTime()) / 86400000) : null;
    return (
        <li className={open ? 'bg-[#FCFCFA]' : ''}>
            <button type="button" onClick={onToggle} aria-expanded={open}
                className="w-full flex items-center gap-4 py-4 text-left group">
                <Avatar p={p} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[14px] font-bold text-[#1A1A1A] truncate">{boardName(p)}</span>
                        {p.member_id && <span className="hidden sm:inline text-[10px] font-bold text-[#BBBBBB] tabular-nums shrink-0">{formatMemberId(p.member_id)}</span>}
                    </div>
                    <div className="text-[12px] text-[#888] mt-0.5 sm:truncate">{personLine({ ...p, as_of: asOf })}</div>
                    {/* On a phone the chip sits under the line, so the line gets the width. */}
                    <div className="sm:hidden flex flex-wrap items-center gap-2 mt-2">
                        <Chip p={p} />
                        {last && <span className="text-[10px] font-bold text-[#AAAAAA]">{CHANNEL_LABEL[last.channel]} {sinceLabel(lastDays)}</span>}
                    </div>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                    <Chip p={p} />
                    {last && <span className="text-[10px] font-bold text-[#AAAAAA]">{CHANNEL_LABEL[last.channel]} {sinceLabel(lastDays)}</span>}
                </div>
                <ChevronDown size={14} className={`text-[#CCCCCC] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <PersonDetail p={p} gym={gym} asOf={asOf} canDelete={canDelete} onChanged={onChanged} />}
        </li>
    );
}

// Everyone drifting, one push from POWR, at most once a day.
function NudgeAll({ gym, drifting, onSent }) {
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
        if (!window.confirm(`Send one push from POWR to ${plan.recipients} ${plan.recipients === 1 ? 'person' : 'people'} who are drifting? Each gets it once, and not again for a fortnight.`)) return;
        setBusy(true);
        try {
            const r = await nudgeQuietMembers(gym.partner_id, false);
            toast.success(`Sent to ${r.recipients}`);
            onSent();
        } catch (e) { toast.error(e.message); }
        finally { setBusy(false); }
    };
    return (
        <div className="mt-5 pt-5 border-t border-[#F0F0EC]">
            <p className="text-[12px] text-[#888] leading-relaxed">
                {plan == null ? 'Counting…'
                    : plan.unavailable ? 'Nudges aren’t available right now.'
                    : plan.recipients ? `One push from POWR to the ${plan.recipients} drifting${plan.cooling ? ` (${plan.cooling} had one in the last fortnight and wait)` : ''}.`
                    : plan.cooling ? `Everyone drifting had a nudge in the last fortnight.` : 'Nobody to nudge right now.'}
            </p>
            <button type="button" onClick={send} disabled={busy || !plan?.recipients} className={`${BTN_GHOST} h-10 px-5 mt-3`}><Send size={12} /> {busy ? 'Sending…' : `Nudge ${plan?.recipients ?? 0}`}</button>
        </div>
    );
}

function csv(rows, asOf) {
    const head = ['Name', 'Username', 'POWR ID', 'Status', 'Last visit', 'Days since', 'Usual pattern', 'Picked this gym', 'Last reach-out'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((p) => [
        boardName(p), p.username, formatMemberId(p.member_id), statusLabel(p.status, p.signal), p.last_visit, p.gap_days,
        patternLine(p), p.is_member ? 'yes' : 'no',
        p.outreach?.[0] ? `${CHANNEL_LABEL[p.outreach[0].channel]} ${new Date(p.outreach[0].at).toISOString().slice(0, 10)}` : '',
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retention-${asOf}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function VenueRetention() {
    const { gym } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState(null);
    const [open, setOpen] = useState(null);
    const [q, setQ] = useState('');

    const load = useCallback(() => {
        fetchRetention(gym.partner_id).then(setData).catch((e) => setError(e.message));
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
    const shown = (groups[active] ?? []).filter((p) => !q || `${boardName(p)} ${p.username ?? ''} ${p.member_id ?? ''}`.toLowerCase().includes(q.toLowerCase()));

    if (error) return <Empty title="Couldn’t load Retention" action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>Try again</button>}>{error}</Empty>;
    if (!data) return <Spinner />;

    if (data.too_few) {
        return (
            <Page>
                <PageTitle eyebrow="Retention" title="Who’s drifting" sub={gym.name} />
                <Empty title="Not enough people yet">
                    Retention shows up once at least {data.min_people ?? 5} people pick {gym.name} in the POWR app or check in here, so nobody can be picked out. The poster by the door gets them on.
                </Empty>
            </Page>
        );
    }

    const c = data.counts ?? {};
    const tz = data.tz ?? 'Europe/London';
    const fmtDay = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`));
    const trend = (data.trend ?? []).map((w) => ({
        key: w.week_end,
        tick: fmtDay(w.week_end),
        tip: `Week to ${fmtDay(w.week_end)}: ${w.drifting} drifting, ${w.slipping} slipping`,
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
                eyebrow="Retention"
                title="Who’s drifting"
                sub={`${gym.name} · visits here, against each person’s own normal`}
                right={named && people.length > 0 && (
                    <button type="button" onClick={() => csv(people, data.as_of)} className={BTN_GHOST}><Download size={13} /> Export</button>
                )}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <Card glow className="p-6 sm:p-8 lg:col-span-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`text-6xl font-extralight tracking-tighter tabular-nums leading-none ${c.drifting ? 'text-[#B45309]' : 'text-[#1A1A1A]'}`}>{fmtNum(c.drifting)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">drifting from their usual visits</span>
                    </div>
                    <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
                        <Fact label="On track" value={c.regular} note="coming in as usual" tone={c.regular ? 'green' : undefined} />
                        <Fact label="Slipping" value={c.slipping} note="later than usual" />
                        <Fact label="Lapsed" value={c.lapsed} note="not in for 60+ days" />
                        <Fact label="New" value={c.new} note="first visit in 4 weeks" />
                    </div>
                    {trend.length > 0 && (
                        <div className="mt-8">
                            <Micro className="mb-6">Drifting each week</Micro>
                            <Columns data={trend} label="Drifting" height={120} tickEvery={3} ghostLabel="Slipping or drifting" />
                        </div>
                    )}
                </Card>

                <div className="flex flex-col gap-4 sm:gap-6">
                    <Card className="p-6 sm:p-8">
                        <Micro gold>Won back</Micro>
                        {wb.reached === 0 ? (
                            <>
                                <div className="text-2xl font-light tracking-tight mt-2">Nothing logged yet</div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                    {named ? 'Log a call or a text on someone’s row, or send a nudge. We’ll show who came back within two weeks.' : 'Clash Pro logs who you reached out to and shows who came back.'}
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-5xl font-extralight tracking-tighter tabular-nums text-[#0B7A57]">{fmtNum(wb.back)}</span>
                                    <span className="text-[12px] text-[#888]">of {fmtNum(wb.reached)} came back</span>
                                </div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                    Reached out to in the last 90 days, back within two weeks.
                                    {decided > 0 ? ` That’s ${Math.round((wb.back / decided) * 100)}% of those whose two weeks are up.` : ''}
                                    {wb.waiting ? ` ${fmtNum(wb.waiting)} still inside their two weeks.` : ''}
                                </p>
                            </>
                        )}
                        {named && c.drifting > 0 && <NudgeAll gym={gym} drifting={c.drifting} onSent={load} />}
                    </Card>
                    {c.cant_see > 0 && (
                        <Card className="p-6">
                            <Micro>Can’t see</Micro>
                            <p className="text-[12px] text-[#888] leading-relaxed mt-2">
                                POWR hasn’t heard from {fmtNum(c.cant_see)} {c.cant_see === 1 ? 'person’s phone' : 'people’s phones'} in a week, or their location is off.
                                They may still be training, so they’re not counted as drifting and never nudged.
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
                                        {l} · {n}
                                    </button>
                                );
                            })}
                        </div>
                        {people.length > 10 && (
                            <label className="relative w-full sm:w-64">
                                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                                <input className={`${INPUT} h-10 pl-10`} placeholder="Find someone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find someone" />
                            </label>
                        )}
                    </div>
                    {shown.length === 0 ? (
                        <p className="text-sm text-[#888] font-light mt-6">
                            {active === 'drifting' ? 'Nobody is drifting right now. Everyone with a pattern is coming in about as often as usual.' : 'Nobody here right now.'}
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
                    <div className="text-2xl font-light tracking-tight">See who, before they cancel</div>
                    <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                        Clash Pro names everyone who’s slipping or drifting, with when they usually come in, a morning email when
                        someone starts, a one-tap nudge from POWR, and a log of who you reached out to and who came back.
                    </p>
                    <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>See packages</Link>
                </Card>
            )}

            <Card className="p-6 sm:p-8">
                <Micro>How it works</Micro>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 text-[12px] text-[#777] leading-relaxed">
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">Their normal, not a fixed rule</span>Each person is measured against their own usual gap between visits. Someone who trains daily is drifting after a week; someone who comes weekly, after about three.</p>
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">Visits here only</span>Only the days and times POWR checked them in at {gym.name}. Never their other training, health data or where they are.</p>
                    <p><span className="block text-[13px] font-bold text-[#1A1A1A] mb-1">Their choice</span>Members can switch this off in the POWR app (Settings, then Privacy). Anyone who does disappears from this page.</p>
                </div>
                <p className="text-[10px] text-[#BBBBBB] font-bold mt-5">As of {fmtDay(data.as_of)} · {tz.replace('_', ' ')}</p>
            </Card>
        </Page>
    );
}
