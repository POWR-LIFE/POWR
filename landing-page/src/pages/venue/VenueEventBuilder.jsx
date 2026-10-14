import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Calendar, Check, Lock, Moon, Plus, Smartphone, Upload, X } from 'lucide-react';
import { useAuth } from '../../App';
import i18n from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST, fmtNum } from '../../components/portal/ui';
import {
    createGymEvent, fetchEventPushes, fetchEventTemplates, fetchGymEvent, fetchGymSummary, fetchPartnerDiscounts, fetchPointPresets,
    previewGymEvent, publishGymEvent, scheduleGymReveal, setEventPush, updateGymEvent,
} from './venueApi';
import { BrandTile } from './VenuePartners';
import {
    ACTIVITIES, activityLabel, fmtDay, fmtDayTime, fromLocalInput, isVideo, isoDay, lastDay, lengthLabel, statusKey, toLocalInput, ukClock,
    whatCounts, withGym,
} from './eventUi';
import { Preview as PushPreview, STANDINGS_HOURS, Switch } from './EventPushes';
import { usePackage } from './packages';
import { hourLabel, ordinal } from '../../../../shared/gymBoard.ts';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import EventAppPreview from '../../components/EventAppPreview';

// Building an event one step at a time: the format, when it runs, what
// counts, the prizes, how it's promoted, then a check before it's saved. The
// same page edits an event (/venue/events/:id/edit) and runs a finished one
// again (/venue/events/new?from=<id>). Every choice is one the format offers
// (event_templates' *_choices, checked again by the server), and
// gym_preview_event shows the dates and rules those choices make before
// anything is saved. Points, invite rewards and entry gates stay POWR's.

const DAY = 86_400_000;

// title and hint are keys, translated where the rail renders them.
const STEPS = [
    { key: 'format',  title: 'venueEventBuilder:steps.format.title',  hint: 'venueEventBuilder:steps.format.hint' },
    { key: 'when',    title: 'venueEventBuilder:steps.when.title',    hint: 'venueEventBuilder:steps.when.hint' },
    { key: 'scoring', title: 'venueEventBuilder:steps.scoring.title', hint: 'venueEventBuilder:steps.scoring.hint' },
    { key: 'prizes',  title: 'venueEventBuilder:steps.prizes.title',  hint: 'venueEventBuilder:steps.prizes.hint' },
    { key: 'promote', title: 'venueEventBuilder:steps.promote.title', hint: 'venueEventBuilder:steps.promote.hint' },
    { key: 'review',  title: 'venueEventBuilder:steps.review.title',  hint: 'venueEventBuilder:steps.review.hint' },
];

/** An hour on the clock: "6pm" in English, "18:00" in French and Spanish (as ukClock). */
function hourText(h) {
    return (i18n.language || 'en') === 'en' ? hourLabel(h) : `${String(h).padStart(2, '0')}:00`;
}

/** A prize's place: "1st" … "5th" (the server takes five at most). */
function placeText(n) {
    return n >= 1 && n <= 5 ? i18n.t(`venueEventBuilder:prizes.places.${n}`) : ordinal(n);
}

// Once an event has started only its words and pictures can change
// (gym_update_event), and the partner code, which goes out at the reveal;
// notifications and the reveal time stay open too.
const LIVE_EDITABLE = ['name', 'promo_headline', 'promo_media_url', 'booking_url', 'logo', 'partner_code'];

const ACTIVITY_KEYS = ACTIVITIES.map(([k]) => k);
const draftKey = (partnerId) => `powr_event_builder:${partnerId}`;
const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** A fresh event of this format, with the format's own defaults. */
function blankValue(tpl) {
    const push = tpl.push_defaults ?? {};
    return {
        name: '',
        start_date: '',
        duration_days: tpl.duration_days,
        night_start_hour: tpl.night_start_hour,
        night_hours: tpl.night_hours,
        scoring: tpl.count_venue_only ? 'venue' : tpl.included_activities?.length ? 'pick' : 'all',
        activities: tpl.included_activities ?? [],
        board_size: tpl.board_size,
        points_preset_key: tpl.default_preset,
        own_rules: [],
        prizes: [{ label: '', image_url: null }],
        // Optional: a partner brand's code for everyone who took part, at the reveal.
        partner_on: false,
        partner_reward_id: null,
        partner_had: false,
        logo_url: null,
        logo_only: false,
        promo_headline: '',
        promo_media_url: null,
        booking_url: '',
        audience_radius_km: null,
        pushes: {
            announce: !!push.announce,
            kickoff: !!push.kickoff,
            doors: !!push.doors && tpl.night_start_hour != null,
            rank_at: push.rank_at ?? null,
        },
        reveal: { mode: 'manual', at: '', auto: true },
    };
}

/** Switching format keeps what the gym wrote; the format's choices start over. */
function switchFormat(prev, tpl) {
    const base = blankValue(tpl);
    if (!prev) return base;
    return {
        ...base,
        name: prev.name,
        start_date: prev.start_date,
        own_rules: prev.own_rules,
        prizes: prev.prizes,
        partner_on: prev.partner_on,
        partner_reward_id: prev.partner_reward_id,
        logo_url: prev.logo_url,
        logo_only: prev.logo_only,
        promo_headline: prev.promo_headline,
        promo_media_url: prev.promo_media_url,
        booking_url: prev.booking_url,
        audience_radius_km: tpl.radius_choices?.includes(prev.audience_radius_km) ? prev.audience_radius_km : null,
    };
}

/** An existing event as the builder's value: to edit it, or (without its dates) to run it again. */
function fromEvent(ev, tpl, pushes, editing) {
    const base = blankValue(tpl);
    // Running it again re-checks every choice against what the format offers now.
    const offered = (list, x, fallback) => (editing || !list?.length || list.includes(x) ? x ?? fallback : fallback);
    return {
        ...base,
        name: ev.name ?? '',
        start_date: editing ? isoDay(new Date(ev.window_start_at)) : '',
        duration_days: offered(tpl.day_choices, ev.duration_days, base.duration_days),
        night_start_hour: offered(tpl.night_hour_choices, ev.night_start_hour, base.night_start_hour),
        night_hours: offered(tpl.night_length_choices, ev.night_hours, base.night_hours),
        scoring: ev.count_venue_only ? 'venue' : ev.included_activities?.length ? 'pick' : 'all',
        activities: ev.included_activities ?? [],
        board_size: offered(tpl.board_choices, ev.board_size, base.board_size),
        points_preset_key: offered(tpl.allowed_presets, ev.points_preset_key, base.points_preset_key),
        own_rules: ev.own_rules ?? [],
        prizes: ev.prizes?.length ? ev.prizes.map(p => ({ label: p.label ?? '', image_url: p.image_url ?? null })) : base.prizes,
        partner_on: !!ev.partner_reward_id,
        partner_reward_id: ev.partner_reward_id ?? null,
        partner_had: editing && !!ev.partner_reward_id,
        logo_url: ev.logo_url ?? null,
        logo_only: !!ev.logo_only,
        promo_headline: ev.promo_headline ?? '',
        promo_media_url: ev.promo_media_url ?? null,
        booking_url: ev.booking_url ?? '',
        audience_radius_km: offered(tpl.radius_choices, ev.audience_radius_km, null),
        pushes: pushes
            ? { announce: !!pushes.announce, kickoff: !!pushes.kickoff, doors: !!pushes.doors, rank_at: pushes.rank_at ?? null }
            : base.pushes,
        reveal: editing && ev.reveal_at ? { mode: 'at', at: toLocalInput(ev.reveal_at), auto: false } : base.reveal,
    };
}

