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
    ImagePlus, LoaderCircle, DoorOpen, MapPin, ChevronDown, Timer, ArrowLeft, ArrowRight,
    Sigma, Scale, BellRing, Send,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import { validateHeroVideoUrl } from '../../lib/heroVideoUrl';
import MediaVideo from '../../components/MediaVideo';
import { eventRegisterUrl } from '../../lib/eventRegisterUrl';
import { formatMemberId, normalizeMemberId } from '../../../../shared/memberId.ts';
import {
    DOOR_POLL_MS, bandInfo, doorCsv, doorTotals, filterDoorRows, gateLabel, gateMet,
    presence, searchDoorRows, sortDoorRows,
} from '../../../../shared/eventDoor.ts';
import {
    BUCKETS as SCORE_BUCKETS, activeBuckets, bucketLabel, excludedSummary, ledgerRowTitle, reasonIsSwitch, reasonLabel,
    rowName, ruleChips, scoringCsv, scoringTotals, searchScoringRows,
} from '../../../../shared/eventScoring.ts';

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

// Three buckets, because that's how the list is actually used: things
// you're still writing, the one you're running, and the pile you keep
// for the record. Everything between scheduled and settled is "active"
// — a settled event still gets its results read off it.
const BUCKETS = [
    ['active',   'Active'],
    ['draft',    'Drafts'],
    ['archived', 'Archived'],
];
const bucketOf = (ev) => (ev.status === 'draft' ? 'draft' : ev.status === 'archived' ? 'archived' : 'active');

const fmtDT = (iso) => iso
    ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

// Mirrors shortDate() in lib/liveEventDisplay.ts — this is the app's own
// wording, so what the note below the date fields quotes is what the home
// card actually prints. Keep the two in step if either moves.
const fmtDay = (iso) => iso
    ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    : '—';

// Mirrors eventNightLine() in lib/liveEventDisplay.ts — 12-hour, ":00" dropped
// on a whole hour, so the admin sees the app's exact "Fri 4 Sept, 7pm" wording.
const fmtDayTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
        .replace(/:00(?=\s*[ap]\.?m)/i, '').replace(/\s+/g, '').toLowerCase();
    return `${fmtDay(iso)}, ${time}`;
};

