import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import i18n, { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { Page, Card, Micro, PageTitle, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchClashNights, bookClashNight, cancelClashNight } from './venueApi';

// Clash Nights (Clash Pro / Founding Pro): 4 a year, one per quarter, POWR
// brings the DJ, photographer and partner prizes. The gym asks for a date
// here; POWR gets a Slack line and confirms or declines in /admin/gyms.
// The rules (28 days' notice, a year ahead, one per quarter, dates POWR has
// confirmed elsewhere) are enforced by gym_book_clash_night; this page only
// shows them. Dates are London calendar days, kept as 'YYYY-MM-DD' strings.

const ACTIVE = ['requested', 'confirmed'];

const toDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const quarterOf = (s) => { const d = toDay(s); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
    toDay(s).toLocaleDateString(formatLocale(), { ...opts, timeZone: 'UTC' });
// English keeps "7pm"; French and Spanish read the 24-hour clock ("19:00").
const fmtTime = (time) => {
    const [h, m] = time.split(':').map(Number);
    if ((i18n.language || 'en') !== 'en') return `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
// Mon … Sun in the reader's language (2024-01-01 was a Monday).
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(formatLocale(), { weekday: 'short', timeZone: 'UTC' }));

const STATUS = {
    requested: { label: 'venueGrowth:clash.status.requested', cls: 'bg-[#FFFBE0] border-[#E8D200]/50 text-[#8a7600]' },
    confirmed: { label: 'venueGrowth:clash.status.confirmed', cls: 'bg-[#0B7A57]/10 border-[#0B7A57]/30 text-[#0B7A57]' },
    declined:  { label: 'venueGrowth:clash.status.declined', cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]' },
    cancelled: { label: 'venueGrowth:clash.status.cancelled', cls: 'bg-[#F4F4F1] border-[#E6E6E1] text-[#AAAAAA]' },
};

function StatusChip({ status }) {
    const { t } = useTranslation();
    const s = STATUS[status];
    return <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] ${s.cls}`}>{t(s.label)}</span>;
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
            label: i18n.t('venueGrowth:clash.quarter', {
                from: q.toLocaleDateString(formatLocale(), { month: 'short', timeZone: 'UTC' }),
                to: end.toLocaleDateString(formatLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }),
            }),
            night: data.bookings.find((b) => ACTIVE.includes(b.status) && quarterOf(b.night_date) === key),
        });
        q = new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + 3, 1));
    }
    return out;
}

