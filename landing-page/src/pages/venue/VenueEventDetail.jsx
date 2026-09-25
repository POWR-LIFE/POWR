import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Copy, ExternalLink, Trophy, Users, Tv, Sparkles, Pencil } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, Spinner, Empty, BTN_GOLD, BTN_GHOST, INPUT, fmtNum } from '../../components/portal/ui';
import {
    cancelGymEvent, deleteGymEvent, disqualifyFromGymEvent, fetchGymEvent, fetchGymEventBoard,
    fetchGymEventRoster, fetchGymSummary, publishGymEvent, reinstateInGymEvent, revealGymEvent,
    scheduleGymReveal, withdrawGymEvent,
} from './venueApi';
import { StatusPill, statusKey, scoringRange, fmtDay, fmtDayTime, lastDay, toLocalInput, fromLocalInput, whatCounts } from './eventUi';
import { boardName } from '../../../../shared/gymBoard.ts';
import { storageImage } from '../../lib/storage';
import { ukTime } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import { eventRegisterUrl } from '../../lib/eventRegisterUrl';
import EventPushes from './EventPushes';
import EventContent from './EventContent';
import { usePackage } from './packages';

// One event, run from a phone at the front desk as easily as from a laptop:
// what happens next and the one button that does it, then the board, who's
// in, the details, and the links for the screen and for members.

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-9 h-9 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