/** What gym_create_event / gym_update_event take, from the builder's value. */
function toFields(v, tpl) {
    const f = {
        name: v.name.trim().replace(/\s+/g, ' '),
        start_date: v.start_date,
        count_venue_only: v.scoring === 'venue',
        included_activities: v.scoring === 'pick' ? ACTIVITY_KEYS.filter(k => v.activities.includes(k)) : null,
        points_preset_key: v.points_preset_key,
        rules: v.own_rules.map(r => r.trim()).filter(Boolean),
        prizes: v.prizes
            .filter(p => p.label.trim())
            .map(p => (p.image_url ? { label: p.label.trim(), image_url: p.image_url } : p.label.trim())),
        promo_headline: v.promo_headline.trim(),
        promo_media_url: v.promo_media_url ?? null,
        booking_url: v.booking_url.trim(),
        logo_url: v.logo_url ?? null,
        logo_only: !!(v.logo_url && v.logo_only),
        audience_radius_km: v.audience_radius_km ?? null,
    };
    // Only sent once the gym has used it: switched on now, or on before and switched off.
    if (v.partner_on || v.partner_had) f.partner_reward_id = v.partner_on ? v.partner_reward_id : null;
    if (tpl.day_choices?.length) f.duration_days = v.duration_days;
    if (tpl.board_choices?.length) f.board_size = v.board_size;
    if (tpl.night_start_hour != null && tpl.night_hour_choices?.length) {
        f.night_start_hour = v.night_start_hour;
        f.night_hours = v.night_hours;
    }
    return f;
}

/** Only what shapes the dates and the rules: what the live preview needs. */
function previewFields(v, tpl) {
    const f = toFields(v, tpl);
    const out = { rules: f.rules, count_venue_only: f.count_venue_only };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.start_date)) out.start_date = v.start_date;
    for (const k of ['duration_days', 'night_start_hour', 'night_hours']) if (k in f) out[k] = f[k];
    // An empty pick would be refused; the rules wait until something's picked.
    if (v.scoring !== 'pick' || f.included_activities.length) out.included_activities = f.included_activities;
    return out;
}

/** The notification switches that differ from what the event has now. */
function pushChanges(want, had, tpl) {
    const out = {};
    for (const k of ['announce', 'kickoff', 'doors']) {
        if (k === 'doors' && tpl.night_start_hour == null) continue;
        if (!!want[k] !== !!had?.[k]) out[k] = !!want[k];
    }
    if ((want.rank_at ?? null) !== (had?.rank_at ?? null)) out.rank_at = want.rank_at ?? null;
    return out;
}

/** A reveal time to offer: an hour into the finale night, else 6pm the day the board seals. */
function suggestedReveal(preview) {
    if (!preview?.lock_at) return '';
    const at = preview.doors_open_at
        ? new Date(preview.doors_open_at).getTime() + 3_600_000
        : new Date(preview.lock_at).getTime() + 18 * 3_600_000;
    return toLocalInput(new Date(at).toISOString());
}

/** What stops a step from being done, in words; null when it's fine. */
function checkStep(key, v, tpl, ctx) {
    if (!tpl || !v) return key === 'format' ? i18n.t('venueEventBuilder:problems.pickFormat') : null;
    switch (key) {
    case 'when': {
        const name = v.name.trim();
        if (name.length < 3) return i18n.t('venueEventBuilder:problems.nameShort');
        if (name.length > 48) return i18n.t('venueEventBuilder:problems.nameLong');
        if (!ctx.datesLocked) {
            if (!v.start_date) return i18n.t('venueEventBuilder:problems.pickFirstDay');
            if (v.start_date < isoDay(new Date())) return i18n.t('venueEventBuilder:problems.firstDayPast');
            if (v.start_date > isoDay(new Date(Date.now() + 89 * DAY))) return i18n.t('venueEventBuilder:problems.firstDayFar');
        }
        if (v.reveal.mode === 'at') {
            if (!v.reveal.at) return i18n.t('venueEventBuilder:problems.pickReveal');
            const lock = ctx.lockAt;
            if (lock) {
                const at = new Date(fromLocalInput(v.reveal.at)).getTime();
                const l = new Date(lock).getTime();
                if (at < l || at > l + 7 * DAY) {
                    return i18n.t('venueEventBuilder:problems.revealWindow', {
                        from: fmtDayTime(lock), to: fmtDayTime(new Date(l + 7 * DAY).toISOString()),
                    });
                }
            }
        }
        return null;
    }
    case 'scoring':
        if (v.scoring === 'pick' && !v.activities.length) return i18n.t('venueEventBuilder:problems.pickActivity');
        return null;
    case 'prizes': {
        const named = v.prizes.filter(p => p.label.trim());
        if (!named.length) return i18n.t('venueEventBuilder:problems.addPrize');
        if (named.some(p => p.label.trim().length < 2)) return i18n.t('venueEventBuilder:problems.prizeNameShort');
        if (v.prizes.some(p => !p.label.trim() && p.image_url)) return i18n.t('venueEventBuilder:problems.prizePhotoName');
        if (v.partner_on) {
            if (!v.partner_reward_id) return i18n.t('venueEventBuilder:problems.pickPartner');
            // A brand already saved on the event stays, even if its codes have since run low.
            const pick = ctx.partners?.find(d => d.reward_id === v.partner_reward_id);
            if (ctx.partners && !pick?.event_ok && v.partner_reward_id !== ctx.savedPartner) return i18n.t('venueEventBuilder:problems.partnerNoCodes');
        }
        return null;
    }
    case 'promote': {
        const b = v.booking_url.trim();
        if (b && !/^https:\/\/\S+\.\S+$/.test(b)) return i18n.t('venueEventBuilder:problems.bookingHttps');
        if (b.toLowerCase().includes('{email}')) return i18n.t('venueEventBuilder:problems.bookingEmail');
        return null;
    }
    default:
        return null;
    }
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function StepRail({ current, problems, reachable, onJump, formatLocked }) {
    const { t } = useTranslation();
    const refs = useRef([]);
    // On a phone the rail scrolls sideways; keep the current step in view.
    useEffect(() => { refs.current[current]?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [current]);
    return (
        <nav aria-label={t('venueEventBuilder:steps.aria')} className="lg:sticky lg:top-6">
            <ol className="flex lg:flex-col gap-1.5 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
                {STEPS.map((s, i) => {
                    const on = i === current;
                    const can = reachable(i);
                    const done = !on && can && !problems[i] && i < current;
                    const locked = i === 0 && formatLocked;
                    return (
                        <li key={s.key} ref={el => { refs.current[i] = el; }} className="shrink-0">
                            <button
                                type="button" onClick={() => onJump(i)} disabled={!can} aria-current={on ? 'step' : undefined}
                                className={`flex items-center gap-3 h-11 lg:h-auto lg:w-full lg:py-3 pl-1.5 pr-4 rounded-full lg:rounded-2xl border text-left transition-all disabled:cursor-not-allowed ${
                                    on ? 'bg-white border-[#E8D200]/60' : 'border-transparent hover:bg-white/70'
                                }`}
                            >
                                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                                    on ? 'bg-[#E8D200] text-[#080808]' : done ? 'bg-[#1A1A1A] text-white' : 'bg-[#E6E6E1] text-[#999]'
                                }`}>
                                    {locked ? <Lock size={11} /> : done ? <Check size={13} /> : i + 1}
                                </span>
                                <span className="min-w-0">
                                    <span className={`block text-[11px] font-black uppercase tracking-[0.15em] ${on ? 'text-[#1A1A1A]' : can ? 'text-[#666]' : 'text-[#C4C4C0]'}`}>{t(s.title)}</span>
                                    <span className="hidden lg:block text-[11px] text-[#AAAAAA] mt-0.5">{t(s.hint)}</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

function StepHead({ title, sub }) {
    return (
        <div className="mb-8">
            <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05]">{title}</h2>
            {sub && <p className="text-[13px] text-[#888] leading-relaxed mt-3 max-w-2xl">{sub}</p>}
        </div>
    );
}

function Field({ label, optional, hint, children }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className={LABEL}>
                {label}
                {optional && <span className="normal-case tracking-normal font-bold text-[#CCCCCC]">{` · ${t('venueEventBuilder:field.optional')}`}</span>}
            </div>
            {children}
            {hint && <p className="text-[11px] text-[#AAAAAA] leading-relaxed mt-2.5 max-w-2xl">{hint}</p>}
        </div>
    );
}

function Chips({ label, options, value, onChange, disabled }) {
    return (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
            {options.map(([val, text]) => {
                const on = value === val;
                return (
                    <button
                        key={String(val)} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(val)}
                        className={`h-10 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all disabled:opacity-40 ${
                            on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]'
                        }`}
                    >
                        {text}
                    </button>
                );
            })}
        </div>
    );
}

/** One of a set of choices, as a card; what goes with it opens underneath. */
function Choice({ on, title, body, onPick, disabled, children }) {
    return (
        <div className={`rounded-2xl border transition-all ${on ? 'border-[#E8D200]/70 bg-[#E8D200]/[0.05]' : 'border-[#E6E6E1] bg-white'} ${disabled && !on ? 'opacity-50' : ''}`}>
            <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick} className="w-full flex items-start gap-4 p-4 sm:p-5 text-left">
                <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'border-[#8a7600]' : 'border-[#D8D8D2]'}`}>
                    {on && <span className="w-2.5 h-2.5 rounded-full bg-[#8a7600]" />}
                </span>
                <span className="min-w-0">
                    <span className="block text-[14px] font-bold text-[#1A1A1A]">{title}</span>
                    {body && <span className="block text-[12px] text-[#888] leading-relaxed mt-1">{body}</span>}
                </span>
            </button>
            {on && children && <div className="px-4 sm:px-5 pb-5 sm:pl-14">{children}</div>}
        </div>
    );
}

function UploadButton({ accept, maxMb, prefix, onUploaded, onBusy, disabled, children }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > maxMb * 1024 * 1024) { toast.error(t('venueEventBuilder:upload.tooBig', { mb: maxMb })); return; }
        setBusy(true);
        onBusy(1);
        try {
            onUploaded(await uploadPublicImage('reward-images', file, prefix));
        } catch (err) {
            toast.error(serverErrorText(err, t('venueEventBuilder:upload.failed')));
        } finally {
            setBusy(false);
            onBusy(-1);
        }
    };
    const off = busy || disabled;
    return (
        <label className={`${BTN_GHOST} h-10 px-5 cursor-pointer ${off ? 'opacity-40 pointer-events-none' : ''}`}>
            <Upload size={13} /> {busy ? t('venueEventBuilder:upload.uploading') : children}
            <input type="file" accept={accept} className="hidden" onChange={onFile} disabled={off} />
        </label>
    );
}

function RemoveButton({ label, onClick, disabled }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
            className="w-10 h-10 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999] hover:text-[#1A1A1A] disabled:opacity-30">
            <X size={14} />
        </button>
    );
}

