import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchClashNights, bookClashNight, cancelClashNight } from './venueApi';

// Clash Nights (Clash Pro / Founding Pro): 4 a year, one per quarter, POWR
// brings the DJ, photographer and partner prizes. The gym asks for a date
// here; POWR gets a Slack line and confirms or declines in /admin/gyms.
// The rules (28 days' notice, a year ahead, one per quarter, dates POWR has
// confirmed elsewhere) are enforced by gym_book_clash_night; this page only
// shows them. Dates are London calendar days, kept as 'YYYY-MM-DD' strings.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVE = ['requested', 'confirmed'];

const toDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const quarterOf = (s) => { const d = toDay(s); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
    toDay(s).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const fmtTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};

const STATUS = {
    requested: { label: 'Asked', cls: 'bg-[#FFFBE0] border-[#E8D200]/50 text-[#8a7600]' },
    confirmed: { label: 'Confirmed', cls: 'bg-[#0B7A57]/10 border-[#0B7A57]/30 text-[#0B7A57]' },
    declined:  { label: 'Not possible', cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]' },
    cancelled: { label: 'Called off', cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#AAAAAA]' },
};

function StatusChip({ status }) {
    const s = STATUS[status];
    return <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] ${s.cls}`}>{s.label}</span>;
}

/** The quarters from the first bookable date to a year out, each with its night (if any). */
function quartersOf(data) {
    const out = [];
    const first = toDay(data.first_date);
    const last = toDay(data.last_date);
    let q = new Date(Date.UTC(first.getUTCFullYear(), Math.floor(first.getUTCMonth() / 3) * 3, 1));
    while (q <= last) {
        const key = quarterOf(iso(q));
        const end = new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + 3, 0));
        out.push({
            key,
            label: `${q.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} – ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
            night: data.bookings.find((b) => ACTIVE.includes(b.status) && quarterOf(b.night_date) === key),
        });
        q = new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + 3, 1));
    }
    return out;
}