function CopyRow({ label, url, toast }) {
    const copy = async () => {
        try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Copy failed'); }
    };
    return (
        <div>
            <Micro className="mb-2">{label}</Micro>
            <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-[11px] font-mono text-[#666] bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-3 py-2.5 truncate">{url}</code>
                <button type="button" onClick={copy} className="w-10 h-10 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666]" aria-label="Copy"><Copy size={14} /></button>
                <a href={url} target="_blank" rel="noopener noreferrer" className="w-10 h-10 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666]" aria-label="Open"><ExternalLink size={14} /></a>
            </div>
        </div>
    );
}

export default function VenueEventDetail() {
    const { id } = useParams();
    const { gym } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const { pkg } = usePackage();
    const canRun = !!pkg?.features?.events;
    const canPost = !!pkg?.features?.studio;

    const [ev, setEv] = useState(null);
    const [trusted, setTrusted] = useState(false);
    const [address, setAddress] = useState('');
    const [board, setBoard] = useState(null);
    const [roster, setRoster] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [revealAt, setRevealAt] = useState('');

    const loadSide = useCallback(async (e) => {
        if (e.status === 'draft') { setBoard(null); setRoster(null); return; }
        const [b, r] = await Promise.all([fetchGymEventBoard(e.id).catch(() => null), fetchGymEventRoster(e.id).catch(() => null)]);
        setBoard(b);
        setRoster(r ?? []);
    }, []);

    const load = useCallback(async () => {
        try {
            const [e, s] = await Promise.all([fetchGymEvent(id), fetchGymSummary(gym.partner_id)]);
            setEv(e);
            setTrusted(!!s?.portal?.trusted);
            setAddress(s?.gym?.address ?? '');
            setRevealAt(toLocalInput(e.reveal_at));
            loadSide(e);
        } catch (err) {
            setError(err.message);
        }
    }, [id, gym.partner_id, loadSide]);

    useEffect(() => { load(); }, [load]);

    // A live board moves; keep it fresh while the page is open.
    useEffect(() => {
        if (!ev || !['live', 'locked'].includes(ev.status)) return undefined;
        const t = setInterval(() => loadSide(ev), 60_000);
        return () => clearInterval(t);
    }, [ev, loadSide]);

    if (error) return <Empty title="Couldn't load this event">{error}</Empty>;
    if (!ev) return <Spinner />;

    const k = statusKey(ev);
    const editable = ev.editable && !['revealed', 'settled', 'cancelled', 'pulled'].includes(k);
    const early = ev.status === 'draft' || (ev.status === 'scheduled' && new Date(ev.window_start_at) > new Date());
    const canEdit = editable && (early || ev.status === 'live');
    const origin = window.location.origin;
    const screenUrl = `${origin}/live/${ev.slug}?k=${ev.display_token}`;
    const promoUrl = `https://powr.life/promo/${ev.slug}`;
    const registerUrl = eventRegisterUrl(ev.slug);

    const act = async (label, fn, ok, after) => {
        setBusy(label);
        try {
            const next = await fn();
            if (next && next.id) { setEv(next); loadSide(next); }
            if (ok) toast.success(ok);
            if (after) after(next);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    const publish = () => act('publish', () => publishGymEvent(ev.id),
        trusted ? 'Published — members can see it now' : 'Sent to POWR for a quick check');
    const reveal = () => {
        if (!window.confirm(`Reveal the winners of ${ev.name}? Everyone in it gets a notification and your screen flips at the same moment.`)) return;
        act('reveal', () => revealGymEvent(ev.id), 'Winners revealed');
    };
    const cancel = () => {
        if (!window.confirm(`Cancel ${ev.name}? It disappears from the app for everyone who can see it${ev.participants ? `, including the ${ev.participants} who joined` : ''}.`)) return;
        act('cancel', () => cancelGymEvent(ev.id), 'Event cancelled');
    };
    const remove = () => {
        if (!window.confirm(`Delete the draft ${ev.name}?`)) return;
        act('delete', () => deleteGymEvent(ev.id), 'Draft deleted', () => navigate('/venue/events'));
    };
    const saveRevealAt = () => act('reveal_at', () => scheduleGymReveal(ev.id, fromLocalInput(revealAt)), revealAt ? 'Reveal scheduled' : 'Scheduled reveal cleared');

    const disqualify = async (row) => {
        const reason = window.prompt(`Remove ${boardName(row)} from ${ev.name}? Say why — POWR sees the reason.`);
        if (reason == null) return;
        setBusy(`dq:${row.user_id}`);
        try {
            setRoster(await disqualifyFromGymEvent(ev.id, row.user_id, reason));
            toast.success('Removed from the event');
            loadSide(ev);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };
    const reinstate = async (row) => {
        setBusy(`dq:${row.user_id}`);
        try {
            setRoster(await reinstateInGymEvent(ev.id, row.user_id));
            toast.success('Back in the event');
            loadSide(ev);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    // ── What happens next ─────────────────────────────────────────────────
    const next = {
        draft: {
            title: 'Draft',
            body: `Only your team can see it, in the POWR app too, if you want to check how it looks. ${trusted ? 'Publishing puts it in front of your members straight away.' : 'Your first event gets a quick check from POWR before it goes out.'}`,
            actions: [
                ...(canRun ? [{ label: trusted ? 'Publish' : 'Send to POWR', fn: publish, primary: true, busy: 'publish' }]
                    : [{ label: 'Publishing needs Clash+', fn: () => navigate('/venue/package'), primary: true, busy: 'none' }]),
                { label: 'Delete draft', fn: remove, busy: 'delete' },
            ],
        },
        pending: {
            title: 'With POWR for a check',
            body: "We'll approve it or tell you what to change, usually within a day. Pull it back if you need to edit.",
            actions: [{ label: 'Pull it back to edit', fn: () => act('withdraw', () => withdrawGymEvent(ev.id), 'Back in your drafts'), busy: 'withdraw' }],
        },
        rejected: {
            title: 'POWR asked for a change',
            body: ev.review_note ? `“${ev.review_note}”` : 'Edit it and send it again.',
            actions: canRun ? [{ label: 'Send again', fn: publish, primary: true, busy: 'publish' }]
                : [{ label: 'Publishing needs Clash+', fn: () => navigate('/venue/package'), primary: true, busy: 'none' }],
        },
        scheduled: {
            title: 'Scheduled',
            body: `Members can see it and join now. Scoring starts ${fmtDay(ev.window_start_at)}.`,
            actions: early ? [{ label: 'Cancel event', fn: cancel, busy: 'cancel' }] : [],
        },
        live: {
            title: 'Live',
            body: `Scoring until the end of ${lastDay(ev.window_end_at)}. The board seals after that${ev.doors_open_at ? `, and you reveal it at the finale night (${fmtDayTime(ev.doors_open_at)})` : ''}.`,
            actions: [],
        },
        locked: {
            title: 'Board sealed',
            body: `Reveal the winners when you're ready — the app and your screen flip together.${ev.auto_reveal_at ? ` If nobody does, POWR reveals it ${fmtDayTime(ev.auto_reveal_at)}.` : ''}`,
            actions: [{ label: 'Reveal the winners', fn: reveal, primary: true, busy: 'reveal' }],
        },
        revealed: {
            title: 'Winners revealed',
            body: `Revealed ${fmtDayTime(ev.revealed_at)}. Winners show their POWR ID at the front desk to collect their prize.`,
            actions: [],
        },
        settled: { title: 'Finished', body: 'Thanks for running it. Run it again any time from your events.', actions: [] },
        cancelled: { title: 'Cancelled', body: 'It no longer shows in the app.', actions: [] },
        pulled: { title: 'Pulled by POWR', body: ev.review_note ? `“${ev.review_note}” Get in touch if you have questions.` : 'Get in touch if you have questions.', actions: [] },
    }[k];

    const sealed = ['live', 'locked'].includes(ev.status);

    return (
        <Page>
            <Link to="/venue/events" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                <ArrowLeft size={13} className="text-[#BBBBBB]" /><span className="text-[#BBBBBB] hover:text-[#8a7600]">Events</span>
            </Link>

            <div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <StatusPill ev={ev} />
                    {ev.template?.name && <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{ev.template.name}</span>}
                    {ev.managed_by === 'powr' && <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">Run by POWR</span>}
                </div>
                <h1 className="text-4xl sm:text-5xl font-light tracking-tighter leading-[0.95]">{ev.name}</h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-3">{scoringRange(ev)}</p>
            </div>

            {next && ev.managed_by === 'gym' && (
                <Card className="p-6 sm:p-8" glow={k === 'locked' || k === 'draft'}>
                    <Micro gold>What happens next</Micro>
                    <div className="text-2xl font-light tracking-tight mt-3">{next.title}</div>
                    <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">{next.body}</p>
                    {next.actions.length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-6">
                            {next.actions.map(a => (
                                <button key={a.label} type="button" onClick={a.fn} disabled={!!busy} className={a.primary ? BTN_GOLD : BTN_GHOST}>
                                    {busy === a.busy ? 'Working…' : a.label}
                                </button>
                            ))}
                        </div>
                    )}
                    {editable && ev.status === 'locked' && (
                        <div className="mt-8 pt-6 border-t border-[#F0F0EC]">
                            <Micro className="mb-3">Or reveal it automatically at</Micro>
                            <div className="flex flex-wrap items-center gap-3">
                                <input type="datetime-local" className={`${INPUT} max-w-xs`} value={revealAt}
                                    min={toLocalInput(ev.lock_at)} onChange={e => setRevealAt(e.target.value)} />
                                {(revealAt || ev.reveal_at) && (
                                    <button type="button" onClick={saveRevealAt} disabled={!!busy} className={BTN_GHOST}>{revealAt ? 'Schedule' : 'Clear'}</button>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {board && (
                <Card className="p-6 sm:p-8">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-6">
                        <div className="flex items-center gap-3"><Trophy size={15} className="text-[#8a7600]" /><Micro>{board.frozen ? 'Final results' : 'Leaderboard'}</Micro></div>
                        {sealed && ev.status === 'locked' && <span className="text-[10px] font-bold text-violet-700">Only your team sees this until you reveal</span>}
                    </div>
                    {board.rows.length === 0 ? (
                        <p className="text-sm text-[#888] font-light">Nobody’s scored yet.</p>
                    ) : (
                        <div className="divide-y divide-[#F0F0EC]">
                            {board.rows.map(row => (
                                <div key={row.user_id} className="flex items-center gap-4 py-3">
                                    <span className="w-6 text-[13px] font-black text-[#BBBBBB] tabular-nums">{row.rank}</span>
                                    <Avatar row={row} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold truncate">{boardName(row)}</div>
                                        {row.prize && <div className="text-[10px] font-bold text-[#8a7600] truncate">{row.prize}</div>}
                                    </div>
                                    <span className="text-lg font-light tabular-nums text-[#8a7600]">{fmtNum(row.points)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {roster && (
                <Card className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-6"><Users size={15} className="text-[#8a7600]" /><Micro>Who’s in · {ev.participants}</Micro></div>
                    {roster.length === 0 ? (
                        <p className="text-sm text-[#888] font-light">Nobody’s joined yet. Share the link below with your members.</p>
                    ) : (
                        <div className="divide-y divide-[#F0F0EC]">
                            {roster.map(row => (
                                <div key={row.user_id} className={`flex items-center gap-4 py-3 ${row.disqualified ? 'opacity-50' : ''}`}>
                                    <Avatar row={row} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold truncate">{boardName(row)}{row.disqualified ? ' · removed' : ''}</div>
                                        <div className="text-[10px] font-bold text-[#AAAAAA]">POWR ID {row.member_id ?? '—'} · joined {fmtDay(row.joined_at)}</div>
                                    </div>
                                    {editable && (
                                        row.disqualified
                                            ? <button type="button" disabled={!!busy} onClick={() => reinstate(row)} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600]">Put back</button>
                                            : <button type="button" disabled={!!busy} onClick={() => disqualify(row)} className="text-[9px] uppercase tracking-[0.2em] font-black text-red-500/60 hover:text-red-500">Remove</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            <Card className="p-6 sm:p-8">
                <div className="flex items-center justify-between gap-3 mb-6">
                    <div className="flex items-center gap-3"><Sparkles size={15} className="text-[#8a7600]" /><Micro>Details</Micro></div>
                    {canEdit && (
                        <Link to={`/venue/events/${ev.id}/edit`} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                            <Pencil size={12} className="text-[#8a7600]" /><span className="text-[#8a7600]">{early ? 'Edit' : 'Edit words and pictures'}</span>
                        </Link>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4 text-[13px]">
                        <div><Micro className="mb-1">Scoring</Micro>{scoringRange(ev)}</div>
                        {ev.doors_open_at && <div><Micro className="mb-1">Finale night</Micro>{fmtDay(ev.doors_open_at)}, {ukTime(ev.doors_open_at)}{ev.doors_close_at ? `–${ukTime(ev.doors_close_at)}` : ''}</div>}
                        <div><Micro className="mb-1">Board seals</Micro>{fmtDayTime(ev.lock_at)}</div>
                        <div><Micro className="mb-1">What counts</Micro>{whatCounts(ev, gym.name)}{ev.board_size ? ` · top ${ev.board_size} on the board` : ''}</div>
                        {ev.attendance_bonus_points > 0 && <div><Micro className="mb-1">Finale bonus</Micro>+{ev.attendance_bonus_points} POWR for everyone who comes{ev.attendance_paid_at ? ' · paid' : ''}</div>}
                        <div><Micro className="mb-1">Shown to</Micro>Your members and recent visitors{ev.audience_radius_km ? `, plus anyone within ${ev.audience_radius_km} km` : ''}</div>
                        {ev.promo_headline && <div><Micro className="mb-1">Headline</Micro>{ev.promo_headline}</div>}
                        {ev.booking_url && <div className="min-w-0"><Micro className="mb-1">Booking link</Micro><span className="block truncate">{ev.booking_url}</span></div>}
                        {(ev.logo_url || ev.promo_media_url) && (
                            <div className="flex items-center gap-3 pt-1">
                                {ev.logo_url && <span className="inline-flex items-center px-3 py-2 rounded-xl bg-[#141414]"><img src={storageImage(ev.logo_url, 200)} alt="Event logo" className="h-7 w-20 object-contain" /></span>}
                                {ev.promo_media_url && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(ev.promo_media_url) && <img src={storageImage(ev.promo_media_url, 240)} alt="" className="h-12 aspect-video rounded-xl object-cover border border-[#E6E6E1]" />}
                            </div>
                        )}
                    </div>
                    <div className="space-y-6 text-[13px]">
                        <div>
                            <Micro className="mb-2">Prizes</Micro>
                            <ol className="space-y-1.5">
                                {(ev.prizes ?? []).map(p => (
                                    <li key={p.rank} className="flex items-center gap-3">
                                        <span className="w-4 font-black text-[#BBBBBB]">{p.rank}</span>
                                        {p.image_url && <img src={storageImage(p.image_url, 80)} alt="" className="w-7 h-7 rounded-lg object-cover" />}
                                        <span>{p.label}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                        <div>
                            <Micro className="mb-2">Rules</Micro>
                            <ul className="space-y-1 text-[#666]">{(ev.rules ?? []).map((r, i) => <li key={i}>· {r}</li>)}</ul>
                        </div>
                    </div>
                </div>
            </Card>

            {ev.managed_by === 'gym' && ev.status !== 'draft' && k !== 'cancelled' && k !== 'pulled' && (
                <EventPushes ev={ev} gymName={gym.name} toast={toast} />
            )}

            {ev.managed_by === 'gym' && k !== 'cancelled' && k !== 'pulled' && (
                <EventContent ev={ev} venue={{ name: gym.name, address }} canPost={canPost} />
            )}

            {ev.status !== 'draft' && k !== 'cancelled' && k !== 'pulled' && (
                <Card className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-6"><Tv size={15} className="text-[#8a7600]" /><Micro>Screen and sharing</Micro></div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                            <CopyRow label="Event board for your TV" url={screenUrl} toast={toast} />
                            <CopyRow label="Page to share with members" url={promoUrl} toast={toast} />
                            <p className="text-[11px] text-[#AAAAAA] leading-relaxed">
                                The TV board counts down, shows the live standings, holds a sealed screen once the board seals, then plays the
                                podium the moment you reveal. The share page and the QR open the event in the POWR app, or the app store for someone new.
                            </p>
                        </div>
                        <div className="flex flex-col items-center gap-3">
                            <div className="p-4 bg-white border border-[#E6E6E1] rounded-2xl"><QRCodeSVG value={registerUrl} size={148} level="M" /></div>
                            <span className="text-[10px] text-[#AAAAAA] text-center">Scan to join · print it for the front desk</span>
                        </div>
                    </div>
                </Card>
            )}

            {/* On a phone at the front desk, Reveal is always in reach. */}
            {k === 'locked' && editable && (
                <div className="lg:hidden fixed left-0 right-0 bottom-16 z-30 px-5 pb-3 pointer-events-none">
                    <button type="button" onClick={reveal} disabled={!!busy} className={`${BTN_GOLD} w-full shadow-xl pointer-events-auto`}>
                        {busy === 'reveal' ? 'Revealing…' : 'Reveal the winners'}
                    </button>
                </div>
            )}
        </Page>
    );
}