function Schedule({ preview, error, finale, gymName }) {
    const { t } = useTranslation();
    const box = 'p-4 sm:p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-[12px]';
    if (error) return <div className={`${box} text-[#B91C1C]`}>{error}</div>;
    if (!preview?.window_start_at) return <div className={`${box} text-[#999]`}>{t('venueEventBuilder:schedule.pickFirstDay')}</div>;
    return (
        <div className={`${box} space-y-2`}>
            <div className="flex items-center gap-2"><Calendar size={13} className="text-[#8a7600] shrink-0" /><span className="font-bold">{t('venueEventBuilder:schedule.scoring', { from: fmtDay(preview.window_start_at), to: lastDay(preview.window_end_at) })}</span></div>
            {finale && preview.doors_open_at && (
                <div className="flex items-center gap-2">
                    <Moon size={13} className="text-[#8a7600] shrink-0" />
                    <span className="font-bold">{t('venueEventBuilder:schedule.finale', { day: fmtDay(preview.doors_open_at), from: ukClock(preview.doors_open_at), to: ukClock(preview.doors_close_at) })}</span>
                    <span className="text-[#999] hidden sm:inline">{t('venueEventBuilder:schedule.atGym', { gym: gymName })}</span>
                </div>
            )}
            <div className="text-[#999] pl-5">{t('venueEventBuilder:schedule.seals')}</div>
        </div>
    );
}

function Rules({ rules, muted }) {
    return (
        <ul className="space-y-2">
            {rules.map((r, i) => (
                <li key={i} className={`flex gap-2.5 text-[12.5px] leading-snug ${muted ? 'text-[#666]' : 'text-[#1A1A1A]'}`}>
                    <Check size={13} className="text-[#8a7600] mt-0.5 shrink-0" />{r}
                </li>
            ))}
        </ul>
    );
}

function ReviewRow({ label, onEdit, children }) {
    const { t } = useTranslation();
    return (
        <div className="py-5 first:pt-0 last:pb-0 flex gap-4">
            <div className="flex-1 min-w-0">
                <Micro className="mb-2">{label}</Micro>
                <div className="text-[13px] text-[#1A1A1A] leading-relaxed space-y-1">{children}</div>
            </div>
            {onEdit && (
                <button type="button" onClick={onEdit} className="shrink-0 h-8 text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600]">
                    {t('venueEventBuilder:actions.change')}
                </button>
            )}
        </div>
    );
}

// ─── The builder ───────────────────────────────────────────────────────────

