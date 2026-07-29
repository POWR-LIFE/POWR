import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
    PartyPopper, Plus, Copy, Save, Trash2, Search, X, Check,
    CalendarClock, Eye, EyeOff, Lock, Flag, Trophy, Archive,
    Link2, RefreshCw, AlertTriangle, Rocket, Undo2,
} from 'lucide-react';

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
    prizes: ev.prizes ?? [],
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

    const selected = useMemo(() => events.find(e => e.id === selectedId) ?? null, [events, selectedId]);
    const dirty = useMemo(() => {
        if (!selected || !form) return false;
        return JSON.stringify(editableFields(selected)) !== JSON.stringify(form);
    }, [selected, form]);

    useEffect(() => { fetchEvents(); }, []);

    useEffect(() => {
        if (!selected) { setForm(null); setVenueName(null); return; }
        setForm(editableFields(selected));
        fetchCounts(selected.id);
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
                        onRegenToken={() => regenerateToken(selected)}
                        onDuplicate={() => duplicateEvent(selected)}
                    />

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

// ─── Lifecycle panel ─────────────────────────────────────────────

function LifecyclePanel({
    ev, counts, acting,
    onSchedule, onUnschedule, onGoLive, onLock, onToggleHidden,
    onSettle, onReveal, onMarkSettled, onArchive,
    onCopyUrl, onRegenToken, onDuplicate,
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
                </div>
            </div>
        </section>
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
                    <div className="flex items-center gap-2 shrink-0">
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

                    {/* Prizes */}
                    <Group title="Prizes" blurb="Labels only — attached to ranks at Settle and read out on the night.">
                        <PrizeEditor prizes={form.prizes} onChange={v => set({ prizes: v })} />
                    </Group>
                </div>
            </fieldset>
        </section>
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