// The window is half-open [start, end): the last day anyone can score is the
// minute before it closes, not the boundary itself.
const fmtLastDay = (iso) => iso ? fmtDay(new Date(new Date(iso).getTime() - 60_000).toISOString()) : '—';

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
    doors_open_at: ev.doors_open_at,
    doors_close_at: ev.doors_close_at,
    eligibility_cutoff_at: ev.eligibility_cutoff_at,
    scope: ev.scope,
    board_size: ev.board_size,
    included_activities: ev.included_activities,
    count_manual: ev.count_manual,
    count_streak: ev.count_streak,
    count_walking: ev.count_walking,
    count_challenges: ev.count_challenges ?? false,
    count_bonuses: ev.count_bonuses ?? false,
    count_referrals: ev.count_referrals ?? false,
    reward_referrals_on_signup: ev.reward_referrals_on_signup ?? false,
    count_adjustments: ev.count_adjustments ?? true,
    attendance_bonus_points: ev.attendance_bonus_points ?? 0,
    invite_bonus_points: ev.invite_bonus_points,
    invite_milestone_n: ev.invite_milestone_n,
    invite_milestone_bonus: ev.invite_milestone_bonus,
    conversion_deadline_at: ev.conversion_deadline_at,
    conversion_verifications: ev.conversion_verifications,
    conversion_activities: ev.conversion_activities,
    entry_gate_n: ev.entry_gate_n,
    entry_gate_counting: ev.entry_gate_counting,
    entry_gate_since: ev.entry_gate_since,
    entry_gate_mode: ev.entry_gate_mode ?? 'deadline',
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
    const [scoring, setScoring] = useState(null);     // admin_get_event_scoring payload
    const [ledgers, setLedgers] = useState({});       // user_id → admin_get_event_user_ledger payload (undefined = not loaded, null = failed)
    const [adjBusy, setAdjBusy] = useState(null);     // user_id of the score adjustment in flight
    const [registrations, setRegistrations] = useState(null); // admin_get_event_registrations payload
    const [bookings, setBookings] = useState(null);   // admin_get_event_bookings payload
    const [door, setDoor] = useState(null);           // admin_get_event_door payload
    const [doorBusy, setDoorBusy] = useState(null);   // user_id of the manual mark in flight
    const [bookingsBusy, setBookingsBusy] = useState(false);
    const [rosterBusy, setRosterBusy] = useState(null);  // 'add' | user_id of the roster edit in flight
    const [pulseSends, setPulseSends] = useState([]);    // live_event_pulse_sends, newest first
    const [pulseBusy, setPulseBusy] = useState(null);    // 'rank' | 'gate' action in flight
    const [tab, setTab] = useState('active');
    const lastOpsEventId = useRef(null);           // guards against showing event A's ops data under event B

    const selected = useMemo(() => events.find(e => e.id === selectedId) ?? null, [events, selectedId]);

    const bucketCounts = useMemo(() => events.reduce(
        (acc, e) => { acc[bucketOf(e)] += 1; return acc; },
        { active: 0, draft: 0, archived: 0 },
    ), [events]);
    const visibleEvents = useMemo(() => events.filter(e => bucketOf(e) === tab), [events, tab]);

    // A tab must never hide the event you are standing in. Archiving the
    // selected event moves it out of Active, and the honest response is
    // to follow it rather than silently drop the panel you're working in.
    useEffect(() => {
        if (selected && bucketOf(selected) !== tab) setTab(bucketOf(selected));
    }, [selected]);   // eslint-disable-line react-hooks/exhaustive-deps

    // On a first load with nothing running, land on a tab that has
    // something in it instead of an empty Active.
    const landed = useRef(false);
    useEffect(() => {
        if (landed.current || loading || events.length === 0) return;
        landed.current = true;
        if (bucketCounts.active === 0) {
            setTab(bucketCounts.draft > 0 ? 'draft' : 'archived');
        }
    }, [loading, events, bucketCounts]);
    const dirty = useMemo(() => {
        if (!selected || !form) return false;
        return JSON.stringify(editableFields(selected)) !== JSON.stringify(form);
    }, [selected, form]);

    useEffect(() => { fetchEvents(); }, []);

    useEffect(() => {
        if (!selected) { setForm(null); setVenueName(null); setOps(null); setStandings(null); setDqRows([]); setAnticheat(null); setScoring(null); setLedgers({}); setRegistrations(null); setBookings(null); setDoor(null); setPulseSends([]); lastOpsEventId.current = null; return; }
        setForm(editableFields(selected));
        // Switching events must never show the previous event's ops data while
        // the new fetch is in flight; same-event refreshes keep what's there.
        if (selected.id !== lastOpsEventId.current) {
            lastOpsEventId.current = selected.id;
            setOps(null); setStandings(null); setDqRows([]); setAnticheat(null); setScoring(null); setLedgers({}); setRegistrations(null); setBookings(null); setDoor(null); setPulseSends([]);
        }
        fetchCounts(selected.id);
        fetchOps(selected.id);
        fetchScoring(selected.id);
        fetchRegistrations(selected.id);
        fetchBookings(selected.id);
        fetchDoor(selected.id);
        fetchPulseSends(selected.id);
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

    // The door board: roster × venue geofence × manual marks. Polled by the
    // panel itself while the door band is live; this is the one-shot load.
    const fetchDoor = async (eventId) => {
        const { data, error } = await supabase.rpc('admin_get_event_door', { p_event_id: eventId });
        if (error) { console.error(error); return; }
        // Never paint event A's door under event B (same guard as ops).
        if (lastOpsEventId.current !== eventId) return;
        setDoor(data);
    };

    // Mark / unmark arrived by hand. The RPC hands the refreshed board back.
const setCheckin = async (ev, row, present) => {
    setDoorBusy(row.user_id);
    try {
        const { data, error } = await supabase.rpc('admin_set_event_checkin', {
            p_event_id: ev.id, p_user_id: row.user_id, p_present: present,
        });
        if (error) { toast.error(error.message); return; }
        if (data && lastOpsEventId.current === ev.id) setDoor(data);
        await logAction(user.id, present ? 'live_event_checkin_marked' : 'live_event_checkin_cleared', 'live_event', ev.id, { target_user: row.user_id });
        toast.success(`${row.name} ${present ? 'marked arrived' : 'mark cleared'}`);
    } finally {
        setDoorBusy(null);
    }
};

    // Pay the event-night reward to everyone who attended and hasn't been
    // paid — door marks pay on the spot, this catches the walk-ins the fence
    // saw that nobody marked. Idempotent server-side; safe to press twice.
    const payAttendance = async (ev) => {
        if (!(ev.attendance_bonus_points > 0)) {
            toast.error('Set "Points for attending" under Scoring first'); return;
        }
        if (!window.confirm(`Pay ${ev.attendance_bonus_points} points to everyone who attended ${ev.name} and hasn't been paid yet?`)) return;
        setDoorBusy('pay_all');
        try {
            const { data, error } = await supabase.rpc('admin_pay_event_attendance', { p_event_id: ev.id });
            if (error) { toast.error(error.message); return; }
            if (data?.door && lastOpsEventId.current === ev.id) setDoor(data.door);
            await logAction(user.id, 'live_event_attendance_paid', 'live_event', ev.id, { paid: data?.paid, already: data?.already, points: data?.points });
            toast.success(data?.paid > 0
                ? `Paid ${data.points} pts to ${data.paid} ${data.paid === 1 ? 'person' : 'people'}${data.already > 0 ? ` · ${data.already} already paid` : ''}`
                : 'Everyone who attended has already been paid');
        } finally {
            setDoorBusy(null);
        }
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

    // ── Scoring breakdown ─────────────────────────────────────
    // What scored for whom. Same predicate as the board (the RPC reads the
    // labelled ledger the scorer filters), so these numbers are the app's
    // numbers with the working shown.
    const fetchScoring = async (eventId) => {
        const { data, error } = await supabase.rpc('admin_get_event_scoring', { p_event_id: eventId });
        if (error) console.error(error);
        if (lastOpsEventId.current !== eventId) return;
        // A failed load must read as a failure, never as "still loading".
        setScoring(error ? { error: error.message } : data);
    };

    // One person's rows, loaded when their breakdown is opened.
    const fetchUserLedger = async (eventId, userId) => {
        const { data, error } = await supabase.rpc('admin_get_event_user_ledger', { p_event_id: eventId, p_user_id: userId });
        if (error) console.error(error);
        if (lastOpsEventId.current !== eventId) return;
        setLedgers(prev => ({ ...prev, [userId]: error ? null : data }));
    };

    // Event-scoped: moves this board, never the wallet. Wallet corrections
    // stay on the member's admin profile. Returns true when applied so the
    // form can clear itself.
    const adjustScore = async (ev, row, amount, reason) => {
        const who = rowName(row);
        if (!Number.isFinite(amount) || amount === 0) { toast.error('Enter a non-zero amount'); return false; }
        if (!reason.trim()) { toast.error('Give a reason — it shows on the breakdown and in the audit log'); return false; }
        if (!window.confirm(
            `${amount > 0 ? 'Add' : 'Take'} ${Math.abs(amount)} points ${amount > 0 ? 'to' : 'from'} ${who}'s score on ${ev.name}? `
            + `This event only — their wallet is untouched.${counts.results > 0 ? ' Final results are already saved: press Re-settle afterwards so they pick it up.' : ''}`,
        )) return false;
        setAdjBusy(row.user_id);
        try {
            const { data, error } = await supabase.rpc('admin_adjust_event_score', {
                p_event_id: ev.id, p_user_id: row.user_id, p_amount: amount, p_reason: reason.trim(),
            });
            if (error) { toast.error(error.message); return false; }
            if (lastOpsEventId.current === ev.id) setLedgers(prev => ({ ...prev, [row.user_id]: data }));
            await logAction(user.id, 'live_event_score_adjust', 'live_event', ev.id,
                { target_user: row.user_id, amount, reason: reason.trim(), adjustment_id: data?.adjustment_id });
            toast.success(`${amount > 0 ? '+' : ''}${amount} on ${who}'s event score`);
            fetchScoring(ev.id);
            fetchOps(ev.id);
            return true;
        } finally {
            setAdjBusy(null);
        }
    };

    const removeScoreAdjustment = async (ev, row, adj) => {
        if (!window.confirm(`Remove the ${adj.amount > 0 ? '+' : ''}${adj.amount} adjustment ("${adj.reason}") from ${rowName(row)}? Their score goes back to what the ledger says.`)) return;
        setAdjBusy(row.user_id);
        try {
            const { data, error } = await supabase.rpc('admin_remove_event_score_adjustment', { p_id: adj.id });
            if (error) { toast.error(error.message); return; }
            if (lastOpsEventId.current === ev.id) setLedgers(prev => ({ ...prev, [row.user_id]: data }));
            await logAction(user.id, 'live_event_score_adjust_removed', 'live_event', ev.id,
                { target_user: row.user_id, amount: adj.amount, reason: adj.reason, adjustment_id: adj.id });
            toast.success('Adjustment removed');
            fetchScoring(ev.id);
            fetchOps(ev.id);
        } finally {
            setAdjBusy(null);
        }
    };

    const exportScoringCsv = (ev) => {
        const blob = new Blob([scoringCsv(scoring?.rows ?? [])], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${ev.slug}-scoring.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // Called from both the standings rows (display_name) and the roster
    // rows (name) — same action, two shapes of the same person.
    const disqualify = async (ev, row, disqualified) => {
        const who = row.display_name ?? row.name ?? row.username ?? 'this member';
        const verb = disqualified ? 'Disqualify' : 'Requalify';
        if (!window.confirm(`${verb} ${who} ${disqualified ? 'from' : 'for'} this event? Event-scoped only — their points are untouched.${disqualified && counts.results > 0 ? ' Re-settle afterwards so the frozen results drop them too.' : ''}`)) return;
        setDqBusy(row.user_id);
        const { error } = await supabase.rpc('admin_disqualify_from_event', {
            p_event_id: ev.id, p_user_id: row.user_id, p_disqualified: disqualified,
        });
        setDqBusy(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, disqualified ? 'live_event_disqualify' : 'live_event_requalify', 'live_event', ev.id, { target_user: row.user_id });
        toast.success(`${who} ${disqualified ? 'disqualified' : 'requalified'}`);
        fetchOps(ev.id);
        fetchScoring(ev.id);
        fetchCounts(ev.id);
        fetchRegistrations(ev.id);
    };

    // ── Roster edits ──────────────────────────────────────────
    // join_live_event speaks for the member and enforces the cutoff and
    // the status window; these speak for the door, and don't. Both RPCs
    // hand back the refreshed roster, so there's no second fetch.

    const addParticipants = async ({ emails = [], userIds = [] }) => {
        if (!selected) return;
        setRosterBusy('add');
        const { data, error } = await supabase.rpc('admin_add_event_participants', {
            p_event_id: selected.id, p_emails: emails, p_user_ids: userIds,
        });
        setRosterBusy(null);
        if (error) { toast.error(error.message); return null; }

        const added = data?.added ?? [];
        const already = data?.already ?? [];
        const missing = data?.missing_emails ?? [];
        if (data?.registrations) setRegistrations(data.registrations);
        fetchCounts(selected.id);
        if (selected.status !== 'draft') fetchOps(selected.id);
        if (added.length > 0) {
            await logAction(user.id, 'live_event_participants_added', 'live_event', selected.id,
                { count: added.length, user_ids: added.map(a => a.user_id) });
        }

        // Every pasted address lands in exactly one bucket — say all three,
        // because "2 added" out of 5 pasted is the sentence that costs
        // someone a place on the night.
        const parts = [added.length === 1 ? `${added[0].name} added` : `${added.length} added`];
        if (already.length > 0) parts.push(`${already.length} already registered`);
        if (missing.length > 0) parts.push(`${missing.length} with no POWR account`);
        const line = parts.join(' · ');
        if (added.length > 0) toast.success(line); else toast.error(line);
        return data;
    };

    const removeParticipant = async (row) => {
        if (!selected) return;
        const who = row.name ?? row.username ?? 'this member';
        if (!window.confirm(
            `Remove ${who} from this event? Their registration is deleted outright — joined time, booking handoff and any DQ history go with it, and they can register again from the app.\n\nDisqualify instead if the registration was real and you want the record kept.${counts.results > 0 ? '\n\nFinal results have already been saved — press Re-settle afterwards.' : ''}`,
        )) return;
        setRosterBusy(row.user_id);
        const { data, error } = await supabase.rpc('admin_remove_event_participant', {
            p_event_id: selected.id, p_user_id: row.user_id,
        });
        setRosterBusy(null);
        if (error) { toast.error(error.message); return; }
        if (data?.registrations) setRegistrations(data.registrations);
        fetchCounts(selected.id);
        if (selected.status !== 'draft') fetchOps(selected.id);
        await logAction(user.id, 'live_event_participant_removed', 'live_event', selected.id, { target_user: row.user_id });
        toast.success(data?.in_results
            ? `${who} removed — they're still in the saved final results, press Re-settle to remove them`
            : `${who} removed`);
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
            toast.error('Scoring end must be after scoring start'); return;
        }
        if (form.promo_media_url) {
            // Same rule as reward heroes: direct files only, never a
            // YouTube/Vimeo-style page link (images sail through).
            const { error: mediaError, warn: mediaWarn } = validateHeroVideoUrl(form.promo_media_url);
            if (mediaError) { toast.error(mediaError); return; }
            if (mediaWarn) toast.info(mediaWarn);
        }
        if (form.doors_open_at && form.doors_close_at && new Date(form.doors_close_at) <= new Date(form.doors_open_at)) {
            toast.error('Doors close must be after doors open'); return;
        }
        if (form.booking_url && !/^https?:\/\//i.test(form.booking_url)) {
            // Mirrors the DB check constraint — fail here with a usable
            // message instead of a constraint-violation toast.
            toast.error('Booking URL must start with http:// or https://'); return;
        }
        setSaving(true);
        const payload = {
            ...form,
            slug: slugify(form.slug),
            // NOT NULL on the row; the grid never emits null any more but a
            // working copy from before that fix may still hold one.
            conversion_activities: Array.isArray(form.conversion_activities) ? form.conversion_activities : [],
        };
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

    // Automatic lifecycle: a once-a-minute cron flips scheduled → live at the
    // scoring start and live → locked at the lock time. Default ON; turning it
    // off hands the buttons back to the admin. Instant write, outside the Save
    // payload like the other lifecycle knobs.
    const setAutoLifecycle = async (ev, enabled) => {
        setActing('auto-lifecycle');
        const { error } = await supabase.from('live_events')
            .update({ auto_lifecycle: enabled }).eq('id', ev.id);
        setActing(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_auto_lifecycle', 'live_event', ev.id, { enabled });
        toast.success(enabled ? 'Automatic lifecycle on' : 'Automatic lifecycle off — you press the buttons');
        fetchEvents();
    };

    // ── Pulse pushes (placement + referral gate) ──────────────
    // Per-registrant pushes composed server-side (live_event_send_pulse) —
    // a broadcast can't carry "you're #4" or "1 signup to go". Times are
    // instant writes outside the Save payload, like the lifecycle knobs.

    const fetchPulseSends = async (eventId) => {
        const { data } = await supabase.from('live_event_pulse_sends')
            .select('*').eq('event_id', eventId)
            .order('created_at', { ascending: false }).limit(20);
        setPulseSends(data ?? []);
    };

    const setPulseTime = async (ev, kind, value) => {   // value 'HH:MM' | null
        const col = kind === 'rank' ? 'notify_rank_at' : 'notify_gate_at';
        setPulseBusy(kind);
        const { error } = await supabase.from('live_events')
            .update({ [col]: value }).eq('id', ev.id);
        setPulseBusy(null);
        if (error) { toast.error(error.message); return; }
        await logAction(user.id, 'live_event_pulse_schedule', 'live_event', ev.id, { kind, at: value });
        toast.success(value
            ? `Daily ${kind === 'rank' ? 'placement' : 'referral reminder'} push at ${value} UK time`
            : `Daily ${kind === 'rank' ? 'placement' : 'referral reminder'} push off`);
        fetchEvents();
    };

    const sendPulseNow = async (ev, kind) => {
        const label = kind === 'rank' ? 'placement push' : 'referral reminder';
        setPulseBusy(kind);
        // Dry-run first: confirm against the real recipient count, not a guess.
        const { data: dry, error: dryErr } = await supabase.rpc('admin_send_event_pulse',
            { p_event_id: ev.id, p_kind: kind, p_dry_run: true });
        if (dryErr) { setPulseBusy(null); toast.error(dryErr.message); return; }
        const n = dry?.recipients ?? 0;
        if (n === 0) {
            setPulseBusy(null);
            toast.error(kind === 'rank'
                ? 'No one to send to — the board must be live, visible and before lock'
                : 'No one is short of the gate right now (or the deadline has passed)');
            return;
        }
        if (!window.confirm(`Send the ${label} to ${n} ${n === 1 ? 'person' : 'people'} now?`)) {
            setPulseBusy(null); return;
        }
        const { data, error } = await supabase.rpc('admin_send_event_pulse',
            { p_event_id: ev.id, p_kind: kind, p_dry_run: false });
        setPulseBusy(null);
        if (error) { toast.error(error.message); return; }
        const sent = data?.recipients ?? n;
        await logAction(user.id, 'live_event_pulse_send', 'live_event', ev.id, { kind, recipients: sent });
        toast.success(`Sent to ${sent} ${sent === 1 ? 'person' : 'people'}`);
        fetchPulseSends(ev.id);
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
        toast.success(`Settled — ${data} final place${data === 1 ? '' : 's'} saved`);
        fetchCounts(ev.id);
        fetchEvents();
    };

    const revealEvent = async (ev) => {
        if (counts.results === 0) { toast.error('Press Settle first — there are no saved results to reveal yet'); return; }
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
                <>
                <div className="flex items-center gap-2 mb-5">
                    {BUCKETS.map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`inline-flex items-center gap-2 h-10 px-5 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all ${
                                tab === key
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]'
                            }`}
                        >
                            {label}
                            <span className={`text-[10px] font-mono ${tab === key ? 'text-white/50' : 'text-[#AAAAAA]'}`}>
                                {bucketCounts[key]}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#F0F0EC] mb-10">
                    {visibleEvents.length === 0 && (
                        <p className="px-7 py-10 text-center text-[13px] text-[#999999]">
                            {tab === 'active'
                                ? 'Nothing running — scheduled, live, locked, revealed and settled events land here.'
                                : tab === 'draft'
                                    ? 'No drafts. New events start here, invisible to the app.'
                                    : 'Nothing archived yet.'}
                        </p>
                    )}
                    {visibleEvents.map(ev => {
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
                                        Scoring {fmtDT(ev.window_start_at)} → {fmtDT(ev.window_end_at)} · {ev.scope === 'opt_in' ? 'Opt-in' : 'Global'}
                                    </p>
                                </div>
                                <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{isSel ? 'Close' : 'Manage'}</span>
                            </button>
                        );
                    })}
                </div>
                </>
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
                        onSetAutoLifecycle={(enabled) => setAutoLifecycle(selected, enabled)}
                    />

                    <PulsePanel
                        ev={selected}
                        sends={pulseSends}
                        busy={pulseBusy}
                        onSetTime={(kind, value) => setPulseTime(selected, kind, value)}
                        onSendNow={(kind) => sendPulseNow(selected, kind)}
                    />

                    <RegistrationsPanel
                        ev={selected}
                        data={registrations}
                        busy={rosterBusy ?? dqBusy}
                        onRefresh={() => fetchRegistrations(selected.id)}
                        onAdd={addParticipants}
                        onRemove={removeParticipant}
                        onDisqualify={(row, dq) => disqualify(selected, row, dq)}
                    />

                    <DoorPanel
                        ev={selected}
                        data={door}
                        busy={doorBusy}
                        onRefresh={() => fetchDoor(selected.id)}
                        onMark={(row, present) => setCheckin(selected, row, present)}
                        onPayAll={() => payAttendance(selected)}
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

                    {selected.status !== 'draft' && (
                        <ScoringPanel
                            ev={selected}
                            data={scoring}
                            ledgers={ledgers}
                            busy={adjBusy}
                            resultsCount={counts.results}
                            onRefresh={() => fetchScoring(selected.id)}
                            onOpenUser={(userId) => fetchUserLedger(selected.id, userId)}
                            onAdjust={(row, amount, reason) => adjustScore(selected, row, amount, reason)}
                            onRemoveAdjustment={(row, adj) => removeScoreAdjustment(selected, row, adj)}
                            onExportCsv={() => exportScoringCsv(selected)}
                        />
                    )}

                    <EditorPanel
                        key={selected.id}
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

// ─── Pulse notifications ─────────────────────────────────────────
// Placement ("you're #4 today") and referral-gate ("1 signup to go")
// pushes, composed per registrant by live_event_send_pulse. This panel
// only holds the controls: a daily send time per kind (UK time — the
// venue's clock, fired once per day by a 5-min cron) and a Send now
// that dry-runs for the recipient count before confirming.

function PulseRow({ title, desc, kind, value, lastSend, busy, onSetTime, onSendNow, inactiveNote }) {
    const current = value ? value.slice(0, 5) : '';
    const [draft, setDraft] = useState(current);
    useEffect(() => { setDraft(current); }, [current]);
    const dirty = draft !== current;

    return (
        <div className="py-5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                    <p className="text-[13px] font-bold text-[#1A1A1A]">{title}</p>
                    <p className="text-[12px] text-[#888888] leading-relaxed mt-0.5">{desc}</p>
                    {lastSend && (
                        <p className="text-[11px] text-[#999999] mt-1.5">
                            Last sent {fmtDT(lastSend.created_at)} · {lastSend.recipients} recipient{lastSend.recipients === 1 ? '' : 's'} · {lastSend.source === 'auto' ? 'scheduled' : 'manual'}
                        </p>
                    )}
                    {inactiveNote && (
                        <p className="text-[11px] text-[#B45309] mt-1.5 inline-flex items-center gap-1.5">
                            <AlertTriangle size={11} /> {inactiveNote}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="time"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        disabled={!!busy}
                        className="h-10 px-3 rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] text-[13px] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] disabled:opacity-40"
                    />
                    {dirty && draft && (
                        <button
                            onClick={() => onSetTime(kind, draft)}
                            disabled={!!busy}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all bg-[#1A1A1A] border-[#1A1A1A] text-white hover:bg-[#333333] disabled:opacity-40"
                        >
                            <Check size={13} /> Set {draft}
                        </button>
                    )}
                    {current && (
                        <button
                            onClick={() => onSetTime(kind, null)}
                            disabled={!!busy}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15 disabled:opacity-40"
                        >
                            <X size={13} /> Off
                        </button>
                    )}
                    <button
                        onClick={() => onSendNow(kind)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.18em] transition-all bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2] disabled:opacity-40"
                    >
                        {busy === kind ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />} Send now
                    </button>
                </div>
            </div>
            <p className="text-[11px] text-[#AAAAAA] mt-2">
                {current
                    ? `Sends every day at ${current} UK time (once per day — a manual send doesn't stop it).`
                    : 'No daily send — set a time, or use Send now for one-offs.'}
            </p>
        </div>
    );
}

function PulsePanel({ ev, sends, busy, onSetTime, onSendNow }) {
    const last = (kind) => (sends ?? []).find(s => s.kind === kind) ?? null;
    const rankInactive =
        ev.status !== 'live' ? 'Only sends while the event is live — nothing goes out right now.'
        : ev.hidden ? 'The board is hidden — placement pushes pause until it\'s visible again.'
        : (ev.lock_at && new Date(ev.lock_at) <= new Date()) ? 'Past the lock time — placement pushes have stopped.'
        : null;
    const gateDeadline = ev.conversion_deadline_at ?? ev.lock_at ?? ev.window_end_at;
    const gateInactive =
        !(ev.entry_gate_n > 0) ? null
        : (gateDeadline && new Date(gateDeadline) <= new Date()) ? 'The gate deadline has passed — reminders have stopped.'
        : null;

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#3B82F6]/[0.08] border-[#3B82F6]/25">
                    <BellRing size={18} className="text-[#3B82F6]" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Pulse notifications</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        Personal pushes with each registrant&apos;s own numbers — their rank, their signup count.
                        Broadcast campaigns can&apos;t do this; they send everyone the same words.
                    </p>
                </div>
                <div className="flex-1 h-[1.5px] rounded-full bg-gradient-to-r from-[#3B82F6]/25 to-transparent" />
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 divide-y divide-[#F0F0EC]">
                <PulseRow
                    kind="rank"
                    title="Daily placement push"
                    desc={'"You\'re #4 today — 26 POWR behind #3." Goes to everyone on the board with their rank, points and movement since the scoring day began (the same ▲/▼ the app shows). Only while the board is live and visible — never from a sealed board.'}
                    value={ev.notify_rank_at}
                    lastSend={last('rank')}
                    busy={busy}
                    onSetTime={onSetTime}
                    onSendNow={onSendNow}
                    inactiveNote={rankInactive}
                />
                {ev.entry_gate_n > 0 ? (
                    <PulseRow
                        kind="gate"
                        title="Referral gate reminder"
                        desc={`"1 more signup to go." Only registrants still short of the ${ev.entry_gate_n}-${ev.entry_gate_counting === 'conversions' ? 'workout' : 'signup'} gate get it, with their own count and the deadline. Keeps running after lock — the gate deadline is later.`}
                        value={ev.notify_gate_at}
                        lastSend={last('gate')}
                        busy={busy}
                        onSetTime={onSetTime}
                        onSendNow={onSendNow}
                        inactiveNote={gateInactive}
                    />
                ) : (
                    <div className="pt-5">
                        <p className="text-[12px] text-[#999999]">
                            No entry gate on this event — the referral reminder appears when one is set in Configuration.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}

// ─── Door board ──────────────────────────────────────────────────
// Who's registered, who's qualified, who's actually in the building.
// Presence comes from the venue geofence (live_events.venue_partner_id →
// gym_visits.partner_id) plus a manual mark for the door staff — the
// fence needs the app, Always+Precise and a live device, so it
// under-counts and never over-counts. Every judgement (inside vs
// inside? vs left, tile maths, ordering) lives in shared/eventDoor.ts
// with jest coverage; this component only renders.

const PRESENCE_TONE = {
    inside:       { color: '#10B981', bg: '#10B98114', border: '#10B98144' },
    inside_stale: { color: '#B45309', bg: '#F59E0B14', border: '#F59E0B55' },
    manual:       { color: '#2563EB', bg: '#3B82F614', border: '#3B82F655' },
    left:         { color: '#6B7280', bg: '#9CA3AF14', border: '#9CA3AF55' },
    not_seen:     { color: '#BBBBBB', bg: 'transparent', border: '#E6E6E1' },
};

const DOOR_FILTERS = [
    ['all', 'Everyone'],
    ['qualified', 'Qualified'],
    ['arrived', 'Arrived'],
    ['not_arrived', 'Not arrived'],
    ['walk_ins', 'Walk-ins'],
];

function DoorPanel({ ev, data, busy, onRefresh, onMark, onPayAll }) {
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [now, setNow] = useState(() => Date.now());

    const [openGate, setOpenGate] = useState(null);   // user_id whose gate friends are expanded

    // Filters must not follow you onto the next event.
    useEffect(() => { setFilter('all'); setQuery(''); setOpenGate(null); }, [ev.id]);

    const event = data?.event ?? null;
    const rows = useMemo(() => data?.rows ?? [], [data]);
    const gateN = event?.gate_n ?? ev.entry_gate_n ?? 0;
    const band = useMemo(() => (event ? bandInfo(event, now) : null), [event, now]);

    // Auto-refresh while the door band is live (and the tab is visible).
    // The clock tick re-evaluates "inside" vs "inside?" between fetches.
    const live = !!band?.live && !['settled', 'archived'].includes(ev.status);
    useEffect(() => {
        if (!live) return undefined;
        const id = setInterval(() => {
            setNow(Date.now());
            if (document.visibilityState === 'visible') onRefresh();
        }, DOOR_POLL_MS);
        return () => clearInterval(id);
    }, [live, ev.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const totals = useMemo(() => doorTotals(rows, gateN, now), [rows, gateN, now]);
    const shown = useMemo(
        () => sortDoorRows(searchDoorRows(filterDoorRows(rows, filter, gateN, now), query), now),
        [rows, filter, gateN, query, now],
    );

    const exportCsv = () => {
        const blob = new Blob([doorCsv(rows, gateN, now)], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${ev.slug}-door.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';

    const Stat = ({ label, value, tone }) => (
        <div className={`rounded-2xl border p-4 ${tone}`}>
            <div className="text-[26px] font-bold leading-none tracking-tight">{value}</div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] mt-2 opacity-70">{label}</div>
        </div>
    );

    const hasVenue = !!(event ? event.venue_partner_id : ev.venue_partner_id);

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#10B981]/10 border-[#10B981]/25">
                    <DoorOpen size={18} className="text-[#10B981]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Door</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        Who&rsquo;s registered, who&rsquo;s qualified, and who has been detected arriving at {event?.venue_name ? event.venue_name : 'the venue'}.
                        Automatic detection can miss people (it needs the app installed, location set to Always + Precise, and a phone with signal) but
                        it never counts someone who isn&rsquo;t there. Use the Mark arrived button for anyone it missed.
                        {band && <> <span className={band.fallback ? 'text-[#B45309]' : ''}>{band.label}.</span></>}
                    </p>
                </div>
                {live && (
                    <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#10B981] shrink-0">
                        <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" /> Live
                    </span>
                )}
                <button
                    onClick={exportCsv}
                    disabled={rows.length === 0}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all shrink-0 disabled:opacity-40"
                >
                    <Download size={13} /> CSV
                </button>
                <button
                    onClick={() => { setNow(Date.now()); onRefresh(); }}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all shrink-0"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
                {(event?.attendance_bonus_points ?? ev.attendance_bonus_points) > 0 && (
                    // Door marks pay on the spot; this is for the walk-ins the
                    // fence saw that nobody marked. Server-side idempotent.
                    <button
                        onClick={onPayAll}
                        disabled={busy === 'pay_all' || ev.status === 'archived'}
                        title={`Pay ${event?.attendance_bonus_points ?? ev.attendance_bonus_points} pts to everyone who attended and hasn't been paid`}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#1A1A1A] border border-[#1A1A1A] text-[10.5px] font-bold uppercase tracking-[0.18em] text-white hover:bg-[#333333] transition-all shrink-0 disabled:opacity-40"
                    >
                        {busy === 'pay_all' ? <LoaderCircle size={13} className="animate-spin" /> : <UserCheck size={13} />}
                        Pay attendance{event?.attendance_paid > 0 ? ` · ${event.attendance_paid} paid` : ''}
                    </button>
                )}
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-6">
                {!hasVenue && (
                    <div className="flex items-start gap-3 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 px-4 py-3 text-[12px] text-[#92400E]">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>No venue is set on this event, so arrivals can't be detected automatically — only people you mark by hand will show here. Pick the venue under Configuration below.</span>
                    </div>
                )}
                {band?.fallback && hasVenue && (
                    <div className="flex items-start gap-3 rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 px-4 py-3 text-[12px] text-[#92400E]">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>Set <strong>Doors open</strong> / <strong>Doors close</strong> in the editor so only event-night visits count as arrivals.</span>
                    </div>
                )}

                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    <Stat label="Registered" value={totals.registered} tone="bg-[#8B5CF6]/5 border-[#8B5CF6]/20 text-[#6D28D9]" />
                    <Stat label={gateN > 0 ? `Qualified (${gateN})` : 'Qualified'} value={totals.qualified} tone="bg-[#0EA5E9]/5 border-[#0EA5E9]/20 text-[#0369A1]" />
                    <Stat label="Booked" value={totals.booked} tone="bg-[#F4F4F1] border-[#E6E6E1] text-[#555555]" />
                    <Stat label="Arrived" value={totals.arrived} tone="bg-[#16A34A]/5 border-[#16A34A]/20 text-[#16A34A]" />
                    <Stat label="Inside now" value={totals.inside} tone="bg-[#10B981]/10 border-[#10B981]/30 text-[#047857]" />
                    <Stat label="Walk-ins" value={totals.walkIns} tone="bg-[#F59E0B]/5 border-[#F59E0B]/20 text-[#B45309]" />
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {DOOR_FILTERS.map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setFilter(key)}
                                className={`h-8 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all ${
                                    filter === key
                                        ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                        : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A]'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Name, email or POWR ID…"
                            className="w-60 h-9 pl-9 pr-8 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[12px] text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#10B981]/40 transition-all"
                        />
                        {query && (
                            <button onClick={() => setQuery('')} aria-label="Clear door search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#1A1A1A]">
                                <X size={13} />
                            </button>
                        )}
                    </div>
                </div>

                {!data ? (
                    <p className="text-[12px] text-[#999999] py-6 text-center">Loading the door…</p>
                ) : shown.length === 0 ? (
                    <p className="text-[12px] text-[#999999] py-6 text-center">
                        {rows.length === 0
                            ? 'Nobody yet — registrations, detected arrivals and people you mark by hand all show here.'
                            : 'Nobody matches this filter.'}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12.5px]">
                            <thead>
                                <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#F0F0EC]">
                                    <th className="py-2 pr-3 text-left">Member</th>
                                    <th className="py-2 pr-3 text-left">Presence</th>
                                    <th className="py-2 pr-3 text-left">Registered</th>
                                    {gateN > 0 && <th className="py-2 pr-3 text-center">Gate</th>}
                                    <th className="py-2 pr-3 text-center">Booked</th>
                                    <th className="py-2 pr-3 text-left">Seen</th>
                                    <th className="py-2 text-right">Door</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F5F5F2]">
                                {shown.map(r => {
                                    const p = presence(r, now);
                                    const tone = PRESENCE_TONE[p.key];
                                    const met = gateMet(r, gateN);
                                    const isBusy = busy === r.user_id;
                                    return (
                                        <React.Fragment key={r.user_id}>
                                        <tr className={p.key === 'not_seen' ? '' : 'bg-[#FAFAF8]/60'}>
                                            <td className="py-2.5 pr-3 align-top">
                                                <div className="font-semibold text-[#1A1A1A] flex items-center gap-2">
                                                    <Link to={`/admin/users/${r.user_id}`} className="hover:underline">{r.name}</Link>
                                                    {r.disqualified_at && (
                                                        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[#EF4444]">DQ</span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-[#999999] flex items-center gap-2 flex-wrap">
                                                    {r.username && <span>@{r.username}</span>}
                                                    {r.member_id && <code className="font-mono">{formatMemberId(r.member_id)}</code>}
                                                    {r.email && <span className="truncate max-w-[220px]">{r.email}</span>}
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3 align-top">
                                                <span
                                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9.5px] font-black uppercase tracking-[0.18em]"
                                                    style={{ color: tone.color, backgroundColor: tone.bg, borderColor: tone.border }}
                                                >
                                                    {p.key === 'inside' || p.key === 'inside_stale' ? <MapPin size={10} /> : null}
                                                    {p.label}
                                                </span>
                                                <div className="text-[11px] text-[#999999] mt-1">{p.detail}</div>
                                            </td>
                                            <td className="py-2.5 pr-3 align-top">
                                                {r.on_roster
                                                    ? <span className="text-[#1A1A1A]">{fmtTime(r.joined_at)}</span>
                                                    : <span className="inline-flex px-2 py-0.5 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[9.5px] font-black uppercase tracking-[0.18em] text-[#B45309]">Walk-in</span>}
                                            </td>
                                            {gateN > 0 && (
                                                // On the night, "3 / 5" is the question "which
                                                // three?" — someone at the door is about to be
                                                // told they're short, and the names are the
                                                // difference between a decision and an argument.
                                                <td className={`py-2.5 pr-3 align-top text-center font-mono ${met ? 'text-[#16A34A]' : 'text-[#999999]'}`}>
                                                    {(r.gate_friends ?? []).length === 0 ? (
                                                        gateLabel(r, gateN)
                                                    ) : (
                                                        <button
                                                            onClick={() => setOpenGate(openGate === r.user_id ? null : r.user_id)}
                                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border transition-all ${
                                                                openGate === r.user_id
                                                                    ? 'bg-[#8B5CF6]/10 border-[#8B5CF6]/30 text-[#8B5CF6]'
                                                                    : 'border-transparent hover:border-[#E6E6E1] hover:bg-[#F4F4F1]'
                                                            }`}
                                                            title="Show which friends this counts"
                                                        >
                                                            {gateLabel(r, gateN)}
                                                            <ChevronDown size={11} className={openGate === r.user_id ? 'rotate-180' : ''} />
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                            <td className="py-2.5 pr-3 align-top text-center">
                                                {r.booked ? <Check size={14} className="inline text-[#16A34A]" /> : <span className="text-[#CCCCCC]">—</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 align-top text-[11px] text-[#777777]">
                                                {r.first_entered_at ? (
                                                    <>
                                                        <div>In {fmtTime(r.first_entered_at)}{r.platform ? ` · ${r.platform}` : ''}</div>
                                                        {r.visit_count > 1 && <div className="text-[#AAAAAA]">{r.visit_count} visits</div>}
                                                    </>
                                                ) : <span className="text-[#CCCCCC]">—</span>}
                                                {r.manual_checked_in_at && (
                                                    <div className="text-[#2563EB]">Marked {fmtTime(r.manual_checked_in_at)}{r.manual_by ? ` by ${r.manual_by}` : ''}</div>
                                                )}
                                                {r.attendance_paid_at && (
                                                    <div className="text-[#16A34A] font-semibold">Paid +{r.attendance_points} · {fmtTime(r.attendance_paid_at)}</div>
                                                )}
                                            </td>
                                            <td className="py-2.5 align-top text-right">
                                                {r.manual_checked_in_at ? (
                                                    <button
                                                        onClick={() => onMark(r, false)}
                                                        disabled={isBusy}
                                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#F4F4F1] border border-[#E6E6E1] text-[10px] font-bold uppercase tracking-[0.15em] text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40"
                                                    >
                                                        {isBusy ? <LoaderCircle size={12} className="animate-spin" /> : <X size={12} />} Clear mark
                                                    </button>
                                                ) : p.arrived ? (
                                                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#BBBBBB]">Geofence</span>
                                                ) : (
                                                    <button
                                                        onClick={() => onMark(r, true)}
                                                        disabled={isBusy || ev.status === 'archived'}
                                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1A1A1A] border border-[#1A1A1A] text-[10px] font-bold uppercase tracking-[0.15em] text-white hover:bg-[#333333] transition-all disabled:opacity-40"
                                                    >
                                                        {isBusy ? <LoaderCircle size={12} className="animate-spin" /> : <UserCheck size={12} />} Mark arrived
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {openGate === r.user_id && (
                                            <tr>
                                                <td colSpan={7} className="bg-[#FAFAF8] px-4 py-3">
                                                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#888888] mb-1.5">
                                                        {r.name}&rsquo;s invites — {gateLabel(r, gateN)} toward the gate
                                                    </div>
                                                    {/* Dense: no POWR ID column. This board is read
                                                        on a phone at a door, not at a desk. */}
                                                    <InviteeList people={r.gate_friends} dense />
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {data?.generated_at && (
                    <p className="text-[10px] text-[#BBBBBB] text-right">
                        Updated {new Date(data.generated_at).toLocaleTimeString('en-GB')}{live ? ' · auto-refreshing' : ''}
                    </p>
                )}
            </div>
        </section>
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
                        Paste the list of attendee emails from the venue&rsquo;s booking system. People are matched by email
                        only — if someone booked with a different email to their POWR account, they&rsquo;ll show as not matched.
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

// ─── Who is behind an invite count ───────────────────────────────
// Every invite number on this page (the roster's Invites cell, the
// door board's Gate cell, the ops funnel's Signups) opens into this.
// One component so the three can never describe the same people
// differently, and it always lists EVERY friend the member brought —
// the ones that don't count for this event are exactly the rows you
// need when someone asks why their total is lower than they expected.
//
// `people` is the server's _live_event_invitees payload; counts_for_event
// is its verdict, computed from the event's own basis. Never re-derive it.
function InviteeList({ people, dense = false }) {
    const fmt = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
    const rows = people ?? [];
    if (rows.length === 0) {
        return <p className="text-[12px] text-[#999999] py-1">Nobody has signed up with their code yet.</p>;
    }
    return (
        <table className="w-full text-[12.5px]">
            <thead>
                <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#AAAAAA] border-b border-[#F0F0EC]">
                    <th className="text-left py-1.5 pr-3">Friend</th>
                    {!dense && <th className="text-left py-1.5 pr-3">POWR ID</th>}
                    <th className="text-left py-1.5 pr-3">Signed up</th>
                    <th className="text-left py-1.5 pr-3">First workout</th>
                    <th className="text-left py-1.5 pl-3">Counts</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F6F6F3]">
                {rows.map((f, i) => (
                    <tr key={f.referred_id ?? i} className={f.counts_for_event ? '' : 'opacity-70'}>
                        <td className="py-1.5 pr-3">
                            <Link to={`/admin/users/${f.referred_id}`} className="font-medium text-[#1A1A1A] hover:underline">
                                {f.name}
                            </Link>
                            {f.email && <span className="font-mono text-[11px] text-[#AAAAAA]"> {f.email}</span>}
                        </td>
                        {!dense && (
                            <td className="py-1.5 pr-3 font-mono text-[11px] tracking-[0.12em] text-[#888888] whitespace-nowrap">
                                {formatMemberId(f.member_id) || '—'}
                            </td>
                        )}
                        <td className="py-1.5 pr-3 text-[#888888] whitespace-nowrap">{fmt(f.created_at)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                            {f.converted_at
                                ? <span className="text-[#10B981]">{fmt(f.converted_at)}</span>
                                : <span className="text-[#999999]">not yet</span>}
                        </td>
                        <td className="py-1.5 pl-3">
                            {f.counts_for_event ? (
                                <span className="inline-flex items-center h-5 px-2 rounded-md bg-[#10B981]/10 border border-[#10B981]/25 text-[#0f7a5a] text-[9px] font-black uppercase tracking-[0.15em]">
                                    Counts
                                </span>
                            ) : (
                                // Two ways to not count, and the difference decides
                                // whether it's worth chasing: a pending friend still
                                // can, one from before the window never will.
                                <span className="text-[11px] text-[#AAAAAA]">
                                    {f.converted_at ? 'before this event' : 'pending'}
                                </span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

// ─── Registrations & invites ─────────────────────────────────────
// Who registered + the invite pipeline + the actual bonus ledger rows,
// at any status (drafts included) — this is where a preview test run is
// checked against how the reward mechanics are supposed to pay out.

function RegistrationsPanel({ ev, data, busy, onRefresh, onAdd, onRemove, onDisqualify }) {
    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
    const [adding, setAdding] = useState(false);
    const [raw, setRaw] = useState('');
    const [missed, setMissed] = useState([]);   // addresses the last add couldn't resolve
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [filter, setFilter] = useState('');   // filters the roster below
    const [openInvites, setOpenInvites] = useState(null);   // user_id whose invitees are expanded

    // The panel isn't remounted per event, so an in-progress add and the
    // leftover misses must not follow you onto the next one.
    useEffect(() => {
        setAdding(false); setRaw(''); setMissed([]);
        setQuery(''); setResults([]); setFilter(''); setOpenInvites(null);
    }, [ev.id]);

    // Profile search. Email lives in auth.users where the portal client
    // has no read at all, so this has to go through the definer RPC —
    // which also tells us who is already on the roster, the thing you
    // actually want to know before clicking Add.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) { setResults([]); setSearching(false); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            const { data: rows, error } = await supabase.rpc('admin_search_event_candidates', {
                p_event_id: ev.id, p_query: q,
            });
            setSearching(false);
            if (error) { console.error(error); setResults([]); return; }
            setResults(rows ?? []);
        }, 250);
        return () => clearTimeout(t);
    }, [query, ev.id, data]);   // re-runs after an add so the chips follow the roster

    // Same parse as the booking export, previewed before the write for the
    // same reason: pasting a whole CSV column shouldn't silently add three
    // of the eight people you meant.
    const parsed = useMemo(
        () => Array.from(new Set(
            raw.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@') && s.length > 2),
        )),
        [raw],
    );

    // Adding is an opt-in-roster idea, and an archived event is closed for
    // edits — mirrors what the RPC will refuse.
    const canAdd = ev.scope === 'opt_in' && ev.status !== 'archived';

    const participants = useMemo(() => data?.participants ?? [], [data]);
    // Client-side, over the roster already in hand — the RPC caps at the
    // 500 newest, so this narrows what's loaded and never claims to
    // search past it.
    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return participants;
        // "ABCD 2345" read off a member's Settings screen is the stored ABCD2345.
        const code = normalizeMemberId(filter);
        return participants.filter(p =>
            [p.name, p.username, p.email].some(v => (v ?? '').toLowerCase().includes(q))
            || (!!code && code.length >= 3 && !!p.member_id && p.member_id.startsWith(code)));
    }, [participants, filter]);

    const referrals = data?.referrals ?? [];
    const milestones = data?.milestones ?? [];
    const ledger = data?.bonus_ledger ?? [];

    // What a member's invite count is counting TOWARDS, in the event's own
    // terms: the entry gate when one is set (it's the ticket), otherwise the
    // invite milestone. Both are what the app shows them, so the roster and
    // their phone read the same "3 / 5".
    const inviteTarget = ev.entry_gate_n > 0 ? ev.entry_gate_n : (ev.invite_milestone_n ?? 0);

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
                        Everyone who has registered, plus the invite rewards paid out — {ev.reward_referrals_on_signup
                            ? <>+{ev.invite_bonus_points} points to the inviter as soon as a friend signs up (the friend earns theirs on their first verified workout)</>
                            : <>+{ev.invite_bonus_points} points to both people for each friend who completes their first verified workout</>}, and +{ev.invite_milestone_bonus} at {ev.invite_milestone_n} friends.
                        Test registrations made while the event is a draft also show up here.
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
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">
                            Registered ({shown.length === participants.length
                                ? participants.length
                                : `${shown.length} of ${participants.length}`})
                        </div>
                        <div className="flex items-center gap-2">
                            {participants.length > 0 && (
                                <div className="relative">
                                    <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                                    <input
                                        type="text"
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        placeholder="Filter the roster…"
                                        className="w-56 h-9 pl-9 pr-8 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[12px] text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#8B5CF6]/40 transition-all"
                                    />
                                    {filter && (
                                        <button
                                            onClick={() => setFilter('')}
                                            aria-label="Clear roster filter"
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#1A1A1A]"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            )}
                            {canAdd && !adding && (
                                <button
                                    onClick={() => { setAdding(true); setMissed([]); }}
                                    className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 text-[#8B5CF6] text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#8B5CF6]/15 transition-all shrink-0"
                                >
                                    <Plus size={13} /> Add members
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Add by email. Bulk, because the input on the night is a
                        handful of addresses at once — and an admin add skips
                        the eligibility cutoff and the joining window that
                        stop the member doing it themselves. */}
                    {adding && (
                        <div className="rounded-2xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/[0.04] p-4 mb-4 space-y-3">
                            <p className="text-[12px] text-[#666666] leading-snug">
                                Search a profile by name, username or email, or paste a batch of addresses below.
                                Either way they go straight onto the list: <strong>the eligibility cutoff and the
                                event dates don&rsquo;t apply</strong>, so someone who signed up in the queue outside
                                still gets in. Someone with no POWR account can&rsquo;t be added — they need to download
                                the app first.
                            </p>

                            {/* Search — the path that doesn't assume you know the
                                address they signed up with. */}
                            <div className="relative">
                                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search members by name, username, email or POWR ID…"
                                    className="w-full h-11 pl-10 pr-4 bg-white border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#8B5CF6]/50 transition-all"
                                />
                            </div>
                            {query.trim().length >= 2 && (
                                <div className="rounded-xl border border-[#E6E6E1] bg-white overflow-hidden divide-y divide-[#F6F6F3]">
                                    {searching && results.length === 0 && (
                                        <p className="px-4 py-3 text-[12px] text-[#999999]">Searching…</p>
                                    )}
                                    {!searching && results.length === 0 && (
                                        <p className="px-4 py-3 text-[12px] text-[#999999]">
                                            No member matches &ldquo;{query.trim()}&rdquo;. If they&rsquo;ve just signed up,
                                            refresh — search reads live.
                                        </p>
                                    )}
                                    {results.map((r) => (
                                        <div key={r.user_id} className="flex items-center gap-3 px-4 py-2.5">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] font-medium text-[#1A1A1A] truncate">
                                                    {r.name}
                                                    {r.username && <span className="text-[#999999] font-normal"> @{r.username}</span>}
                                                </div>
                                                <div className="font-mono text-[11px] text-[#AAAAAA] truncate">
                                                    {r.email ?? 'no email on file'}
                                                    {r.member_id && <span className="text-[#777777]"> · {formatMemberId(r.member_id)}</span>}
                                                </div>
                                            </div>
                                            {/* Already-in is stated, not hidden: a missing row
                                                reads as "not found", which is a different answer. */}
                                            {r.on_roster ? (
                                                <span className={`text-[9.5px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg shrink-0 ${
                                                    r.disqualified
                                                        ? 'bg-[#F43F5E]/10 text-[#F43F5E]'
                                                        : 'bg-[#10B981]/10 text-[#10B981]'
                                                }`}>
                                                    {r.disqualified ? 'Disqualified' : 'Already in'}
                                                </span>
                                            ) : (
                                                <button
                                                    disabled={busy === 'add' || busy === r.user_id}
                                                    onClick={() => onAdd({ userIds: [r.user_id] })}
                                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] bg-[#8B5CF6]/10 border-[#8B5CF6]/25 text-[#8B5CF6] hover:bg-[#8B5CF6]/15 transition-all disabled:opacity-40 shrink-0"
                                                >
                                                    <Plus size={11} /> Add
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center gap-3 pt-1">
                                <div className="h-[1px] flex-1 bg-[#8B5CF6]/15" />
                                <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#AAAAAA]">or paste a batch</span>
                                <div className="h-[1px] flex-1 bg-[#8B5CF6]/15" />
                            </div>

                            <textarea
                                value={raw}
                                onChange={(e) => setRaw(e.target.value)}
                                rows={4}
                                placeholder="member@email.com, another@email.com"
                                className="w-full rounded-2xl border border-[#E6E6E1] bg-white p-4 font-mono text-[12px] text-[#1A1A1A] outline-none focus:border-[#8B5CF6]"
                            />
                            <div className="flex items-center gap-3 flex-wrap">
                                <button
                                    disabled={busy === 'add' || parsed.length === 0}
                                    onClick={async () => {
                                        const res = await onAdd({ emails: parsed });
                                        if (!res) return;                    // failed — keep what was typed
                                        setMissed(res.missing_emails ?? []);
                                        setRaw('');
                                        setAdding(false);
                                    }}
                                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#1A1A1A] text-white text-[10.5px] font-bold uppercase tracking-[0.18em] disabled:opacity-40"
                                >
                                    <Plus size={13} /> {busy === 'add' ? 'Adding…' : `Add ${parsed.length || ''}`.trim()}
                                </button>
                                <button
                                    onClick={() => { setAdding(false); setRaw(''); }}
                                    className="h-10 px-4 rounded-xl border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#888888]"
                                >
                                    Cancel
                                </button>
                                <p className="text-[12px] text-[#999999]">
                                    {parsed.length} valid {parsed.length === 1 ? 'address' : 'addresses'} — anyone already
                                    registered is left exactly as they are.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* The addresses that didn't land: the only part of an add
                        worth chasing after the toast has gone. */}
                    {missed.length > 0 && (
                        <div className="rounded-2xl border border-[#F59E0B]/25 bg-[#F59E0B]/[0.06] p-4 mb-4">
                            <div className="flex items-start gap-2">
                                <AlertTriangle size={13} className="text-[#B45309] mt-0.5 shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#B45309]">
                                        No POWR account ({missed.length}) — not added
                                    </div>
                                    <p className="font-mono text-[12px] text-[#8a6a20] mt-1 break-words">{missed.join(', ')}</p>
                                </div>
                                <button onClick={() => setMissed([])} className="ml-auto text-[#B45309] shrink-0"><X size={14} /></button>
                            </div>
                        </div>
                    )}

                    {participants.length === 0 ? (
                        <p className="text-[13px] text-[#999999]">Nobody has registered yet.</p>
                    ) : shown.length === 0 ? (
                        <p className="text-[13px] text-[#999999]">
                            No registered member matches &ldquo;{filter.trim()}&rdquo;. Use Add members to search
                            everyone, not just this roster.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <Head cols={[['Member'], ['Email'], ['POWR ID'], ['Invites'], ['Joined'], ['Opened booking'], ['Booked'], ['Status'], ['', 'text-right']]} />
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {shown.map((p) => (
                                        <React.Fragment key={p.user_id}>
                                        <tr className={p.disqualified_at ? 'opacity-45' : ''}>
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">
                                                {p.name}
                                                {p.username && <span className="text-[#999999] font-normal"> @{p.username}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 font-mono text-[12px] text-[#888888]">{p.email ?? '—'}</td>
                                            <td className="py-2.5 pr-3 font-mono text-[12px] tracking-[0.12em] text-[#555555] whitespace-nowrap">{formatMemberId(p.member_id) || '—'}</td>
                                            {/* The count IS the control: the question after
                                                "3 / 5" is always which three, so the cell
                                                opens into them. The denominator is the entry
                                                gate when there is one, otherwise the invite
                                                milestone — the same target the member sees. */}
                                            <td className="py-2.5 pr-3 whitespace-nowrap">
                                                {(p.invites_total ?? 0) === 0 ? (
                                                    <span className="text-[#CCCCCC]">—</span>
                                                ) : (
                                                    <button
                                                        onClick={() => setOpenInvites(openInvites === p.user_id ? null : p.user_id)}
                                                        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-mono transition-all ${
                                                            openInvites === p.user_id
                                                                ? 'bg-[#8B5CF6]/10 border-[#8B5CF6]/30 text-[#8B5CF6]'
                                                                : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:border-[#8B5CF6]/30'
                                                        }`}
                                                        title="Show who they invited"
                                                    >
                                                        {p.invites_counting ?? 0}
                                                        {inviteTarget > 0 ? ` / ${inviteTarget}` : ''}
                                                        {(p.invites_total ?? 0) > (p.invites_counting ?? 0) && (
                                                            <span className="text-[#AAAAAA]">of {p.invites_total}</span>
                                                        )}
                                                    </button>
                                                )}
                                            </td>
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
                                            {/* Two different verbs: DQ keeps the row and the record
                                                (the registration was real, the conduct wasn't);
                                                Remove deletes a row that shouldn't exist at all. */}
                                            <td className="py-2.5 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => onDisqualify(p, !p.disqualified_at)}
                                                    disabled={busy === p.user_id}
                                                    title={p.disqualified_at ? 'Requalify for this event' : 'Disqualify from this event'}
                                                    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] transition-all disabled:opacity-40 ${
                                                        p.disqualified_at
                                                            ? 'bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A]'
                                                            : 'bg-[#F43F5E]/10 border-[#F43F5E]/25 text-[#F43F5E] hover:bg-[#F43F5E]/15'
                                                    }`}
                                                >
                                                    {p.disqualified_at
                                                        ? <><UserCheck size={11} /> Requalify</>
                                                        : <><UserX size={11} /> DQ</>}
                                                </button>
                                                <button
                                                    onClick={() => onRemove(p)}
                                                    disabled={busy === p.user_id}
                                                    title="Delete this registration outright"
                                                    className="inline-flex items-center justify-center w-8 h-8 ml-2 rounded-lg border border-[#E6E6E1] bg-[#F4F4F1] text-[#999999] hover:text-[#F43F5E] hover:border-[#F43F5E]/25 transition-all disabled:opacity-40"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </td>
                                        </tr>
                                        {openInvites === p.user_id && (
                                            <tr>
                                                <td colSpan={9} className="bg-[#FAFAF8] px-4 py-3 rounded-b-xl">
                                                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#888888] mb-1.5">
                                                        {p.name} invited {p.invites_total}
                                                        {' · '}{p.invites_counting} count{p.invites_counting === 1 ? 's' : ''} here
                                                        {' · '}{p.invites_converted} completed a first workout
                                                    </div>
                                                    <InviteeList people={p.invites} />
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
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
                                            <td className="py-2.5 pr-3 font-medium text-[#1A1A1A]">
                                                {r.referrer_id
                                                    ? <Link to={`/admin/users/${r.referrer_id}`} className="hover:underline">{r.referrer_name}</Link>
                                                    : r.referrer_name}
                                            </td>
                                            <td className="py-2.5 pr-3 text-[#555555]">
                                                {r.referred_id
                                                    ? <Link to={`/admin/users/${r.referred_id}`} className="hover:underline">{r.referred_name}</Link>
                                                    : r.referred_name}
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
                        This list covers invite bonuses from every event, not just this one — the newest are at the top.
                        A friend counts once they complete a {(ev.conversion_verifications ?? []).join(' or ') || 'verified'}
                        {' '}workout; a manually logged workout never counts.
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
    ['auto',     'Auto',     'Shows whatever a real user would see at this stage of the event'],
    ['live',     'Live',     'Live leaderboard — testers’ real points mixed with sample rows'],
    ['locked',   'Hidden',   'The hidden (blurred) leaderboard everyone sees while waiting for the reveal'],
    ['revealed', 'Winners',  'Sample final results, with the tester placed 4th'],
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
                        Leaderboard preview — what testers see in the app
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
                        Hidden is what real users see for the whole event week. Winners uses sample results (the tester
                        placed 4th, with this event’s prize names). Testers’ apps update within a minute, or straight
                        away if they reopen the app.
                    </p>
                </div>
            )}
            <p className="text-[11px] text-[#999999] mt-2 leading-relaxed">
                Only the accounts listed here can see this draft event in the app. For them it looks exactly as it
                will for everyone once scheduled (or live once scoring starts), with a PREVIEW badge. Everyone else
                sees nothing until you press Schedule. Test registrations are real — they stay if you launch the
                event, and disappear if you delete the draft.
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
    onSetAutoLifecycle,
}) {
    const meta = STATUS_META[ev.status];
    const pastLock = ev.lock_at && new Date(ev.lock_at) <= new Date();
    // What the clock will do next, if anything. Only the two automatic
    // transitions have a "next"; everything after lock is a human decision.
    const auto = ev.auto_lifecycle !== false;
    const nextAuto =
        ev.status === 'scheduled' ? { label: 'goes live', at: ev.window_start_at }
        : ev.status === 'live' && ev.lock_at ? { label: 'locks', at: ev.lock_at }
        : null;

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
                        {counts.participants} participant{counts.participants === 1 ? '' : 's'} · {counts.results} saved final place{counts.results === 1 ? '' : 's'}
                        {pastLock && ev.status === 'live' ? ' · past the leaderboard hide time (the board is already hidden in the app)' : ''}
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
                            <span className="text-[11px] text-[#999999]">
                                Settle freezes the ranking; Reveal shows it — vet between the two.
                                {ev.entry_gate_n > 0 && ev.entry_gate_mode !== 'entry' && (
                                    <> Settle also drops anyone below {ev.entry_gate_n} friends
                                    {(() => { const dl = ev.conversion_deadline_at ?? ev.lock_at ?? ev.window_end_at; return dl && new Date(dl) > new Date() ? <> — friends can still count until {fmtDT(dl)}, so settle after that (or Re-settle)</> : null; })()}.</>
                                )}
                            </span>
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

                {/* Automatic lifecycle — the clock keeps the published dates;
                    the buttons above are the override. Shown while there is a
                    next automatic step so the admin always knows what will
                    happen without them. */}
                {nextAuto && (
                    <div className={`flex items-center gap-3 flex-wrap rounded-2xl border px-4 py-3 ${auto ? 'bg-[#10B981]/[0.06] border-[#10B981]/25' : 'bg-[#F4F4F1] border-[#E6E6E1]'}`}>
                        <Timer size={14} className={auto ? 'text-[#10B981]' : 'text-[#999999]'} />
                        <span className="text-[12px] text-[#333333]">
                            {auto ? (
                                <>Automatically <strong>{nextAuto.label}</strong> at {fmtDT(nextAuto.at)}{new Date(nextAuto.at) <= new Date() ? ' — due now, the next minute tick will move it' : ''}.</>
                            ) : (
                                <>Automatic lifecycle is <strong>off</strong> — this event only {nextAuto.label} when you press the button.</>
                            )}
                        </span>
                        <button
                            onClick={() => onSetAutoLifecycle(!auto)}
                            disabled={!!acting}
                            className="ml-auto inline-flex items-center h-8 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all bg-white border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2] disabled:opacity-40"
                        >
                            {auto ? 'Switch to manual' : 'Switch to automatic'}
                        </button>
                    </div>
                )}

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
                        Open this link on the venue&apos;s big screen. It can only show the board — it can&apos;t reveal a hidden
                        leaderboard early. Regenerating the link stops any previously shared link from working.
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
                        The public web page to share when promoting the event — background, venue logo, registration QR
                        code and POWR logo. Anyone can open it once the event is scheduled; while it&apos;s a draft only the
                        Preview link works. Change the background and headline in Configuration below.
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
                        The same QR code shown on the promo page. Scanning it opens this event in the app. The download is a
                        1024px PNG for posters and social posts. Regenerating the venue screen link does not change this code,
                        but changing the event&apos;s slug does — download it again if you change the slug.
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
    const [openFunnel, setOpenFunnel] = useState(null);   // referrer_id whose invitees are expanded
    // The panel isn't remounted per event — an expansion must not carry over.
    useEffect(() => { setOpenFunnel(null); }, [ev.id]);
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
                        You can always see the full leaderboard here, even while it&apos;s hidden in the app. Wearable data
                        arrives 30–90 minutes late, so scores updating after the fact is normal, not suspicious.
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
                    <Stat label="Saved final places" value={ops?.results_count} />
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
                                                    {/* Deadline-mode invite requirement: on the live board now,
                                                        dropped at Settle unless the count lands in time. */}
                                                    {r.gate_met === false && (
                                                        <span
                                                            className="px-2 py-0.5 rounded-full bg-[#E8D200]/15 border border-[#E8D200]/40 text-[#8a7600] text-[9px] font-black uppercase tracking-[0.12em]"
                                                            title="Below the invite requirement — will not be in the final standings unless they reach it before Settle"
                                                        >
                                                            {r.gate_count} friends · drops at settle
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
                                Final results have already been saved — after disqualifying anyone, press Re-settle so they're removed from the saved results too.
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
                                    <React.Fragment key={f.referrer_id}>
                                    <tr>
                                        {/* The referrer's own name opens their people —
                                            the funnel's columns say how many, this says who. */}
                                        <td className="py-2 pr-3 font-semibold text-[#1A1A1A]">
                                            <button
                                                onClick={() => setOpenFunnel(openFunnel === f.referrer_id ? null : f.referrer_id)}
                                                className="inline-flex items-center gap-1.5 hover:text-[#8B5CF6] transition-colors"
                                            >
                                                {f.referrer_name}
                                                <ChevronDown
                                                    size={12}
                                                    className={`text-[#AAAAAA] transition-transform ${openFunnel === f.referrer_id ? 'rotate-180' : ''}`}
                                                />
                                            </button>
                                        </td>
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
                                    {openFunnel === f.referrer_id && (
                                        <tr>
                                            <td colSpan={5} className="bg-[#FAFAF8] px-4 py-3">
                                                <InviteeList people={f.invitees} />
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </section>
    );
}

// ─── Scoring breakdown ───────────────────────────────────────────
// What scored for whom. The server labels every ledger row (bucket,
// counted, reason) from the SAME predicate the board filters, so these
// are the app's numbers with the working shown — never a re-derivation.
// Event adjustments are event-scoped: the board moves, the wallet does
// not. Labels and maths live in shared/eventScoring.ts (jest-covered);
// this component only renders.

const BUCKET_TONE = {
    activity:         '#1A1A1A',
    streak:           '#F59E0B',
    challenge:        '#0EA5E9',
    bonus:            '#0EA5E9',
    other:            '#888888',
    adjustment:       '#8B5CF6',
    penalty:          '#F43F5E',
    event_adjustment: '#8B5CF6',
};

const signed = (n) => (n > 0 ? `+${n}` : String(n));

function ScoringPanel({ ev, data, ledgers, busy, resultsCount, onRefresh, onOpenUser, onAdjust, onRemoveAdjustment, onExportCsv }) {
    const [query, setQuery] = useState('');
    const [openUser, setOpenUser] = useState(null);     // user_id whose ledger is expanded
    const [adjustFor, setAdjustFor] = useState(null);   // user_id with the adjust form open
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    // The panel isn't remounted per event — nothing may carry over.
    useEffect(() => { setQuery(''); setOpenUser(null); setAdjustFor(null); setAmount(''); setReason(''); }, [ev.id]);

    const rows = data?.rows ?? [];
    const shown = useMemo(() => searchScoringRows(rows, query), [rows, query]);
    const buckets = useMemo(() => activeBuckets(rows), [rows]);
    const totals = useMemo(() => scoringTotals(rows), [rows]);
    const chips = useMemo(() => ruleChips(data?.event ?? ev), [data, ev]);
    const frozen = data?.event?.frozen ?? ['revealed', 'settled', 'archived'].includes(ev.status);

    const fmtTime = (iso) => iso
        ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';

    const toggleUser = (userId) => {
        const next = openUser === userId ? null : userId;
        setOpenUser(next);
        if (next && (ledgers[next] === undefined || ledgers[next] === null)) onOpenUser(next);
    };

    const openAdjust = (userId) => {
        if (adjustFor === userId) { setAdjustFor(null); return; }
        setAdjustFor(userId); setAmount(''); setReason('');
        if (openUser !== userId) toggleUser(userId);
    };

    const submitAdjust = async (row) => {
        const n = parseInt(amount, 10);
        const ok = await onAdjust(row, n, reason);
        if (ok) { setAdjustFor(null); setAmount(''); setReason(''); }
    };

    const Stat = ({ label, value, accent }) => (
        <div className="rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] px-5 py-4">
            <div className="text-2xl font-light tracking-tight" style={{ color: accent ?? '#1A1A1A' }}>{value ?? '—'}</div>
            <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mt-1">{label}</div>
        </div>
    );

    return (
        <section>
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#8B5CF6]/10 border-[#8B5CF6]/25">
                    <Sigma size={18} className="text-[#8B5CF6]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Scoring — what counts for whom</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        Every point on the board, split by where it came from, plus what each person earned that is NOT
                        counting and why. Open a row for their ledger. Adjustments made here move this board only — the
                        member&apos;s wallet is untouched.
                    </p>
                </div>
                <button
                    onClick={onRefresh}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all shrink-0"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
                <button
                    onClick={onExportCsv}
                    disabled={rows.length === 0}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all disabled:opacity-40 shrink-0"
                >
                    <Download size={13} /> Export CSV
                </button>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 space-y-6">
                {/* The rules in force — the numbers below are never read without them. */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mr-1">Counting</span>
                    {chips.map((c) => (
                        <span
                            key={c.key}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-[0.12em] ${
                                c.on
                                    ? 'bg-[#10B981]/10 border-[#10B981]/25 text-[#0F766E]'
                                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#AAAAAA] line-through decoration-[#CCCCCC]'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.on ? '#10B981' : '#CCCCCC' }} />
                            {c.label}
                        </span>
                    ))}
                    <span className="text-[11px] text-[#AAAAAA] ml-1">— change these under Scoring in the editor below</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <Stat label="On the board" value={data && !data.error ? totals.people : undefined} />
                    <Stat label="Points counting" value={data && !data.error ? totals.points : undefined} />
                    <Stat label="Earned, not counting" value={data && !data.error ? totals.excludedPoints : undefined} accent={totals.excludedPoints > 0 ? '#B45309' : undefined} />
                    <Stat label="Penalties" value={data && !data.error ? totals.byBucket.penalty : undefined} accent={totals.byBucket.penalty < 0 ? '#F43F5E' : undefined} />
                    <Stat label="Event adjustments" value={data && !data.error ? signed(totals.byBucket.event_adjustment) : undefined} accent={totals.adjustmentsN > 0 ? '#8B5CF6' : undefined} />
                </div>

                {!data ? (
                    <p className="text-[13px] text-[#999999]">Loading the breakdown…</p>
                ) : data.error ? (
                    <p className="text-[13px] text-[#F43F5E]">Could not load the breakdown: {data.error}</p>
                ) : rows.length === 0 ? (
                    <p className="text-[13px] text-[#999999]">Nobody has anything on the ledger for this window yet.</p>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1 max-w-sm">
                                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Name, username or POWR ID"
                                    className="w-full h-9 pl-8 pr-3 rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] text-[13px] text-[#1A1A1A] placeholder:text-[#BBBBBB] focus:outline-none focus:border-[#8B5CF6]"
                                />
                            </div>
                            <span className="text-[11px] text-[#999999]">
                                {shown.length === rows.length ? `${rows.length} people` : `${shown.length} of ${rows.length}`}
                                {data.generated_at && ` · as of ${fmtTime(data.generated_at)}`}
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead>
                                    <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#F0F0EC]">
                                        <th className="text-left py-2 pr-3">#</th>
                                        <th className="text-left py-2 pr-3">Member</th>
                                        <th className="text-right py-2 pr-3">Points</th>
                                        {buckets.map((b) => (
                                            <th key={b} className="text-right py-2 pr-3 whitespace-nowrap">{SCORE_BUCKETS.find(x => x.key === b)?.short ?? b}</th>
                                        ))}
                                        <th className="text-left py-2 pr-3">Not counting</th>
                                        <th className="text-right py-2 pr-3">Sessions</th>
                                        <th className="text-left py-2 pr-3">Last counted</th>
                                        <th className="text-right py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F6F6F3]">
                                    {shown.map((r) => {
                                        const isOpen = openUser === r.user_id;
                                        const ledger = ledgers[r.user_id];
                                        const excl = excludedSummary(r);
                                        return (
                                            <React.Fragment key={r.user_id}>
                                                <tr className={isOpen ? 'bg-[#FAFAF8]' : ''}>
                                                    <td className="py-2.5 pr-3 font-mono text-[#888888]">{r.rank}</td>
                                                    <td className="py-2.5 pr-3">
                                                        <button
                                                            onClick={() => toggleUser(r.user_id)}
                                                            className="inline-flex items-center gap-1.5 font-semibold text-[#1A1A1A] hover:text-[#8B5CF6] transition-colors text-left"
                                                        >
                                                            {rowName(r)}
                                                            <ChevronDown size={12} className={`text-[#AAAAAA] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                                        </button>
                                                        {r.username && <span className="text-[#AAAAAA] ml-2">@{r.username}</span>}
                                                        {r.gate_met === false && (
                                                            <span
                                                                className="ml-2 px-2 py-0.5 rounded-full bg-[#E8D200]/15 border border-[#E8D200]/40 text-[#8a7600] text-[9px] font-black uppercase tracking-[0.12em]"
                                                                title="Below the invite requirement — drops at Settle unless they reach it"
                                                            >
                                                                {r.gate_count} friends
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right font-mono font-semibold">{r.points}</td>
                                                    {buckets.map((b) => {
                                                        const v = r.by_bucket?.[b] ?? 0;
                                                        return (
                                                            <td key={b} className="py-2.5 pr-3 text-right font-mono" style={{ color: v === 0 ? '#CCCCCC' : BUCKET_TONE[b] }}>
                                                                {v === 0 ? '·' : (b === 'penalty' || b === 'event_adjustment' || b === 'adjustment') ? signed(v) : v}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="py-2.5 pr-3 text-[12px] text-[#B45309] max-w-[16rem] truncate" title={excl}>
                                                        {excl || <span className="text-[#CCCCCC]">·</span>}
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right font-mono">{r.counted_sessions}</td>
                                                    <td className="py-2.5 pr-3 text-[#888888] whitespace-nowrap">{fmtTime(r.last_counted_at)}</td>
                                                    <td className="py-2.5 text-right whitespace-nowrap">
                                                        <Link
                                                            to={`/admin/users/${r.user_id}`}
                                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] bg-[#F4F4F1] border-[#E6E6E1] text-[#555555] hover:text-[#1A1A1A] transition-all mr-2"
                                                            title="Open their admin profile (wallet, sessions, review)"
                                                        >
                                                            <ExternalLink size={11} /> Profile
                                                        </Link>
                                                        <button
                                                            onClick={() => openAdjust(r.user_id)}
                                                            disabled={frozen || busy === r.user_id}
                                                            title={frozen ? 'Results are frozen once revealed' : 'Add to or take from their score on this board'}
                                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[9.5px] font-bold uppercase tracking-[0.12em] transition-all disabled:opacity-40 bg-[#8B5CF6]/10 border-[#8B5CF6]/25 text-[#6D28D9] hover:bg-[#8B5CF6]/15"
                                                        >
                                                            <Scale size={11} /> Adjust
                                                        </button>
                                                    </td>
                                                </tr>

                                                {isOpen && (
                                                    <tr>
                                                        <td colSpan={7 + buckets.length} className="bg-[#FAFAF8] px-5 py-4">
                                                            <UserLedger
                                                                row={r}
                                                                ledger={ledger}
                                                                frozen={frozen}
                                                                busy={busy === r.user_id}
                                                                adjusting={adjustFor === r.user_id}
                                                                amount={amount}
                                                                reason={reason}
                                                                setAmount={setAmount}
                                                                setReason={setReason}
                                                                onSubmit={() => submitAdjust(r)}
                                                                onCancel={() => setAdjustFor(null)}
                                                                onRemoveAdjustment={(adj) => onRemoveAdjustment(r, adj)}
                                                                fmtTime={fmtTime}
                                                            />
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {resultsCount > 0 && !frozen && (
                            <p className="text-[11px] text-[#B45309] flex items-center gap-1.5">
                                <AlertTriangle size={12} />
                                Final results have already been saved — after adjusting anyone, press Re-settle so the saved results pick it up.
                            </p>
                        )}
                        {frozen && (
                            <p className="text-[11px] text-[#999999] flex items-center gap-1.5">
                                <Lock size={12} /> Results are revealed — the board is frozen and cannot be adjusted.
                            </p>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

// One person's ledger inside the breakdown: activity split, event
// adjustments (with the form), then every candidate row — counted or
// not, and if not, why.
function UserLedger({ row, ledger, frozen, busy, adjusting, amount, reason, setAmount, setReason, onSubmit, onCancel, onRemoveAdjustment, fmtTime }) {
    const acts = Object.entries(row.by_activity ?? {}).sort((a, b) => b[1] - a[1]);
    const adjustments = ledger?.adjustments ?? [];
    const rows = ledger?.rows ?? [];

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-8 flex-wrap">
                {/* By activity */}
                <div>
                    <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mb-2">By activity</div>
                    {acts.length === 0 ? (
                        <span className="text-[12px] text-[#AAAAAA]">No activity points counting</span>
                    ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {acts.map(([k, v]) => (
                                <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#E6E6E1] text-[11px] text-[#1A1A1A]">
                                    <span className="capitalize">{k}</span>
                                    <span className="font-mono font-semibold">{v}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Event adjustments */}
                <div className="min-w-[18rem] flex-1">
                    <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mb-2">
                        Event adjustments{adjustments.length > 0 ? ` — ${adjustments.length}` : ''}
                    </div>
                    {adjustments.length === 0 && !adjusting && (
                        <span className="text-[12px] text-[#AAAAAA]">None</span>
                    )}
                    <div className="space-y-1.5">
                        {adjustments.map((a) => (
                            <div key={a.id} className="flex items-center gap-3 text-[12px]">
                                <span className="font-mono font-semibold w-12 text-right" style={{ color: a.amount < 0 ? '#F43F5E' : '#6D28D9' }}>{signed(a.amount)}</span>
                                <span className="text-[#1A1A1A] flex-1 min-w-0 truncate" title={a.reason}>{a.reason}</span>
                                <span className="text-[#999999] whitespace-nowrap">{a.admin_name} · {fmtTime(a.created_at)}</span>
                                {!frozen && (
                                    <button
                                        onClick={() => onRemoveAdjustment(a)}
                                        disabled={busy}
                                        title="Remove this adjustment"
                                        className="text-[#BBBBBB] hover:text-[#F43F5E] transition-colors disabled:opacity-40"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    {adjusting && (
                        <div className="mt-3 flex items-end gap-2 flex-wrap">
                            <label className="block">
                                <span className="block text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] mb-1">Points (±)</span>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="-10"
                                    className="w-24 h-9 px-3 rounded-xl border border-[#E6E6E1] bg-white text-[13px] font-mono text-[#1A1A1A] focus:outline-none focus:border-[#8B5CF6]"
                                />
                            </label>
                            <label className="block flex-1 min-w-[14rem]">
                                <span className="block text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] mb-1">Reason (shown here and in the audit log)</span>
                                <input
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
                                    placeholder="Duplicate wearable session on 29 Aug"
                                    className="w-full h-9 px-3 rounded-xl border border-[#E6E6E1] bg-white text-[13px] text-[#1A1A1A] placeholder:text-[#BBBBBB] focus:outline-none focus:border-[#8B5CF6]"
                                />
                            </label>
                            <button
                                onClick={onSubmit}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#8B5CF6] text-white text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#7C3AED] transition-all disabled:opacity-40"
                            >
                                {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />} Apply
                            </button>
                            <button
                                onClick={onCancel}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10px] font-bold uppercase tracking-[0.15em] text-[#555555] hover:text-[#1A1A1A] transition-all disabled:opacity-40"
                            >
                                <X size={12} /> Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* The ledger */}
            <div>
                <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#999999] mb-2">
                    Ledger — this window
                    {ledger?.points !== undefined && ledger?.points !== null && (
                        <span className="ml-2 normal-case tracking-normal font-normal text-[11px] text-[#888888]">the app is showing them {ledger.points} pts</span>
                    )}
                </div>
                {ledger === undefined ? (
                    <p className="text-[12px] text-[#AAAAAA]">Loading…</p>
                ) : ledger === null ? (
                    <p className="text-[12px] text-[#F43F5E]">Could not load their ledger.</p>
                ) : rows.length === 0 ? (
                    <p className="text-[12px] text-[#AAAAAA]">No ledger rows touch this window.</p>
                ) : (
                    <table className="w-full text-[12px]">
                        <thead>
                            <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] border-b border-[#EDEDE8]">
                                <th className="text-left py-1.5 pr-3">When</th>
                                <th className="text-left py-1.5 pr-3">What</th>
                                <th className="text-left py-1.5 pr-3">Bucket</th>
                                <th className="text-right py-1.5 pr-3">Points</th>
                                <th className="text-left py-1.5">Counting?</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFEFEA]">
                            {rows.map((l) => (
                                <tr key={l.tx_id} className={l.counted ? '' : 'opacity-70'}>
                                    <td className="py-1.5 pr-3 text-[#888888] whitespace-nowrap">
                                        {fmtTime(l.session_id ? l.ended_at : l.created_at)}
                                        {l.session_id && l.created_at && Math.abs(new Date(l.created_at) - new Date(l.ended_at)) > 6 * 3600 * 1000 && (
                                            <span className="block text-[10px] text-[#BBBBBB]">credited {fmtTime(l.created_at)}</span>
                                        )}
                                    </td>
                                    <td className="py-1.5 pr-3 text-[#1A1A1A]">
                                        {ledgerRowTitle(l)}
                                        {l.flagged && (
                                            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#F43F5E]/10 border border-[#F43F5E]/25 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.12em]">
                                                <ShieldAlert size={9} /> flagged
                                            </span>
                                        )}
                                        {l.description && !l.session_id && (
                                            <span className="block text-[11px] text-[#999999] truncate max-w-[28rem]" title={l.description}>{l.description}</span>
                                        )}
                                    </td>
                                    <td className="py-1.5 pr-3 text-[#888888]">{bucketLabel(l.bucket)}</td>
                                    <td className="py-1.5 pr-3 text-right font-mono font-semibold" style={{ color: l.amount < 0 ? '#F43F5E' : l.counted ? '#1A1A1A' : '#AAAAAA' }}>
                                        {signed(l.amount)}
                                    </td>
                                    <td className="py-1.5">
                                        {l.counted ? (
                                            <span className="inline-flex items-center gap-1 text-[#0F766E] font-semibold"><Check size={11} /> Counted</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 text-[#B45309]">
                                                <X size={11} /> {reasonLabel(l.reason)}
                                                {reasonIsSwitch(l.reason) && (
                                                    <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[#AAAAAA]">· editor switch</span>
                                                )}
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

// ─── Setup steps ─────────────────────────────────────────────────
// The configuration is one form (one Save), but it's presented as
// numbered steps so an admin can see what's decided, what's still to
// do, and where each setting surfaces in the app — the fields used to
// be a single 40-row list with no map from "this field" to "that
// screen". Each step: a status + one-line summary for the rail, an
// "In the app" box naming the surfaces it drives, then its fields.

const SURFACES = {
    home:     { label: 'Home card',      color: '#10B981' },
    league:   { label: 'League tab',     color: '#3B82F6' },
    ticket:   { label: 'Ticket',         color: '#8B5CF6' },
    register: { label: 'Join sheet',     color: '#EC4899' },
    promo:    { label: 'Promo page',     color: '#F59E0B' },
    screen:   { label: 'Venue screen',   color: '#0EA5E9' },
    door:     { label: 'Door tab',       color: '#F97316' },
    admin:    { label: 'This panel',     color: '#888888' },
};

const STEP_TONE = {
    done: { ring: 'border-[#10B981] bg-[#10B981] text-white',      label: 'Done',     text: 'text-[#10B981]' },
    warn: { ring: 'border-[#F59E0B] bg-[#F59E0B]/10 text-[#B45309]', label: 'Check',    text: 'text-[#B45309]' },
    todo: { ring: 'border-[#D8D8D2] bg-white text-[#888888]',      label: 'To do',    text: 'text-[#999999]' },
    off:  { ring: 'border-[#E6E6E1] bg-[#F4F4F1] text-[#AAAAAA]',   label: 'Optional', text: 'text-[#AAAAAA]' },
};

const activitiesSummary = (list) => (list == null ? 'All types' : `${list.length} type${list.length === 1 ? '' : 's'}`);

// Status + rail summary for each step, from the form alone. "warn" is
// reserved for things that quietly cost the app a row or a screen
// (no event night, no prizes) — not for anything merely optional.
const stepState = (form) => ({
    basics: form.name?.trim() && form.slug?.trim()
        ? { status: 'done', summary: `${form.name} · ${form.slug}` }
        : { status: 'todo', summary: 'Name and slug needed' },
    dates: !form.window_start_at || !form.window_end_at
        ? { status: 'todo', summary: 'Set the scoring window' }
        : !form.doors_open_at
            ? { status: 'warn', summary: `${fmtDay(form.window_start_at)} → ${fmtLastDay(form.window_end_at)} · no event night` }
            : { status: 'done', summary: `${fmtDay(form.window_start_at)} → ${fmtLastDay(form.window_end_at)} · night ${fmtDay(form.doors_open_at)}` },
    who: {
        status: 'done',
        summary: `${form.scope === 'opt_in' ? 'Opt-in' : 'Everyone'} · top ${form.board_size} · entry closes ${fmtDay(form.eligibility_cutoff_at ?? form.window_start_at)}`,
    },
    scoring: {
        status: 'done',
        summary: `${activitiesSummary(form.included_activities)} · manual ${form.count_manual ? 'on' : 'off'} · streaks ${form.count_streak ? 'on' : 'off'}`
            + `${form.count_challenges ? ' · challenges on' : ''}${form.count_bonuses ? ' · bonuses on' : ''}${form.count_referrals ? ' · invite rewards on' : ''}${form.count_adjustments === false ? ' · adjustments off' : ''}`
            + `${form.attendance_bonus_points > 0 ? ` · +${form.attendance_bonus_points} for attending` : ''}`,
    },
    invites: form.invite_bonus_points > 0
        ? {
            status: 'done',
            summary: `${form.invite_bonus_points} pts per friend${form.invite_milestone_n > 0 && form.invite_milestone_bonus > 0 ? ` · +${form.invite_milestone_bonus} at ${form.invite_milestone_n}` : ''}${form.reward_referrals_on_signup ? ' · inviter paid at signup' : ''}`,
        }
        : { status: 'off', summary: 'No invite bonus' },
    gate: form.entry_gate_n > 0
        ? { status: 'done', summary: `${form.entry_gate_n} friend${form.entry_gate_n === 1 ? '' : 's'} · ${form.entry_gate_mode === 'entry' ? 'unlocks the board' : 'keep your place'}` }
        : { status: 'off', summary: 'Off — anyone can compete' },
    prizes: (form.prizes?.length ?? 0) > 0
        ? { status: 'done', summary: `${form.prizes.length} prize${form.prizes.length === 1 ? '' : 's'} · ${form.rules?.length ?? 0} rule${form.rules?.length === 1 ? '' : 's'}` }
        : { status: 'warn', summary: 'No prizes yet' },
    promo: (() => {
        const parts = [
            form.promo_headline && 'headline',
            form.promo_media_url && 'background',
            form.booking_url && 'booking link',
        ].filter(Boolean);
        return parts.length
            ? { status: 'done', summary: parts.join(' · ').replace(/^./, c => c.toUpperCase()) }
            : { status: 'off', summary: 'Plain look, no booking' };
    })(),
});

function EditorPanel({ form, setForm, dirty, saving, onSave, onDiscard, venueName, setVenueName, locked }) {
    const set = (patch) => setForm(prev => ({ ...prev, ...patch }));
    const [stepKey, setStepKey] = useState('basics');
    const topRef = useRef(null);
    const state = stepState(form);

    const steps = [
        {
            key: 'basics',
            title: 'Basics',
            blurb: 'What the event is called and who is hosting it.',
            inApp: [
                ['home', 'Your logo sits next to the venue’s logo in the lockup at the top of the card, with the name underneath unless Logo only is on.'],
                ['league', 'The same lockup heads the League tab once someone has joined.'],
                ['promo', 'The venue logo on the promo page and the venue screen comes from the venue partner you pick here.'],
                ['door', 'The venue partner’s geofence is what counts people as inside on the Door tab.'],
                ['admin', 'The slug is baked into the promo, big-screen and registration QR links — change it and the QR needs downloading again.'],
            ],
            sections: [
                { fields: (
                    <>
                        <Field label="Name">
                            <TextInput value={form.name} onChange={v => set({ name: v })} />
                        </Field>
                        <Field label="Slug" hint="Short name used in the event's web links. Lowercase, words joined with dashes, e.g. fnl-x-powr.">
                            <TextInput value={form.slug} onChange={v => set({ slug: v })} mono />
                        </Field>
                        <Field label="Venue partner" hint="Optional. The gym or venue hosting the event.">
                            <VenuePicker
                                venueId={form.venue_partner_id}
                                venueName={venueName}
                                onPick={(id, name) => { set({ venue_partner_id: id }); setVenueName(name); }}
                            />
                        </Field>
                    </>
                ) },
                { title: 'Logo', fields: (
                    <>
                        <Field label="Logo" hint="The POWR-side logo on the event card, shown next to the venue's logo. Upload a white logo on a transparent background. Leave blank to use the standard white POWR logo.">
                            <EventLogoField value={form.logo_url} onChange={v => set({ logo_url: v })} />
                        </Field>
                        <Field label="Logo only" hint="On: the app card shows just the logos (larger), with no event name underneath. The name still appears everywhere else.">
                            <Toggle on={form.logo_only} onFlip={() => set({ logo_only: !form.logo_only })} />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'dates',
            title: 'Dates',
            blurb: 'Two different things: the week people score points, and the night they turn up at the venue. All times are UK time.',
            inApp: [
                ['home', 'Reads “Scoring starts <day>” with a SCORING IN N DAYS chip while scheduled, then “Scoring ends <last day>” once live — never a bare date.'],
                ['league', '“Event night <day, time>” comes from Doors open. It is the only place people are told when to actually turn up.'],
                ['league', 'From the Leaderboard hides time the board is blurred, in the app and on the venue screen, until you press Reveal.'],
                ['admin', 'With automatic lifecycle on (Lifecycle panel above), the event goes live at scoring start and locks at the hide time by itself.'],
                ['door', 'Arrivals are counted between Doors open and Doors close.'],
            ],
            sections: [
                { title: 'Competition window', blurb: 'Points earned from the moment scoring starts, up to (but not including) the moment it ends, count towards the event.', fields: (
                    <>
                        <Field label="Scoring starts" hint="Start of the competition. Points earned from this moment count.">
                            <DateTimeInput value={form.window_start_at} onChange={v => set({ window_start_at: v })} />
                            <p className="text-[11px] text-[#999999] leading-relaxed mt-2 max-w-md">
                                The app&rsquo;s home card reads{' '}
                                <span className="font-medium text-[#555555]">“Scoring starts {fmtDay(form.window_start_at)}”</span> — never a
                                bare date, which people read as the night at the venue and turn up on the wrong day.
                            </p>
                        </Field>
                        <Field label="Scoring ends" hint="End of the competition. Points earned from this moment on don't count.">
                            <DateTimeInput value={form.window_end_at} onChange={v => set({ window_end_at: v })} />
                            {/* The off-by-one below is the half-open window, and it looks like a
                                bug unless it's spelled out right here next to the field that
                                causes it: the app names the last day people can score, not the
                                instant the window shuts. */}
                            <p className="text-[11px] text-[#999999] leading-relaxed mt-2 max-w-md">
                                Nothing counts from this moment on, so the last day anyone can score is{' '}
                                <span className="font-medium text-[#555555]">{fmtLastDay(form.window_end_at)}</span> — and that&rsquo;s the day
                                the app shows, as{' '}
                                <span className="font-medium text-[#555555]">“Scoring ends {fmtLastDay(form.window_end_at)}”</span>.
                                Set this to midnight at the end of the last scoring day.
                            </p>
                        </Field>
                        <Field label="Leaderboard hides" hint="From this moment the leaderboard is hidden in the app and everyone waits for the reveal. Usually the same as, or just after, scoring ends. Leave blank to keep it visible until you press Lock board.">
                            <DateTimeInput value={form.lock_at} onChange={v => set({ lock_at: v })} clearable />
                        </Field>
                    </>
                ) },
                { title: 'Event night at the venue', blurb: 'Usually about a week after scoring opens. Nothing here affects points — it tells people when to show up and tells the Door tab when to count.', fields: (
                    <>
                        <Field label="Doors open" hint="When the night at the venue starts. Doubles as the moment people arriving start being counted on the Door tab.">
                            <DateTimeInput value={form.doors_open_at} onChange={v => set({ doors_open_at: v })} clearable />
                            {/* This is the one field that answers "when is the event?", as
                                opposed to "when can I score?" — leaving it blank costs the
                                app a row, so say so rather than letting it read optional. */}
                            <p className="text-[11px] text-[#999999] leading-relaxed mt-2 max-w-md">
                                {form.doors_open_at ? (
                                    <>
                                        The League card shows{' '}
                                        <span className="font-medium text-[#555555]">“Event night {fmtDayTime(form.doors_open_at)}”</span>.
                                        This is the only field that tells people when to actually turn up — scoring
                                        usually opens a week earlier.
                                    </>
                                ) : (
                                    <span className="text-[#B45309]">
                                        Not set — the League card can&rsquo;t tell anyone when to turn up, so it hides the
                                        event-night row entirely rather than guess from the scoring window. Set this to
                                        the night at the venue. Counting on the Door tab falls back to the leaderboard
                                        hide time (or scoring end) meanwhile.
                                    </span>
                                )}
                            </p>
                        </Field>
                        <Field label="Doors close" hint="After this, people arriving at the venue are no longer counted. Leave blank for 12 hours after doors open.">
                            <DateTimeInput value={form.doors_close_at} onChange={v => set({ doors_close_at: v })} clearable />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'who',
            title: 'Who competes',
            blurb: 'Whether people have to join, until when, and how many make the leaderboard.',
            inApp: [
                ['home', 'Opt-in: the card sells the event with a Join button until entry closes. Global: everyone is in automatically and there is no join step.'],
                ['register', 'Joining opens the join sheet (dates, prizes, rules) and lands people on the League tab.'],
                ['league', 'The leaderboard lists the top places up to Leaderboard size; the same number of final places are saved when you press Settle.'],
                ['ticket', 'After the eligibility cutoff, joining stops — the ticket and invite progress of people already in stay where they are.'],
            ],
            sections: [
                { fields: (
                    <>
                        <Field label="Who takes part" hint="Opt-in: people must join the event in the app to appear on the leaderboard. Global: every POWR member is on the leaderboard automatically.">
                            <div className="flex gap-2">
                                {['opt_in', 'global'].map(s => (
                                    <Chip key={s} active={form.scope === s} onClick={() => set({ scope: s })}>
                                        {s === 'opt_in' ? 'Opt-in (must join)' : 'Global (everyone)'}
                                    </Chip>
                                ))}
                            </div>
                        </Field>
                        <Field label="Eligibility cutoff" hint="Entry closes here: anyone who created their POWR account after this time can't compete, and joining stops at the same moment. Set it after the scoring end to let people sign up, join and bring invites right up to the event day — their points still only count inside the scoring window. Leave blank to use the scoring start time.">
                            <DateTimeInput value={form.eligibility_cutoff_at} onChange={v => set({ eligibility_cutoff_at: v })} clearable />
                            <p className="text-[11px] text-[#999999] leading-relaxed mt-2 max-w-md">
                                Entry closes{' '}
                                <span className="font-medium text-[#555555]">{fmtDT(form.eligibility_cutoff_at ?? form.window_start_at)}</span>
                                {form.eligibility_cutoff_at ? '' : ' (the scoring start, because this is blank)'}.
                            </p>
                        </Field>
                        <Field label="Leaderboard size" hint="How many people are shown on the leaderboard in the app, and how many final places are saved when the event is settled.">
                            <NumberInput value={form.board_size} onChange={v => set({ board_size: v })} min={3} max={500} />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'scoring',
            title: 'Scoring',
            blurb: 'Which of a person’s points count towards their event score. Normal POWR rules still decide what they earn; the event only chooses which of it counts. Two rules are fixed: penalties always reduce a score, and the event-night reward never adds to one. Invite rewards count only when their switch below is on.',
            inApp: [
                ['league', 'Only points from the activities ticked here feed the rank on the leaderboard and the RANK pill on the home card.'],
                ['screen', 'The venue screen shows the same standings.'],
                ['admin', 'Changing anything here re-scores everyone the moment you save — scores are computed live and only frozen by Settle.'],
                ['door', 'The event-night reward is paid from the Door board: marking someone arrived pays them, and Pay attendance pays everyone the venue fence saw.'],
            ],
            sections: [
                { fields: (
                    <>
                        <Field label="Activities that count" hint="Points from these workout types count towards the event. Pick All types to count everything.">
                            <ActivityGrid
                                value={form.included_activities}
                                onChange={v => set({ included_activities: v })}
                            />
                        </Field>
                        <Field label="Manually logged workouts count" hint="On: workouts people type in by hand count. Off: only workouts verified by a gym check-in or wearable count.">
                            <Toggle on={form.count_manual} onFlip={() => set({ count_manual: !form.count_manual })} />
                        </Field>
                        <Field label="Walking counts" hint="Off: walking points are ignored, even if walking is selected above.">
                            <Toggle on={form.count_walking} onFlip={() => set({ count_walking: !form.count_walking })} />
                        </Field>
                        <Field label="Streak bonuses count" hint="On: the daily streak bonus points people earn also count towards their event score.">
                            <Toggle on={form.count_streak} onFlip={() => set({ count_streak: !form.count_streak })} />
                        </Field>
                        <Field label="Challenge payouts count" hint="On: weekly and Together challenge payouts credited during the window count. Off (recommended): a payout doesn't say which workouts earned it, so a wearable backfill can bring in a week of old history.">
                            <Toggle on={form.count_challenges} onFlip={() => set({ count_challenges: !form.count_challenges })} />
                        </Field>
                        <Field label="Other bonuses count" hint="On: level-up, creator and other bonus points credited during the window count. Invite rewards have their own switch below; the event-night reward never counts.">
                            <Toggle on={form.count_bonuses} onFlip={() => set({ count_bonuses: !form.count_bonuses })} />
                        </Field>
                        <Field label="Invite rewards count" hint="On: the points paid when an invited friend completes their first verified workout (to both people) and the milestone bonus count towards the event score, as long as they were paid during the scoring window. Off: they stay normal POWR points and never move the board. Flipping this re-scores everyone straight away.">
                            <Toggle on={form.count_referrals} onFlip={() => set({ count_referrals: !form.count_referrals })} />
                        </Field>
                        <Field label="Admin adjustments count" hint="On: points an admin adds by hand during the window count. Penalties always count, whatever this says.">
                            <Toggle on={form.count_adjustments} onFlip={() => set({ count_adjustments: !form.count_adjustments })} />
                        </Field>
                    </>
                ) },
                { title: 'Event night reward', fields: (
                    <>
                        <Field label="Points for attending" hint="Paid once to each person who turns up on the night — marked arrived at the door, or seen inside the venue fence while doors are open. Normal POWR points, paid to their wallet; they never move the event score. 0 = no reward.">
                            <NumberInput value={form.attendance_bonus_points} onChange={v => set({ attendance_bonus_points: v })} min={0} max={5000} unit="pts" />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'invites',
            title: 'Invite rewards',
            blurb: 'Points for bringing friends in. A friend only counts once they have completed their first verified workout — a manually logged workout never counts for this.',
            inApp: [
                ['register', 'The join sheet pitch quotes the points per friend.'],
                ['ticket', 'Invite progress and the milestone bonus sit on the ticket in the League tab until the invite deadline.'],
                ['admin', 'The bonus is paid to both people (as normal POWR points) when the friend’s first verified workout lands. It counts towards the event score only when “Invite rewards count” is on under Scoring.'],
            ],
            sections: [
                { title: 'Bonus', fields: (
                    <>
                        <Field label="Points per friend" hint={form.reward_referrals_on_signup
                            ? "Paid to the inviter as soon as the friend signs up, and to the friend once they complete their first verified workout."
                            : "Paid to both the inviter and the friend once the friend completes their first verified workout."}>
                            <NumberInput value={form.invite_bonus_points} onChange={v => set({ invite_bonus_points: v })} min={0} max={1000} unit="pts" />
                        </Field>
                        <Field label="Pay the inviter at signup" hint="On: the inviter is paid the moment someone signs up with their code, and the milestone counts signups — matching an entry gate that already counts signups. The friend still earns their own side on their first verified workout, so a fake account is worth nothing to itself. Off (default): nothing is paid until the friend completes a first verified workout.">
                            <Toggle on={form.reward_referrals_on_signup} onFlip={() => set({ reward_referrals_on_signup: !form.reward_referrals_on_signup })} />
                        </Field>
                        <Field label="Milestone after" hint="Number of friends someone needs to bring in to earn the extra milestone bonus below.">
                            <NumberInput value={form.invite_milestone_n} onChange={v => set({ invite_milestone_n: v })} min={0} max={50} unit="friends" />
                        </Field>
                        <Field label="Milestone bonus" hint="Extra points paid to the inviter when they reach the milestone. Set to 0 for no milestone bonus.">
                            <NumberInput value={form.invite_milestone_bonus} onChange={v => set({ invite_milestone_bonus: v })} min={0} max={5000} unit="pts" />
                        </Field>
                    </>
                ) },
                { title: 'What counts as the friend’s first workout', fields: (
                    <>
                        <Field label="Which workouts count as verified" hint="The friend's first workout must be verified in one of these ways.">
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
                        <Field label="Which activities count for the first workout" hint="Walking and sleep are left out by default because wearables record them automatically without any effort.">
                            <ActivityGrid
                                value={form.conversion_activities}
                                onChange={v => set({ conversion_activities: v })}
                                nullable={false}
                            />
                        </Field>
                        <Field label="Invite deadline" hint="Invites stay open until this time: the ticket and invite progress stay on the League tab, and friends must complete their first workout by it for the conversion bonus to count. Leave blank to use the scoring end time.">
                            <DateTimeInput value={form.conversion_deadline_at} onChange={v => set({ conversion_deadline_at: v })} clearable />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'gate',
            title: 'Friend requirement',
            optional: true,
            blurb: 'Optional. Ask people to bring a certain number of friends. Anyone can still join, and the final results are public to everyone.',
            inApp: [
                ['home', 'The pill on the card counts progress — “2 OF 5 FRIENDS” — until it flips to the person’s RANK.'],
                ['league', 'Keep your place: everyone is on the live board, and Settle drops anyone still short. Unlock the board: the leaderboard stays hidden for someone until they reach the number.'],
                ['admin', 'The Lifecycle panel reminds you to Settle after the invite deadline, so late friends are counted.'],
            ],
            sections: [
                { fields: (
                    <>
                        <Field label="Friends required" hint="How many friends someone must invite. 0 = no requirement.">
                            <NumberInput value={form.entry_gate_n} onChange={v => set({ entry_gate_n: v })} min={0} max={50} unit="friends" />
                        </Field>
                        <Field label="When it applies" hint="Keep your place: everyone registered is on the live leaderboard from the start; anyone below the number when you press Settle is dropped from the final standings. Friends must be in by the invite deadline (or the lock time if none). Unlock the board: nobody is scored or shown the leaderboard until they reach the number.">
                            <div className="flex gap-2">
                                <Chip active={form.entry_gate_mode !== 'entry'} onClick={() => set({ entry_gate_mode: 'deadline' })}>
                                    Keep your place (by the deadline)
                                </Chip>
                                <Chip active={form.entry_gate_mode === 'entry'} onClick={() => set({ entry_gate_mode: 'entry' })}>
                                    Unlock the board (before you appear)
                                </Chip>
                            </div>
                        </Field>
                        <Field label="What counts as a friend" hint="Sign-ups: the friend just needs to create an account with the code (can happen before scoring starts). First workout: the friend also needs to complete their first verified workout.">
                            <div className="flex gap-2">
                                <Chip active={form.entry_gate_counting === 'signups'} onClick={() => set({ entry_gate_counting: 'signups' })}>
                                    Signed up with code
                                </Chip>
                                <Chip active={form.entry_gate_counting === 'conversions'} onClick={() => set({ entry_gate_counting: 'conversions' })}>
                                    Signed up + first verified workout
                                </Chip>
                            </div>
                        </Field>
                        <Field label="Only count friends invited after" hint="Friends invited before this time don't count towards the requirement. Leave blank to count every friend they've ever invited.">
                            <DateTimeInput value={form.entry_gate_since} onChange={v => set({ entry_gate_since: v })} clearable />
                        </Field>
                    </>
                ) },
            ],
        },
        {
            key: 'prizes',
            title: 'Rules & prizes',
            blurb: 'What people are playing for, and the rules they agree to when they join.',
            inApp: [
                ['register', 'Rules and prizes are shown on the join sheet before someone commits.'],
                ['ticket', 'Rules expand on the ticket in the League tab; prizes sit on the League header.'],
                ['promo', 'Prize images appear on the promo page and the venue screen.'],
                ['league', 'After Reveal, the winners card shows the prizes against the final places — and winners can share theirs.'],
            ],
            sections: [
                { title: 'Rules', blurb: 'One rule per line — keep each short.', fields: (
                    <Field label="Event rules" hint="For example: Only points earned during the event week count.">
                        <RulesField value={form.rules} onChange={v => set({ rules: v })} />
                    </Field>
                ) },
                { title: 'Prizes', blurb: 'What each finishing place wins. A square photo on a plain background, 600px or larger, works best.', fields: (
                    <PrizeEditor prizes={form.prizes} onChange={v => set({ prizes: v })} />
                ) },
            ],
        },
        {
            key: 'promo',
            title: 'Promo & booking',
            optional: true,
            blurb: 'The look of the event when you promote it, and the venue’s booking form if there is one.',
            inApp: [
                ['promo', 'The background plays behind the whole promo page, with the venue logo and the registration QR code (links in the Lifecycle panel above).'],
                ['home', 'The same background sits behind the home card and the League header. The headline shows above the scoring line.'],
                ['ticket', 'With a booking link set, a BOOK YOUR SPOT button appears on the ticket and the home card. Leave it blank and there are no booking buttons.'],
                ['admin', 'Use the Venue bookings tab to check who actually booked.'],
            ],
            sections: [
                { title: 'Promo look', fields: (
                    <>
                        <Field label="Background" hint="A video (.mp4/.webm) or image shown behind the whole page. Leave blank for the plain dark POWR look.">
                            <PromoMediaField
                                value={form.promo_media_url}
                                onChange={v => set({ promo_media_url: v })}
                            />
                        </Field>
                        <Field label="Headline" hint="Optional line under the event name — for example what's up for grabs. Shown on the promo page and on the app's home card, above the scoring line. Leave blank for the name and dates alone.">
                            <TextInput value={form.promo_headline} onChange={v => set({ promo_headline: v || null })} />
                        </Field>
                    </>
                ) },
                { title: 'Booking', blurb: 'Link to the venue’s own booking page. Add it when the venue’s form opens and the buttons appear in the app.', fields: (
                    <Field label="Booking link" hint="You can include {email} and {name} in the link — the app swaps in the person's details so the venue's form can be pre-filled.">
                        <TextInput mono value={form.booking_url} onChange={v => set({ booking_url: v || null })} />
                    </Field>
                ) },
            ],
        },
    ];

    const index = Math.max(0, steps.findIndex(s => s.key === stepKey));
    const step = steps[index];
    const goTo = (key) => {
        setStepKey(key);
        // Keep the step header in view — the rail is sticky but the
        // content card can be much taller than the viewport.
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const outstanding = steps.filter(s => ['todo', 'warn'].includes(state[s.key].status));

    return (
        <section ref={topRef} className="scroll-mt-6">
            <div className="flex items-center gap-4 mb-4 px-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border bg-[#10B981]/10 border-[#10B981]/25">
                    <PartyPopper size={18} className="text-[#10B981]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Setup</h2>
                    <p className="text-[12px] text-[#888888] leading-snug">
                        {locked
                            ? 'Results have been revealed, so these settings can no longer be changed.'
                            : outstanding.length === 0
                                ? 'Everything is set. Changes take effect as soon as you save — scores are recalculated straight away.'
                                : `${outstanding.length} step${outstanding.length === 1 ? '' : 's'} to look at: ${outstanding.map(s => s.title).join(', ')}. One Save covers every step.`}
                    </p>
                </div>
                {dirty && !locked && (
                    <SaveBar saving={saving} onSave={onSave} onDiscard={onDiscard} className="shrink-0" />
                )}
            </div>

            <fieldset disabled={locked} className={locked ? 'opacity-60' : ''}>
                <div className="flex gap-6 items-start flex-col lg:flex-row">
                    {/* Step rail */}
                    <nav className="w-full lg:w-72 shrink-0 lg:sticky lg:top-6 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
                        {steps.map((s, i) => {
                            const st = state[s.key];
                            const tone = STEP_TONE[st.status];
                            const active = s.key === stepKey;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    onClick={() => goTo(s.key)}
                                    className={`text-left flex items-start gap-3 rounded-2xl border px-3.5 py-3 min-w-[220px] lg:min-w-0 transition-all ${
                                        active
                                            ? 'bg-white border-[#1A1A1A] shadow-sm'
                                            : 'bg-white/60 border-[#E6E6E1] hover:border-[#D8D8D2] hover:bg-white'
                                    }`}
                                >
                                    <span className={`w-6 h-6 rounded-full border-2 shrink-0 mt-0.5 inline-flex items-center justify-center text-[10px] font-black ${tone.ring}`}>
                                        {st.status === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className={`text-[13px] font-semibold leading-tight ${active ? 'text-[#1A1A1A]' : 'text-[#333333]'}`}>{s.title}</span>
                                            {st.status !== 'done' && (
                                                <span className={`text-[9px] font-black uppercase tracking-[0.15em] ${tone.text}`}>{tone.label}</span>
                                            )}
                                        </span>
                                        <span className="text-[11px] text-[#999999] leading-snug block mt-0.5 truncate">{st.summary}</span>
                                    </span>
                                </button>
                            );
                        })}
                        <div className="hidden lg:block mt-3 px-1 text-[11px] text-[#AAAAAA] leading-relaxed">
                            Go live from the Lifecycle panel at the top: preview with testers, then press Schedule.
                        </div>
                    </nav>

                    {/* Active step */}
                    <div className="flex-1 min-w-0 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                        <div className="px-7 pt-6 pb-5 border-b border-[#F0F0EC]">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#10B981]">Step {index + 1} of {steps.length}</span>
                                {step.optional && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#AAAAAA]">· Optional</span>}
                            </div>
                            <h3 className="text-2xl font-light tracking-tight text-[#1A1A1A]">{step.title}</h3>
                            <p className="text-[13px] text-[#777777] leading-relaxed mt-1.5 max-w-2xl">{step.blurb}</p>

                            <div className="mt-5 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] px-5 py-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Smartphone size={13} className="text-[#555555]" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#555555]">In the app</span>
                                </div>
                                <ul className="space-y-2">
                                    {step.inApp.map(([surface, text], i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <SurfaceTag id={surface} />
                                            <span className="text-[12px] text-[#555555] leading-relaxed">{text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div className="divide-y divide-[#F0F0EC]">
                            {step.sections.map((sec, i) => (
                                sec.title
                                    ? <Group key={i} title={sec.title} blurb={sec.blurb}>{sec.fields}</Group>
                                    : <div key={i} className="px-7 py-6 space-y-5">{sec.fields}</div>
                            ))}
                        </div>

                        <div className="px-7 py-5 border-t border-[#F0F0EC] flex items-center justify-between gap-3 flex-wrap">
                            <button
                                type="button"
                                onClick={() => goTo(steps[index - 1].key)}
                                disabled={index === 0}
                                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border bg-[#F4F4F1] border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ArrowLeft size={13} /> {index > 0 ? steps[index - 1].title : 'Back'}
                            </button>
                            {index < steps.length - 1 ? (
                                <button
                                    type="button"
                                    onClick={() => goTo(steps[index + 1].key)}
                                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#1A1A1A] text-white text-[10.5px] font-bold uppercase tracking-[0.18em] hover:bg-[#333333] transition-all"
                                >
                                    Next: {steps[index + 1].title} <ArrowRight size={13} />
                                </button>
                            ) : (
                                <span className="text-[11px] text-[#999999]">
                                    Last step — save, then use the Lifecycle panel at the top to preview and Schedule.
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </fieldset>

            {dirty && !locked && (
                <SaveBar saving={saving} onSave={onSave} onDiscard={onDiscard} className="justify-end mt-4 px-1" />
            )}
        </section>
    );
}

function SurfaceTag({ id }) {
    const s = SURFACES[id] ?? SURFACES.admin;
    return (
        <span
            className="shrink-0 inline-flex items-center h-5 px-2 rounded-md border text-[9px] font-black uppercase tracking-[0.15em] whitespace-nowrap mt-0.5"
            style={{ color: s.color, borderColor: `${s.color}44`, backgroundColor: `${s.color}0F` }}
        >
            {s.label}
        </span>
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
// Two null semantics live behind this one widget:
//   nullable  — the column allows null and the SQL reads null as "every
//               type" (included_activities). "All types" stores null.
//   !nullable — the column is NOT NULL and the SQL matches the session type
//               against the stored list (conversion_activities: `type = any
//               (v_acts)`). "All types" stores the explicit full list, and
//               null is never emitted — writing it trips the not-null
//               constraint on save.
function ActivityGrid({ value, onChange, nullable = true }) {
    const list = Array.isArray(value) ? value : [];
    const all = nullable
        ? value == null
        : ACTIVITIES.every(a => list.includes(a));
    const chipOn = (a) => (nullable ? all || list.includes(a) : list.includes(a));
    return (
        <div className="flex gap-2 flex-wrap">
            <Chip
                active={all}
                onClick={() => {
                    if (nullable) onChange(all ? [...ACTIVITIES] : null);
                    else onChange(all ? [] : [...ACTIVITIES]);
                }}
            >
                All types
            </Chip>
            {ACTIVITIES.map(a => {
                const on = chipOn(a);
                return (
                    <Chip
                        key={a}
                        active={on && !(nullable && all)}
                        onClick={() => {
                            const base = nullable && all ? [...ACTIVITIES] : list;
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

// Prizes are `live_events.prizes` — a jsonb array of {rank, label, image_url?}
// that every RPC and edge fn passes through wholesale, so the image needs no
// migration: it is simply carried on the row and every surface that renders
// prizes (League ticket, register sheet, promo page, live board) knows to look
// for it. Uploads share the reward-images bucket (the one admins already have
// storage policies for) under event-prizes/.
function PrizeEditor({ prizes, onChange }) {
    const rows = Array.isArray(prizes) ? prizes : [];
    const setRow = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    return (
        <div className="space-y-3">
            {rows.length === 0 && (
                <p className="text-[12px] text-[#999999]">No prizes configured — the ticket, sheet, promo page and board all skip the section.</p>
            )}
            {rows.map((r, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 p-3 pr-3 rounded-2xl bg-white border border-[#E6E6E1] hover:border-[#D8D8D2] transition-all max-w-2xl"
                >
                    <PrizeImageTile
                        value={r.image_url}
                        rank={r.rank ?? i + 1}
                        onChange={url => setRow(i, { image_url: url })}
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center gap-2 h-10 pl-3 pr-1 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] shrink-0">
                                <span className="text-[9.5px] font-black uppercase tracking-[0.22em] text-[#999999]">Rank</span>
                                <input
                                    type="number" min={1} max={100} value={r.rank ?? i + 1}
                                    onChange={e => setRow(i, { rank: parseInt(e.target.value || '1', 10) })}
                                    className="w-12 h-8 bg-transparent font-mono text-sm text-center text-[#1A1A1A] outline-none"
                                    aria-label="Rank"
                                />
                            </div>
                            <span className="text-[10.5px] font-black uppercase tracking-[0.2em] text-[#B8A800] w-9 shrink-0">
                                {ordinal(r.rank ?? i + 1)}
                            </span>
                        </div>
                        <input
                            type="text" value={r.label ?? ''} placeholder="Prize — e.g. 3 months free membership"
                            onChange={e => setRow(i, { label: e.target.value })}
                            className="w-full h-10 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#10B981]/40"
                            aria-label="Prize label"
                        />
                    </div>
                    <button
                        type="button" aria-label="Remove prize"
                        onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                        className="w-10 h-10 self-start rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-[#F43F5E] transition-all shrink-0"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...rows, { rank: rows.length + 1, label: '', image_url: null }])}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#555555] hover:text-[#1A1A1A] transition-all"
            >
                <Plus size={13} /> Add prize
            </button>
        </div>
    );
}

const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// The square image slot on a prize row. Empty = a dashed drop-zone that IS
// the file input; filled = the image on a dark tile (that is what it sits on
// everywhere it renders) with replace-on-hover and a corner remove. Same
// bucket + size ceiling as the event logo.
function PrizeImageTile({ value, rank, onChange }) {
    const toast = useToast();
    const [uploading, setUploading] = useState(false);

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type?.startsWith('image/')) { toast.error('Prize images must be an image file'); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error('Keep the prize image under 5MB'); return; }
        setUploading(true);
        try {
            const url = await uploadPublicImage('reward-images', file, 'event-prizes');
            onChange(url);
            toast.success('Prize image uploaded — save to apply');
        } catch (err) {
            toast.error(err.message ?? 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    if (!value) {
        return (
            <label
                className={`relative w-[88px] h-[88px] shrink-0 rounded-xl border border-dashed border-[#D8D8D2] bg-[#FAFAF8] flex flex-col items-center justify-center gap-1.5 text-[#999999] hover:text-[#1A1A1A] hover:border-[#B8B8B0] hover:bg-[#F4F4F1] transition-all cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                aria-label={`Add image for the ${ordinal(rank)} prize`}
            >
                {uploading ? <LoaderCircle size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                <span className="text-[9px] font-black uppercase tracking-[0.18em]">{uploading ? 'Saving' : 'Image'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
        );
    }

    return (
        <div className="relative w-[88px] h-[88px] shrink-0 rounded-xl overflow-hidden bg-[#141414] border border-[#E6E6E1] group/tile">
            <img
                src={storageImage(value, 256)}
                alt={`${ordinal(rank)} prize`}
                className="w-full h-full object-cover"
            />
            <label
                className={`absolute inset-0 flex items-center justify-center bg-black/55 text-white text-[9px] font-black uppercase tracking-[0.18em] opacity-0 group-hover/tile:opacity-100 focus-within:opacity-100 transition-opacity cursor-pointer ${uploading ? 'opacity-100 pointer-events-none' : ''}`}
                aria-label={`Replace image for the ${ordinal(rank)} prize`}
            >
                {uploading ? <LoaderCircle size={16} className="animate-spin" /> : 'Replace'}
                <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            <button
                type="button" aria-label="Remove prize image"
                onClick={() => onChange(null)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/tile:opacity-100 focus:opacity-100 hover:bg-[#F43F5E] transition-all"
            >
                <X size={10} />
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
