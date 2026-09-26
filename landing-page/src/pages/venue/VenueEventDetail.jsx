import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Copy, Download, ExternalLink, Trophy, Users, Tv, Search, Smartphone, Sparkles, Pencil, Printer, X } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, Spinner, Empty, BTN_GOLD, BTN_GHOST, INPUT, fmtNum } from '../../components/portal/ui';
import {
    cancelGymEvent, deleteGymEvent, disqualifyFromGymEvent, fetchGymEvent, fetchGymEventBoard,
    fetchGymEventRoster, fetchGymSummary, publishGymEvent, reinstateInGymEvent, revealGymEvent,
    scheduleGymReveal, setPrizeHanded, withdrawGymEvent,
} from './venueApi';
import { StatusPill, statusKey, scoringRange, fmtDay, fmtDayTime, lastDay, toLocalInput, fromLocalInput, whatCounts } from './eventUi';
import { boardName } from '../../../../shared/gymBoard.ts';
import { storageImage } from '../../lib/storage';
import { ukTime } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import { eventRegisterUrl } from '../../lib/eventRegisterUrl';
import EventPushes from './EventPushes';
import EventContent from './EventContent';
import EventDoor, { doorApplies } from './EventDoor';
import EventAppPreview from '../../components/EventAppPreview';
import { usePackage } from './packages';

// One event, run from a phone at the front desk as easily as from a laptop.
// A header says where it stands and holds the one button that moves it on;
// tabs hold the rest: the board, the people (and the door on a finale
// night), the details, and everything that promotes it.

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