function Calendar({ data, selected, onPick }) {
    // Open on the month of the first date that can actually be picked.
    const [cursor, setCursor] = useState(() => {
        const used = new Set(data.bookings.filter((b) => ACTIVE.includes(b.status)).map((b) => quarterOf(b.night_date)));
        const taken = new Set(data.taken);
        let d = toDay(data.first_date);
        while (iso(d) <= data.last_date && (used.has(quarterOf(iso(d))) || taken.has(iso(d)))) d = new Date(d.getTime() + 86400000);
        if (iso(d) > data.last_date) d = toDay(data.first_date);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    });
    const taken = useMemo(() => new Set(data.taken), [data.taken]);
    const mine = useMemo(() => Object.fromEntries(data.bookings.filter((b) => ACTIVE.includes(b.status)).map((b) => [b.night_date, b])), [data.bookings]);
    const usedQuarters = useMemo(() => new Set(Object.keys(mine).map(quarterOf)), [mine]);

    const firstMonth = new Date(Date.UTC(toDay(data.today).getUTCFullYear(), toDay(data.today).getUTCMonth(), 1));
    const lastMonth = new Date(Date.UTC(toDay(data.last_date).getUTCFullYear(), toDay(data.last_date).getUTCMonth(), 1));
    const move = (n) => setCursor((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + n, 1)));

    const lead = (cursor.getUTCDay() + 6) % 7; // Monday first
    const daysIn = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
    const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), i + 1))))];

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <button type="button" onClick={() => move(-1)} disabled={cursor <= firstMonth} aria-label="Previous month"
                    className="w-10 h-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#666] disabled:opacity-30">
                    <ChevronLeft size={16} />
                </button>
                <div className="text-lg font-light tracking-tight text-[#1A1A1A]">
                    {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </div>
                <button type="button" onClick={() => move(1)} disabled={cursor >= lastMonth} aria-label="Next month"
                    className="w-10 h-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#666] disabled:opacity-30">
                    <ChevronRight size={16} />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {WEEKDAYS.map((w) => <div key={w} className="text-center text-[9px] uppercase tracking-[0.2em] font-black text-[#BBBBBB] pb-1">{w}</div>)}
                {cells.map((d, i) => {
                    if (!d) return <div key={`b${i}`} />;
                    const own = mine[d];
                    const tooSoon = d < data.first_date;
                    const tooFar = d > data.last_date;
                    const isTaken = taken.has(d);
                    const quarterUsed = !own && usedQuarters.has(quarterOf(d));
                    const off = tooSoon || tooFar || isTaken || quarterUsed || !!own;
                    const why = own ? (own.status === 'confirmed' ? 'Your Clash Night' : 'You asked for this night')
                        : tooSoon ? `Needs ${data.lead_days} days’ notice` : tooFar ? 'More than a year ahead'
                        : isTaken ? 'POWR is at another gym that night' : quarterUsed ? 'You have a night this quarter' : 'Pick this night';
                    const isSel = selected === d;
                    return (
                        <button key={d} type="button" disabled={off} onClick={() => onPick(d)} title={why} aria-label={`${fmtDay(d)}: ${why}`} aria-pressed={isSel}
                            className={`relative aspect-square sm:aspect-auto sm:h-14 rounded-xl text-[13px] transition-colors flex flex-col items-center justify-center
                                ${isSel ? 'bg-[#E8D200] text-[#080808] font-bold'
                                : own ? (own.status === 'confirmed' ? 'bg-[#0B7A57]/10 text-[#0B7A57] font-bold border border-[#0B7A57]/30' : 'bg-[#FFFBE0] text-[#8a7600] font-bold border border-[#E8D200]/50')
                                : off ? 'text-[#D0D0CB] cursor-not-allowed'
                                : 'bg-[#F4F4F1] text-[#1A1A1A] hover:bg-[#E8D200]/20 border border-transparent hover:border-[#E8D200]/40'}`}>
                            {Number(d.slice(8))}
                            {isTaken && !own && <span className="hidden sm:block text-[7px] uppercase tracking-[0.15em] font-black text-[#CCCCCC]">Taken</span>}
                        </button>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-[10px] text-[#999]">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#F4F4F1]" />Free</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#FFFBE0] border border-[#E8D200]/50" />Asked</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#0B7A57]/10 border border-[#0B7A57]/30" />Confirmed</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-[#E6E6E1]" />Can’t book</span>
            </div>
        </div>
    );
}

export default function VenueClashNights() {
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [picked, setPicked] = useState(null);
    const [startTime, setStartTime] = useState('19:00');
    const [backupDate, setBackupDate] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const formRef = useRef(null);

    const load = () => fetchClashNights(gym.partner_id).then(setData).catch((e) => setError(e.message));
    useEffect(() => { load(); }, [gym.partner_id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (error) return <Empty title="Couldn’t load your Clash Nights" action={<button type="button" className={BTN_GHOST} onClick={() => window.location.reload()}>Try again</button>}>{error}</Empty>;
    if (!data) return <Spinner />;

    const previewOnly = () => { if (!isActingGym) return false; toast.error('Preview only. Change a gym’s Clash Nights from the admin pages.'); return true; };

    const submit = async () => {
        if (previewOnly()) return;
        setBusy(true);
        try {
            setData(await bookClashNight(gym.partner_id, { date: picked, startTime, backupDate, notes }));
            toast.success(`Asked for ${fmtDay(picked, { weekday: 'long', day: 'numeric', month: 'long' })}. POWR will confirm it with you.`);
            setPicked(null); setBackupDate(''); setNotes(''); setStartTime('19:00');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    const cancel = async (b) => {
        if (previewOnly()) return;
        if (!window.confirm(`Call off the Clash Night on ${fmtDay(b.night_date, { weekday: 'long', day: 'numeric', month: 'long' })}? POWR will be told straight away.`)) return;
        try {
            setData(await cancelClashNight(b.id));
            toast.success('Called off. That quarter is free to book again.');
        } catch (e) {
            toast.error(e.message);
        }
    };

    const title = <PageTitle eyebrow="Clash Pro" title="Clash Nights" sub={gym.name} />;

    if (!data.included) {
        return (
            <Page>
                {title}
                <Card className="p-8 sm:p-12" glow>
                    <div className="flex items-center gap-3 mb-5">
                        <Lock size={14} className="text-[#8a7600]" />
                        <Micro gold>Clash Pro and Founding Pro</Micro>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05] max-w-2xl">Clash Nights come with Clash Pro</h2>
                    <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-xl">
                        Four POWR Clash Nights a year, one a quarter, at your gym. We bring the DJ, the photographer and partner prizes, and you pick the dates here.
                    </p>
                    <Link to="/venue/package" className={`${BTN_GOLD} mt-8`} style={{ color: '#080808' }}>See packages</Link>
                </Card>
            </Page>
        );
    }

    const quarters = quartersOf(data);
    const upcoming = data.bookings.filter((b) => ACTIVE.includes(b.status) && b.night_date >= data.today).sort((a, b) => a.night_date.localeCompare(b.night_date));
    const history = data.bookings.filter((b) => !upcoming.includes(b));
    const founding = data.package === 'founding';

    return (
        <Page>
            {title}

            <Card className="p-6 sm:p-10">
                <Micro gold>How it works</Micro>
                <p className="text-[15px] text-[#444] leading-relaxed mt-3 max-w-3xl">
                    Your package includes {data.per_year} Clash Nights a year, one a quarter. We bring the DJ, the photographer and partner prizes.
                    Pick a night at least <b className="text-[#1A1A1A]">{data.lead_days / 7} weeks ahead</b>. The first date you can pick is {fmtDay(data.first_date, { weekday: 'long', day: 'numeric', month: 'long' })}.
                    POWR gets your request, then confirms the date with you.
                </p>
                {founding && upcoming.length < data.per_year && (
                    <p className="text-[12px] font-bold text-[#8a7600] mt-3">Founding Pro: pick all four dates now, one in each quarter.</p>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
                    {quarters.map((q) => (
                        <div key={q.key} className={`p-4 rounded-2xl border ${q.night ? 'bg-white border-[#E6E6E1]' : 'bg-[#F4F4F1] border-dashed border-[#E6E6E1]'}`}>
                            <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{q.label}</div>
                            {q.night ? (
                                <>
                                    <div className="text-[14px] font-bold text-[#1A1A1A] mt-2">{fmtDay(q.night.night_date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                                    <div className="mt-2"><StatusChip status={q.night.status} /></div>
                                </>
                            ) : (
                                <div className="text-[12px] text-[#999] mt-2">Free to book</div>
                            )}
                        </div>
                    ))}
                </div>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                <Card className="p-5 sm:p-8 xl:col-span-3">
                    <Micro className="mb-4">Pick a night</Micro>
                    <Calendar data={data} selected={picked} onPick={(d) => {
                        setPicked(d);
                        if (backupDate === d) setBackupDate('');
                        // Phones and narrow windows stack the form under the calendar.
                        if (window.innerWidth < 1280) setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }} />
                </Card>

                <div ref={formRef} className="xl:col-span-2 scroll-mt-24">
                <Card className="p-6 sm:p-8 h-full" glow={!!picked}>
                    {picked ? (
                        <div className="space-y-5">
                            <div>
                                <Micro gold>Your night</Micro>
                                <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mt-2">{fmtDay(picked, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                                <div className="text-[12px] text-[#999] mt-1">Your {quartersOf(data).find((q) => q.key === quarterOf(picked))?.label} night</div>
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-time">Starts at</label>
                                <input id="cn-time" type="time" step="900" min="06:00" max="21:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-backup">Backup date (optional)</label>
                                <input id="cn-backup" type="date" min={data.first_date} max={data.last_date} value={backupDate} onChange={(e) => setBackupDate(e.target.value)} className={INPUT} />
                                <p className="text-[11px] text-[#AAAAAA] mt-2">If we can’t do your first choice, we’ll try this one.</p>
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-notes">Anything we should know</label>
                                <textarea id="cn-notes" rows={3} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)}
                                    placeholder="How many you expect, a theme, where the DJ can set up…"
                                    className={`${INPUT} h-auto py-3 resize-none`} />
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" onClick={submit} disabled={busy || !startTime} className={BTN_GOLD}>
                                    {busy ? 'Sending…' : 'Ask POWR for this night'}
                                </button>
                                <button type="button" onClick={() => setPicked(null)} className={BTN_GHOST}>Clear</button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col justify-center py-8">
                            <Micro>Your night</Micro>
                            <p className="text-[14px] text-[#888] leading-relaxed mt-3">
                                Pick a free date on the calendar. Greyed-out days are too soon, in a quarter you’ve already booked, or taken by another gym.
                            </p>
                        </div>
                    )}
                </Card>
                </div>
            </div>

            {(upcoming.length > 0 || history.length > 0) && (
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-2">Your nights</Micro>
                    <div className="divide-y divide-[#F0F0EC]">
                        {[...upcoming, ...history].map((b) => (
                            <div key={b.id} className="py-4 flex flex-wrap items-start gap-4">
                                <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className={`text-[15px] font-bold ${upcoming.includes(b) ? 'text-[#1A1A1A]' : 'text-[#AAAAAA]'}`}>
                                            {fmtDay(b.night_date)} · {fmtTime(b.start_time)}
                                        </span>
                                        <StatusChip status={b.status} />
                                    </div>
                                    {b.backup_date && <div className="text-[12px] text-[#999] mt-1">Backup {fmtDay(b.backup_date)}</div>}
                                    {b.notes && <div className="text-[12px] text-[#888] mt-1">“{b.notes}”</div>}
                                    {b.admin_note && <div className="text-[12px] text-[#1A1A1A] mt-2"><b>POWR:</b> {b.admin_note}</div>}
                                </div>
                                {upcoming.includes(b) && (
                                    <button type="button" onClick={() => cancel(b)} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#ef4444] pt-1">
                                        Call off
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </Page>
    );
}
