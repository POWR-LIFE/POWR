import React, { useEffect, useMemo, useState } from 'react';
import { Star, X, Clock, CheckCircle, XCircle, Undo2, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import FeaturedCalendar from '../../components/FeaturedCalendar';

function atMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function nextMonday(from = new Date()) {
    const d = atMidnight(from);
    const day = d.getDay(); // 0=Sun
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    return d;
}

function formatWindow(starts, ends) {
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt(starts)} → ${fmt(ends)}`;
}

function toDateInput(date) {
    const d = new Date(date);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}

function isActive(starts, ends) {
    const now = Date.now();
    return new Date(starts).getTime() <= now && new Date(ends).getTime() > now;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
    return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

const REQUEST_STATUS = {
    pending:   { label: 'Awaiting review', color: '#8a7600', bg: 'bg-[#E8D200]/10 border-[#E8D200]/30', icon: Clock },
    approved:  { label: 'Confirmed',       color: '#16A34A', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    declined:  { label: 'Not this time',   color: '#999999', bg: 'bg-[#EFEFEC] border-[#E6E6E1]',       icon: XCircle },
    withdrawn: { label: 'Withdrawn',       color: '#999999', bg: 'bg-[#EFEFEC] border-[#E6E6E1]',       icon: Undo2 },
};

export default function PartnerFeatured() {
    const toast = useToast();
    const { user, partnerData } = useAuth();
    const myBrand = partnerData?.brand_name || null;

    const [schedule, setSchedule] = useState([]);
    const [requests, setRequests] = useState([]);
    const [myRewards, setMyRewards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(() => atMidnight(new Date()));

    const [form, setForm] = useState(null);   // { starts, ends, reward_id, note } | null
    const [saving, setSaving] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState(null);

    const fetchAll = async () => {
        // Public-read RLS: every brand's featured window is visible here.
        // Requests are the opposite — RLS returns this brand's rows only.
        // Rewards must be filtered by brand explicitly: active rewards are
        // publicly readable, so an unfiltered select returns every brand's.
        const [sched, reqs, rew] = await Promise.all([
            supabase
                .from('featured_reward_schedule')
                .select('id, reward_id, starts_at, ends_at, rewards(title, brand_name, brand_color, image_url, partners(name, logo_url))')
                .order('starts_at', { ascending: true }),
            supabase
                .from('featured_slot_requests')
                .select('id, reward_id, requested_start, requested_end, note, status, reviewer_notes, created_at, rewards(title, brand_name, brand_color, image_url)')
                .order('requested_start', { ascending: true }),
            myBrand
                ? supabase
                    .from('rewards')
                    .select('id, title, brand_name, image_url, brand_color')
                    .ilike('brand_name', myBrand)
                    .eq('active', true)
                    .order('title')
                : Promise.resolve({ data: [] }),
        ]);
        // supabase-js resolves rather than throws on a failed query — an empty
        // calendar and a broken one look identical unless we check.
        if (sched.error || reqs.error || rew.error) toast.error('Some of this page failed to load — try refreshing');
        setSchedule(sched.data || []);
        setRequests(reqs.data || []);
        setMyRewards(rew.data || []);
        setLoading(false);
    };

    useEffect(() => { fetchAll(); }, [user?.id, myBrand]);

    const rewardLabel = (row) => {
        const r = row.rewards;
        if (!r) return 'Reward';
        return r.partners?.name || r.brand_name || r.title || 'Reward';
    };

    const pending = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);

    // Confirmed bands + this brand's pending asks drawn as dashed ghosts, so
    // "we've asked for that week" and "that week is ours" never look alike.
    const slots = useMemo(() => ([
        ...schedule.map(s => ({
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            label: rewardLabel(s),
            brand_name: s.rewards?.brand_name || s.rewards?.partners?.name || null,
            brandColor: s.rewards?.brand_color || null,
            logo: s.rewards?.image_url || s.rewards?.partners?.logo_url || null,
        })),
        ...pending.map(r => ({
            id: `req-${r.id}`,
            requestId: r.id,
            ghost: true,
            starts_at: r.requested_start,
            ends_at: r.requested_end,
            label: `${r.rewards?.title || 'Reward'} (requested)`,
            brand_name: r.rewards?.brand_name || myBrand,
            brandColor: r.rewards?.brand_color || null,
            logo: r.rewards?.image_url || null,
        })),
    ]), [schedule, pending, myBrand]);

    const current = schedule.find(s => isActive(s.starts_at, s.ends_at));
    const isMine = (row) => myBrand && (row?.rewards?.brand_name || '').trim().toLowerCase() === myBrand.trim().toLowerCase();

    // The partner's own upcoming/active windows, for a quick "you're featured" cue.
    const myUpcoming = useMemo(
        () => schedule.filter(s => isMine(s) && new Date(s.ends_at).getTime() > Date.now())
            .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)),
        [schedule, myBrand],
    );

    const goMonth = (delta) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

    // A day is askable if it is in the future and no confirmed slot covers it.
    // Another brand's *request* never blocks one of ours — nothing is reserved
    // until an admin approves.
    const dayIsTaken = (day) => schedule.some(s => overlaps(atMidnight(day), addDays(atMidnight(day), 1), s.starts_at, s.ends_at));
    const canClickDay = (day) => atMidnight(day).getTime() >= atMidnight(new Date()).getTime() && !dayIsTaken(day);

    const openRequest = (startDate) => {
        if (myRewards.length === 0) {
            toast.error('Add a live reward first — a featured week has to point at something members can claim');
            return;
        }
        const start = startDate ? atMidnight(startDate) : nextMonday();
        setForm({
            starts: toDateInput(start),
            ends: toDateInput(addDays(start, 7)),
            reward_id: myRewards.length === 1 ? myRewards[0].id : '',
            note: '',
        });
    };

    const submitRequest = async (e) => {
        e.preventDefault();
        if (!form.reward_id) { toast.error('Pick the reward you want featured'); return; }
        const starts = atMidnight(new Date(`${form.starts}T00:00`));
        const ends = atMidnight(new Date(`${form.ends}T00:00`));
        if (!(ends > starts)) { toast.error('The end date has to be after the start date'); return; }
        if (ends <= new Date()) { toast.error('Pick a window that has not already passed'); return; }
        if (schedule.some(s => overlaps(starts, ends, s.starts_at, s.ends_at))) {
            toast.error('Part of that window is already booked — pick dates the calendar shows as free');
            return;
        }

        setSaving(true);
        const { error } = await supabase.from('featured_slot_requests').insert({
            brand_name: myBrand,
            reward_id: form.reward_id,
            requested_start: starts.toISOString(),
            requested_end: ends.toISOString(),
            note: form.note.trim() || null,
            requested_by: user.id,
        });
        setSaving(false);

        if (error) {
            // The one-pending-per-week exclusion constraint.
            if (error.code === '23P01') {
                toast.error('You already have a request open on those dates');
            } else {
                toast.error('Could not send that request — please try again');
            }
            return;
        }
        toast.success('Request sent — the POWR team will confirm or come back to you');
        setForm(null);
        fetchAll();
    };

    const withdraw = async (id) => {
        const { error } = await supabase
            .from('featured_slot_requests')
            .update({ status: 'withdrawn' })
            .eq('id', id);
        if (error) {
            toast.error('Could not withdraw that request');
            return;
        }
        toast.success('Request withdrawn');
        setSelectedRequest(null);
        fetchAll();
    };

    const decided = requests.filter(r => r.status !== 'pending');

    return (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]" />
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Featured Lineup</span>
                    </div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">What's On</h1>
                    <p className="text-[#888888] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        The reward featured at the top of the POWR rewards screen. Your brand is outlined —
                        click any free day to ask for a week.
                    </p>
                </div>
                <button
                    onClick={() => openRequest()}
                    className="flex items-center gap-4 h-14 px-8 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.3em] rounded-full transition-all hover:translate-y-[-3px] shadow-xl shadow-[#E8D200]/20 shrink-0"
                >
                    <Star size={16} /> Request A Week
                </button>
            </div>

            {/* Live now */}
            {current && (
                <div className="mb-6 flex items-center gap-6 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-3xl px-10 py-7">
                    <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                        <Star size={18} className="text-[#8a7600]" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[9px] uppercase tracking-[0.5em] text-[#8a7600] font-black mb-1">Featured Now</div>
                        <div className="text-base font-bold text-[#1A1A1A]">{rewardLabel(current)}{isMine(current) && <span className="ml-3 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#1A1A1A] text-white rounded-full align-middle">You</span>}</div>
                        <div className="text-[11px] text-[#888888] mt-0.5 font-black uppercase tracking-[0.2em]">{formatWindow(current.starts_at, current.ends_at)}</div>
                    </div>
                </div>
            )}

            {/* Partner's own upcoming windows */}
            {myUpcoming.length > 0 && (
                <div className="mb-6 bg-white border border-[#E6E6E1] rounded-3xl px-10 py-6">
                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#999999] font-black mb-3">Your featured windows</div>
                    <div className="flex flex-wrap gap-3">
                        {myUpcoming.map(s => (
                            <span key={s.id} className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/20 text-[10px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                                {formatWindow(s.starts_at, s.ends_at)}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* No live reward → nothing to feature. Say so before they hit a
                dead end in the request form. */}
            {!loading && myRewards.length === 0 && (
                <div className="mb-6 bg-white border border-[#E6E6E1] rounded-3xl px-10 py-7 flex items-center gap-6">
                    <div className="w-10 h-10 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                        <Award size={17} className="text-[#999999]" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[13px] font-bold text-[#1A1A1A] mb-1">A featured week needs a live reward</div>
                        <p className="text-[12px] text-[#888888] leading-relaxed">
                            The featured card sends members straight to an offer they can claim, so there has to be
                            one live before you can request a slot. <Link to="/partner/rewards" className="text-[#8a7600] font-bold underline underline-offset-2">Set up a reward</Link>.
                        </p>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-48 gap-6">
                    <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Calendar...</span>
                </div>
            ) : (
                <>
                    <FeaturedCalendar
                        slots={slots}
                        month={month}
                        onPrevMonth={() => goMonth(-1)}
                        onNextMonth={() => goMonth(1)}
                        onDayClick={(day) => openRequest(day)}
                        onSlotClick={(slot) => {
                            if (!slot.ghost) return;   // confirmed bands aren't yours to edit
                            setSelectedRequest(requests.find(r => r.id === slot.requestId) || null);
                        }}
                        canClickDay={canClickDay}
                        highlightBrand={myBrand}
                    />
                    <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">
                        Click a free day to request that week · dashed bands are requests, not bookings
                    </p>
                </>
            )}

            {/* Your requests */}
            {!loading && requests.length > 0 && (
                <div className="mt-10 bg-white border border-[#E6E6E1] rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">Your Requests</h2>
                        {pending.length > 0 && (
                            <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-3 py-1">
                                {pending.length} awaiting review
                            </span>
                        )}
                    </div>
                    <div className="space-y-3">
                        {[...pending, ...decided].map(r => {
                            const cfg = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
                            const StatusIcon = cfg.icon;
                            return (
                                <div key={r.id} className="border border-[#E6E6E1] rounded-2xl p-5 flex items-center gap-5">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold text-[#1A1A1A] truncate mb-1.5">
                                            {formatWindow(r.requested_start, r.requested_end)}
                                        </div>
                                        <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black truncate">
                                            {r.rewards?.title || 'Reward'}
                                        </div>
                                        {r.reviewer_notes && (
                                            <p className="mt-3 text-[12px] text-[#666666] leading-relaxed border-l-2 border-[#E6E6E1] pl-4">
                                                {r.reviewer_notes}
                                            </p>
                                        )}
                                    </div>
                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest shrink-0 ${cfg.bg}`} style={{ color: cfg.color }}>
                                        <StatusIcon size={10} />
                                        {cfg.label}
                                    </span>
                                    {r.status === 'pending' && (
                                        <button
                                            onClick={() => withdraw(r.id)}
                                            className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-red-500 transition-colors shrink-0"
                                        >
                                            Withdraw
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Ghost band tapped → withdraw sheet */}
            {selectedRequest && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-8 animate-in fade-in duration-200" onClick={() => setSelectedRequest(null)}>
                    <div className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl w-full max-w-md p-10" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-8">
                            <div className="min-w-0">
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-2">Requested · not confirmed</div>
                                <div className="text-base font-bold text-[#1A1A1A]">{selectedRequest.rewards?.title || 'Reward'}</div>
                                <div className="text-[10px] uppercase tracking-[0.2em] text-[#888888] font-black mt-1">
                                    {formatWindow(selectedRequest.requested_start, selectedRequest.requested_end)}
                                </div>
                            </div>
                            <button onClick={() => setSelectedRequest(null)} className="w-10 h-10 bg-white border border-[#E6E6E1] rounded-2xl flex items-center justify-center text-[#666] hover:text-[#1A1A1A] transition-all shrink-0">
                                <X size={16} />
                            </button>
                        </div>
                        <button
                            onClick={() => withdraw(selectedRequest.id)}
                            className="w-full h-12 flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] text-[#999999] hover:text-red-500 border border-[#E6E6E1] hover:border-red-500/20 rounded-full transition-all"
                        >
                            <Undo2 size={14} /> Withdraw Request
                        </button>
                    </div>
                </div>
            )}

            {/* Request modal */}
            {form && (
                <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="flex min-h-full items-center justify-center p-8">
                        <div className="bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl w-full max-w-xl shadow-[0_0_100px_rgba(232,210,0,0.05)]">
                            <form onSubmit={submitRequest} className="p-12">
                                <div className="flex items-start justify-between mb-10">
                                    <div>
                                        <h2 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-2">Request A Week</h2>
                                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">The POWR team confirms every slot</p>
                                    </div>
                                    <button type="button" onClick={() => setForm(null)} className="w-12 h-12 bg-white border border-[#E6E6E1] rounded-3xl flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] hover:border-[#E8D200]/40 transition-all">
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="mb-8">
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Reward to feature</label>
                                    <select
                                        required
                                        className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all appearance-none text-[12px] font-black text-[#222222] tracking-[0.1em] uppercase"
                                        value={form.reward_id}
                                        onChange={e => setForm({ ...form, reward_id: e.target.value })}
                                    >
                                        <option value="">— Select a reward —</option>
                                        {myRewards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-6 mb-8">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">From</label>
                                        <input
                                            type="date"
                                            required
                                            min={toDateInput(new Date())}
                                            className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A]"
                                            value={form.starts}
                                            onChange={e => setForm({ ...form, starts: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Until</label>
                                        <input
                                            type="date"
                                            required
                                            min={form.starts}
                                            className="w-full h-16 px-8 bg-white border border-[#E6E6E1] rounded-3xl focus:border-[#E8D200]/40 outline-none transition-all text-[12px] font-black text-[#1A1A1A]"
                                            value={form.ends}
                                            onChange={e => setForm({ ...form, ends: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {/* Quick-fill week buttons, mirroring the admin scheduler */}
                                <div className="mb-8">
                                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#999999] font-black mb-4">Quick fill — week of</div>
                                    <div className="flex flex-wrap gap-3">
                                        {[0, 1, 2, 3].map(offset => {
                                            const start = addDays(nextMonday(), offset * 7);
                                            const taken = schedule.some(s => overlaps(start, addDays(start, 7), s.starts_at, s.ends_at));
                                            const label = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                            return (
                                                <button
                                                    key={offset}
                                                    type="button"
                                                    disabled={taken}
                                                    title={taken ? 'Already booked' : undefined}
                                                    onClick={() => setForm(prev => ({
                                                        ...prev,
                                                        starts: toDateInput(start),
                                                        ends: toDateInput(addDays(start, 7)),
                                                    }))}
                                                    className="h-9 px-5 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all disabled:opacity-35 disabled:hover:text-[#555555] disabled:hover:border-[#E6E6E1] disabled:cursor-not-allowed"
                                                >
                                                    {label}{taken ? ' · taken' : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="mb-8">
                                    <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-4">Anything we should know? <span className="text-[#BBBBBB]">(optional)</span></label>
                                    <textarea
                                        rows={4}
                                        value={form.note}
                                        onChange={e => setForm({ ...form, note: e.target.value })}
                                        placeholder="A launch date, a campaign you're running, why this week matters…"
                                        className="w-full bg-white border border-[#E6E6E1] rounded-2xl p-5 text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none resize-none transition-all"
                                    />
                                </div>

                                <p className="text-[11px] text-[#888888] leading-relaxed mb-8 bg-white border border-[#E6E6E1] rounded-2xl px-5 py-4">
                                    Only one reward is featured at a time, so a request holds nothing —
                                    we'll confirm it here, and you'll see the week turn solid on the calendar.
                                </p>

                                <div className="flex justify-end gap-4">
                                    <button type="button" onClick={() => setForm(null)} className="h-14 px-8 text-[11px] uppercase tracking-[0.4em] font-black text-[#666666] hover:text-[#BBB] transition-colors">Cancel</button>
                                    <button type="submit" disabled={saving} className="h-14 px-10 bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.4em] rounded-full transition-all hover:translate-y-[-2px] shadow-xl shadow-[#E8D200]/20 disabled:opacity-50">
                                        {saving ? 'Sending...' : 'Send Request'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
