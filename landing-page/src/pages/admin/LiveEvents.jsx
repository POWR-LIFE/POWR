import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Link } from 'react-router-dom';
import {
    PartyPopper, Plus, Copy, Save, Trash2, Search, X, Check,
    CalendarClock, Eye, EyeOff, Lock, Flag, Trophy, Archive,
    Link2, RefreshCw, AlertTriangle, Rocket, Undo2,
    Gauge, Download, UserX, UserCheck, ShieldAlert,
    Megaphone, Upload, ExternalLink, QrCode, Smartphone, Users, TicketCheck,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import { validateHeroVideoUrl } from '../../lib/heroVideoUrl';
import MediaVideo from '../../components/MediaVideo';
import { eventRegisterUrl } from '../../lib/eventRegisterUrl';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

// Every session type the app writes. Scoring defaults exclude sleep
// ("you have to train"); conversion defaults also exclude walking + sleep
// (wearables auto-create those — see the ticket-2 migration).
const ACTIVITIES = ['gym', 'running', 'cycling', 'hiit', 'yoga', 'swimming', 'sports', 'dance', 'walking', 'sleep'];
const VERIFICATIONS = ['geofence', 'wearable'];

const STATUS_META = {
    draft:     { color: '#9CA3AF', label: 'Draft' },
    scheduled: { color: '#3B82F6', label: 'Scheduled' },
    live:      { color: '#10B981', label: 'Live' },
    locked:    { color: '#F97316', label: 'Locked' },
    revealed:  { color: '#8B5CF6', label: 'Revealed' },
    settled:   { color: '#14B8A6', label: 'Settled' },
    archived:  { color: '#6B7280', label: 'Archived' },
};

// datetime-local speaks the browser's local time (admins run this from
// London, which is exactly the timezone the spec pins the window to).
const isoToLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (local) => (local ? new Date(local).toISOString() : null);

const newToken = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const fmtDT = (iso) => iso
    ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

// Editor working copy: exactly the columns the editor owns. Status, hidden,
// display_token and revealed_at are managed by the lifecycle panel instead —
// keeping them out of the Save payload means an in-progress edit can never
// accidentally revert a status change made in between.
const editableFields = (ev) => ({
    name: ev.name,
    slug: ev.slug,
    logo_url: ev.logo_url,
    logo_only: ev.logo_only,
    venue_partner_id: ev.venue_partner_id,
    window_start_at: ev.window_start_at,
    window_end_at: ev.window_end_at,
    lock_at: ev.lock_at,
    eligibility_cutoff_at: ev.eligibility_cutoff_at,
    scope: ev.scope,
    board_size: ev.board_size,
    included_activities: ev.included_activities,
    count_manual: ev.count_manual,
    count_streak: ev.count_streak,
    count_walking: ev.count_walking,
    invite_bonus_points: ev.invite_bonus_points,
    invite_milestone_n: ev.invite_milestone_n,
    invite_milestone_bonus: ev.invite_milestone_bonus,
    conversion_deadline_at: ev.conversion_deadline_at,
    conversion_verifications: ev.conversion_verifications,
    conversion_activities: ev.conversion_activities,
    entry_gate_n: ev.entry_gate_n,
    entry_gate_counting: ev.entry_gate_counting,
    entry_gate_since: ev.entry_gate_since,
    booking_url: ev.booking_url,
    prizes: ev.prizes ?? [],
    // Kept as an ARRAY in form state (the textarea maps join/split at its
    // edge) so the JSON.stringify dirty comparison stays stable.
    rules: ev.rules ?? [],
    promo_media_url: ev.promo_media_url,
    promo_headline: ev.promo_headline,
});

export default function LiveEvents() {
    const toast = useToast();
    const { user } = useAuth();

    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [form, setForm] = useState(null);       // editable working copy
    const [saving, setSaving] = useState(false);
    const [acting, setActing] = useState(null);   // lifecycle action in flight
    const [counts, setCounts] = useState({ participants: 0, results: 0 });
    const [venueName, setVenueName] = useState(null);
    const [ops, setOps] = useState(null);          // admin_get_event_ops payload
    const [standings, setStandings] = useState(null); // through-blur board rows
    const [dqRows, setDqRows] = useState([]);      // disqualified users (off-board)
    const [dqBusy, setDqBusy] = useState(null);    // user_id of DQ action in flight
    const [anticheat, setAnticheat] = useState(null); // admin_get_event_anticheat payload
    const [registrations, setRegistrations] = useState(null); // admin_get_event_registrations payload
    const [bookings, setBookings] = useState(null);   // admin_get_event_bookings payload
    const [bookingsBusy, setBookingsBusy] = useState(false);
    const lastOpsEventId = useRef(null);           // guards against showing event A's ops data under event B

    const selected = useMemo(() => events.find(e => e.id === selectedId) ?? null, [events, selectedId]);
    const dirty = useMemo(() => {
        if (!selected || !form) return false;
        return JSON.stringify(editableFields(selected)) !== JSON.stringify(form);
    }, [selected, form]);

    useEffect(() => { fetchEvents(); }, []);

    useEffect(() => {
        if (!selected) { setForm(null); setVenueName(null); setOps(null); setStandings(null); setDqRows([]); setAnticheat(null); setRegistrations(null); setBookings(null); lastOpsEventId.current = null; return; }
        setForm(editableFields(selected));
        // Switching events must never show the previous event's ops data while
        // the new fetch is in flight; same-event refreshes keep what's there.
        if (selected.id !== lastOpsEventId.current) {
            lastOpsEventId.current = selected.id;
            setOps(null); setStandings(null); setDqRows([]); setAnticheat(null); setRegistrations(null); setBookings(null);
        }
        fetchCounts(selected.id);
        fetchOps(selected.id);
        fetchRegistrations(selected.id);
        fetchBookings(selected.id);
        if (selected.venue_partner_id) {
            supabase.from('partners').select('name').eq('id', selected.venue_partner_id).single()
                .then(({ data }) => setVenueName(data?.name ?? null));
        } else {
            setVenueName(null);
        }
    }, [selectedId, events]);   // eslint-disable-line react-hooks/exhaustive-deps

    const fetchEvents = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('live_events').select('*').order('window_start_at', { ascending: false });
        if (error) { toast.error('Failed to load events'); console.error(error); }
        setEvents(data || []);
        setLoading(false);
    };

    const fetchCounts = async (eventId) => {
        const [p, r] = await Promise.all([
            supabase.from('live_event_participants').select('*', { count: 'exact', head: true }).eq('event_id', eventId),
            supabase.from('live_event_results').select('*', { count: 'exact', head: true }).eq('event_id', eventId),
        ]);
        setCounts({ participants: p.count ?? 0, results: r.count ?? 0 });
    };

    // Roster + invite pipeline + bonus ledger — works at ANY status, drafts
    // included, so preview test runs are inspectable end-to-end.
    const fetchRegistrations = async (eventId) => {
        const { data, error } = await supabase.rpc('admin_get_event_registrations', { p_event_id: eventId });
        if (error) { console.error(error); setRegistrations(null); return; }
        setRegistrations(data);
    };

    // Booking reconciliation against the venue's own ticketing. Nothing here
    // is derived from POWR state — the venue's export is the input, and the
    // RPC returns the intersection plus both differences.
    const fetchBookings = async (eventId) => {
        const { data, error } = await supabase.rpc('admin_get_event_bookings', { p_event_id: eventId });
        if (error) { console.error(error); setBookings(null); return; }
        setBookings(data);
    };

    // Writing REPLACES the event's list — the export is authoritative at
    // upload time, so a corrected export is the fix for a bad one.
    const saveBookings = async (emails) => {
        if (!selected) return;
        setBookingsBusy(true);
        const { data, error } = await supabase.rpc('admin_set_event_bookings', {
            p_event_id: selected.id,
            p_emails: emails,
        });
        setBookingsBusy(false);
        if (error) { toast.error('Failed to save the booking list'); console.error(error); return; }
        setBookings(data);
        toast.success(`${data?.booked_total ?? 0} bookings saved`);
    };

    // Ops dashboard data: counts/funnel + the through-blur standings. Admin
    // RPCs see the board at any status, hidden or not — this is the list
    // whoever hands out prizes reads from.
    const fetchOps = async (eventId) => {
        // A failed report must read as "no report", never as the previous
        // one — stale vetting signals are worse than none.
        setAnticheat(null);
        const [opsRes, boardRes, acRes, dqRes] = await Promise.all([
            supabase.rpc('admin_get_event_ops', { p_event_id: eventId }),
            supabase.rpc('admin_get_event_leaderboard', { p_event_id: eventId }),
            supabase.rpc('admin_get_event_anticheat', { p_event_id: eventId }),
            // Disqualified users drop out of the scorer (that's the point), so
            // the requalify path needs its own list.
            supabase.from('live_event_participants')
                .select('user_id, disqualified_at, profiles:user_id (display_name, username)')
                .eq('event_id', eventId)
                .not('disqualified_at', 'is', null),
        ]);
        if (!opsRes.error) setOps(opsRes.data);
        if (!boardRes.error) setStandings(boardRes.data?.standings ?? []);
        if (!acRes.error) setAnticheat(acRes.data);
        if (!dqRes.error) {
            setDqRows((dqRes.data ?? []).map(r => ({
                user_id: r.user_id,
                disqualified_at: r.disqualified_at,
                display_name: r.profiles?.display_name ?? null,
                username: r.profiles?.username ?? null,
            })));
        }
    };

    const disqualify = async (ev, row, disqualified) => {
        const verb = disqualified ? 'Disqualify' : 'Requalify';
        if (!window.confirm(`${verb} ${row.display_name ?? row.username ?? 'this member'} ${disqualified ? 'from' : 'for'} this event? Event-scoped only — their points are untouched.${disqualified && counts.results > 0 ? ' Re-settle afterwards so the frozen results drop them too.' : ''}`)) return;
        setDqBusy(row.user_id);
        const { error } = await supabase.rpc('admin_disqualify_from_event', {
            p_event_id: ev.id, p_user_id: row.user_id, p_disqualified: disqualified,
        });
        setDqBusy(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, disqualified ? 'live_event_disqualify' : 'live_event_requalify', 'live_event', ev.id, { target_user: row.user_id });
        toast.success(`${row.display_name ?? row.username ?? 'Member'} ${disqualified ? 'disqualified' : 'requalified'}`);
        fetchOps(ev.id);
        fetchCounts(ev.id);
    };

    const exportCsv = (ev) => {
        const header = 'rank,name,username,points,last_counted,sessions,geofence,wearable,manual,flagged,disqualified';
        const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        const lines = (standings ?? []).map(r => [
            r.rank, q(r.display_name ?? ''), q(r.username ?? ''), r.points,
            q(r.last_counted_tx_at ?? ''), r.sessions_in_window, r.geofence_sessions,
            r.wearable_sessions, r.manual_sessions, r.flagged_sessions, r.disqualified,
        ].join(','));
        const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${ev.slug}-standings.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // ── Create / duplicate / save ─────────────────────────────

    const createEvent = async () => {
        const start = new Date(); start.setDate(start.getDate() + 14); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 4);
        const { data, error } = await supabase.from('live_events').insert({
            name: 'New event',
            slug: `event-${Date.now().toString(36)}`,
            status: 'draft',
            window_start_at: start.toISOString(),
            window_end_at: end.toISOString(),
            created_by: user.id,
        }).select().single();
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_create', 'live_event', data.id, {});
        toast.success('Draft event created');
        await fetchEvents();
        setSelectedId(data.id);
    };

    const duplicateEvent = async (ev) => {
        const copy = { ...editableFields(ev) };
        const { data, error } = await supabase.from('live_events').insert({
            ...copy,
            name: `${ev.name} (copy)`,
            slug: `${ev.slug}-copy-${Date.now().toString(36).slice(-4)}`,
            status: 'draft',
            created_by: user.id,
        }).select().single();
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_duplicate', 'live_event', data.id, { source: ev.id });
        toast.success('Event duplicated as draft');
        await fetchEvents();
        setSelectedId(data.id);
    };

    const saveForm = async () => {
        if (!selected || !form) return;
        if (!form.name.trim() || !form.slug.trim()) { toast.error('Name and slug are required'); return; }
        if (new Date(form.window_end_at) <= new Date(form.window_start_at)) {
            toast.error('Window end must be after window start'); return;
        }
        if (form.promo_media_url) {
            // Same rule as reward heroes: direct files only, never a
            // YouTube/Vimeo-style page link (images sail through).
            const { error: mediaError, warn: mediaWarn } = validateHeroVideoUrl(form.promo_media_url);
            if (mediaError) { toast.error(mediaError); return; }
            if (mediaWarn) toast.info(mediaWarn);
        }
        if (form.booking_url && !/^https?:\/\//i.test(form.booking_url)) {
            // Mirrors the DB check constraint — fail here with a usable
            // message instead of a constraint-violation toast.
            toast.error('Booking URL must start with http:// or https://'); return;
        }
        setSaving(true);
        const payload = { ...form, slug: slugify(form.slug) };
        const { error } = await supabase.from('live_events').update(payload).eq('id', selected.id);
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_update', 'live_event', selected.id, { fields: Object.keys(payload) });
        toast.success('Event saved');
        fetchEvents();
    };

    // ── Lifecycle ─────────────────────────────────────────────

    const setStatus = async (ev, status, extra = {}, confirmMsg = null) => {
        if (confirmMsg && !window.confirm(confirmMsg)) return;
        setActing(status);
        const { error } = await supabase.from('live_events').update({ status, ...extra }).eq('id', ev.id);
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_status', 'live_event', ev.id, { from: ev.status, to: status });
        toast.success(`Event → ${STATUS_META[status].label}`);
        fetchEvents();
    };

    // Board preview state: which leaderboard state the preview accounts see —
    // sealed blur, live standings (real scores + sample fill), or the sample
    // winners reveal. Instant write, outside the Save payload.
    const setBoardState = async (ev, state) => {
        setActing('board-state');
        const { error } = await supabase.from('live_events')
            .update({ preview_board_state: state }).eq('id', ev.id);
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_board_preview', 'live_event', ev.id, { state });
        toast.success(`Board preview → ${state}`);
        fetchEvents();
    };

    // In-app test preview: instant write, deliberately outside the Save
    // payload (like status/hidden) so it can't be reverted by a stale edit.
    const setPreview = async (ev, enabled, emails) => {
        setActing('preview');
        const { error } = await supabase.from('live_events')
            .update({ preview_enabled: enabled, preview_emails: emails })
            .eq('id', ev.id);
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_preview', 'live_event', ev.id, { enabled, emails });
        toast.success(enabled ? `In-app preview ON for ${emails.length} account${emails.length === 1 ? '' : 's'}` : 'In-app preview off');
        fetchEvents();
    };

    const toggleHidden = async (ev) => {
        setActing('hidden');
        const { error } = await supabase.from('live_events').update({ hidden: !ev.hidden }).eq('id', ev.id);
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_hidden', 'live_event', ev.id, { hidden: !ev.hidden });
        toast.success(!ev.hidden ? 'Board hidden everywhere' : 'Board visible again');
        fetchEvents();
    };

    const settleEvent = async (ev) => {
        if (!window.confirm('Settle now? This snapshots the final ranking from the ledger into results. You can re-settle until Reveal.')) return;
        setActing('settle');
        const { data, error } = await supabase.rpc('admin_settle_event', { p_event_id: ev.id });
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_settle', 'live_event', ev.id, { results: data });
        toast.success(`Settled — ${data} result row${data === 1 ? '' : 's'} frozen`);
        fetchCounts(ev.id);
        fetchEvents();
    };

    const revealEvent = async (ev) => {
        if (counts.results === 0) { toast.error('Settle first — there are no frozen results to reveal'); return; }
        if (!window.confirm(`Reveal to everyone? The app winners card and the venue screen flip the moment you confirm. ${counts.results} frozen results will show.`)) return;
        await setStatus(ev, 'revealed', { revealed_at: new Date().toISOString() });
    };

    const regenerateToken = async (ev) => {
        if (!window.confirm('Regenerate the display token? Any previously shared big-screen link stops working immediately.')) return;
        const token = newToken();
        const { error } = await supabase.from('live_events').update({ display_token: token }).eq('id', ev.id);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_token_regen', 'live_event', ev.id, {});
        toast.success('Display token regenerated — old links are dead');
        fetchEvents();
    };

    const copyDisplayUrl = async (ev) => {
        await navigator.clipboard.writeText(`https://powr.life/live/${ev.slug}?k=${ev.display_token}`);
        toast.success('Display URL copied');
    };

    const copyPromoUrl = async (ev) => {
        await navigator.clipboard.writeText(`https://powr.life/promo/${ev.slug}`);
        toast.success('Promo URL copied');
    };

    // ── Render ────────────────────────────────────────────────

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#10B981]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Subsystem / Events</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <div>
                        <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-5">Live Events</h1>
                        <p className="text-[#666666] text-sm max-w-2xl leading-relaxed">
                            Points-week events: windowed leaderboards over the ledger, never a reset. Every mechanic
                            parameter lives on the event row and re-scores retroactively — scores are computed, not stored,
                            until Settle freezes them.
                        </p>
                    </div>
                    <button
                        onClick={createEvent}
                        className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#333333] transition-all"
                    >
                        <Plus size={14} /> New event
                    </button>
                </div>
            </div>

            {/* ── Event list ── */}
            {loading ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl flex flex-col items-center justify-center py-32 gap-6">
                    <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading events…</span>
                </div>
            ) : events.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-20 text-center">
                    <PartyPopper size={48} className="mx-auto text-[#CCCCCC] mb-6" />
                    <p className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">No events yet</p>
                    <p className="text-[13px] text-[#999999]">Create one and configure the week before anything goes live.</p>
                </div>
            ) : (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#F0F0EC] mb-10">
                    {events.map(ev => {
                        const meta = STATUS_META[ev.status] ?? STATUS_META.draft;
                        const isSel = ev.id === selectedId;
                        return (
                            <button
                                key={ev.id}
                                onClick={() => setSelectedId(isSel ? null : ev.id)}
                                className={`w-full text-left flex items-center gap-5 px-7 py-5 transition-colors ${isSel ? 'bg-[#FAFAF8]' : 'hover:bg-[#FAFAF8]'}`}
                            >
                                <span
                                    className="shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-[0.2em]"
                                    style={{ color: meta.color, borderColor: `${meta.color}44`, backgroundColor: `${meta.color}0F` }}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                                    {meta.label}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2.5 flex-wrap">
                                        <span className="text-[15px] font-semibold text-[#1A1A1A]">{ev.name}</span>
                                        <code className="text-[10px] font-mono text-[#999999] bg-[#F4F4F1] border border-[#EAEAE5] rounded-md px-1.5 py-0.5">{ev.slug}</code>
                                        {ev.hidden && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#F97316]">
                                                <EyeOff size={11} /> Hidden
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[12px] text-[#888888] mt-0.5">
                                        {fmtDT(ev.window_start_at)} → {fmtDT(ev.window_end_at)} · {ev.scope === 'opt_in' ? 'Opt-in' : 'Global'}
                                    </p>
                                </div>
                                <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{isSel ? 'Close' : 'Manage'}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* ── Selected event ── */}
            {selected && form && (
                <div className="space-y-8">
                    <LifecyclePanel
                        ev={selected}
                        counts={counts}
                        acting={acting}
                        onSchedule={() => setStatus(selected, 'scheduled', {},
                            'Schedule this event? The moment it is scheduled the event card appears in the app for every up-to-date user.')}
                        onUnschedule={() => setStatus(selected, 'draft', {}, 'Back to draft? The event card disappears from the app.')}
                        onGoLive={() => setStatus(selected, 'live', {}, 'Go live? The board starts returning standings in the app.')}
                        onLock={() => setStatus(selected, 'locked', {},
                            'Lock the board? Scores stop being served everywhere (app + venue screen) until Reveal.')}
                        onToggleHidden={() => toggleHidden(selected)}
                        onSettle={() => settleEvent(selected)}
                        onReveal={() => revealEvent(selected)}
                        onMarkSettled={() => setStatus(selected, 'settled', {}, 'Wrap up? The event moves to its final settled state.')}
                        onArchive={() => setStatus(selected, 'archived', {}, 'Archive this event? It disappears from the app entirely.')}
                        onCopyUrl={() => copyDisplayUrl(selected)}
                        onCopyPromoUrl={() => copyPromoUrl(selected)}
                        onRegenToken={() => regenerateToken(selected)}
                        onDuplicate={() => duplicateEvent(selected)}
                        onSetPreview={(enabled, emails) => setPreview(selected, enabled, emails)}
                        onSetBoardState={(state) => setBoardState(selected, state)}
                    />

                    <RegistrationsPanel
                        ev={selected}
                        data={registrations}
                        onRefresh={() => fetchRegistrations(selected.id)}
                    />

                    <BookingsPanel
                        data={bookings}
                        busy={bookingsBusy}
                        onSave={saveBookings}
                        onRefresh={() => fetchBookings(selected.id)}
                    />

                    {selected.status !== 'draft' && (
                        <OpsPanel
                            ev={selected}
                            ops={ops}
                            standings={standings}
                            dqRows={dqRows}
                            dqBusy={dqBusy}
                            anticheat={anticheat}
                            resultsCount={counts.results}
                            onDisqualify={(row, dq) => disqualify(selected, row, dq)}
                            onExportCsv={() => exportCsv(selected)}
                        />
                    )}

                    <EditorPanel
                        form={form}
                        setForm={setForm}
                        dirty={dirty}
                        saving={saving}
                        onSave={saveForm}
                        onDiscard={() => setForm(editableFields(selected))}
                        venueName={venueName}
                        setVenueName={setVenueName}
                        locked={['revealed', 'settled', 'archived'].includes(selected.status)}
                    />
                </div>
            )}
        </div>
    );
}

// ─── Venue bookings ──────────────────────────────────────────────
// The venue sells places through its own system, so "booked" and
// "registered in POWR" are two lists that only meet by email. Paste the
// venue's export and this shows the intersection and both differences —
// the two mismatches are the ones that cost you on the night.

function BookingsPanel({ data, busy, onSave, onRefresh }) {
    const [raw, setRaw] = useState('');
    const [editing, setEditing] = useState(false);

    const confirmed = data?.confirmed ?? [];
    const notRegistered = data?.booked_not_registered ?? [];
    const notBooked = data?.registered_not_booked ?? [];
    const bookedTotal = data?.booked_total ?? 0;

    // Anything that isn't an email is a header row or a stray column — the
    // RPC drops them too, but showing the count before saving is what stops
    // someone pasting a whole CSV and trusting a silently wrong number.
    const parsed = useMemo(
        () => Array.from(new Set(
            raw.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@') && s.length > 2),
        )),
        [raw],
    );

    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : null;

    const Stat = ({ label, value, tone }) => (
        <div className={`rounded-2xl border p-4 ${tone}`}>
            <div className="text-[26px] font-bold leading-none tracking-tight">{value}</div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] mt-2 opacity-70">{label}</div>
        </div>
    );

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#0EA5E9]/10 border-[#0EA5E9]/25">
                    <TicketCheck size={18} className="text-[#0EA5E9]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Venue bookings</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        Paste the attendee email export from the venue&rsquo;s booking system. Matching is by email
                        only — someone who booked with a different address than their POWR account shows as a
                        mismatch, not a match.
                        {data?.uploaded_at && <> Last uploaded {fmtTime(data.uploaded_at)}.</>}
                    </p>
                </div>
                <button
                    onClick={onRefresh}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all shrink-0"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-7">
                <div className="grid grid-cols-3 gap-3">
                    <Stat label="Booked & registered" value={confirmed.length} tone="bg-[#16A34A]/5 border-[#16A34A]/20 text-[#16A34A]" />
                    <Stat label="Booked, not registered" value={notRegistered.length} tone="bg-[#F59E0B]/5 border-[#F59E0B]/20 text-[#B45309]" />
                    <Stat label="Registered, not booked" value={notBooked.length} tone="bg-[#EF4444]/5 border-[#EF4444]/20 text-[#DC2626]" />
                </div>

                {/* Upload */}
                {editing ? (
                    <div className="space-y-3">
                        <textarea
                            value={raw}
                            onChange={(e) => setRaw(e.target.value)}
                            rows={8}
                            placeholder={'Paste emails — commas, spaces or one per line.\nHeader rows and duplicates are ignored.'}
                            className="w-full rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] p-4 font-mono text-[12px] text-[#1A1A1A] outline-none focus:border-[#0EA5E9]"
                        />
                        <div className="flex items-center gap-3">
                            <button
                                disabled={busy || parsed.length === 0}
                                onClick={async () => { await onSave(parsed); setEditing(false); setRaw(''); }}
                                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#1A1A1A] text-white text-[10.5px] font-bold uppercase tracking-[0.18em] disabled:opacity-40"
                            >
                                <Upload size={13} /> {busy ? 'Saving…' : `Replace list with ${parsed.length}`}
                            </button>
                            <button
                                onClick={() => { setEditing(false); setRaw(''); }}
                                className="h-10 px-4 rounded-xl border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#888888]"
                            >
                                Cancel
                            </button>
                            <p className="text-[12px] text-[#999999]">
                                {parsed.length} valid {parsed.length === 1 ? 'address' : 'addresses'} — this
                                <strong className="text-[#B45309]"> replaces </strong>
                                all {bookedTotal} currently stored.
                            </p>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setEditing(true)}
                        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all"
                    >
                        <Upload size={13} /> {bookedTotal > 0 ? 'Upload a new export' : 'Paste the booking export'}
                    </button>
                )}

                {/* The two mismatches — the lists worth acting on */}
                {notRegistered.length > 0 && (
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#B45309] mb-2">
                            Booked, not registered ({notRegistered.length})
                        </div>
                        <p className="text-[12px] text-[#888888] mb-3">
                            They have a place on the night but aren&rsquo;t in the event. No account at all means the
                            download has to happen first — chase those earliest.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {notRegistered.map((r) => (
                                        <tr key={r.email}>
                                            <td className="py-2.5 pr-3 font-mono text-[12px] text-[#555555]">{r.email}</td>
                                            <td className="py-2.5 pr-3 text-[#888888]">{r.name ?? '—'}</td>
                                            <td className="py-2.5 text-right">
                                                <span className={`text-[10px] font-black uppercase tracking-[0.15em] px-2 py-1 rounded-lg ${
                                                    r.has_account
                                                        ? 'bg-[#F59E0B]/10 text-[#B45309]'
                                                        : 'bg-[#EF4444]/10 text-[#DC2626]'
                                                }`}>
                                                    {r.has_account ? 'Has account' : 'No account'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {notBooked.length > 0 && (
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DC2626] mb-2">
                            Registered, not booked ({notBooked.length})
                        </div>
                        <p className="text-[12px] text-[#888888] mb-3">
                            In the event but with no booking against their account email — they may not get
                            through the door, or they booked under a different address.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {notBooked.map((r) => (
                                        <tr key={r.user_id}>
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">{r.name}</td>
                                            <td className="py-2.5 font-mono text-[12px] text-[#888888]">{r.email ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {bookedTotal === 0 && (
                    <p className="text-[13px] text-[#999999]">
                        No booking export uploaded yet — every registration will show as unbooked until there is one.
                    </p>
                )}
            </div>
        </section>
    );
}

// ─── Registrations & invites ─────────────────────────────────────
// Who registered + the invite pipeline + the actual bonus ledger rows,
// at any status (drafts included) — this is where a preview test run is
// checked against how the reward mechanics are supposed to pay out.

function RegistrationsPanel({ ev, data, onRefresh }) {
    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
    const participants = data?.participants ?? [];
    const referrals = data?.referrals ?? [];
    const milestones = data?.milestones ?? [];
    const ledger = data?.bonus_ledger ?? [];

    const SOURCE_LABEL = {
        referral_sent:     'Referrer bonus',
        referral_received: 'New-member bonus',
        invite_milestone:  'Milestone bonus',
    };

    const Head = ({ cols }) => (
        <thead>
            <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#F0F0EC]">
                {cols.map(([label, cls]) => <th key={label} className={`py-2 pr-3 ${cls ?? 'text-left'}`}>{label}</th>)}
            </tr>
        </thead>
    );

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#8B5CF6]/10 border-[#8B5CF6]/25">
                    <Users size={18} className="text-[#8B5CF6]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Registrations & invites</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        The raw roster and the invite reward trail — pays +{ev.invite_bonus_points} to each side per
                        converted invite, +{ev.invite_milestone_bonus} at {ev.invite_milestone_n} conversions.
                        Works while the event is a draft, so preview test runs show up here.
                    </p>
                </div>
                <button
                    onClick={onRefresh}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all shrink-0"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-7">
                {/* Roster */}
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">
                        Registered ({participants.length})
                    </div>
                    {participants.length === 0 ? (
                        <p className="text-[13px] text-[#999999]">Nobody has registered yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <Head cols={[['Member'], ['Email'], ['Joined'], ['Opened booking'], ['Booked'], ['Status']]} />
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {participants.map((p) => (
                                        <tr key={p.user_id} className={p.disqualified_at ? 'opacity-45' : ''}>
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">
                                                {p.name}
                                                {p.username && <span className="text-[#999999] font-normal"> @{p.username}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 font-mono text-[12px] text-[#888888]">{p.email ?? '—'}</td>
                                            <td className="py-2.5 pr-3 text-[#888888]">{fmtTime(p.joined_at)}</td>
                                            {/* joined → opened → booked, the whole funnel in one row.
                                                "Booked" derives from the Venue bookings export by email —
                                                blank means "not in the export", not "didn't book". */}
                                            <td className="py-2.5 pr-3 text-[#888888]">{fmtTime(p.booking_opened_at)}</td>
                                            <td className="py-2.5 pr-3">
                                                {p.booked
                                                    ? <span className="text-[#10B981] text-[11px] font-bold uppercase tracking-wide">✓</span>
                                                    : <span className="text-[#BBBBBB]">—</span>}
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                {p.disqualified_at
                                                    ? <span className="text-[#F43F5E] text-[11px] font-bold uppercase tracking-wide">DQ</span>
                                                    : <span className="text-[#10B981] text-[11px] font-bold uppercase tracking-wide">In</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Invite pipeline */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">
                        Invite pipeline ({referrals.length})
                    </div>
                    {referrals.length === 0 ? (
                        <p className="text-[13px] text-[#999999]">
                            No invites yet — conversions attributed to this event and still-pending signups will appear here.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <Head cols={[['Referrer'], ['Invited'], ['Signed up'], ['Converted'], ['Attribution']]} />
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {referrals.map((r, i) => (
                                        <tr key={i}>
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">{r.referrer_name}</td>
                                            <td className="py-2.5 pr-3 text-[#555555]">
                                                {r.referred_name}
                                                {r.referred_email && <span className="font-mono text-[11px] text-[#AAAAAA]"> {r.referred_email}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 text-[#888888]">{fmtTime(r.created_at)}</td>
                                            <td className="py-2.5 pr-3">
                                                {r.converted_at
                                                    ? <span className="text-[#10B981]">{fmtTime(r.converted_at)}</span>
                                                    : <span className="text-[#999999]">pending</span>}
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                {r.attributed
                                                    ? <span className="inline-flex items-center h-5 px-2 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 text-[#8B5CF6] text-[9px] font-black uppercase tracking-[0.15em]">This event</span>
                                                    : <span className="text-[11px] text-[#AAAAAA]">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {milestones.length > 0 && (
                        <p className="text-[12px] text-[#555555] mt-3">
                            Milestones paid: {milestones.map((m) => `${m.referrer_name} (+${m.points_paid} at ${m.converted_count})`).join(' · ')}
                        </p>
                    )}
                </div>

                {/* Bonus ledger */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-2">
                        Invite bonus ledger — latest {ledger.length} across all events
                    </div>
                    {ledger.length === 0 ? (
                        <p className="text-[13px] text-[#999999]">No invite bonus transactions yet, ever.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <Head cols={[['When'], ['Member'], ['Type'], ['Points', 'text-right'], ['Description']]} />
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {ledger.map((t, i) => (
                                        <tr key={i}>
                                            <td className="py-2.5 pr-3 text-[#888888] whitespace-nowrap">{fmtTime(t.created_at)}</td>
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">
                                                {t.name}
                                                {t.email && <span className="font-mono text-[11px] text-[#AAAAAA]"> {t.email}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 text-[#555555]">{SOURCE_LABEL[t.source] ?? t.source}</td>
                                            <td className="py-2.5 pr-3 text-right font-mono text-[#10B981]">+{t.amount}</td>
                                            <td className="py-2.5 pr-3 text-[#888888]">{t.description}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                        Point transactions aren&apos;t tagged with an event, so this feed is global — during a test run
                        your rows are the newest. Conversion requires a {(ev.conversion_verifications ?? []).join(' or ') || 'verified'}
                        {' '}session; manual never converts.
                    </p>
                </div>
            </div>
        </section>
    );
}

// ─── In-app test preview ─────────────────────────────────────────
// While the event is a draft, the listed app accounts (and ONLY them)
// see the real home card + register flow, with the status simulated as
// scheduled/live from the window. Everyone else sees nothing — this is
// how you check the card in Expo Go before pressing Schedule.

const BOARD_STATES = [
    ['auto',     'Auto',     'Behaves like the real thing under the simulated status'],
    ['live',     'Live',     'Standings — testers’ real points merged with sample rows'],
    ['locked',   'Sealed',   'The blur everyone stares at during event week'],
    ['revealed', 'Winners',  'Sample results with the tester placed 4th'],
];

function PreviewBlock({ ev, acting, onSetPreview, onSetBoardState }) {
    // Resync the input from the saved list only when it actually changes
    // (event switch or a save) — never clobber in-progress typing on
    // unrelated refetches.
    const savedEmails = (ev.preview_emails ?? []).join(', ');
    const [emailsText, setEmailsText] = useState(savedEmails);
    useEffect(() => { setEmailsText(savedEmails); }, [ev.id, savedEmails]);

    const parsed = emailsText.split(/[,\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    const invalid = parsed.filter(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

    return (
        <div className="border-t border-[#F0F0EC] pt-6">
            <div className="flex items-center gap-2 mb-2">
                <Smartphone size={13} className="text-[#888888]" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">In-app test preview</span>
                {ev.preview_enabled && (
                    <span className="inline-flex items-center h-5 px-2 rounded-md bg-[#E8D200]/15 border border-[#E8D200]/40 text-[#8a7600] text-[9px] font-black uppercase tracking-[0.15em]">
                        On · {(ev.preview_emails ?? []).length}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                <input
                    value={emailsText}
                    onChange={e => setEmailsText(e.target.value)}
                    placeholder="tester@email.com, another@email.com"
                    className="flex-1 min-w-[260px] h-10 px-3 rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] text-[12px] font-mono text-[#555555] focus:outline-none focus:border-[#1A1A1A]"
                />
                <button
                    onClick={() => onSetPreview(!ev.preview_enabled, parsed)}
                    disabled={!!acting || (!ev.preview_enabled && (parsed.length === 0 || invalid.length > 0))}
                    className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        ev.preview_enabled
                            ? 'bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15'
                            : 'bg-[#E8D200]/15 border-[#E8D200]/40 text-[#8a7600] hover:bg-[#E8D200]/25'
                    }`}
                >
                    <Smartphone size={13} /> {ev.preview_enabled ? 'Disable preview' : 'Enable preview'}
                </button>
                {ev.preview_enabled && (
                    <button
                        onClick={() => onSetPreview(true, parsed)}
                        disabled={!!acting || parsed.length === 0 || invalid.length > 0}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                    >
                        <Check size={13} /> Update emails
                    </button>
                )}
            </div>
            {invalid.length > 0 && (
                <p className="text-[11px] text-[#F43F5E] mt-2">Not an email: {invalid.join(', ')}</p>
            )}
            {ev.preview_enabled && (
                <div className="mt-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mb-2">
                        Board preview — what testers see on the League leaderboard
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {BOARD_STATES.map(([value, label, hint]) => (
                            <button
                                key={value}
                                onClick={() => onSetBoardState(value)}
                                disabled={!!acting || (ev.preview_board_state ?? 'auto') === value}
                                title={hint}
                                className={`h-9 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.15em] transition-all disabled:cursor-default ${
                                    (ev.preview_board_state ?? 'auto') === value
                                        ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                        : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                        Sealed is the state real users hold all event week; Winners uses sample rows (tester
                        placed 4th, prize labels from this event’s Prizes). The app picks it up within a minute
                        — or instantly on a fresh open.
                    </p>
                </div>
            )}
            <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                Only the accounts listed here see this draft in the app — the home card, register sheet and League
                tab behave exactly as if the event were scheduled (or live once the window opens), with a PREVIEW
                badge. Everyone else sees nothing until you press Schedule. Test registrations are real join rows;
                they carry over if you launch, or vanish if you delete the draft.
            </p>
        </div>
    );
}

// ─── Lifecycle panel ─────────────────────────────────────────────

function LifecyclePanel({
    ev, counts, acting,
    onSchedule, onUnschedule, onGoLive, onLock, onToggleHidden,
    onSettle, onReveal, onMarkSettled, onArchive,
    onCopyUrl, onCopyPromoUrl, onRegenToken, onDuplicate, onSetPreview, onSetBoardState,
}) {
    const meta = STATUS_META[ev.status];
    const pastLock = ev.lock_at && new Date(ev.lock_at) <= new Date();

    const Btn = ({ icon: Icon, label, onClick, tone = 'neutral', disabled }) => {
        const tones = {
            neutral: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]',
            primary: 'bg-[#1A1A1A] border-[#1A1A1A] text-white hover:bg-[#333333]',
            danger:  'bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15',
            gold:    'bg-[#E8D200]/15 border-[#E8D200]/40 text-[#8a7600] hover:bg-[#E8D200]/25',
        };
        return (
            <button
                onClick={onClick}
                disabled={disabled || !!acting}
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
            >
                <Icon size={13} /> {label}
            </button>
        );
    };

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border"
                    style={{ backgroundColor: `${meta.color}14`, borderColor: `${meta.color}33` }}>
                    <CalendarClock size={18} style={{ color: meta.color }} />
                </div>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Lifecycle — {meta.label}</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        {counts.participants} participant{counts.participants === 1 ? '' : 's'} · {counts.results} frozen result{counts.results === 1 ? '' : 's'}
                        {pastLock && ev.status === 'live' ? ' · past lock time (board already hiding itself)' : ''}
                    </p>
                </div>
                <div className="flex-1 h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, ${meta.color}40, transparent)` }} />
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-6">
                {/* Transition buttons for the current status */}
                <div className="flex items-center gap-3 flex-wrap">
                    {ev.status === 'draft' && (
                        <>
                            <Btn icon={Rocket} label="Schedule" tone="primary" onClick={onSchedule} />
                            <span className="text-[11px] text-[#999999] inline-flex items-center gap-1.5">
                                <AlertTriangle size={12} className="text-[#F97316]" />
                                Scheduling makes the event card visible in the app immediately.
                            </span>
                        </>
                    )}
                    {ev.status === 'scheduled' && (
                        <>
                            <Btn icon={Flag} label="Go live" tone="primary" onClick={onGoLive} />
                            <Btn icon={Undo2} label="Back to draft" onClick={onUnschedule} />
                        </>
                    )}
                    {ev.status === 'live' && <Btn icon={Lock} label="Lock board" tone="primary" onClick={onLock} />}
                    {ev.status === 'locked' && (
                        <>
                            <Btn icon={Trophy} label={counts.results > 0 ? 'Re-settle' : 'Settle'} tone="primary" onClick={onSettle} />
                            <Btn icon={PartyPopper} label="Reveal" tone="gold" onClick={onReveal} disabled={counts.results === 0} />
                            <span className="text-[11px] text-[#999999]">Settle freezes the ranking; Reveal shows it — vet between the two.</span>
                        </>
                    )}
                    {ev.status === 'revealed' && <Btn icon={Check} label="Mark settled" onClick={onMarkSettled} />}
                    {!['archived'].includes(ev.status) && (
                        <>
                            <Btn
                                icon={ev.hidden ? Eye : EyeOff}
                                label={ev.hidden ? 'Unhide' : 'Hide now'}
                                tone={ev.hidden ? 'neutral' : 'danger'}
                                onClick={onToggleHidden}
                            />
                            <Btn icon={Archive} label="Archive" onClick={onArchive} />
                        </>
                    )}
                    <Btn icon={Copy} label="Duplicate" onClick={onDuplicate} />
                </div>

                {/* In-app test preview — draft only; scheduling makes it moot */}
                {ev.status === 'draft' && (
                    <PreviewBlock ev={ev} acting={acting} onSetPreview={onSetPreview} onSetBoardState={onSetBoardState} />
                )}

                {/* Display URL */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="flex items-center gap-2 mb-2">
                        <Link2 size={13} className="text-[#888888]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Big-screen display URL</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <code className="text-[12px] font-mono text-[#555555] bg-[#F4F4F1] border border-[#EAEAE5] rounded-lg px-3 py-2 select-all break-all">
                            https://powr.life/live/{ev.slug}?k={ev.display_token}
                        </code>
                        <Btn icon={Copy} label="Copy" onClick={onCopyUrl} />
                        <Btn icon={RefreshCw} label="Regenerate token" tone="danger" onClick={onRegenToken} />
                    </div>
                    <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                        Runs the venue screen full-screen — the token grants display access only and never sees through
                        a locked board. Regenerating kills any previously shared link. The /live route ships separately.
                    </p>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#AAAAAA]">Preview the screen:</span>
                        {[
                            ['countdown', 'Countdown'],
                            ['live', 'Live board'],
                            ['locked', 'Locked'],
                            ['reveal', 'Reveal'],
                            ['settled', 'Winners'],
                        ].map(([state, label]) => (
                            <a
                                key={state}
                                href={`https://powr.life/live/${ev.slug}?k=${ev.display_token}&preview=${state}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                            >
                                {label}
                            </a>
                        ))}
                        <span className="text-[10px] text-[#AAAAAA]">
                            — sample standings, works while the event is a draft. The reveal replays on refresh.
                        </span>
                    </div>
                </div>

                {/* Promo page URL */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="flex items-center gap-2 mb-2">
                        <Megaphone size={13} className="text-[#888888]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Promo page URL</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <code className="text-[12px] font-mono text-[#555555] bg-[#F4F4F1] border border-[#EAEAE5] rounded-lg px-3 py-2 select-all break-all">
                            https://powr.life/promo/{ev.slug}
                        </code>
                        <Btn icon={Copy} label="Copy" onClick={onCopyPromoUrl} />
                        <a
                            href={`https://powr.life/promo/${ev.slug}?k=${ev.display_token}`}
                            target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                        >
                            <ExternalLink size={13} /> Preview
                        </a>
                    </div>
                    <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                        The shareable send-out page — background media, venue logo, registration QR, POWR logo. Public
                        (no token) from the moment the event is scheduled; while it's a draft only the Preview link
                        works. Media and headline are set in Configuration below.
                    </p>
                </div>

                {/* Registration QR */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="flex items-center gap-2 mb-2">
                        <QrCode size={13} className="text-[#888888]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Registration QR</span>
                    </div>
                    <RegistrationQr slug={ev.slug} />
                    <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                        The same code the promo page shows — unique to this event
                        (<span className="font-mono">?event={ev.slug}</span>), so scanners land on this event&apos;s card in
                        the app. The download is a 1024px PNG for posters and socials. Regenerating the display token
                        does NOT change this code, but changing the slug does — re-download after a slug change.
                    </p>
                </div>
            </div>
        </section>
    );
}

// High-res canvas styled down for preview; download reads the same canvas,
// so the PNG is always exactly what's shown.
function RegistrationQr({ slug }) {
    const boxRef = useRef(null);
    const download = () => {
        const canvas = boxRef.current?.querySelector('canvas');
        if (!canvas) return;
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${slug}-registration-qr.png`;
        a.click();
    };
    return (
        <div className="flex items-center gap-4 flex-wrap">
            <div ref={boxRef} className="bg-white border border-[#EAEAE5] rounded-xl p-2.5 shrink-0">
                <QRCodeCanvas
                    value={eventRegisterUrl(slug)}
                    size={1024}
                    fgColor="#0a0a0a"
                    bgColor="#FFFFFF"
                    level="M"
                    style={{ width: 96, height: 96, display: 'block' }}
                />
            </div>
            <button
                onClick={download}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
            >
                <Download size={13} /> Download PNG
            </button>
        </div>
    );
}

// ─── Ops panel (ticket 6) ────────────────────────────────────────
// Through-blur standings + vetting signals + invite funnel. This is
// the list read out at prize handover — visible to admins whatever
// the board's public state.

function OpsPanel({ ev, ops, standings, dqRows, dqBusy, anticheat, resultsCount, onDisqualify, onExportCsv }) {
    const rows = standings ?? [];
    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';

    const Stat = ({ label, value, accent }) => (
        <div className="rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] px-5 py-4">
            <div className="text-2xl font-light tracking-tight" style={{ color: accent ?? '#1A1A1A' }}>{value ?? '—'}</div>
            <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mt-1">{label}</div>
        </div>
    );

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#0EA5E9]/10 border-[#0EA5E9]/25">
                    <Gauge size={18} className="text-[#0EA5E9]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Ops — live standings & vetting</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        Admin view sees through the blur at any status. Wearable data lags 30–90 min behind
                        reality — late scores are normal, not suspicious.
                    </p>
                </div>
                <button
                    onClick={onExportCsv}
                    disabled={rows.length === 0}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all disabled:opacity-40 shrink-0"
                >
                    <Download size={13} /> Export CSV
                </button>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-7">
                {/* Counts */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <Stat label="Eligible" value={ops?.eligible_count} />
                    <Stat label={ev.scope === 'opt_in' ? 'Joined' : 'Participants'} value={ops?.participant_count} />
                    <Stat label="Disqualified" value={ops?.disqualified_count} accent={ops?.disqualified_count > 0 ? '#F43F5E' : undefined} />
                    <Stat label="On the board" value={rows.length} />
                    <Stat label="Frozen results" value={ops?.results_count} />
                    <Stat label="Invite conversions" value={ops?.converted_count} accent="#10B981" />
                </div>

                {/* Standings + vetting signals */}
                {rows.length === 0 ? (
                    <p className="text-[13px] text-[#999999]">No scores on the board yet.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#F0F0EC]">
                                    <th className="text-left py-2 pr-3">#</th>
                                    <th className="text-left py-2 pr-3">Member</th>
                                    <th className="text-right py-2 pr-3">Points</th>
                                    <th className="text-left py-2 pr-3">Last counted</th>
                                    <th className="text-right py-2 pr-3">Sessions</th>
                                    <th className="text-left py-2 pr-3">Mix G/W/M</th>
                                    <th className="text-left py-2 pr-3">Signals</th>
                                    <th className="text-right py-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F6F6F3]">
                                {rows.map((r) => {
                                    const manualHeavy = r.sessions_in_window > 0 && r.manual_sessions / r.sessions_in_window >= 0.5;
                                    return (
                                        <tr key={r.user_id} className={r.disqualified ? 'opacity-45' : ''}>
                                            <td className="py-2.5 pr-3 font-mono text-[#888888]">{r.rank}</td>
                                            <td className="py-2.5 pr-3">
                                                {/* One click into the existing review surface — rejection
                                                    there writes penalty rows, which now lower event scores. */}
                                                <Link to={`/admin/users/${r.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">
                                                    {r.display_name ?? r.username ?? 'POWR member'}
                                                </Link>
                                                {r.username && <span className="text-[#AAAAAA] ml-2">@{r.username}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right font-mono font-semibold">{r.points}</td>
                                            <td className="py-2.5 pr-3 text-[#888888]">{fmtTime(r.last_counted_tx_at)}</td>
                                            <td className="py-2.5 pr-3 text-right font-mono">{r.sessions_in_window}</td>
                                            <td className="py-2.5 pr-3 font-mono text-[#888888]">
                                                {r.geofence_sessions}/{r.wearable_sessions}/{r.manual_sessions}
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {r.flagged_sessions > 0 && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F43F5E]/10 border border-[#F43F5E]/25 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.12em]">
                                                            <ShieldAlert size={10} /> {r.flagged_sessions} flagged
                                                        </span>
                                                    )}
                                                    {manualHeavy && (
                                                        <span className="px-2 py-0.5 rounded-full bg-[#F97316]/10 border border-[#F97316]/25 text-[#B45309] text-[9px] font-black uppercase tracking-[0.12em]">
                                                            manual-heavy
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-2.5 text-right">
                                                <button
                                                    onClick={() => onDisqualify(r, true)}
                                                    disabled={dqBusy === r.user_id}
                                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] transition-all disabled:opacity-40 bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15"
                                                >
                                                    <UserX size={11} /> Disqualify
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {resultsCount > 0 && (
                            <p className="text-[11px] text-[#B45309] mt-3 flex items-center gap-1.5">
                                <AlertTriangle size={12} />
                                Results are already frozen — after any disqualification, Re-settle so the snapshot drops them too.
                            </p>
                        )}
                    </div>
                )}

                {/* Disqualified — off the board by definition, so the requalify
                    path lives here rather than in the standings table. */}
                {(dqRows ?? []).length > 0 && (
                    <div className="border-t border-[#F0F0EC] pt-6">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#F43F5E] mb-3">
                            Disqualified — {dqRows.length}
                        </div>
                        <div className="space-y-2">
                            {dqRows.map((r) => (
                                <div key={r.user_id} className="flex items-center gap-4">
                                    <Link to={`/admin/users/${r.user_id}`} className="font-semibold text-[13px] text-[#1A1A1A] hover:underline">
                                        {r.display_name ?? r.username ?? 'POWR member'}
                                    </Link>
                                    <span className="text-[11px] text-[#999999]">
                                        since {new Date(r.disqualified_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <button
                                        onClick={() => onDisqualify(r, false)}
                                        disabled={dqBusy === r.user_id}
                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] transition-all disabled:opacity-40"
                                    >
                                        <UserCheck size={11} /> Requalify
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Anti-cheat report (ticket 7) — signals, not verdicts. */}
                <AntiCheatReport report={anticheat} />

                {/* Invite funnel */}
                <div className="border-t border-[#F0F0EC] pt-6">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888] mb-3">
                        Invite funnel — {ops?.converted_count ?? 0} converted · {ops?.pending_referrals ?? 0} signups pending
                    </div>
                    {(ops?.funnel ?? []).length === 0 ? (
                        <p className="text-[13px] text-[#999999]">No invites yet.</p>
                    ) : (
                        <table className="w-full max-w-2xl text-[13px]">
                            <thead>
                                <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#F0F0EC]">
                                    <th className="text-left py-2 pr-3">Referrer</th>
                                    <th className="text-right py-2 pr-3">Signups</th>
                                    <th className="text-right py-2 pr-3">Pending</th>
                                    <th className="text-right py-2 pr-3">Converted</th>
                                    <th className="text-left py-2 pl-3">Milestone</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F6F6F3]">
                                {ops.funnel.map((f) => (
                                    <tr key={f.referrer_id}>
                                        <td className="py-2 pr-3 font-semibold text-[#1A1A1A]">{f.referrer_name}</td>
                                        <td className="py-2 pr-3 text-right font-mono">{f.signups}</td>
                                        <td className="py-2 pr-3 text-right font-mono text-[#999999]">{f.pending}</td>
                                        <td className="py-2 pr-3 text-right font-mono font-semibold text-[#10B981]">{f.converted}</td>
                                        <td className="py-2 pl-3">
                                            {f.milestone_paid && (
                                                <span className="px-2 py-0.5 rounded-full bg-[#E8D200]/15 border border-[#E8D200]/40 text-[#8a7600] text-[9px] font-black uppercase tracking-[0.12em]">
                                                    paid
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </section>
    );
}

// ─── Anti-cheat report (ticket 7) ────────────────────────────────
// Four event-window signals, each with innocent explanations — the
// human decides. Anything found links into the user's admin profile
// where SessionReview rejection (penalty rows) lowers event scores.

function AntiCheatReport({ report }) {
    if (!report) return null;
    const groups = [
        {
            key: 'mirrored_sessions',
            title: 'Mirrored wearable sessions',
            blurb: 'Near-identical workouts (same type, start ±5 min, duration ±60 s) on two accounts, 2+ times — the shape of one watch synced to two accounts. Also what two friends training together looks like.',
            rows: (report.mirrored_sessions ?? []).map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px]">
                    <Link to={`/admin/users/${m.user_a?.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">{m.user_a?.name}</Link>
                    <span className="text-[#999999]">×</span>
                    <Link to={`/admin/users/${m.user_b?.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">{m.user_b?.name}</Link>
                    <span className="text-[#999999]">— {m.mirrored} matching sessions</span>
                </div>
            )),
        },
        {
            key: 'shared_devices',
            title: 'Shared devices',
            blurb: 'One device writing sessions for 2+ accounts inside the window.',
            rows: (report.shared_devices ?? []).map((d) => (
                <div key={d.device_id} className="flex items-center gap-2 text-[13px] flex-wrap">
                    <code className="text-[11px] font-mono text-[#999999] bg-[#F4F4F1] border border-[#EAEAE5] rounded px-1.5 py-0.5">{String(d.device_id).slice(0, 12)}…</code>
                    {(d.users ?? []).map((u, i) => (
                        <span key={u.user_id} className="flex items-center gap-1">
                            {i > 0 && <span className="text-[#999999]">·</span>}
                            <Link to={`/admin/users/${u.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">{u.name}</Link>
                            <span className="text-[#999999]">({u.sessions})</span>
                        </span>
                    ))}
                </div>
            )),
        },
        {
            key: 'short_bursts',
            title: 'Short-session bursts',
            blurb: '3+ sub-15-minute wearable sessions in one day (walking/sleep excluded) — wearables pay flat per session, so tiny bursts are the farm shape.',
            rows: (report.short_bursts ?? []).map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px]">
                    <Link to={`/admin/users/${b.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">{b.name}</Link>
                    {/* b.day is a date-only string; suffix a local midnight so the
                        calendar day doesn't shift for admins west of UTC. */}
                    <span className="text-[#999999]">— {b.short_sessions} short sessions on {new Date(`${b.day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                </div>
            )),
        },
        {
            key: 'manual_heavy',
            title: 'Manual-heavy scores',
            blurb: 'Board users whose event score is ≥40% manual logs (points-weighted, ≥20 pts).',
            rows: (report.manual_heavy ?? []).map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 text-[13px]">
                    <span className="font-mono text-[#999999]">#{m.rank}</span>
                    <Link to={`/admin/users/${m.user_id}`} className="font-semibold text-[#1A1A1A] hover:underline">{m.name}</Link>
                    <span className="text-[#999999]">— {m.manual_points} of {m.points} pts manual ({Math.round(m.share * 100)}%)</span>
                </div>
            )),
        },
    ];
    const totalHits = groups.reduce((n, g) => n + g.rows.length, 0);

    return (
        <div className="border-t border-[#F0F0EC] pt-6">
            <div className="flex items-center gap-2.5 mb-1">
                <ShieldAlert size={14} className={totalHits > 0 ? 'text-[#F97316]' : 'text-[#10B981]'} />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">
                    Anti-cheat report — {totalHits > 0 ? `${totalHits} signal${totalHits === 1 ? '' : 's'}` : 'all clear'}
                </span>
            </div>
            <p className="text-[11.5px] text-[#999999] mb-4 max-w-3xl">
                Signals, not verdicts — each has innocent explanations. Rejecting sessions in a user's
                review writes penalty rows, which lower their event score; Disqualify above removes them
                from this event entirely.
            </p>
            <div className="grid gap-5 lg:grid-cols-2">
                {groups.map((g) => (
                    <div key={g.key} className="rounded-2xl border border-[#EFEFEA] bg-[#FBFBF9] p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[12.5px] font-bold text-[#1A1A1A]">{g.title}</span>
                            {g.rows.length > 0
                                ? <span className="text-[10px] font-black text-[#F97316]">{g.rows.length}</span>
                                : <Check size={13} className="text-[#10B981]" />}
                        </div>
                        <p className="text-[11px] text-[#999999] leading-snug mb-2.5">{g.blurb}</p>
                        {g.rows.length === 0
                            ? <p className="text-[12px] text-[#AAAAAA]">Nothing found.</p>
                            : <div className="space-y-1.5">{g.rows}</div>}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Editor panel ────────────────────────────────────────────────

function EditorPanel({ form, setForm, dirty, saving, onSave, onDiscard, venueName, setVenueName, locked }) {
    const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#10B981]/10 border-[#10B981]/25">
                    <PartyPopper size={18} className="text-[#10B981]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Configuration</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        {locked
                            ? 'This event has been revealed — its configuration is read-only for the record.'
                            : 'Every knob re-scores immediately: standings are computed from the ledger on read.'}
                    </p>
                </div>
                {dirty && !locked && (
                    <SaveBar saving={saving} onSave={onSave} onDiscard={onDiscard} className="shrink-0" />
                )}
            </div>

            <fieldset disabled={locked} className={locked ? 'opacity-60' : ''}>
                <div className="bg-white border border-[#E6E6E1] rounded-3xl divide-y divide-[#F0F0EC]">
                    {/* Identity */}
                    <Group title="Identity">
                        <Field label="Name">
                            <TextInput value={form.name} onChange={v => set({ name: v })} />
                        </Field>
                        <Field label="Slug" hint="In the display URL; lowercase-kebab.">
                            <TextInput value={form.slug} onChange={v => set({ slug: v })} mono />
                        </Field>
                        <Field label="Logo" hint="The POWR side of the card's partnership lockup (venue logo · line · this). Upload a WHITE mark on a transparent background — it sits straight on the artwork, no chip. Blank = the white POWR mark.">
                            <EventLogoField value={form.logo_url} onChange={v => set({ logo_url: v })} />
                        </Field>
                        <Field label="Logo only" hint="Hide the name on the app card — the lockup alone carries the identity, shown larger. The name is still used everywhere else.">
                            <Toggle on={form.logo_only} onFlip={() => set({ logo_only: !form.logo_only })} />
                        </Field>
                        <Field label="Venue partner" hint="Optional — links the event to a gym/venue.">
                            <VenuePicker
                                venueId={form.venue_partner_id}
                                venueName={venueName}
                                onPick={(id, name) => { set({ venue_partner_id: id }); setVenueName(name); }}
                            />
                        </Field>
                    </Group>

                    {/* Window */}
                    <Group title="Window & lock" blurb="All times are London (your browser's clock). The scoring window is half-open: the end bound is the first moment that no longer counts.">
                        <Field label="Window opens">
                            <DateTimeInput value={form.window_start_at} onChange={v => set({ window_start_at: v })} />
                        </Field>
                        <Field label="Window ends">
                            <DateTimeInput value={form.window_end_at} onChange={v => set({ window_end_at: v })} />
                        </Field>
                        <Field label="Board auto-locks" hint="Board hides itself from this moment (no cron — checked on read). Blank = never auto-locks.">
                            <DateTimeInput value={form.lock_at} onChange={v => set({ lock_at: v })} clearable />
                        </Field>
                        <Field label="Eligibility cutoff" hint="Accounts created after this can't compete. Blank = window open.">
                            <DateTimeInput value={form.eligibility_cutoff_at} onChange={v => set({ eligibility_cutoff_at: v })} clearable />
                        </Field>
                        <Field label="Scope">
                            <div className="flex gap-2">
                                {['opt_in', 'global'].map(s => (
                                    <Chip key={s} active={form.scope === s} onClick={() => set({ scope: s })}>
                                        {s === 'opt_in' ? 'Opt-in (join to compete)' : 'Global (everyone on boards)'}
                                    </Chip>
                                ))}
                            </div>
                        </Field>
                        <Field label="Board size" hint="Rows served to the app + snapshotted at Settle.">
                            <NumberInput value={form.board_size} onChange={v => set({ board_size: v })} min={3} max={500} />
                        </Field>
                    </Group>

                    {/* Scoring */}
                    <Group title="Scoring" blurb="What counts toward the event score. Penalties always subtract; bonuses never count — those two are not negotiable in the scorer.">
                        <Field label="Counting activities" hint="Session types whose earn points count.">
                            <ActivityGrid
                                value={form.included_activities}
                                onChange={v => set({ included_activities: v })}
                            />
                        </Field>
                        <Field label="Manual logs count">
                            <Toggle on={form.count_manual} onFlip={() => set({ count_manual: !form.count_manual })} />
                        </Field>
                        <Field label="Walking counts" hint="Kill-switch on top of the activity list.">
                            <Toggle on={form.count_walking} onFlip={() => set({ count_walking: !form.count_walking })} />
                        </Field>
                        <Field label="Streak bonuses count">
                            <Toggle on={form.count_streak} onFlip={() => set({ count_streak: !form.count_streak })} />
                        </Field>
                    </Group>

                    {/* Invites */}
                    <Group title="Invites" blurb="A signup converts when the invitee logs their first qualifying verified workout — manual never converts, whatever is set here.">
                        <Field label="Bonus per conversion" hint="Paid to BOTH sides.">
                            <NumberInput value={form.invite_bonus_points} onChange={v => set({ invite_bonus_points: v })} min={0} max={1000} unit="pts" />
                        </Field>
                        <Field label="Milestone at" hint="Nth conversion pays the milestone bonus.">
                            <NumberInput value={form.invite_milestone_n} onChange={v => set({ invite_milestone_n: v })} min={0} max={50} unit="friends" />
                        </Field>
                        <Field label="Milestone bonus">
                            <NumberInput value={form.invite_milestone_bonus} onChange={v => set({ invite_milestone_bonus: v })} min={0} max={5000} unit="pts" />
                        </Field>
                        <Field label="Converting verifications">
                            <div className="flex gap-2">
                                {VERIFICATIONS.map(v => {
                                    const on = form.conversion_verifications?.includes(v);
                                    return (
                                        <Chip key={v} active={on} onClick={() => set({
                                            conversion_verifications: on
                                                ? form.conversion_verifications.filter(x => x !== v)
                                                : [...(form.conversion_verifications ?? []), v],
                                        })}>
                                            {v}
                                        </Chip>
                                    );
                                })}
                            </div>
                        </Field>
                        <Field label="Converting activities" hint="Walking/sleep excluded by default — wearables auto-create them.">
                            <ActivityGrid
                                value={form.conversion_activities}
                                onChange={v => set({ conversion_activities: v })}
                            />
                        </Field>
                        <Field label="Conversion deadline" hint="Blank = window end.">
                            <DateTimeInput value={form.conversion_deadline_at} onChange={v => set({ conversion_deadline_at: v })} clearable />
                        </Field>
                    </Group>

                    {/* Entry gate */}
                    <Group title="Entry gate" blurb="Refer-to-compete: users need this many referrals to appear on the leaderboard or see live standings. Joining stays open and revealed results stay public — the gate is the board, not the guest list.">
                        <Field label="Referrals required" hint="0 = no gate.">
                            <NumberInput value={form.entry_gate_n} onChange={v => set({ entry_gate_n: v })} min={0} max={50} unit="friends" />
                        </Field>
                        <Field label="What counts" hint="Signups can be met before the window opens; conversions need each friend's first verified workout.">
                            <div className="flex gap-2">
                                <Chip active={form.entry_gate_counting === 'signups'} onClick={() => set({ entry_gate_counting: 'signups' })}>
                                    Signups (code entered)
                                </Chip>
                                <Chip active={form.entry_gate_counting === 'conversions'} onClick={() => set({ entry_gate_counting: 'conversions' })}>
                                    Conversions (first verified workout)
                                </Chip>
                            </div>
                        </Field>
                        <Field label="Counting from" hint="Referrals before this moment don't count. Blank = every referral.">
                            <DateTimeInput value={form.entry_gate_since} onChange={v => set({ entry_gate_since: v })} clearable />
                        </Field>
                    </Group>

                    {/* Booking */}
                    <Group title="Booking" blurb="The venue's own booking page. Blank hides every booking surface in the app — set it when their form opens and the CTAs appear on the next refresh. Attendee reconciliation lives in the Venue bookings panel.">
                        <Field label="Booking URL" hint="May contain {email} and {name} — the app substitutes the registrant's details so the form can prefill where the platform supports it.">
                            <TextInput mono value={form.booking_url} onChange={v => set({ booking_url: v || null })} />
                        </Field>
                    </Group>

                    {/* Rules */}
                    <Group title="Rules" blurb="Shown at registration and on the League ticket. One rule per line — keep each one short enough to read at a glance.">
                        <Field label="Event rules" hint="e.g. Only points earned during the event week count.">
                            <RulesField value={form.rules} onChange={v => set({ rules: v })} />
                        </Field>
                    </Group>

                    {/* Prizes */}
                    <Group title="Prizes" blurb="Labels only — attached to ranks at Settle and read out on the night.">
                        <PrizeEditor prizes={form.prizes} onChange={v => set({ prizes: v })} />
                    </Group>

                    {/* Promo page */}
                    <Group title="Promo page" blurb="The shareable send-out page (URL in Lifecycle above). Venue logo comes from the venue partner; the QR sends people into the app to register.">
                        <Field label="Background media" hint="A video (.mp4/.webm) or image behind the whole page. Blank = dark brand look.">
                            <PromoMediaField
                                value={form.promo_media_url}
                                onChange={v => set({ promo_media_url: v })}
                            />
                        </Field>
                        <Field label="Headline" hint="Optional line under the event name — e.g. what's at stake. Blank = name + dates only.">
                            <TextInput value={form.promo_headline} onChange={v => set({ promo_headline: v || null })} />
                        </Field>
                    </Group>
                </div>
            </fieldset>

            {dirty && !locked && (
                <SaveBar saving={saving} onSave={onSave} onDiscard={onDiscard} className="justify-end mt-4 px-1" />
            )}
        </section>
    );
}

function SaveBar({ saving, onSave, onDiscard, className = '' }) {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <button
                onClick={onDiscard}
                className="h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#666666] hover:text-[#1A1A1A] transition-all"
            >
                Discard
            </button>
            <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#10B981] text-white text-[10.5px] font-bold uppercase tracking-[0.18em] hover:bg-[#0EA271] transition-all disabled:opacity-50"
            >
                <Save size={13} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
        </div>
    );
}

// ─── Small controls (house style) ────────────────────────────────

function Group({ title, blurb, children }) {
    return (
        <div className="px-7 py-6">
            <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#888888] mb-1">{title}</h3>
            {blurb && <p className="text-[12px] text-[#999999] leading-relaxed mb-4 max-w-2xl">{blurb}</p>}
            {!blurb && <div className="mb-4" />}
            <div className="space-y-5">{children}</div>
        </div>
    );
}

function Field({ label, hint, children }) {
    return (
        <div className="flex items-start gap-6 flex-wrap">
            <div className="w-52 shrink-0 pt-2">
                <span className="text-[13.5px] font-semibold text-[#1A1A1A] leading-tight block">{label}</span>
                {hint && <span className="text-[11.5px] text-[#999999] leading-snug block mt-0.5">{hint}</span>}
            </div>
            <div className="flex-1 min-w-[240px]">{children}</div>
        </div>
    );
}

function TextInput({ value, onChange, mono }) {
    return (
        <input
            type="text"
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            className={`w-full max-w-md h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none transition-all focus:border-[#10B981]/40 ${mono ? 'font-mono' : ''}`}
        />
    );
}

const parseRules = (text) => text.split('\n').map(s => s.trim()).filter(Boolean);

/**
 * One rule per line ↔ jsonb string array. The canonical form value is the
 * ARRAY (so the JSON.stringify dirty comparison is stable against the saved
 * row) but the textarea needs its own text buffer: parsing on every
 * keystroke would eat the trailing newline the user just typed. The buffer
 * re-seeds only when the canonical value diverges from what the buffer
 * parses to — i.e. Discard or switching events, never our own keystrokes.
 */
function RulesField({ value, onChange }) {
    const [text, setText] = useState((value ?? []).join('\n'));
    useEffect(() => {
        if (JSON.stringify(parseRules(text)) !== JSON.stringify(value ?? [])) {
            setText((value ?? []).join('\n'));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on external value changes only
    }, [value]);
    return (
        <textarea
            value={text}
            onChange={e => { setText(e.target.value); onChange(parseRules(e.target.value)); }}
            spellCheck={false}
            className="w-full max-w-md h-28 px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none transition-all focus:border-[#10B981]/40 resize-y"
        />
    );
}

function NumberInput({ value, onChange, min, max, unit }) {
    return (
        <div className="relative inline-block">
            <input
                type="number"
                value={value ?? 0}
                min={min} max={max}
                onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value || '0', 10))))}
                className={`w-36 h-11 px-4 ${unit ? 'pr-16' : ''} bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#10B981]/40 transition-all`}
            />
            {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#999999] font-black uppercase tracking-[0.15em] pointer-events-none">{unit}</span>}
        </div>
    );
}

function DateTimeInput({ value, onChange, clearable }) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="datetime-local"
                value={isoToLocal(value)}
                onChange={e => onChange(localToIso(e.target.value))}
                className="h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#10B981]/40 transition-all"
            />
            {clearable && value && (
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    aria-label="Clear"
                    className="w-9 h-9 rounded-lg bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-all"
                >
                    <X size={13} />
                </button>
            )}
        </div>
    );
}

function Toggle({ on, onFlip }) {
    return (
        <div className="flex items-center gap-3 pt-1">
            <button
                type="button" role="switch" aria-checked={on} onClick={onFlip}
                className={`relative w-14 h-8 rounded-full transition-colors ${on ? 'bg-[#10B981]' : 'bg-[#D8D8D2]'}`}
            >
                <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${on ? 'text-[#10B981]' : 'text-[#BBBBBB]'}`}>{on ? 'On' : 'Off'}</span>
        </div>
    );
}

function Chip({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`h-9 px-3.5 rounded-full border text-[11px] font-bold tracking-wide transition-all ${
                active
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#0B7A57]'
                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888888] hover:text-[#1A1A1A]'
            }`}
        >
            {children}
        </button>
    );
}

// null = all types count (the server treats a null list as no filter).
function ActivityGrid({ value, onChange }) {
    const all = value == null;
    return (
        <div className="flex gap-2 flex-wrap">
            <Chip active={all} onClick={() => onChange(all ? [...ACTIVITIES] : null)}>All types</Chip>
            {ACTIVITIES.map(a => {
                const on = all || value?.includes(a);
                return (
                    <Chip
                        key={a}
                        active={on && !all}
                        onClick={() => {
                            const base = all ? [...ACTIVITIES] : (value ?? []);
                            onChange(on ? base.filter(x => x !== a) : [...base, a]);
                        }}
                    >
                        {a}
                    </Chip>
                );
            })}
        </div>
    );
}

function PrizeEditor({ prizes, onChange }) {
    const rows = Array.isArray(prizes) ? prizes : [];
    const setRow = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    return (
        <div className="space-y-2.5">
            {rows.length === 0 && <p className="text-[12px] text-[#999999]">No prizes configured.</p>}
            {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                    <div className="relative">
                        <input
                            type="number" min={1} max={100} value={r.rank ?? i + 1}
                            onChange={e => setRow(i, { rank: parseInt(e.target.value || '1', 10) })}
                            className="w-20 h-10 px-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-center text-[#1A1A1A] outline-none focus:border-[#10B981]/40"
                            aria-label="Rank"
                        />
                    </div>
                    <input
                        type="text" value={r.label ?? ''} placeholder="Prize label"
                        onChange={e => setRow(i, { label: e.target.value })}
                        className="flex-1 max-w-md h-10 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#10B981]/40"
                        aria-label="Prize label"
                    />
                    <button
                        type="button" aria-label="Remove prize"
                        onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                        className="w-10 h-10 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-[#F43F5E] transition-all"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...rows, { rank: rows.length + 1, label: '' }])}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all"
            >
                <Plus size={13} /> Add prize
            </button>
        </div>
    );
}

// Image-only upload for the POWR side of the card's partnership lockup. Same
// bucket story as promo media (reward-images — the one admins already have
// storage policies for), under event-logos/. The preview mirrors the app
// card: a DARK tile, because the mark sits raw on the artwork — a white
// upload judged on a white background looks like a blank block (it did).
function EventLogoField({ value, onChange }) {
    const toast = useToast();
    const [uploading, setUploading] = useState(false);

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { toast.error('Keep the logo under 5MB'); return; }
        setUploading(true);
        try {
            const url = await uploadPublicImage('reward-images', file, 'event-logos');
            onChange(url);
            toast.success('Logo uploaded — save to apply');
        } catch (err) {
            toast.error(err.message ?? 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex items-center gap-3 flex-wrap">
            <label className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all cursor-pointer bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2] ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={13} /> {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload'}
                <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            {value && (
                <>
                    <span className="inline-flex items-center px-3 py-2 rounded-[10px] bg-[#141414] border border-[#E6E6E1]">
                        <img src={storageImage(value, 168)} alt="Event logo preview" className="h-[30px] w-[84px] object-contain" />
                    </span>
                    <button
                        type="button" aria-label="Remove logo"
                        onClick={() => onChange(null)}
                        className="w-9 h-9 rounded-lg bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-all"
                    >
                        <X size={13} />
                    </button>
                </>
            )}
        </div>
    );
}

// URL field + direct upload for the promo background. Uploads land in the
// reward-images bucket (the one admins already have storage policies for)
// under event-promo/. The preview renders whatever the page would: video
// extensions get a muted looping <video>, anything else an <img>.
const PROMO_VIDEO_EXT = /\.(mp4|m3u8|webm|mov)(\?|#|$)/i;

function PromoMediaField({ value, onChange }) {
    const toast = useToast();
    const [uploading, setUploading] = useState(false);

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 80 * 1024 * 1024) { toast.error('Keep promo media under 80MB'); return; }
        setUploading(true);
        try {
            const url = await uploadPublicImage('reward-images', file, 'event-promo');
            onChange(url);
            toast.success('Media uploaded — save to apply');
        } catch (err) {
            toast.error(err.message ?? 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={e => onChange(e.target.value.trim() || null)}
                    placeholder="https://…/promo.mp4 or image URL"
                    className="w-full max-w-md h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm font-mono text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#10B981]/40 transition-all"
                />
                <label className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all cursor-pointer bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2] ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload'}
                    <input
                        type="file"
                        accept="image/*,video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        onChange={handleFile}
                        disabled={uploading}
                    />
                </label>
            </div>
            {value && (
                <div className="w-full max-w-md rounded-xl overflow-hidden border border-[#E6E6E1] bg-[#080808]">
                    {PROMO_VIDEO_EXT.test(value) ? (
                        <MediaVideo src={value} muted loop autoPlay playsInline className="w-full h-32 object-cover" />
                    ) : (
                        <img src={storageImage(value, 960)} alt="Promo background preview" className="w-full h-32 object-cover" />
                    )}
                </div>
            )}
        </div>
    );
}

function VenuePicker({ venueId, venueName, onPick }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) { setResults([]); return; }
        const t = setTimeout(async () => {
            const { data } = await supabase.from('partners').select('id, name').ilike('name', `%${q}%`).limit(8);
            setResults(data ?? []);
        }, 250);
        return () => clearTimeout(t);
    }, [query]);

    if (venueId) {
        return (
            <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-sm text-[#1A1A1A]">
                    {venueName ?? venueId}
                </span>
                <button
                    type="button" aria-label="Clear venue"
                    onClick={() => onPick(null, null)}
                    className="w-9 h-9 rounded-lg bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-[#1A1A1A] transition-all"
                >
                    <X size={13} />
                </button>
            </div>
        );
    }

    return (
        <div className="relative max-w-md">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
            <input
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                placeholder="Search venues…"
                className="w-full h-11 pl-10 pr-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#10B981]/40 transition-all"
            />
            {open && results.length > 0 && (
                <div className="absolute z-10 top-12 left-0 right-0 bg-white border border-[#E6E6E1] rounded-xl shadow-lg overflow-hidden">
                    {results.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => { onPick(p.id, p.name); setQuery(''); setOpen(false); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-[#333333] hover:bg-[#FAFAF8] transition-colors"
                        >
                            {p.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