function Calendar({ data, selected, onPick }) {
    const { t } = useTranslation();
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
                <button type="button" onClick={() => move(-1)} disabled={cursor <= firstMonth} aria-label={t('venueGrowth:clash.calendar.previous')}
                    className="w-10 h-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#666] disabled:opacity-30">
                    <ChevronLeft size={16} />
                </button>
                <div className="text-lg font-light tracking-tight text-[#1A1A1A]">
                    {cursor.toLocaleDateString(formatLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </div>
                <button type="button" onClick={() => move(1)} disabled={cursor >= lastMonth} aria-label={t('venueGrowth:clash.calendar.next')}
                    className="w-10 h-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#666] disabled:opacity-30">
                    <ChevronRight size={16} />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {weekdays().map((w) => <div key={w} className="text-center text-[9px] uppercase tracking-[0.2em] font-black text-[#BBBBBB] pb-1">{w}</div>)}
                {cells.map((d, i) => {
                    if (!d) return <div key={`b${i}`} />;
                    const own = mine[d];
                    const tooSoon = d < data.first_date;
                    const tooFar = d > data.last_date;
                    const isTaken = taken.has(d);
                    const quarterUsed = !own && usedQuarters.has(quarterOf(d));
                    const off = tooSoon || tooFar || isTaken || quarterUsed || !!own;
                    const why = own ? (own.status === 'confirmed' ? t('venueGrowth:clash.calendar.why.confirmed') : t('venueGrowth:clash.calendar.why.requested'))
                        : tooSoon ? t('venueGrowth:clash.calendar.why.tooSoon', { count: data.lead_days }) : tooFar ? t('venueGrowth:clash.calendar.why.tooFar')
                        : isTaken ? t('venueGrowth:clash.calendar.why.taken') : quarterUsed ? t('venueGrowth:clash.calendar.why.quarterUsed') : t('venueGrowth:clash.calendar.why.pick');
                    const isSel = selected === d;
                    return (
                        <button key={d} type="button" disabled={off} onClick={() => onPick(d)} title={why} aria-label={t('venueGrowth:clash.calendar.dayAria', { day: fmtDay(d), why })} aria-pressed={isSel}
                            className={`relative aspect-square sm:aspect-auto sm:h-14 rounded-xl text-[13px] transition-colors flex flex-col items-center justify-center
                                ${isSel ? 'bg-[#E8D200] text-[#080808] font-bold'
                                : own ? (own.status === 'confirmed' ? 'bg-[#0B7A57]/10 text-[#0B7A57] font-bold border border-[#0B7A57]/30' : 'bg-[#FFFBE0] text-[#8a7600] font-bold border border-[#E8D200]/50')
                                : off ? 'text-[#D0D0CB] cursor-not-allowed'
                                : 'bg-[#F4F4F1] text-[#1A1A1A] hover:bg-[#E8D200]/20 border border-transparent hover:border-[#E8D200]/40'}`}>
                            {Number(d.slice(8))}
                            {isTaken && !own && <span className="hidden sm:block text-[7px] uppercase tracking-[0.15em] font-black text-[#CCCCCC]">{t('venueGrowth:clash.calendar.taken')}</span>}
                        </button>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-[10px] text-[#999]">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#F4F4F1]" />{t('venueGrowth:clash.calendar.legend.free')}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#FFFBE0] border border-[#E8D200]/50" />{t('venueGrowth:clash.status.requested')}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#0B7A57]/10 border border-[#0B7A57]/30" />{t('venueGrowth:clash.status.confirmed')}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-[#E6E6E1]" />{t('venueGrowth:clash.calendar.legend.cantBook')}</span>
            </div>
        </div>
    );
}

export default function VenueClashNights() {
    const { t } = useTranslation();
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

    const load = () => fetchClashNights(gym.partner_id).then(setData).catch((e) => setError(e));
    useEffect(() => { load(); }, [gym.partner_id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (error) return <Empty title={t('venueGrowth:clash.loadError')} action={<button type="button" className={BTN_GHOST} onClick={() => window.location.reload()}>{t('common:actions.retry')}</button>}>{serverErrorText(error)}</Empty>;
    if (!data) return <Spinner />;

    // Admin preview only (POWR staff), so this message stays English.
    const previewOnly = () => { if (!isActingGym) return false; toast.error('Preview only. Change a gym’s Clash Nights from the admin pages.'); return true; };

    const submit = async () => {
        if (previewOnly()) return;
        setBusy(true);
        try {
            setData(await bookClashNight(gym.partner_id, { date: picked, startTime, backupDate, notes }));
            toast.success(t('venueGrowth:clash.toast.asked', { date: fmtDay(picked, { weekday: 'long', day: 'numeric', month: 'long' }) }));
            setPicked(null); setBackupDate(''); setNotes(''); setStartTime('19:00');
        } catch (e) {
            toast.error(serverErrorText(e));
        } finally {
            setBusy(false);
        }
    };

    const cancel = async (b) => {
        if (previewOnly()) return;
        if (!window.confirm(t('venueGrowth:clash.toast.callOffConfirm', { date: fmtDay(b.night_date, { weekday: 'long', day: 'numeric', month: 'long' }) }))) return;
        try {
            setData(await cancelClashNight(b.id));
            toast.success(t('venueGrowth:clash.toast.calledOff'));
        } catch (e) {
            toast.error(serverErrorText(e));
        }
    };

    const title = <PageTitle eyebrow={t('venueGrowth:clash.eyebrow')} title={t('venueGrowth:clash.title')} sub={gym.name} />;

    if (!data.included) {
        return (
            <Page>
                {title}
                <Card className="p-8 sm:p-12" glow>
                    <div className="flex items-center gap-3 mb-5">
                        <Lock size={14} className="text-[#8a7600]" />
                        <Micro gold>{t('venueGrowth:clash.locked.eyebrow')}</Micro>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05] max-w-2xl">{t('venueGrowth:clash.locked.title')}</h2>
                    <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-xl">
                        {t('venueGrowth:clash.locked.body')}
                    </p>
                    <Link to="/venue/package" className={`${BTN_GOLD} mt-8`} style={{ color: '#080808' }}>{t('venueGrowth:clash.locked.cta')}</Link>
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
                <Micro gold>{t('venueGrowth:clash.how.eyebrow')}</Micro>
                <p className="text-[15px] text-[#444] leading-relaxed mt-3 max-w-3xl">
                    {t('venueGrowth:clash.how.included', { count: data.per_year })}{' '}
                    <Trans i18nKey="venueGrowth:clash.how.notice" count={data.lead_days / 7}
                        values={{ date: fmtDay(data.first_date, { weekday: 'long', day: 'numeric', month: 'long' }) }}
                        components={{ strong: <b className="text-[#1A1A1A]" /> }} />{' '}
                    {t('venueGrowth:clash.how.confirm')}
                </p>
                {founding && upcoming.length < data.per_year && (
                    <p className="text-[12px] font-bold text-[#8a7600] mt-3">{t('venueGrowth:clash.how.founding')}</p>
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
                                <div className="text-[12px] text-[#999] mt-2">{t('venueGrowth:clash.how.freeToBook')}</div>
                            )}
                        </div>
                    ))}
                </div>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                <Card className="p-5 sm:p-8 xl:col-span-3">
                    <Micro className="mb-4">{t('venueGrowth:clash.form.pickNight')}</Micro>
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
                                <Micro gold>{t('venueGrowth:clash.form.yourNight')}</Micro>
                                <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mt-2">{fmtDay(picked, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                                <div className="text-[12px] text-[#999] mt-1">{t('venueGrowth:clash.form.quarterNight', { quarter: quartersOf(data).find((q) => q.key === quarterOf(picked))?.label })}</div>
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-time">{t('venueGrowth:clash.form.startsAt')}</label>
                                <input id="cn-time" type="time" step="900" min="06:00" max="21:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-backup">{t('venueGrowth:clash.form.backup')}</label>
                                <input id="cn-backup" type="date" min={data.first_date} max={data.last_date} value={backupDate} onChange={(e) => setBackupDate(e.target.value)} className={INPUT} />
                                <p className="text-[11px] text-[#AAAAAA] mt-2">{t('venueGrowth:clash.form.backupHint')}</p>
                            </div>
                            <div>
                                <label className={LABEL} htmlFor="cn-notes">{t('venueGrowth:clash.form.notes')}</label>
                                <textarea id="cn-notes" rows={3} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)}
                                    placeholder={t('venueGrowth:clash.form.notesPlaceholder')}
                                    className={`${INPUT} h-auto py-3 resize-none`} />
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" onClick={submit} disabled={busy || !startTime} className={BTN_GOLD}>
                                    {busy ? t('venueGrowth:clash.form.sending') : t('venueGrowth:clash.form.submit')}
                                </button>
                                <button type="button" onClick={() => setPicked(null)} className={BTN_GHOST}>{t('venueGrowth:clash.form.clear')}</button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col justify-center py-8">
                            <Micro>{t('venueGrowth:clash.form.yourNight')}</Micro>
                            <p className="text-[14px] text-[#888] leading-relaxed mt-3">
                                {t('venueGrowth:clash.form.empty')}
                            </p>
                        </div>
                    )}
                </Card>
                </div>
            </div>

            {(upcoming.length > 0 || history.length > 0) && (
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-2">{t('venueGrowth:clash.list.title')}</Micro>
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
                                    {b.backup_date && <div className="text-[12px] text-[#999] mt-1">{t('venueGrowth:clash.list.backup', { date: fmtDay(b.backup_date) })}</div>}
                                    {b.notes && <div className="text-[12px] text-[#888] mt-1">{t('venueGrowth:clash.list.notes', { notes: b.notes })}</div>}
                                    {/* admin_note is written by POWR staff: shown as written. */}
                                    {b.admin_note && <div className="text-[12px] text-[#1A1A1A] mt-2"><b>{t('venueGrowth:clash.list.powrNote')}</b> {b.admin_note}</div>}
                                </div>
                                {upcoming.includes(b) && (
                                    <button type="button" onClick={() => cancel(b)} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#ef4444] pt-1">
                                        {t('venueGrowth:clash.list.callOff')}
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