/** Removing someone is serious: a reason, said plainly, and what it does. */
function RemoveDialog({ row, eventName, busy, onCancel, onConfirm }) {
    const [reason, setReason] = useState('');
    const ok = reason.trim().length >= 3 && reason.trim().length <= 200;
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);
    return createPortal(
        <div className="fixed inset-0 z-[1000] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel} role="dialog" aria-modal="true" aria-label={`Remove ${boardName(row)}`}>
            <div className="w-full max-w-md bg-white rounded-[2rem] p-6 sm:p-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Micro gold>Remove from the event</Micro>
                        <div className="text-2xl font-light tracking-tight mt-2">{boardName(row)}</div>
                    </div>
                    <button type="button" onClick={onCancel} aria-label="Close" className="w-9 h-9 rounded-full bg-[#F4F4F1] flex items-center justify-center text-[#666]"><X size={14} /></button>
                </div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-3">
                    They drop off the board of {eventName} and their points in it no longer count. Their POWR account isn’t touched, and you can put them back. POWR sees the reason.
                </p>
                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-5 mb-2">Why</label>
                <textarea className={`${INPUT} h-auto py-3 min-h-[88px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Logged sessions they didn’t do" autoFocus />
                <div className="flex flex-wrap justify-end gap-3 mt-5">
                    <button type="button" onClick={onCancel} className={BTN_GHOST}>Keep them in</button>
                    <button type="button" disabled={!ok || busy} onClick={() => onConfirm(reason.trim())} className={`${BTN_GOLD} bg-red-500 text-white hover:shadow-none`}>{busy ? 'Removing…' : 'Remove'}</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

const TABS = { board: 'Board', people: 'People', details: 'Details', promote: 'Promote' };

export default function VenueEventDetail() {
    const { id } = useParams();
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    // An admin previewing a gym looks; changes go through the admin pages.
    const previewOnly = () => { if (!isActingGym) return false; toast.error('Preview only. Change a gym’s event from the admin pages.'); return true; };
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
    const [removing, setRemoving] = useState(null);   // roster row in the dialog
    const [q, setQ] = useState('');                    // People: find someone
    const [who, setWho] = useState('all');             // People: all | members | guests | removed

    const loadSide = useCallback(async (e) => {
        if (e.status === 'draft') { setBoard(null); setRoster(null); return; }
        const [b, r] = await Promise.all([fetchGymEventBoard(e.id).catch(() => null), fetchGymEventRoster(e.id).catch(() => null)]);
        setBoard(b);
        setRoster(r ?? []);
    }, []);

    const load = useCallback(async () => {
        setError(null);
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

    const k = ev ? statusKey(ev) : null;
    const isDraft = ev?.status === 'draft';
    const powrRun = ev?.managed_by === 'powr';
    const tabs = useMemo(() => {
        if (!ev) return [];
        if (isDraft) return ['details', 'promote'];
        return ['board', 'people', 'details', 'promote'];
    }, [ev, isDraft]);
    // Where the page opens: the board once there is one, the door on a finale
    // night, the details for a draft.
    const defaultTab = !ev ? 'details' : isDraft ? 'details' : doorApplies(ev) ? 'people' : ['scheduled', 'pending', 'rejected'].includes(k) ? 'promote' : 'board';
    const tab = tabs.includes(params.get('tab')) ? params.get('tab') : defaultTab;
    const setTab = (t) => setParams(t === defaultTab ? {} : { tab: t }, { replace: true });

    // People, narrowed. A guest joined without having picked this gym in the app.
    const guests = (roster ?? []).filter((r) => r.guest && !r.disqualified).length;
    const removedCount = (roster ?? []).filter((r) => r.disqualified).length;
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return (roster ?? []).filter((r) => {
            if (who === 'members' && (r.guest || r.disqualified)) return false;
            if (who === 'guests' && (!r.guest || r.disqualified)) return false;
            if (who === 'removed' && !r.disqualified) return false;
            if (!needle) return true;
            return [boardName(r), r.username, r.member_id].some((s) => String(s ?? '').toLowerCase().includes(needle));
        });
    }, [roster, q, who]);

    if (error) return <Empty title="Couldn’t load this event" action={<button type="button" onClick={load} className={BTN_GHOST}>Try again</button>}>{error}</Empty>;
    if (!ev) return <Spinner />;

    const editable = ev.editable && !['revealed', 'settled', 'cancelled', 'pulled'].includes(k);
    const early = ev.status === 'draft' || (ev.status === 'scheduled' && new Date(ev.window_start_at) > new Date());
    const canEdit = editable && (early || ev.status === 'live');
    const origin = window.location.origin;
    const screenUrl = `${origin}/live/${ev.slug}?k=${ev.display_token}`;
    const promoUrl = `https://powr.life/promo/${ev.slug}`;
    const registerUrl = eventRegisterUrl(ev.slug);
    const over = ['revealed', 'settled', 'archived'].includes(ev.status);

    const act = async (label, fn, ok, after) => {
        if (previewOnly()) return;
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

    const disqualify = async (row, reason) => {
        if (previewOnly()) return;
        setBusy(`dq:${row.user_id}`);
        try {
            setRoster(await disqualifyFromGymEvent(ev.id, row.user_id, reason));
            setRemoving(null);
            toast.success('Removed from the event');
            loadSide(ev);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };
    const reinstate = async (row) => {
        if (previewOnly()) return;
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
    // An A4 sheet for the front desk: the QR big, the event, the gym, what to do.
    const printQr = () => {
        const svg = document.querySelector('#event-qr svg')?.outerHTML;
        if (!svg) return;
        const w = window.open('', '_blank', 'noopener,width=800,height=1000');
        if (!w) { toast.error('Allow pop-ups to print'); return; }
        const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ev.name)} · join</title>
<style>@page{size:A4;margin:18mm}body{margin:0;font-family:Outfit,system-ui,sans-serif;color:#111;text-align:center}
.k{font-size:11px;letter-spacing:.35em;text-transform:uppercase;font-weight:900;color:#8a7600}h1{font-size:44px;font-weight:300;letter-spacing:-.03em;margin:14px 0 6px}
.g{font-size:14px;letter-spacing:.2em;text-transform:uppercase;font-weight:900;color:#888;margin-bottom:34px}svg{width:118mm;height:118mm}
.l{font-size:22px;font-weight:300;margin-top:34px}.s{font-size:12px;color:#888;margin-top:10px}</style></head>
<body><div class="k">Live event</div><h1>${esc(ev.name)}</h1><div class="g">${esc(gym.name)}</div>${svg}
<div class="l">Scan to join in the POWR app</div><div class="s">${esc(scoringRange(ev))}${ev.prizes?.[0]?.label ? ` · ${esc(ev.prizes[0].label)} for 1st` : ''}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`);
        w.document.close();
    };

    const handPrize = async (p, handed) => {
        if (previewOnly()) return;
        setBusy(`prize:${p.rank}`);
        try {
            const prizes = await setPrizeHanded(ev.id, p.rank, handed);
            setEv((e) => ({ ...e, prizes }));
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    // The roster as a spreadsheet: what the page shows, nothing more.
    const exportPeople = () => {
        const head = ['Name', 'Username', 'POWR ID', 'Joined', 'Member or guest', 'Removed'];
        const rows = (roster ?? []).map((r) => [boardName(r), r.username ?? '', r.member_id ?? '', String(r.joined_at ?? '').slice(0, 10), r.guest ? 'Guest' : 'Member', r.disqualified ? 'Yes' : '']);
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
        a.download = `POWR - ${ev.name} - people.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
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
            body: `Revealed ${fmtDayTime(ev.revealed_at)}. Winners show their POWR ID at the front desk to collect their prize; tick each one off under Details.`,
            actions: [{ label: 'Run it again', fn: () => navigate(`/venue/events/new?from=${ev.id}`), busy: 'none' }],
        },
        settled: { title: 'Finished', body: 'Thanks for running it. The same set-up is one click away.', actions: [{ label: 'Run it again', fn: () => navigate(`/venue/events/new?from=${ev.id}`), primary: true, busy: 'none' }] },
        cancelled: { title: 'Cancelled', body: 'It no longer shows in the app.', actions: [] },
        pulled: { title: 'Pulled by POWR', body: ev.review_note ? `“${ev.review_note}” Get in touch if you have questions.` : 'Get in touch if you have questions.', actions: [{ label: 'Email POWR', fn: () => { window.location.href = `mailto:support@powr.life?subject=${encodeURIComponent(`${ev.name} was pulled`)}`; }, busy: 'none' }] },
    }[k];

    const sealed = ['live', 'locked'].includes(ev.status);
    const leader = board?.rows?.[0];
    // A partner prize is handed over the moment its code is issued.
    const prizesHanded = (ev.prizes ?? []).filter((p) => p.handed_at || p.issued).length;

    // The numbers a glance wants, by state.
    const facts = [];
    if (!isDraft) facts.push([String(ev.participants ?? 0), 'in']);
    if (!isDraft && guests > 0) facts.push([String(guests), guests === 1 ? 'guest' : 'guests']);
    if (leader && !ev.status.startsWith('locked')) facts.push([boardName(leader), sealed && ev.status === 'locked' ? 'leads, sealed' : over ? 'won' : 'leads']);
    if (ev.status === 'live') facts.push([lastDay(ev.window_end_at), 'last day']);
    if (ev.status === 'scheduled') facts.push([fmtDay(ev.window_start_at), 'starts']);
    if (ev.doors_open_at && !over) facts.push([`${fmtDay(ev.doors_open_at)} ${ukTime(ev.doors_open_at)}`, 'finale']);
    if ((ev.prizes ?? []).length) facts.push([over ? `${prizesHanded} of ${ev.prizes.length}` : String(ev.prizes.length), over ? 'prizes handed over' : 'prizes']);

    return (
        <Page>
            <Link to="/venue/events" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                <ArrowLeft size={13} className="text-[#BBBBBB]" /><span className="text-[#BBBBBB] hover:text-[#8a7600]">Events</span>
            </Link>

            <div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <StatusPill ev={ev} />
                    {ev.template?.name && <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{ev.template.name}</span>}
                    {powrRun && <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">Run by POWR</span>}
                </div>
                <h1 className="text-4xl sm:text-5xl font-light tracking-tighter leading-[0.95]">{ev.name}</h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-3">{scoringRange(ev)}</p>
                {facts.length > 0 && (
                    <div className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
                        {facts.map(([v, l]) => (
                            <div key={l}>
                                <div className="text-xl font-light tracking-tight text-[#1A1A1A] truncate max-w-[14rem]">{v}</div>
                                <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] mt-0.5">{l}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {powrRun && (
                <Card className="p-6 sm:p-8">
                    <Micro gold>Run by POWR at your gym</Micro>
                    <p className="text-[13px] text-[#777] leading-relaxed mt-3 max-w-2xl">POWR wrote it, sends the notifications and reveals the results. You can see who’s in, follow the board, and put it on your TV.</p>
                </Card>
            )}

            {next && !powrRun && (
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

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[#E6E6E1] -mx-1 overflow-x-auto" role="tablist" aria-label="Parts of this event" style={{ scrollbarWidth: 'none' }}>
                {tabs.map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} aria-label={`Tab: ${TABS[t]}`} onClick={() => setTab(t)}
                        className={`px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === t ? 'border-[#E8D200] text-[#1A1A1A]' : 'border-transparent text-[#AAAAAA] hover:text-[#1A1A1A]'}`}>
                        {TABS[t]}{t === 'people' && doorApplies(ev) ? ' · door' : ''}
                    </button>
                ))}
            </div>

            {tab === 'board' && (
                board ? (
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
                ) : <Card className="p-6 sm:p-8"><p className="text-sm text-[#888] font-light">The board appears once the event is published.</p></Card>
            )}

            {tab === 'people' && (
                <>
                    {doorApplies(ev) && <EventDoor ev={ev} toast={toast} />}
                    {roster && (
                        <Card className="p-6 sm:p-8">
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6">
                                <div className="flex items-center gap-3"><Users size={15} className="text-[#8a7600]" /><Micro>Who’s in · {ev.participants}</Micro></div>
                                {roster.length > 0 && (
                                    <button type="button" onClick={exportPeople} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]"><Download size={12} /> Export</button>
                                )}
                            </div>
                            {roster.length === 0 ? (
                                <p className="text-sm text-[#888] font-light">Nobody’s joined yet. Share the link under Promote with your members.</p>
                            ) : (
                                <>
                                    {(roster.length > 5 || guests > 0 || removedCount > 0) && (
                                        <div className="flex flex-wrap items-center gap-3 mb-5">
                                            {roster.length > 5 && (
                                                <div className="relative">
                                                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                                                    <input className={`${INPUT} h-10 pl-9 w-56`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find someone" />
                                                </div>
                                            )}
                                            {(guests > 0 || removedCount > 0) && (
                                                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Show">
                                                    {[['all', 'Everyone'], ['members', 'Members'], ...(guests > 0 ? [['guests', `Guests · ${guests}`]] : []), ...(removedCount > 0 ? [['removed', 'Removed']] : [])].map(([k, label]) => (
                                                        <button key={k} type="button" role="radio" aria-checked={who === k} onClick={() => setWho(k)}
                                                            className={`h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-all ${who === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {guests > 0 && <p className="text-[11px] text-[#AAAAAA] mb-4">A guest joined without having picked {gym.name} as their gym in the app: worth a word at the front desk.</p>}
                                    {shown.length === 0 && <p className="text-sm text-[#888] font-light">Nobody matches.</p>}
                                    <div className="divide-y divide-[#F0F0EC]">
                                        {shown.map(row => (
                                            <div key={row.user_id} className={`flex items-center gap-4 py-3 ${row.disqualified ? 'opacity-50' : ''}`}>
                                                <Avatar row={row} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[13px] font-bold truncate">
                                                        {boardName(row)}{row.disqualified ? ' · removed' : ''}
                                                        {row.guest && !row.disqualified && <span className="ml-2 inline-flex items-center h-5 px-2 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[8px] font-black uppercase tracking-[0.2em] text-[#888] align-middle">Guest</span>}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-[#AAAAAA]">POWR ID {row.member_id ?? '—'} · joined {fmtDay(row.joined_at)}</div>
                                                </div>
                                                {editable && !powrRun && (
                                                    row.disqualified
                                                        ? <button type="button" disabled={!!busy} onClick={() => reinstate(row)} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600]">Put back</button>
                                                        : <button type="button" disabled={!!busy} onClick={() => setRemoving(row)} className="text-[9px] uppercase tracking-[0.2em] font-black text-red-500/60 hover:text-red-500">Remove</button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </Card>
                    )}
                </>
            )}

            {tab === 'details' && (
                <Card className="p-6 sm:p-8">
                    <div className="flex items-center justify-between gap-3 mb-6">
                        <div className="flex items-center gap-3"><Sparkles size={15} className="text-[#8a7600]" /><Micro>Details</Micro></div>
                        {canEdit && !powrRun && (
                            <Link to={`/venue/events/${ev.id}/edit`} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                                <Pencil size={12} className="text-[#8a7600]" /><span className="text-[#8a7600]">{early ? 'Edit' : 'Edit words and pictures'}</span>
                            </Link>
                        )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4 text-[13px]">
                            <div><Micro className="mb-1">Scoring</Micro>{scoringRange(ev)}</div>
                            {ev.doors_open_at && <div><Micro className="mb-1">Finale night</Micro>{fmtDay(ev.doors_open_at)}, {ukTime(ev.doors_open_at)}{ev.doors_close_at ? `–${ukTime(ev.doors_close_at)}` : ''} <span className="text-[#AAAAAA]">· UK time</span></div>}
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
                                <Micro className="mb-2">Prizes{over && !powrRun ? ' · tick each one when it’s handed over' : ''}</Micro>
                                <ol className="space-y-2">
                                    {(ev.prizes ?? []).map(p => (
                                        <li key={p.rank} className="flex items-start gap-3">
                                            {over && !powrRun && !p.reward_id
                                                ? <input type="checkbox" checked={!!p.handed_at} disabled={busy === `prize:${p.rank}`} onChange={(e) => handPrize(p, e.target.checked)} className="accent-[#E8D200] w-4 h-4 mt-0.5" aria-label={`Prize ${p.rank} handed over`} />
                                                : <span className="w-4 font-black text-[#BBBBBB]">{p.rank}</span>}
                                            {p.image_url && <img src={storageImage(p.image_url, 80)} alt="" className="w-7 h-7 rounded-lg object-cover" />}
                                            <span className="min-w-0">
                                                <span className={p.handed_at ? 'line-through text-[#AAAAAA]' : ''}>{over ? `${p.rank}. ` : ''}{p.label}</span>
                                                {p.handed_at && <span className="ml-2 text-[10px] font-bold text-[#0B7A57]">handed over {fmtDay(p.handed_at)}</span>}
                                                {p.reward && <span className="block text-[10px] font-bold text-[#8a7600]">POWR partner prize · {p.reward.brand_name}</span>}
                                                {p.issued && (
                                                    <span className="block text-[10px] font-bold text-[#0B7A57]">
                                                        In {p.issued.name ?? 'the winner'}’s Wallet since {fmtDay(p.issued.issued_at)} · code <code className="font-mono text-[11px] text-[#1A1A1A]">{p.issued.code}</code>
                                                    </span>
                                                )}
                                                {p.reward_id && over && !p.issued && <span className="block text-[10px] font-bold text-[#B45309]">No code was left for this prize. Email support@powr.life and we’ll sort it.</span>}
                                            </span>
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
            )}

            {tab === 'promote' && (
                <>
                    {!powrRun && k !== 'cancelled' && k !== 'pulled' && <EventPushes ev={ev} gymName={gym.name} toast={toast} />}
                    {!powrRun && k !== 'cancelled' && k !== 'pulled' && <EventContent ev={ev} venue={{ name: gym.name, address }} canPost={canPost} />}
                    {!isDraft && k !== 'cancelled' && k !== 'pulled' && (
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
                                    <div id="event-qr" className="p-4 bg-white border border-[#E6E6E1] rounded-2xl"><QRCodeSVG value={registerUrl} size={148} level="M" /></div>
                                    <button type="button" onClick={printQr} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
                                        <Printer size={12} /> Print it for the front desk
                                    </button>
                                </div>
                            </div>
                        </Card>
                    )}
                    {isDraft && <p className="text-[12px] text-[#AAAAAA]">The TV board, the share page and the join QR appear here once the event is published.</p>}
                    {k !== 'cancelled' && k !== 'pulled' && (
                        <Card className="p-6 sm:p-8">
                            <div className="flex items-center gap-3 mb-6"><Smartphone size={15} className="text-[#8a7600]" /><Micro>In the app</Micro></div>
                            <EventAppPreview
                                event={{ ...ev, status: ev.status === 'live' ? 'live' : 'scheduled', rules: ev.rules ?? [], prizes: ev.prizes ?? [] }}
                                venue={{ name: gym.name, logo_url: gym.logo_url ?? null, logo_bg: gym.logo_bg ?? null }}
                                pageTheme="light"
                            />
                        </Card>
                    )}
                </>
            )}

            {removing && (
                <RemoveDialog row={removing} eventName={ev.name} busy={busy === `dq:${removing.user_id}`} onCancel={() => setRemoving(null)} onConfirm={(reason) => disqualify(removing, reason)} />
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