export default function VenueEventBuilder() {
    const { id } = useParams();
    const [params] = useSearchParams();
    const fromId = id ? null : params.get('from');
    const { gym, isAdmin } = useAuth();
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { pkg } = usePackage();
    const canPublish = !!pkg?.features?.events;
    const rootRef = useRef(null);

    const [templates, setTemplates] = useState(null);
    const [presets, setPresets] = useState([]);
    const [partners, setPartners] = useState(null);   // partner discounts; null until loaded (or if they fail)
    const [partnersError, setPartnersError] = useState(false);
    const [showPhone, setShowPhone] = useState(false); // the app preview, below xl
    const [trusted, setTrusted] = useState(false);
    const [orig, setOrig] = useState(null);           // editing: { ev, value, pushes }
    const [tplKey, setTplKey] = useState(null);
    const [v, setV] = useState(null);
    const [step, setStep] = useState(0);
    const [restored, setRestored] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [uploading, setUploading] = useState(0);
    const [saving, setSaving] = useState(null);
    const [error, setError] = useState(null);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        let alive = true;
        const source = id ?? fromId;
        Promise.all([
            fetchEventTemplates(),
            fetchPointPresets(),
            fetchGymSummary(gym.partner_id).catch(() => null),
            source ? fetchGymEvent(source).catch(err => { if (id) throw err; return null; }) : null,
            source ? fetchEventPushes(source).catch(() => null) : null,
            fetchPartnerDiscounts(gym.partner_id).catch(() => null),
        ])
            .then(([tpls, p, summary, ev, pushes, discounts]) => {
                if (!alive) return;
                setTemplates(tpls);
                setPresets(p);
                setPartners(Array.isArray(discounts) ? discounts : null);
                setPartnersError(!Array.isArray(discounts));
                setTrusted(!!summary?.portal?.trusted);
                if (ev) {
                    const tpl = tpls.find(x => x.key === ev.template_key);
                    const k = statusKey(ev);
                    // Keys, so the words follow the language if it changes while this shows.
                    if (id) {
                        if (!ev.editable) { setLoadError({ key: 'venueEventBuilder:load.notYours' }); return; }
                        if (k === 'pending') { setLoadError({ key: 'venueEventBuilder:load.pending' }); return; }
                        if (!['draft', 'rejected', 'scheduled', 'live'].includes(k)) { setLoadError({ key: 'venueEventBuilder:load.finished' }); return; }
                        if (!tpl) { setLoadError({ key: 'venueEventBuilder:load.noFormat' }); return; }
                    }
                    if (tpl) {
                        const value = fromEvent(ev, tpl, pushes, !!id);
                        setTplKey(tpl.key);
                        setV(value);
                        setStep(1);
                        if (id) setOrig({ ev, value, pushes });
                        return;
                    }
                }
                // A new event: pick up one this tab didn't finish.
                try {
                    const saved = JSON.parse(sessionStorage.getItem(draftKey(gym.partner_id)) ?? 'null');
                    const tpl = saved && tpls.find(x => x.key === saved.tplKey);
                    if (!source && tpl && saved.v) {
                        setTplKey(tpl.key);
                        setV({ ...blankValue(tpl), ...saved.v });
                        setStep(Math.min(saved.step ?? 0, STEPS.length - 1));
                        setRestored(true);
                    }
                } catch { /* no storage: start fresh */ }
            })
            .catch(err => { if (alive) setLoadError(serverErrorText(err)); });
        return () => { alive = false; };
    }, [id, fromId, gym.partner_id]);

    const tpl = useMemo(() => templates?.find(x => x.key === tplKey) ?? null, [templates, tplKey]);
    const ev = orig?.ev ?? null;
    const started = !!ev && !(ev.status === 'draft' || (ev.status === 'scheduled' && new Date(ev.window_start_at) > new Date()));
    const can = (field) => !started || LIVE_EDITABLE.includes(field);
    const finale = tpl?.night_start_hour != null;
    // What the app will show, drawn from the builder as it stands.
    const previewEvent = useMemo(() => (v && tpl ? {
        name: v.name.trim() || tpl.name,
        promo_headline: v.promo_headline.trim(),
        promo_media_url: v.promo_media_url,
        logo_url: v.logo_url,
        logo_only: !!(v.logo_url && v.logo_only),
        // A started event keeps its own dates and rules; a new one takes the server's preview.
        status: ev?.status === 'live' ? 'live' : 'scheduled',
        window_start_at: preview?.window_start_at ?? ev?.window_start_at ?? null,
        window_end_at: preview?.window_end_at ?? ev?.window_end_at ?? null,
        prizes: v.prizes.filter(p => p.label.trim()).map((p, i) => ({ rank: i + 1, label: p.label.trim(), image_url: p.image_url ?? null })),
        rules: preview?.rules ?? ev?.rules ?? [],
    } : null), [v, tpl, preview, ev]);
    const previewVenue = useMemo(() => ({ name: gym.name, logo_url: gym.logo_url ?? null, logo_bg: gym.logo_bg ?? null }), [gym]);

    // Keep an unfinished new event across a reload of this tab.
    useEffect(() => {
        if (id || fromId || !v || !tplKey) return;
        try { sessionStorage.setItem(draftKey(gym.partner_id), JSON.stringify({ tplKey, v, step })); } catch { /* ignore */ }
    }, [id, fromId, v, tplKey, step, gym.partner_id]);

    // The server's own dates and rules for the choices so far.
    const previewKey = tpl && v ? JSON.stringify(previewFields(v, tpl)) : null;
    const seq = useRef(0);
    useEffect(() => {
        if (!previewKey || !tplKey) return undefined;
        const n = ++seq.current;
        const timer = setTimeout(() => {
            previewGymEvent(gym.partner_id, tplKey, JSON.parse(previewKey))
                .then(p => { if (seq.current === n) { setPreview(p); setPreviewError(null); } })
                .catch(err => { if (seq.current === n) setPreviewError(serverErrorText(err)); });
        }, 250);
        return () => clearTimeout(timer);
    }, [previewKey, tplKey, gym.partner_id]);

    // A reveal time the gym hasn't typed follows the dates.
    useEffect(() => {
        if (!v || v.reveal.mode !== 'at' || !v.reveal.auto || !preview?.lock_at) return;
        const s = suggestedReveal(preview);
        if (s && s !== v.reveal.at) setV(x => ({ ...x, reveal: { ...x.reveal, at: s } }));
    }, [preview, v]);

    if (loadError) {
        return (
            <Empty title={t('venueEventBuilder:load.title')} action={<Link to={id ? `/venue/events/${id}` : '/venue/events'} className={BTN_GHOST}>{t('common:actions.back')}</Link>}>
                {loadError.key ? t(loadError.key) : loadError}
            </Empty>
        );
    }
    if (!templates || (id && !orig)) return <Spinner />;

    const set = (patch) => setV(x => ({ ...x, ...patch }));
    const setPrize = (i, patch) => setV(x => ({ ...x, prizes: x.prizes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
    const reloadPartners = () => {
        setPartnersError(false);
        fetchPartnerDiscounts(gym.partner_id)
            .then(d => setPartners(Array.isArray(d) ? d : []))
            .catch(() => setPartnersError(true));
    };
    const onBusy = (d) => setUploading(n => n + d);
    const prefix = `gym-events/${gym.partner_id}`;
    const lockAt = started ? ev.lock_at : preview?.lock_at;
    const savedPartner = ev?.partner_reward_id ?? null;
    const problems = STEPS.map(s => checkStep(s.key, v, tpl, { datesLocked: started, lockAt, partners, savedPartner }));
    const firstProblem = problems.findIndex(Boolean);
    const reachable = (i) => !!id || firstProblem === -1 || i <= firstProblem;
    const go = (i) => {
        if (!reachable(i)) return;
        setStep(i);
        setError(null);
        rootRef.current?.scrollIntoView({ block: 'start' });
    };
    const pickFormat = (next) => {
        if (id) return;
        setTplKey(next.key);
        setV(prev => (tplKey === next.key ? prev : switchFormat(prev, next)));
    };
    const startOver = () => {
        try { sessionStorage.removeItem(draftKey(gym.partner_id)); } catch { /* ignore */ }
        setV(null);
        setTplKey(null);
        setPreview(null);
        setStep(0);
        setRestored(false);
    };

    const save = async (publish) => {
        if (uploading) return;
        if (firstProblem !== -1) { go(firstProblem); return; }
        setSaving(publish ? 'publish' : 'save');
        setError(null);
        const fields = toFields(v, tpl);
        let saved;
        try {
            if (orig) {
                // Only what changed: a date that's already in the notice window
                // mustn't block a new headline.
                const before = toFields(orig.value, tpl);
                const changed = Object.fromEntries(Object.entries(fields)
                    .filter(([k, x]) => JSON.stringify(x ?? null) !== JSON.stringify(before[k] ?? null)));
                saved = Object.keys(changed).length ? await updateGymEvent(orig.ev.id, changed) : orig.ev;
            } else {
                saved = await createGymEvent(gym.partner_id, tpl.key, fields);
            }
        } catch (err) {
            setError(serverErrorText(err));
            setSaving(null);
            return;
        }

        // Saved. Notifications, the reveal time and publishing follow; a
        // problem with one of them still leaves the event saved.
        const later = [];
        const patch = pushChanges(v.pushes, orig ? orig.pushes : blankValue(tpl).pushes, tpl);
        if (Object.keys(patch).length) {
            try { await setEventPush(saved.id, patch); } catch (err) { later.push(t('venueEventBuilder:save.notificationsFailed', { error: serverErrorText(err) })); }
        }
        const revealAt = v.reveal.mode === 'at' && v.reveal.at ? fromLocalInput(v.reveal.at) : null;
        if (!sameInstant(revealAt, saved.reveal_at)) {
            try { await scheduleGymReveal(saved.id, revealAt); } catch (err) { later.push(t('venueEventBuilder:save.revealFailed', { error: serverErrorText(err) })); }
        }
        let published = null;
        if (publish) {
            try { published = await publishGymEvent(saved.id); } catch (err) { later.push(t('venueEventBuilder:save.publishFailed', { error: serverErrorText(err) })); }
        }
        if (!orig) { try { sessionStorage.removeItem(draftKey(gym.partner_id)); } catch { /* ignore */ } }

        if (later.length) toast.error(t('venueEventBuilder:save.partial', { problems: later.join(t('venueEventBuilder:save.separator')) }));
        else if (published) toast.success(statusKey(published) === 'pending' ? t('venueEventBuilder:save.sentForCheck') : t('venueEventBuilder:save.published'));
        else toast.success(orig ? t('venueEventBuilder:save.saved') : t('venueEventBuilder:save.draftSaved'));
        navigate(`/venue/events/${saved.id}`);
    };

    // ── Steps ─────────────────────────────────────────────────────────────
    const cur = STEPS[step].key;
    const presetOptions = tpl ? presets.filter(p => tpl.allowed_presets.includes(p.key)) : [];
    const preset = presets.find(p => p.key === v?.points_preset_key);
    const firstPrize = v?.prizes.find(p => p.label.trim())?.label.trim() ?? '';
    // Feeds the push previews, which show what members get: English until
    // they follow the member's language (eventPushCopy's lang).
    const pushPayload = v && {
        event_name: v.name.trim() || 'Your event',
        gym_name: gym.name,
        prize: firstPrize,
        starts_at: preview?.window_start_at ?? null,
        ends_at: preview?.window_end_at ?? null,
        doors_open_at: preview?.doors_open_at ?? null,
        venue_only: v.scoring === 'venue',
        activities: v.scoring === 'pick' ? v.activities : null,
        attendance: preset?.attendance_bonus_points ?? 0,
    };
    const lockedNote = started && (
        <div className="flex items-start gap-3 mb-8 p-4 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] text-[12px] text-[#666] leading-relaxed">
            <Lock size={14} className="text-[#8a7600] mt-0.5 shrink-0" />
            {t('venueEventBuilder:lockedNote')}
        </div>
    );

    const formatStep = (
        <>
            <StepHead
                title={id ? t('venueEventBuilder:format.titleEdit') : t('venueEventBuilder:format.titleNew')}
                sub={id ? t('venueEventBuilder:format.subEdit') : t('venueEventBuilder:format.subNew')}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="radiogroup" aria-label={t('venueEventBuilder:steps.format.title')}>
                {/* The format's name and blurb come from event_templates, as stored. */}
                {templates.map(tp => {
                    const on = tp.key === tplKey;
                    const days = tp.day_choices?.length
                        ? t('venueEventBuilder:format.dayRange', { min: lengthLabel(Math.min(...tp.day_choices)), max: lengthLabel(Math.max(...tp.day_choices)) })
                        : lengthLabel(tp.duration_days);
                    return (
                        <button
                            key={tp.key} type="button" role="radio" aria-checked={on} disabled={!!id && !on} onClick={() => pickFormat(tp)}
                            className={`text-left rounded-3xl border p-6 transition-all disabled:opacity-40 ${on ? 'border-[#E8D200] bg-[#E8D200]/[0.06]' : 'border-[#E6E6E1] bg-white hover:border-[#E8D200]/50'}`}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <Micro gold={on}>{tp.night_start_hour != null ? t('venueEventBuilder:format.withFinale', { days }) : days}</Micro>
                                {on && <Check size={16} className="text-[#8a7600]" />}
                            </div>
                            <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{tp.name}</div>
                            <p className="text-[12px] text-[#888] leading-relaxed mt-2">{withGym(tp.blurb, gym.name)}</p>
                            <p className="text-[11px] font-bold text-[#8a7600] mt-4">
                                {tp.count_venue_only ? t('venueEventBuilder:format.countsVenue', { gym: gym.name }) : t('venueEventBuilder:format.countsAll')}
                            </p>
                        </button>
                    );
                })}
            </div>
        </>
    );

    const whenStep = v && tpl && (
        <>
            <StepHead title={t('venueEventBuilder:when.title')} sub={t('venueEventBuilder:when.sub')} />
            {lockedNote}
            <div className="space-y-8">
                <Field label={t('venueEventBuilder:when.name')}>
                    <input className={INPUT} aria-label={t('venueEventBuilder:when.name')} value={v.name} maxLength={48} disabled={!can('name')}
                        onChange={e => set({ name: e.target.value })} placeholder={t('venueEventBuilder:when.namePlaceholder', { gym: gym.name })} />
                </Field>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Field label={t('venueEventBuilder:when.firstDay')}>
                        <input type="date" aria-label={t('venueEventBuilder:when.firstDay')} className={`${INPUT} max-w-xs`} value={v.start_date} disabled={!can('start_date')}
                            min={isoDay(new Date())} max={isoDay(new Date(Date.now() + 89 * DAY))}
                            onChange={e => set({ start_date: e.target.value })} />
                    </Field>
                    {tpl.day_choices?.length > 0 && (
                        <Field label={t('venueEventBuilder:when.howLong')}>
                            <Chips label={t('venueEventBuilder:when.howLong')} value={v.duration_days} disabled={!can('duration_days')} onChange={d => set({ duration_days: d })}
                                options={tpl.day_choices.map(d => [d, lengthLabel(d)])} />
                        </Field>
                    )}
                </div>
                {finale && tpl.night_hour_choices?.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <Field label={t('venueEventBuilder:when.nightStarts')}>
                            <Chips label={t('venueEventBuilder:when.nightStarts')} value={v.night_start_hour} disabled={!can('night')} onChange={h => set({ night_start_hour: h })}
                                options={tpl.night_hour_choices.map(h => [h, hourText(h)])} />
                        </Field>
                        <Field label={t('venueEventBuilder:when.nightLasts')}>
                            <Chips label={t('venueEventBuilder:when.nightLengthAria')} value={v.night_hours} disabled={!can('night')} onChange={n => set({ night_hours: n })}
                                options={tpl.night_length_choices.map(n => [n, t('venueEventBuilder:when.hours', { count: n })])} />
                        </Field>
                    </div>
                )}
                <Schedule preview={preview} error={previewError} finale={finale} gymName={gym.name} />

                <Field label={t('venueEventBuilder:reveal.label')}>
                    <div className="space-y-3" role="radiogroup" aria-label={t('venueEventBuilder:reveal.label')}>
                        <Choice
                            on={v.reveal.mode === 'manual'} onPick={() => set({ reveal: { ...v.reveal, mode: 'manual' } })}
                            title={t('venueEventBuilder:reveal.manualTitle')}
                            body={t(finale ? 'venueEventBuilder:reveal.manualBodyFinale' : 'venueEventBuilder:reveal.manualBody', {
                                count: Math.round(((tpl.settle_grace_hours ?? 12) + (tpl.auto_reveal_after_hours ?? 72)) / 24),
                            })}
                        />
                        <Choice
                            on={v.reveal.mode === 'at'}
                            onPick={() => set({ reveal: { mode: 'at', at: v.reveal.at || suggestedReveal(preview), auto: !v.reveal.at } })}
                            title={t('venueEventBuilder:reveal.atTitle')} body={t('venueEventBuilder:reveal.atBody')}
                        >
                            <input type="datetime-local" aria-label={t('venueEventBuilder:reveal.timeAria')} className={`${INPUT} max-w-xs`} value={v.reveal.at}
                                min={lockAt ? toLocalInput(lockAt) : undefined}
                                max={lockAt ? toLocalInput(new Date(new Date(lockAt).getTime() + 7 * DAY).toISOString()) : undefined}
                                onChange={e => set({ reveal: { mode: 'at', at: e.target.value, auto: false } })} />
                        </Choice>
                    </div>
                </Field>
            </div>
        </>
    );

    const scoringStep = v && tpl && (
        <>
            <StepHead title={t('venueEventBuilder:scoring.title')} sub={t('venueEventBuilder:scoring.sub')} />
            {lockedNote}
            <div className="space-y-8">
                <div className="space-y-3" role="radiogroup" aria-label={t('venueEventBuilder:scoring.title')}>
                    <Choice on={v.scoring === 'all'} disabled={!can('scoring')} onPick={() => set({ scoring: 'all' })}
                        title={t('venueEventBuilder:scoring.allTitle')}
                        body={t('venueEventBuilder:scoring.allBody')} />
                    <Choice on={v.scoring === 'venue'} disabled={!can('scoring')} onPick={() => set({ scoring: 'venue' })}
                        title={t('venueEventBuilder:scoring.venueTitle', { gym: gym.name })}
                        body={t('venueEventBuilder:scoring.venueBody')} />
                    <Choice on={v.scoring === 'pick'} disabled={!can('scoring')} onPick={() => set({ scoring: 'pick' })}
                        title={t('venueEventBuilder:scoring.pickTitle')} body={t('venueEventBuilder:scoring.pickBody')}>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={t('venueEventBuilder:scoring.activitiesAria')}>
                            {ACTIVITIES.map(([k]) => {
                                const label = activityLabel(k);
                                const on = v.activities.includes(k);
                                return (
                                    <button key={k} type="button" aria-pressed={on} disabled={!can('scoring')}
                                        onClick={() => set({ activities: on ? v.activities.filter(a => a !== k) : [...v.activities, k] })}
                                        className={`h-10 px-4 rounded-full border text-[11px] font-bold transition-all inline-flex items-center gap-1.5 disabled:opacity-40 ${
                                            on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#555] hover:border-[#E8D200]/50'
                                        }`}>
                                        {on && <Check size={12} />}{label}
                                    </button>
                                );
                            })}
                        </div>
                        {v.activities.includes('walking') && (
                            <p className="text-[11px] text-[#B45309] font-bold mt-3">{t('venueEventBuilder:scoring.walkingNote')}</p>
                        )}
                    </Choice>
                </div>
                <p className="text-[11px] text-[#AAAAAA] -mt-4">{t('venueEventBuilder:scoring.manualNote')}</p>

                {tpl.board_choices?.length > 0 && (
                    <Field label={t('venueEventBuilder:scoring.board')} hint={t('venueEventBuilder:scoring.boardHint')}>
                        <Chips label={t('venueEventBuilder:scoring.boardAria')} value={v.board_size} disabled={!can('board_size')} onChange={n => set({ board_size: n })}
                            options={tpl.board_choices.map(n => [n, t('venueEventBuilder:scoring.top', { n })])} />
                    </Field>
                )}

                {/* The presets' labels and blurbs come from the database, as stored. */}
                {presetOptions.length > 1 && (
                    <Field label={t('venueEventBuilder:scoring.bonus')} hint={t('venueEventBuilder:scoring.bonusHint', { blurb: preset?.blurb ?? '', gym: gym.name })}>
                        <Chips label={t('venueEventBuilder:scoring.bonus')} value={v.points_preset_key} disabled={!can('points_preset_key')} onChange={k => set({ points_preset_key: k })}
                            options={presetOptions.map(p => [p.key, p.label])} />
                    </Field>
                )}

                {/* The rules themselves are the server's (gym_preview_event), as members read them in the app. */}
                <Field label={t('venueEventBuilder:scoring.rules')}>
                    <div className="p-4 sm:p-5 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1]">
                        <Micro className="mb-3">{t('venueEventBuilder:scoring.rulesWritten')}</Micro>
                        {v.scoring === 'pick' && !v.activities.length
                            ? <p className="text-[12px] text-[#999]">{t('venueEventBuilder:scoring.rulesPick')}</p>
                            : <Rules rules={preview?.house_rules ?? []} muted />}
                    </div>
                    <div className="mt-5 space-y-2">
                        {v.own_rules.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input className={INPUT} aria-label={t('venueEventBuilder:scoring.ownRuleAria', { n: i + 1 })} value={r} maxLength={200} disabled={!can('rules')}
                                    onChange={e => set({ own_rules: v.own_rules.map((x, j) => (j === i ? e.target.value : x)) })}
                                    placeholder={t('venueEventBuilder:scoring.ownRulePlaceholder')} />
                                <RemoveButton label={t('venueEventBuilder:scoring.removeRule')} disabled={!can('rules')} onClick={() => set({ own_rules: v.own_rules.filter((_, j) => j !== i) })} />
                            </div>
                        ))}
                        {can('rules') && v.own_rules.length < 8 && (
                            <button type="button" onClick={() => set({ own_rules: [...v.own_rules, ''] })} className={`${BTN_GHOST} h-10 px-5`}>
                                <Plus size={13} /> {t('venueEventBuilder:scoring.addRule')}
                            </button>
                        )}
                    </div>
                </Field>
            </div>
        </>
    );

    // The optional partner code: brands with a code to give (and the one saved, whatever its stock).
    const eventBrands = (partners ?? []).filter(d => d.event_ok || d.reward_id === savedPartner);
    const partnerPick = (partners ?? []).find(d => d.reward_id === v?.partner_reward_id)
        ?? (v?.partner_reward_id && v.partner_reward_id === savedPartner && ev?.partner_reward
            ? { ...ev.partner_reward, reward_id: savedPartner } : null);
    const prizesStep = v && tpl && (
        <>
            <StepHead title={t('venueEventBuilder:steps.prizes.title')} sub={t('venueEventBuilder:prizes.sub')} />
            {lockedNote}
            <div className="space-y-4">
                {v.prizes.map((p, i) => (
                    <div key={i} className="p-4 sm:p-5 rounded-2xl border border-[#E6E6E1] bg-white">
                        <div className="flex items-center gap-3">
                            <span className="w-10 text-[12px] font-black text-[#8a7600] shrink-0">{placeText(i + 1)}</span>
                            <input className={INPUT} aria-label={t('venueEventBuilder:prizes.prizeAria', { place: placeText(i + 1) })} value={p.label} maxLength={60} disabled={!can('prizes')}
                                placeholder={i < 3 ? t(`venueEventBuilder:prizes.placeholders.${i + 1}`) : t('venueEventBuilder:prizes.placeholders.other')}
                                onChange={e => setPrize(i, { label: e.target.value })} />
                            {v.prizes.length > 1 && (
                                <RemoveButton label={t('venueEventBuilder:prizes.remove', { place: placeText(i + 1) })} disabled={!can('prizes')}
                                    onClick={() => set({ prizes: v.prizes.filter((_, j) => j !== i) })} />
                            )}
                        </div>
                        <div className="flex items-center gap-3 mt-3 pl-[52px]">
                            {p.image_url ? (
                                <>
                                    <img src={storageImage(p.image_url, 160)} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E6E6E1]" />
                                    <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('prizes')}
                                        onUploaded={url => setPrize(i, { image_url: url })}>{t('venueEventBuilder:actions.change')}</UploadButton>
                                    <RemoveButton label={t('venueEventBuilder:prizes.removePhoto')} disabled={!can('prizes')} onClick={() => setPrize(i, { image_url: null })} />
                                </>
                            ) : (
                                <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('prizes')}
                                    onUploaded={url => setPrize(i, { image_url: url })}>{t('venueEventBuilder:prizes.addPhoto')}</UploadButton>
                            )}
                        </div>
                    </div>
                ))}
                {can('prizes') && v.prizes.length < 5 && (
                    <button type="button" onClick={() => set({ prizes: [...v.prizes, { label: '', image_url: null }] })} className={`${BTN_GHOST} h-10 px-5`}>
                        <Plus size={13} /> {t('venueEventBuilder:prizes.add')}
                    </button>
                )}
                <p className="text-[11px] text-[#AAAAAA] leading-relaxed">
                    <Trans
                        i18nKey="venueEventBuilder:prizes.photosNote"
                        components={{
                            partners: <Link to="/venue/partners" target="_blank" rel="noopener" className="font-bold underline underline-offset-2" />,
                            gold: <span className="text-[#8a7600]" />,
                        }}
                    />
                </p>
            </div>

            {/* Optional, and off unless the gym switches it on. */}
            <div className="mt-10 pt-8 border-t border-[#F0F0EC]">
                <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <Micro gold>{t('venueEventBuilder:partner.optional')}</Micro>
                        <div className="text-[16px] font-bold text-[#1A1A1A] mt-2 leading-snug">{t('venueEventBuilder:partner.title')}</div>
                        <p className="text-[12px] text-[#777] leading-relaxed mt-1.5 max-w-xl">
                            {t('venueEventBuilder:partner.body')}
                        </p>
                    </div>
                    <Switch label={t('venueEventBuilder:partner.title')} on={v.partner_on} disabled={!can('partner_code')}
                        onChange={on => set({ partner_on: on })} />
                </div>
                {v.partner_on && (
                    <div className="mt-5">
                        {partners === null ? (
                            partnersError ? (
                                <p className="text-[12px] text-[#666] leading-relaxed">
                                    {t('venueEventBuilder:partner.loadFailed')}{' '}
                                    <button type="button" onClick={reloadPartners} className="font-bold text-[#8a7600] underline underline-offset-2">{t('common:actions.retry')}</button>
                                </p>
                            ) : <Spinner className="py-6" />
                        ) : eventBrands.length === 0 ? (
                            <p className="text-[12px] text-[#666] leading-relaxed">
                                {t('venueEventBuilder:partner.none')}
                                {/* Admin only, so English. */}
                                {isAdmin && (
                                    <> Add codes to a reward in the admin Rewards page and it shows here.{' '}
                                        <Link to="/admin/rewards" className="font-bold underline underline-offset-2"><span className="text-[#8a7600]">Open Rewards</span></Link>
                                    </>
                                )}
                            </p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('venueEventBuilder:partner.aria')}>
                                    {eventBrands.map(d => {
                                        const on = d.reward_id === v.partner_reward_id;
                                        return (
                                            <button key={d.reward_id} type="button" role="radio" aria-checked={on} disabled={!can('partner_code')}
                                                onClick={() => set({ partner_reward_id: d.reward_id })}
                                                className={`flex items-center gap-3 p-3 rounded-2xl border text-left transition-all disabled:opacity-50 ${on ? 'border-[#E8D200] bg-[#E8D200]/[0.06]' : 'border-[#E6E6E1] bg-white hover:border-[#E8D200]/50'}`}>
                                                <BrandTile d={d} className="w-11 h-11 rounded-xl" />
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-[13px] font-bold text-[#1A1A1A] truncate">{d.label}</span>
                                                    <span className="block text-[11px] text-[#888] truncate">
                                                        {d.kind === 'shared'
                                                            ? t('venueEventBuilder:partner.shared')
                                                            : d.available ? t('venueEventBuilder:partner.codesLeft', { count: d.available, n: fmtNum(d.available) }) : t('venueEventBuilder:partner.noneLeft')}
                                                    </span>
                                                </span>
                                                {on && <Check size={15} className="text-[#8a7600] shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] text-[#AAAAAA] leading-relaxed mt-3">
                                    {t('venueEventBuilder:partner.note')}
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </>
    );

    const pushRows = v && tpl && [
        { key: 'announce', title: t('venueEventBuilder:pushes.announce.title'), type: 'event_announced', detail: t('venueEventBuilder:pushes.announce.detail') },
        { key: 'kickoff', title: t('venueEventBuilder:pushes.kickoff.title'), type: 'event_kickoff', detail: t('venueEventBuilder:pushes.kickoff.detail') },
        ...(finale ? [{ key: 'doors', title: t('venueEventBuilder:pushes.doors.title'), type: 'event_doors_open', detail: t('venueEventBuilder:pushes.doors.detail') }] : []),
    ];

    const promoteStep = v && tpl && (
        <>
            <StepHead title={t('venueEventBuilder:promote.title')} sub={t('venueEventBuilder:promote.sub')} />
            {lockedNote}
            <div className="space-y-10">
                <Field label={t('venueEventBuilder:promote.logo')} optional hint={t('venueEventBuilder:promote.logoHint')}>
                    <div className="flex flex-wrap items-center gap-3">
                        {v.logo_url && (
                            <span className="inline-flex items-center px-4 py-2.5 rounded-xl bg-[#141414] border border-[#E6E6E1]">
                                <img src={storageImage(v.logo_url, 200)} alt={t('venueEventBuilder:promote.logoAlt')} className="h-8 w-24 object-contain" />
                            </span>
                        )}
                        <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('logo')}
                            onUploaded={url => set({ logo_url: url })}>{v.logo_url ? t('venueEventBuilder:actions.change') : t('venueEventBuilder:promote.uploadLogo')}</UploadButton>
                        {v.logo_url && <RemoveButton label={t('venueEventBuilder:promote.removeLogo')} disabled={!can('logo')} onClick={() => set({ logo_url: null, logo_only: false })} />}
                    </div>
                    {v.logo_url && (
                        <label className="flex items-center justify-between gap-4 mt-4 max-w-md">
                            <span className="text-[13px] text-[#1A1A1A]">{t('venueEventBuilder:promote.logoOnly')}</span>
                            <Switch label={t('venueEventBuilder:promote.logoOnly')} on={v.logo_only} disabled={!can('logo')} onChange={on => set({ logo_only: on })} />
                        </label>
                    )}
                </Field>

                <Field label={t('venueEventBuilder:promote.headline')} optional hint={t('venueEventBuilder:promote.headlineHint')}>
                    <input className={INPUT} aria-label={t('venueEventBuilder:promote.headline')} value={v.promo_headline} maxLength={80} disabled={!can('promo_headline')}
                        onChange={e => set({ promo_headline: e.target.value })} placeholder={t('venueEventBuilder:promote.headlinePlaceholder')} />
                </Field>

                <Field label={t('venueEventBuilder:promote.media')} optional hint={t('venueEventBuilder:promote.mediaHint')}>
                    <div className="flex flex-wrap items-center gap-3">
                        {v.promo_media_url && (isVideo(v.promo_media_url)
                            ? <video src={v.promo_media_url} muted playsInline className="h-20 aspect-video rounded-xl object-cover border border-[#E6E6E1] bg-black" />
                            : <img src={storageImage(v.promo_media_url, 320)} alt="" className="h-20 aspect-video rounded-xl object-cover border border-[#E6E6E1]" />)}
                        <UploadButton accept="image/*,video/mp4,video/webm,video/quicktime" maxMb={80} prefix={prefix} onBusy={onBusy} disabled={!can('promo_media_url')}
                            onUploaded={url => set({ promo_media_url: url })}>{v.promo_media_url ? t('venueEventBuilder:actions.change') : t('venueEventBuilder:promote.upload')}</UploadButton>
                        {v.promo_media_url && <RemoveButton label={t('venueEventBuilder:promote.removeMedia')} disabled={!can('promo_media_url')} onClick={() => set({ promo_media_url: null })} />}
                    </div>
                </Field>

                <Field label={t('venueEventBuilder:promote.booking')} optional hint={t('venueEventBuilder:promote.bookingHint')}>
                    <input className={INPUT} aria-label={t('venueEventBuilder:promote.booking')} value={v.booking_url} maxLength={300} disabled={!can('booking_url')} inputMode="url"
                        onChange={e => set({ booking_url: e.target.value })} placeholder="https://" />
                </Field>

                {tpl.radius_choices?.length > 0 && (
                    <Field label={t('venueEventBuilder:promote.audience')} hint={t('venueEventBuilder:promote.audienceHint', { gym: gym.name })}>
                        <Chips label={t('venueEventBuilder:promote.audienceAria')} value={v.audience_radius_km ?? null} disabled={!can('audience_radius_km')} onChange={km => set({ audience_radius_km: km })}
                            options={[[null, t('venueEventBuilder:promote.justMembers')], ...tpl.radius_choices.map(km => [km, t('venueEventBuilder:promote.withinKm', { km })])]} />
                    </Field>
                )}

                {/* The previews under each switch are what members get, so they stay English for now (see pushPayload). */}
                <Field label={t('venueEventBuilder:promote.notifications')} hint={t('venueEventBuilder:promote.notificationsHint')}>
                    <div className="divide-y divide-[#F0F0EC] border-y border-[#F0F0EC]">
                        {pushRows.map(r => (
                            <div key={r.key} className="py-5">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold text-[#1A1A1A]">{r.title}</div>
                                        <p className="text-[12px] text-[#888] leading-relaxed mt-1">{r.detail}</p>
                                    </div>
                                    <Switch label={r.title} on={v.pushes[r.key]} onChange={on => set({ pushes: { ...v.pushes, [r.key]: on } })} />
                                </div>
                                <PushPreview type={r.type} payload={pushPayload} off={!v.pushes[r.key]} />
                            </div>
                        ))}
                        <div className="py-5 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold text-[#1A1A1A]">{t('venueEventBuilder:promote.standings')}</div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-1">{t('venueEventBuilder:promote.standingsBody')}</p>
                            </div>
                            <select
                                aria-label={t('venueEventBuilder:promote.standingsAria')} value={v.pushes.rank_at ?? ''}
                                onChange={e => set({ pushes: { ...v.pushes, rank_at: e.target.value || null } })}
                                className="h-11 pl-4 pr-8 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[12px] font-bold text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]/60"
                            >
                                <option value="">{t('venueEventBuilder:promote.off')}</option>
                                {STANDINGS_HOURS.map(h => <option key={h} value={`${String(h).padStart(2, '0')}:00`}>{hourText(h)}</option>)}
                            </select>
                        </div>
                    </div>
                </Field>
            </div>
        </>
    );

    const pushesOn = pushRows ? pushRows.filter(r => v.pushes[r.key]).map(r => r.title.toLowerCase()) : [];
    const reviewStep = v && tpl && (
        <>
            <StepHead
                title={t('venueEventBuilder:review.title')}
                sub={id ? t('venueEventBuilder:review.subEdit') : t('venueEventBuilder:review.subNew')}
            />
            {/* Single column: at xl the phone sits in the page's side column, so a second column here stayed empty. */}
            <div className="grid grid-cols-1 gap-10 items-start">
                <div className="divide-y divide-[#F0F0EC]">
                    <ReviewRow label={t('venueEventBuilder:steps.format.title')} onEdit={id ? null : () => go(0)}>{tpl.name}</ReviewRow>
                    <ReviewRow label={t('venueEventBuilder:steps.when.title')} onEdit={() => go(1)}>
                        <div className="font-bold">{v.name.trim()}</div>
                        {preview?.window_start_at && <div>{t('venueEventBuilder:schedule.scoring', { from: fmtDay(preview.window_start_at), to: lastDay(preview.window_end_at) })}</div>}
                        {preview?.doors_open_at && <div>{t('venueEventBuilder:schedule.finale', { day: fmtDay(preview.doors_open_at), from: ukClock(preview.doors_open_at), to: ukClock(preview.doors_close_at) })}</div>}
                        <div className="text-[#888]">
                            {v.reveal.mode === 'at' && v.reveal.at
                                ? t('venueEventBuilder:review.revealAuto', { at: fmtDayTime(fromLocalInput(v.reveal.at)) })
                                : t('venueEventBuilder:review.revealManual')}
                        </div>
                    </ReviewRow>
                    <ReviewRow label={t('venueEventBuilder:scoring.title')} onEdit={() => go(2)}>
                        <div>{whatCounts({ count_venue_only: v.scoring === 'venue', included_activities: v.scoring === 'pick' ? v.activities : null }, gym.name)}</div>
                        <div className="text-[#888]">
                            {t('venueEventBuilder:review.boardTop', { n: v.board_size })}
                            {preset?.attendance_bonus_points ? ` · ${t('venueEventBuilder:review.finaleBonus', { points: preset.attendance_bonus_points })}` : ''}
                        </div>
                    </ReviewRow>
                    <ReviewRow label={t('venueEventBuilder:steps.prizes.title')} onEdit={() => go(3)}>
                        <ol className="space-y-1.5">
                            {v.prizes.filter(p => p.label.trim()).map((p, i) => (
                                <li key={i} className="flex items-center gap-3">
                                    <span className="w-9 text-[11px] font-black text-[#BBBBBB]">{placeText(i + 1)}</span>
                                    {p.image_url && <img src={storageImage(p.image_url, 80)} alt="" className="w-7 h-7 rounded-lg object-cover" />}
                                    <span>{p.label.trim()}</span>
                                </li>
                            ))}
                        </ol>
                        {v.partner_on && partnerPick && (
                            <div className="mt-2 text-[#888]">{t('venueEventBuilder:review.partnerCode', { brand: partnerPick.label })}</div>
                        )}
                    </ReviewRow>
                    <ReviewRow label={t('venueEventBuilder:steps.promote.title')} onEdit={() => go(4)}>
                        <div>{v.audience_radius_km ? t('venueEventBuilder:review.audienceKm', { km: v.audience_radius_km }) : t('venueEventBuilder:review.audience')}</div>
                        <div className="text-[#888]">
                            {pushesOn.length ? t('venueEventBuilder:review.notifications', { list: pushesOn.join(', ') }) : t('venueEventBuilder:review.noNotifications')}
                            {v.pushes.rank_at ? t('venueEventBuilder:review.standingsAt', { time: hourText(Number(v.pushes.rank_at.slice(0, 2))) }) : ''}
                        </div>
                        {v.booking_url.trim() && <div className="text-[#888] truncate">{t('venueEventBuilder:review.booking', { url: v.booking_url.trim() })}</div>}
                    </ReviewRow>
                    <ReviewRow label={t('venueEventBuilder:scoring.rules')} onEdit={() => go(2)}>
                        <Rules rules={preview?.rules ?? []} />
                    </ReviewRow>
                </div>
                <div className="xl:hidden"><EventAppPreview event={previewEvent} venue={previewVenue} pageTheme="light" /></div>
            </div>
        </>
    );

    const body = { format: formatStep, when: whenStep, scoring: scoringStep, prizes: prizesStep, promote: promoteStep, review: reviewStep }[cur];
    const last = STEPS.length - 1;
    const problem = problems[step];
    const isDraft = !ev || ev.status === 'draft';
    const sidePreview = !!previewEvent && step > 0;

    return (
        <Page>
            <Link to={id ? `/venue/events/${id}` : '/venue/events'} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                <ArrowLeft size={13} className="text-[#BBBBBB]" /><span className="text-[#BBBBBB] hover:text-[#8a7600]">{id ? t('venueEventBuilder:page.backToEvent') : t('venueEventBuilder:page.events')}</span>
            </Link>
            <div ref={rootRef} className="scroll-mt-24">
                <PageTitle
                    eyebrow={id ? t('venueEventBuilder:page.edit') : fromId ? t('venueEventBuilder:page.again') : t('venueEventBuilder:page.new')}
                    title={v?.name.trim() || (tpl ? tpl.name : t('venueEventBuilder:page.new'))}
                    right={restored && !id ? (
                        <button type="button" onClick={startOver} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#8a7600]">
                            {t('venueEventBuilder:actions.startOver')}
                        </button>
                    ) : null}
                />
            </div>
            {/* The third column only exists while the phone preview fills it; an empty one squeezed the form. */}
            <div className={`grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] ${sidePreview ? 'xl:grid-cols-[180px_minmax(0,1fr)_280px] 2xl:grid-cols-[210px_minmax(0,1fr)_320px]' : ''} gap-6 lg:gap-8 items-start`}>
                <StepRail current={step} problems={problems} reachable={reachable} onJump={go} formatLocked={!!id} />
                <div className="min-w-0 space-y-5">
                    <Card className="p-6 sm:p-10">{body}</Card>
                    {previewEvent && step > 0 && cur !== 'review' && (
                        <div className="xl:hidden">
                            <button type="button" onClick={() => setShowPhone(s => !s)} aria-expanded={showPhone} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
                                <Smartphone size={13} /> {showPhone ? t('venueEventBuilder:page.hidePhone') : t('venueEventBuilder:page.showPhone')}
                            </button>
                            {showPhone && <div className="mt-5"><EventAppPreview event={previewEvent} venue={previewVenue} pageTheme="light" /></div>}
                        </div>
                    )}

                    {error && <div className="text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}

                    <div className="flex flex-wrap items-center gap-3">
                        {step > 0 && (
                            <button type="button" onClick={() => go(step - 1)} className={BTN_GHOST} disabled={!!saving}>
                                <ArrowLeft size={13} /> {t('common:actions.back')}
                            </button>
                        )}
                        {step < last && (
                            <button type="button" onClick={() => go(step + 1)} disabled={!!problem || !!uploading || !!saving} className={BTN_GOLD}>
                                {t('venueEventBuilder:actions.next', { step: t(STEPS[step + 1].title) })} <ArrowRight size={14} />
                            </button>
                        )}
                        {step < last && id && (
                            <button type="button" onClick={() => save(false)} disabled={!!uploading || !!saving} className={BTN_GHOST}>
                                {saving === 'save' ? t('common:actions.saving') : t('venueEventBuilder:actions.saveChanges')}
                            </button>
                        )}
                        {step === last && (
                            <>
                                <button type="button" onClick={() => save(false)} disabled={!!uploading || !!saving}
                                    className={id && !isDraft ? BTN_GOLD : BTN_GHOST}>
                                    {saving === 'save' ? t('common:actions.saving') : id ? t('venueEventBuilder:actions.saveChanges') : t('venueEventBuilder:actions.saveDraft')}
                                </button>
                                {isDraft && (canPublish ? (
                                    <button type="button" onClick={() => save(true)} disabled={!!uploading || !!saving} className={BTN_GOLD}>
                                        {saving === 'publish' ? t('venueEventBuilder:actions.working') : trusted ? t('venueEventBuilder:actions.publish') : t('venueEventBuilder:actions.sendToPowr')}
                                    </button>
                                ) : (
                                    <Link to="/venue/package" className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">{t('venueEventBuilder:actions.needsClashPlus')}</Link>
                                ))}
                            </>
                        )}
                        {problem && step < last && <span className="text-[11px] font-bold text-[#B45309]">{problem}</span>}
                        {uploading > 0 && <span className="text-[11px] font-bold text-[#888]">{t('venueEventBuilder:upload.uploading')}</span>}
                    </div>
                    {step === last && isDraft && canPublish && (
                        <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-2xl">
                            {trusted
                                ? t('venueEventBuilder:publish.trusted')
                                : t('venueEventBuilder:publish.check')}
                        </p>
                    )}
                </div>
                {sidePreview && (
                    <div className="hidden xl:block xl:sticky xl:top-6">
                        <EventAppPreview event={previewEvent} venue={previewVenue} pageTheme="light" width={280} />
                    </div>
                )}
            </div>
        </Page>
    );
}
