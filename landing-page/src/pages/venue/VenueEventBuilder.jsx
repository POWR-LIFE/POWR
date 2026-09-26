import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, Check, Gift, Lock, Moon, Plus, Smartphone, Upload, X } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import {
    createGymEvent, fetchEventPushes, fetchEventTemplates, fetchGymEvent, fetchGymSummary, fetchPointPresets, fetchPrizeCatalogue,
    previewGymEvent, publishGymEvent, scheduleGymReveal, setEventPush, updateGymEvent,
} from './venueApi';
import {
    ACTIVITIES, fmtDay, fmtDayTime, fromLocalInput, isVideo, isoDay, lastDay, lengthLabel, statusKey, toLocalInput, whatCounts, withGym,
} from './eventUi';
import { Preview as PushPreview, STANDINGS_HOURS, Switch } from './EventPushes';
import { usePackage } from './packages';
import { hourLabel, ordinal } from '../../../../shared/gymBoard.ts';
import { ukTime } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
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

const STEPS = [
    { key: 'format',  title: 'Format',  hint: 'The kind of event' },
    { key: 'when',    title: 'When',    hint: 'Name, dates, reveal' },
    { key: 'scoring', title: 'Scoring', hint: 'What counts' },
    { key: 'prizes',  title: 'Prizes',  hint: 'What they win' },
    { key: 'promote', title: 'Promote', hint: 'Look and reach' },
    { key: 'review',  title: 'Review',  hint: 'Check and save' },
];

// Once an event has started only its words and pictures can change
// (gym_update_event); notifications and the reveal time stay open too.
const LIVE_EDITABLE = ['name', 'promo_headline', 'promo_media_url', 'booking_url', 'logo'];

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
        prizes: [{ label: '', image_url: null, reward_id: null }],
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
        prizes: ev.prizes?.length ? ev.prizes.map(p => ({ label: p.label ?? '', image_url: p.image_url ?? null, reward_id: p.reward_id ?? null })) : base.prizes,
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
        // A partner prize is its reward; the server names and pictures it.
        prizes: v.prizes
            .filter(p => p.reward_id || p.label.trim())
            .map(p => (p.reward_id
                ? { label: p.label.trim(), image_url: p.image_url ?? null, reward_id: p.reward_id }
                : p.image_url ? { label: p.label.trim(), image_url: p.image_url } : p.label.trim())),
        promo_headline: v.promo_headline.trim(),
        promo_media_url: v.promo_media_url ?? null,
        booking_url: v.booking_url.trim(),
        logo_url: v.logo_url ?? null,
        logo_only: !!(v.logo_url && v.logo_only),
        audience_radius_km: v.audience_radius_km ?? null,
    };
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
    if (!tpl || !v) return key === 'format' ? 'Pick a format to start' : null;
    switch (key) {
    case 'when': {
        const name = v.name.trim();
        if (name.length < 3) return 'Give the event a name';
        if (name.length > 48) return 'Keep the name to 48 characters';
        if (!ctx.datesLocked) {
            if (!v.start_date) return 'Pick the first day';
            if (v.start_date < isoDay(new Date())) return 'The first day can’t be in the past';
            if (v.start_date > isoDay(new Date(Date.now() + 89 * DAY))) return 'Pick a first day in the next 90 days';
        }
        if (v.reveal.mode === 'at') {
            if (!v.reveal.at) return 'Pick when the winners are revealed';
            const lock = ctx.lockAt;
            if (lock) {
                const at = new Date(fromLocalInput(v.reveal.at)).getTime();
                const l = new Date(lock).getTime();
                if (at < l || at > l + 7 * DAY) {
                    return `Reveal between ${fmtDayTime(lock)} and ${fmtDayTime(new Date(l + 7 * DAY).toISOString())}`;
                }
            }
        }
        return null;
    }
    case 'scoring':
        if (v.scoring === 'pick' && !v.activities.length) return 'Pick at least one activity';
        return null;
    case 'prizes': {
        const named = v.prizes.filter(p => p.reward_id || p.label.trim());
        if (!named.length) return 'Add at least one prize';
        if (named.some(p => !p.reward_id && p.label.trim().length < 2)) return 'Give each prize a name of 2 characters or more';
        if (v.prizes.some(p => !p.reward_id && !p.label.trim() && p.image_url)) return 'Give each prize photo a name';
        if (v.prizes.filter(p => p.reward_id).length > 3) return 'Up to 3 partner prizes per event';
        return null;
    }
    case 'promote': {
        const b = v.booking_url.trim();
        if (b && !/^https:\/\/\S+\.\S+$/.test(b)) return 'A booking link starts with https://';
        if (b.toLowerCase().includes('{email}')) return 'A booking link can’t ask for members’ email addresses';
        return null;
    }
    default:
        return null;
    }
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function StepRail({ current, problems, reachable, onJump, formatLocked }) {
    const refs = useRef([]);
    // On a phone the rail scrolls sideways; keep the current step in view.
    useEffect(() => { refs.current[current]?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [current]);
    return (
        <nav aria-label="Steps" className="lg:sticky lg:top-6">
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
                                    <span className={`block text-[11px] font-black uppercase tracking-[0.15em] ${on ? 'text-[#1A1A1A]' : can ? 'text-[#666]' : 'text-[#C4C4C0]'}`}>{s.title}</span>
                                    <span className="hidden lg:block text-[11px] text-[#AAAAAA] mt-0.5">{s.hint}</span>
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
    return (
        <div>
            <div className={LABEL}>
                {label}
                {optional && <span className="normal-case tracking-normal font-bold text-[#CCCCCC]"> · optional</span>}
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
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > maxMb * 1024 * 1024) { toast.error(`Keep it under ${maxMb} MB`); return; }
        setBusy(true);
        onBusy(1);
        try {
            onUploaded(await uploadPublicImage('reward-images', file, prefix));
        } catch (err) {
            toast.error(err.message ?? 'Upload failed');
        } finally {
            setBusy(false);
            onBusy(-1);
        }
    };
    const off = busy || disabled;
    return (
        <label className={`${BTN_GHOST} h-10 px-5 cursor-pointer ${off ? 'opacity-40 pointer-events-none' : ''}`}>
            <Upload size={13} /> {busy ? 'Uploading…' : children}
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
    const box = 'p-4 sm:p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-[12px]';
    if (error) return <div className={`${box} text-[#B91C1C]`}>{error}</div>;
    if (!preview?.window_start_at) return <div className={`${box} text-[#999]`}>Pick the first day to see every date.</div>;
    return (
        <div className={`${box} space-y-2`}>
            <div className="flex items-center gap-2"><Calendar size={13} className="text-[#8a7600] shrink-0" /><span className="font-bold">Scoring {fmtDay(preview.window_start_at)} → {lastDay(preview.window_end_at)}</span></div>
            {finale && preview.doors_open_at && (
                <div className="flex items-center gap-2">
                    <Moon size={13} className="text-[#8a7600] shrink-0" />
                    <span className="font-bold">Finale night {fmtDay(preview.doors_open_at)}, {ukTime(preview.doors_open_at)}–{ukTime(preview.doors_close_at)}</span>
                    <span className="text-[#999] hidden sm:inline">at {gymName}</span>
                </div>
            )}
            <div className="text-[#999] pl-5">The board seals at midnight after the last day. Members can join until then.</div>
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

/** A POWR partner prize in a slot: the reward's own words and picture. */
function PartnerPrize({ ordinal: ord, prize, reward, disabled, onChange, onOwn, onRemove }) {
    const img = reward?.image_url ?? prize.image_url;
    return (
        <div className="flex items-start gap-3">
            <span className="w-10 text-[12px] font-black text-[#8a7600] shrink-0 pt-3">{ord}</span>
            <div className="flex-1 min-w-0 p-3 sm:p-4 rounded-2xl bg-[#FFFBE0] border border-[#E8D200]/50">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-white border border-[#E6E6E1] shrink-0 flex items-center justify-center">
                        {img ? <img src={storageImage(img, 160)} alt="" className="w-full h-full object-cover" /> : <Gift size={16} className="text-[#8a7600]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[9px] uppercase tracking-[0.25em] font-black text-[#8a7600]">POWR partner prize</div>
                        <div className="text-[14px] font-bold text-[#1A1A1A] mt-0.5 leading-snug line-clamp-2">{prize.label || reward?.label}</div>
                    </div>
                </div>
                {reward?.offer && <div className="text-[12px] text-[#666] mt-2.5 line-clamp-2">{reward.offer}</div>}
                <div className="text-[11px] text-[#888] mt-1.5 leading-relaxed">
                    {reward ? (reward.available == null ? 'A code for the winner, in their Wallet at the reveal.' : `${reward.available} codes left · the winner’s lands in their Wallet at the reveal.`) : 'The winner’s code lands in their Wallet at the reveal.'}
                </div>
                {!disabled && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
                        <button type="button" onClick={onChange} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600]">Change</button>
                        <button type="button" onClick={onOwn} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Use my own prize</button>
                    </div>
                )}
            </div>
            {onRemove && <RemoveButton label={`Remove ${ord} prize`} disabled={disabled} onClick={onRemove} />}
        </div>
    );
}

/** The catalogue: rewards brands have offered as event prizes. */
function PrizePicker({ catalogue, current, onPick, onClose }) {
    return (
        <div className="mt-4 rounded-2xl border border-[#E6E6E1] bg-[#FAFAF8] p-3 sm:p-4" role="listbox" aria-label="POWR partner prizes">
            <div className="flex items-center justify-between gap-3 mb-3">
                <Micro>Pick a partner prize</Micro>
                <button type="button" onClick={onClose} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Close</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catalogue.map(r => (
                    <button key={r.id} type="button" role="option" aria-selected={r.id === current} onClick={() => onPick(r)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${r.id === current ? 'border-[#E8D200] bg-[#FFFBE0]' : 'border-[#E6E6E1] bg-white hover:border-[#CFCFC8]'}`}>
                        <div className="w-11 h-11 rounded-lg overflow-hidden bg-[#F4F4F1] shrink-0 flex items-center justify-center">
                            {r.image_url ? <img src={storageImage(r.image_url, 120)} alt="" className="w-full h-full object-cover" /> : <Gift size={15} className="text-[#8a7600]" />}
                        </div>
                        <div className="min-w-0">
                            <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{r.label}</div>
                            <div className="text-[11px] text-[#888] truncate">{r.title}{r.available != null ? ` · ${r.available} left` : ''}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function ReviewRow({ label, onEdit, children }) {
    return (
        <div className="py-5 first:pt-0 last:pb-0 flex gap-4">
            <div className="flex-1 min-w-0">
                <Micro className="mb-2">{label}</Micro>
                <div className="text-[13px] text-[#1A1A1A] leading-relaxed space-y-1">{children}</div>
            </div>
            {onEdit && (
                <button type="button" onClick={onEdit} className="shrink-0 h-8 text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600]">
                    Change
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
    const { gym } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const { pkg } = usePackage();
    const canPublish = !!pkg?.features?.events;
    const rootRef = useRef(null);

    const [templates, setTemplates] = useState(null);
    const [presets, setPresets] = useState([]);
    const [catalogue, setCatalogue] = useState([]);   // POWR partner prizes on offer
    const [picking, setPicking] = useState(null);     // prize slot choosing a partner prize
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
            fetchPrizeCatalogue(gym.partner_id).catch(() => []),
        ])
            .then(([t, p, summary, ev, pushes, prizes]) => {
                if (!alive) return;
                setTemplates(t);
                setPresets(p);
                setCatalogue(Array.isArray(prizes) ? prizes : []);
                setTrusted(!!summary?.portal?.trusted);
                if (ev) {
                    const tpl = t.find(x => x.key === ev.template_key);
                    const k = statusKey(ev);
                    if (id) {
                        if (!ev.editable) { setLoadError('Only the gym that runs this event can change it.'); return; }
                        if (k === 'pending') { setLoadError('It’s with POWR for a quick check. Pull it back from the event page to change it.'); return; }
                        if (!['draft', 'rejected', 'scheduled', 'live'].includes(k)) { setLoadError('This event has finished, so it can’t change. Run it again as a new event.'); return; }
                        if (!tpl) { setLoadError('This kind of event is no longer offered. Contact POWR to change it.'); return; }
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
                    const tpl = saved && t.find(x => x.key === saved.tplKey);
                    if (!source && tpl && saved.v) {
                        setTplKey(tpl.key);
                        setV({ ...blankValue(tpl), ...saved.v });
                        setStep(Math.min(saved.step ?? 0, STEPS.length - 1));
                        setRestored(true);
                    }
                } catch { /* no storage: start fresh */ }
            })
            .catch(err => { if (alive) setLoadError(err.message); });
        return () => { alive = false; };
    }, [id, fromId, gym.partner_id]);

    const tpl = useMemo(() => templates?.find(t => t.key === tplKey) ?? null, [templates, tplKey]);
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
        prizes: v.prizes.filter(p => p.reward_id || p.label.trim()).map((p, i) => ({ rank: i + 1, label: p.label.trim() || 'Prize', image_url: p.image_url ?? null })),
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
        const t = setTimeout(() => {
            previewGymEvent(gym.partner_id, tplKey, JSON.parse(previewKey))
                .then(p => { if (seq.current === n) { setPreview(p); setPreviewError(null); } })
                .catch(err => { if (seq.current === n) setPreviewError(err.message); });
        }, 250);
        return () => clearTimeout(t);
    }, [previewKey, tplKey, gym.partner_id]);

    // A reveal time the gym hasn't typed follows the dates.
    useEffect(() => {
        if (!v || v.reveal.mode !== 'at' || !v.reveal.auto || !preview?.lock_at) return;
        const s = suggestedReveal(preview);
        if (s && s !== v.reveal.at) setV(x => ({ ...x, reveal: { ...x.reveal, at: s } }));
    }, [preview, v]);

    if (loadError) {
        return (
            <Empty title="Can’t open this event" action={<Link to={id ? `/venue/events/${id}` : '/venue/events'} className={BTN_GHOST}>Back</Link>}>
                {loadError}
            </Empty>
        );
    }
    if (!templates || (id && !orig)) return <Spinner />;

    const set = (patch) => setV(x => ({ ...x, ...patch }));
    const setPrize = (i, patch) => setV(x => ({ ...x, prizes: x.prizes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
    const onBusy = (d) => setUploading(n => n + d);
    const prefix = `gym-events/${gym.partner_id}`;
    const lockAt = started ? ev.lock_at : preview?.lock_at;
    const problems = STEPS.map(s => checkStep(s.key, v, tpl, { datesLocked: started, lockAt }));
    const firstProblem = problems.findIndex(Boolean);
    const reachable = (i) => !!id || firstProblem === -1 || i <= firstProblem;
    const go = (i) => {
        if (!reachable(i)) return;
        setStep(i);
        setError(null);
        rootRef.current?.scrollIntoView({ block: 'start' });
    };
    const pickFormat = (t) => {
        if (id) return;
        setTplKey(t.key);
        setV(prev => (tplKey === t.key ? prev : switchFormat(prev, t)));
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
            setError(err.message);
            setSaving(null);
            return;
        }

        // Saved. Notifications, the reveal time and publishing follow; a
        // problem with one of them still leaves the event saved.
        const later = [];
        const patch = pushChanges(v.pushes, orig ? orig.pushes : blankValue(tpl).pushes, tpl);
        if (Object.keys(patch).length) {
            try { await setEventPush(saved.id, patch); } catch (err) { later.push(`the notifications weren’t saved (${err.message})`); }
        }
        const revealAt = v.reveal.mode === 'at' && v.reveal.at ? fromLocalInput(v.reveal.at) : null;
        if (!sameInstant(revealAt, saved.reveal_at)) {
            try { await scheduleGymReveal(saved.id, revealAt); } catch (err) { later.push(`the reveal time wasn’t saved (${err.message})`); }
        }
        let published = null;
        if (publish) {
            try { published = await publishGymEvent(saved.id); } catch (err) { later.push(`it isn’t published yet: ${err.message}`); }
        }
        if (!orig) { try { sessionStorage.removeItem(draftKey(gym.partner_id)); } catch { /* ignore */ } }

        if (later.length) toast.error(`Saved, but ${later.join('; ')}`);
        else if (published) toast.success(statusKey(published) === 'pending' ? 'Sent to POWR for a quick check' : 'Published. Your members can see it now');
        else toast.success(orig ? 'Saved' : 'Draft saved');
        navigate(`/venue/events/${saved.id}`);
    };

    // ── Steps ─────────────────────────────────────────────────────────────
    const cur = STEPS[step].key;
    const presetOptions = tpl ? presets.filter(p => tpl.allowed_presets.includes(p.key)) : [];
    const preset = presets.find(p => p.key === v?.points_preset_key);
    const firstPrize = v?.prizes.find(p => p.label.trim())?.label.trim() ?? '';
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
            It’s under way, so only the name, headline, logo, picture and booking link can change, plus the notifications and when the winners are revealed.
        </div>
    );

    const formatStep = (
        <>
            <StepHead title={id ? 'The format' : 'What kind of event?'} sub={id ? 'The format is set once an event is saved. Run it again as a new event to pick another.' : 'Pick a format. You choose how long it runs, what counts and more in the next steps.'} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="radiogroup" aria-label="Format">
                {templates.map(t => {
                    const on = t.key === tplKey;
                    const days = t.day_choices?.length
                        ? `${lengthLabel(Math.min(...t.day_choices))} to ${lengthLabel(Math.max(...t.day_choices))}`
                        : lengthLabel(t.duration_days);
                    return (
                        <button
                            key={t.key} type="button" role="radio" aria-checked={on} disabled={!!id && !on} onClick={() => pickFormat(t)}
                            className={`text-left rounded-3xl border p-6 transition-all disabled:opacity-40 ${on ? 'border-[#E8D200] bg-[#E8D200]/[0.06]' : 'border-[#E6E6E1] bg-white hover:border-[#E8D200]/50'}`}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <Micro gold={on}>{days}{t.night_start_hour != null ? ' + finale night' : ''}</Micro>
                                {on && <Check size={16} className="text-[#8a7600]" />}
                            </div>
                            <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{t.name}</div>
                            <p className="text-[12px] text-[#888] leading-relaxed mt-2">{withGym(t.blurb, gym.name)}</p>
                            <p className="text-[11px] font-bold text-[#8a7600] mt-4">
                                {t.count_venue_only ? `Counts sessions at ${gym.name}` : 'Counts any verified workout'}. You can change this.
                            </p>
                        </button>
                    );
                })}
            </div>
        </>
    );

    const whenStep = v && tpl && (
        <>
            <StepHead title="Name and dates" sub="The first day starts at midnight. Every other date follows from the choices here." />
            {lockedNote}
            <div className="space-y-8">
                <Field label="Event name">
                    <input className={INPUT} aria-label="Event name" value={v.name} maxLength={48} disabled={!can('name')}
                        onChange={e => set({ name: e.target.value })} placeholder={`${gym.name} October Clash`} />
                </Field>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Field label="First day">
                        <input type="date" aria-label="First day" className={`${INPUT} max-w-xs`} value={v.start_date} disabled={!can('start_date')}
                            min={isoDay(new Date())} max={isoDay(new Date(Date.now() + 89 * DAY))}
                            onChange={e => set({ start_date: e.target.value })} />
                    </Field>
                    {tpl.day_choices?.length > 0 && (
                        <Field label="How long">
                            <Chips label="How long" value={v.duration_days} disabled={!can('duration_days')} onChange={d => set({ duration_days: d })}
                                options={tpl.day_choices.map(d => [d, lengthLabel(d)])} />
                        </Field>
                    )}
                </div>
                {finale && tpl.night_hour_choices?.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <Field label="Finale night starts">
                            <Chips label="Finale night starts" value={v.night_start_hour} disabled={!can('night')} onChange={h => set({ night_start_hour: h })}
                                options={tpl.night_hour_choices.map(h => [h, hourLabel(h)])} />
                        </Field>
                        <Field label="And lasts">
                            <Chips label="Finale night length" value={v.night_hours} disabled={!can('night')} onChange={n => set({ night_hours: n })}
                                options={tpl.night_length_choices.map(n => [n, `${n} hours`])} />
                        </Field>
                    </div>
                )}
                <Schedule preview={preview} error={previewError} finale={finale} gymName={gym.name} />

                <Field label="Revealing the winners">
                    <div className="space-y-3" role="radiogroup" aria-label="Revealing the winners">
                        <Choice
                            on={v.reveal.mode === 'manual'} onPick={() => set({ reveal: { ...v.reveal, mode: 'manual' } })}
                            title="I’ll reveal them"
                            body={`Press Reveal from your phone${finale ? ' on the finale night' : ''} or the portal. The app and your screen flip together. If nobody does, POWR reveals them about ${Math.round(((tpl.settle_grace_hours ?? 12) + (tpl.auto_reveal_after_hours ?? 72)) / 24)} days after the board seals.`}
                        />
                        <Choice
                            on={v.reveal.mode === 'at'}
                            onPick={() => set({ reveal: { mode: 'at', at: v.reveal.at || suggestedReveal(preview), auto: !v.reveal.at } })}
                            title="At a set time" body="Pick a time after the board seals and within a week of it."
                        >
                            <input type="datetime-local" aria-label="Reveal time" className={`${INPUT} max-w-xs`} value={v.reveal.at}
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
            <StepHead title="What counts" sub="Members score points for verified activity. Choose which activity moves this board." />
            {lockedNote}
            <div className="space-y-8">
                <div className="space-y-3" role="radiogroup" aria-label="What counts">
                    <Choice on={v.scoring === 'all'} disabled={!can('scoring')} onPick={() => set({ scoring: 'all' })}
                        title="Every verified workout"
                        body="Anything members do, anywhere: gym check-ins, and workouts from their watch or phone." />
                    <Choice on={v.scoring === 'venue'} disabled={!can('scoring')} onPick={() => set({ scoring: 'venue' })}
                        title={`Only sessions at ${gym.name}`}
                        body="Members check in with POWR when they arrive. The hardest to game, and footfall you can see." />
                    <Choice on={v.scoring === 'pick'} disabled={!can('scoring')} onPick={() => set({ scoring: 'pick' })}
                        title="Pick the activities" body="Choose what counts, like running and cycling for a run club.">
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Activities">
                            {ACTIVITIES.map(([k, label]) => {
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
                            <p className="text-[11px] text-[#B45309] font-bold mt-3">Walking includes everyone’s daily steps, so it can outweigh workouts.</p>
                        )}
                    </Choice>
                </div>
                <p className="text-[11px] text-[#AAAAAA] -mt-4">Workouts typed in by hand never count. POWR checks everything else.</p>

                {tpl.board_choices?.length > 0 && (
                    <Field label="Leaderboard" hint="How many places show on the board in the app and on your screen.">
                        <Chips label="Leaderboard size" value={v.board_size} disabled={!can('board_size')} onChange={n => set({ board_size: n })}
                            options={tpl.board_choices.map(n => [n, `Top ${n}`])} />
                    </Field>
                )}

                {presetOptions.length > 1 && (
                    <Field label="Finale night bonus" hint={`${preset?.blurb ?? ''} POWR pays it to members who joined and check in at ${gym.name} on the night.`}>
                        <Chips label="Finale night bonus" value={v.points_preset_key} disabled={!can('points_preset_key')} onChange={k => set({ points_preset_key: k })}
                            options={presetOptions.map(p => [p.key, p.label])} />
                    </Field>
                )}

                <Field label="Rules">
                    <div className="p-4 sm:p-5 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1]">
                        <Micro className="mb-3">Written for you from your choices</Micro>
                        {v.scoring === 'pick' && !v.activities.length
                            ? <p className="text-[12px] text-[#999]">Pick an activity to see them.</p>
                            : <Rules rules={preview?.house_rules ?? []} muted />}
                    </div>
                    <div className="mt-5 space-y-2">
                        {v.own_rules.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input className={INPUT} aria-label={`Your rule ${i + 1}`} value={r} maxLength={200} disabled={!can('rules')}
                                    onChange={e => set({ own_rules: v.own_rules.map((x, j) => (j === i ? e.target.value : x)) })}
                                    placeholder="A rule of your own" />
                                <RemoveButton label="Remove rule" disabled={!can('rules')} onClick={() => set({ own_rules: v.own_rules.filter((_, j) => j !== i) })} />
                            </div>
                        ))}
                        {can('rules') && v.own_rules.length < 8 && (
                            <button type="button" onClick={() => set({ own_rules: [...v.own_rules, ''] })} className={`${BTN_GHOST} h-10 px-5`}>
                                <Plus size={13} /> Add a rule of your own
                            </button>
                        )}
                    </div>
                </Field>
            </div>
        </>
    );

    const partnerCount = v ? v.prizes.filter(p => p.reward_id).length : 0;
    const prizesStep = v && tpl && (
        <>
            <StepHead title="Prizes" sub="1st place first. Your own prizes you hand over at the front desk; a POWR partner prize reaches the winner as a code in their Wallet the moment you reveal." />
            {lockedNote}
            <div className="space-y-4">
                {v.prizes.map((p, i) => (
                    <div key={i} className="p-4 sm:p-5 rounded-2xl border border-[#E6E6E1] bg-white">
                        {p.reward_id ? (
                            <PartnerPrize
                                ordinal={ordinal(i + 1)}
                                prize={p}
                                reward={catalogue.find(r => r.id === p.reward_id)}
                                disabled={!can('prizes')}
                                onChange={() => setPicking(i)}
                                onOwn={() => { setPrize(i, { reward_id: null, label: '', image_url: null }); setPicking(null); }}
                                onRemove={v.prizes.length > 1 ? () => set({ prizes: v.prizes.filter((_, j) => j !== i) }) : null}
                            />
                        ) : (
                            <>
                                <div className="flex items-center gap-3">
                                    <span className="w-10 text-[12px] font-black text-[#8a7600] shrink-0">{ordinal(i + 1)}</span>
                                    <input className={INPUT} aria-label={`${ordinal(i + 1)} prize`} value={p.label} maxLength={60} disabled={!can('prizes')}
                                        placeholder={['A free month', 'A PT session', 'Gym merch'][i] ?? 'Prize'}
                                        onChange={e => setPrize(i, { label: e.target.value })} />
                                    {v.prizes.length > 1 && (
                                        <RemoveButton label={`Remove ${ordinal(i + 1)} prize`} disabled={!can('prizes')}
                                            onClick={() => set({ prizes: v.prizes.filter((_, j) => j !== i) })} />
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-3 mt-3 pl-[52px]">
                                    {p.image_url ? (
                                        <>
                                            <img src={storageImage(p.image_url, 160)} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E6E6E1]" />
                                            <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('prizes')}
                                                onUploaded={url => setPrize(i, { image_url: url })}>Change</UploadButton>
                                            <RemoveButton label="Remove photo" disabled={!can('prizes')} onClick={() => setPrize(i, { image_url: null })} />
                                        </>
                                    ) : (
                                        <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('prizes')}
                                            onUploaded={url => setPrize(i, { image_url: url })}>Add a photo</UploadButton>
                                    )}
                                    {catalogue.length > 0 && can('prizes') && partnerCount < 3 && picking !== i && (
                                        <button type="button" onClick={() => setPicking(i)} className="inline-flex items-center gap-2 h-10 text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600]">
                                            <Gift size={13} /> Or a POWR partner prize
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                        {picking === i && (
                            <PrizePicker
                                catalogue={catalogue}
                                current={p.reward_id}
                                onPick={r => { setPrize(i, { reward_id: r.id, label: r.label, image_url: r.image_url ?? null }); setPicking(null); }}
                                onClose={() => setPicking(null)}
                            />
                        )}
                    </div>
                ))}
                {can('prizes') && v.prizes.length < 5 && (
                    <button type="button" onClick={() => set({ prizes: [...v.prizes, { label: '', image_url: null, reward_id: null }] })} className={`${BTN_GHOST} h-10 px-5`}>
                        <Plus size={13} /> Add a prize
                    </button>
                )}
                <p className="text-[11px] text-[#AAAAAA] leading-relaxed">
                    Photos show with the prizes in the app, on the share page and on your screen.
                    {catalogue.length > 0 && ' Up to 3 partner prizes per event, on us: the brand supplies the code, POWR settles with them.'}
                </p>
            </div>
        </>
    );

    const pushRows = v && tpl && [
        { key: 'announce', title: 'Announcement', type: 'event_announced', detail: 'To your members and recent visitors who haven’t joined. Once, in the daytime, after you publish.' },
        { key: 'kickoff', title: 'Day one', type: 'event_kickoff', detail: 'To everyone who’s joined, the morning scoring starts.' },
        ...(finale ? [{ key: 'doors', title: 'Finale night', type: 'event_doors_open', detail: 'To everyone who’s joined, the morning of the finale.' }] : []),
    ];

    const promoteStep = v && tpl && (
        <>
            <StepHead title="Promote it" sub="How it looks, who sees it, and the notifications POWR sends for you." />
            {lockedNote}
            <div className="space-y-10">
                <Field label="Logo" optional hint="Shown on the event’s card in the app. A wide logo on a transparent background works best.">
                    <div className="flex flex-wrap items-center gap-3">
                        {v.logo_url && (
                            <span className="inline-flex items-center px-4 py-2.5 rounded-xl bg-[#141414] border border-[#E6E6E1]">
                                <img src={storageImage(v.logo_url, 200)} alt="Event logo" className="h-8 w-24 object-contain" />
                            </span>
                        )}
                        <UploadButton accept="image/*" maxMb={5} prefix={prefix} onBusy={onBusy} disabled={!can('logo')}
                            onUploaded={url => set({ logo_url: url })}>{v.logo_url ? 'Change' : 'Upload a logo'}</UploadButton>
                        {v.logo_url && <RemoveButton label="Remove logo" disabled={!can('logo')} onClick={() => set({ logo_url: null, logo_only: false })} />}
                    </div>
                    {v.logo_url && (
                        <label className="flex items-center justify-between gap-4 mt-4 max-w-md">
                            <span className="text-[13px] text-[#1A1A1A]">Show the logo instead of the name</span>
                            <Switch label="Show the logo instead of the name" on={v.logo_only} disabled={!can('logo')} onChange={on => set({ logo_only: on })} />
                        </label>
                    )}
                </Field>

                <Field label="Headline" optional hint="One line under the name, in the app and on share cards.">
                    <input className={INPUT} aria-label="Headline" value={v.promo_headline} maxLength={80} disabled={!can('promo_headline')}
                        onChange={e => set({ promo_headline: e.target.value })} placeholder="Most sessions in October wins a free month" />
                </Field>

                <Field label="Picture or video" optional hint="The big picture on the event’s card in the app and on share cards. A short video plays silently.">
                    <div className="flex flex-wrap items-center gap-3">
                        {v.promo_media_url && (isVideo(v.promo_media_url)
                            ? <video src={v.promo_media_url} muted playsInline className="h-20 aspect-video rounded-xl object-cover border border-[#E6E6E1] bg-black" />
                            : <img src={storageImage(v.promo_media_url, 320)} alt="" className="h-20 aspect-video rounded-xl object-cover border border-[#E6E6E1]" />)}
                        <UploadButton accept="image/*,video/mp4,video/webm,video/quicktime" maxMb={80} prefix={prefix} onBusy={onBusy} disabled={!can('promo_media_url')}
                            onUploaded={url => set({ promo_media_url: url })}>{v.promo_media_url ? 'Change' : 'Upload'}</UploadButton>
                        {v.promo_media_url && <RemoveButton label="Remove picture" disabled={!can('promo_media_url')} onClick={() => set({ promo_media_url: null })} />}
                    </div>
                </Field>

                <Field label="Booking link" optional hint="If members book a place on your own system, link it here and the app shows a Book button. {name} fills in their name.">
                    <input className={INPUT} aria-label="Booking link" value={v.booking_url} maxLength={300} disabled={!can('booking_url')} inputMode="url"
                        onChange={e => set({ booking_url: e.target.value })} placeholder="https://" />
                </Field>

                {tpl.radius_choices?.length > 0 && (
                    <Field label="Who sees it in the app" hint={`Your members and anyone who’s trained at ${gym.name} lately always see it. Anyone can join from your QR code or link.`}>
                        <Chips label="Who sees it" value={v.audience_radius_km ?? null} disabled={!can('audience_radius_km')} onChange={km => set({ audience_radius_km: km })}
                            options={[[null, 'Just my members'], ...tpl.radius_choices.map(km => [km, `Also within ${km} km`])]} />
                    </Field>
                )}

                <Field label="Notifications" hint="POWR writes every word and sends them at the right moment. Nothing goes out until the event is published, and members can turn notifications off.">
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
                                <div className="text-[13px] font-bold text-[#1A1A1A]">Daily standings</div>
                                <p className="text-[12px] text-[#888] leading-relaxed mt-1">Each member’s own rank and points, and how far they are from the place above. Only while the board is live.</p>
                            </div>
                            <select
                                aria-label="Daily standings time" value={v.pushes.rank_at ?? ''}
                                onChange={e => set({ pushes: { ...v.pushes, rank_at: e.target.value || null } })}
                                className="h-11 pl-4 pr-8 shrink-0 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[12px] font-bold text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]/60"
                            >
                                <option value="">Off</option>
                                {STANDINGS_HOURS.map(h => <option key={h} value={`${String(h).padStart(2, '0')}:00`}>{hourLabel(h)}</option>)}
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
                title="Check it over"
                sub={id ? 'Save to update it everywhere it shows.' : 'Nothing goes out until you publish. You can save it as a draft and come back.'}
            />
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-10 items-start">
                <div className="divide-y divide-[#F0F0EC]">
                    <ReviewRow label="Format" onEdit={id ? null : () => go(0)}>{tpl.name}</ReviewRow>
                    <ReviewRow label="When" onEdit={() => go(1)}>
                        <div className="font-bold">{v.name.trim()}</div>
                        {preview?.window_start_at && <div>Scoring {fmtDay(preview.window_start_at)} → {lastDay(preview.window_end_at)}</div>}
                        {preview?.doors_open_at && <div>Finale night {fmtDay(preview.doors_open_at)}, {ukTime(preview.doors_open_at)}–{ukTime(preview.doors_close_at)}</div>}
                        <div className="text-[#888]">
                            {v.reveal.mode === 'at' && v.reveal.at ? `Winners revealed automatically ${fmtDayTime(fromLocalInput(v.reveal.at))}` : 'You reveal the winners'}
                        </div>
                    </ReviewRow>
                    <ReviewRow label="What counts" onEdit={() => go(2)}>
                        <div>{whatCounts({ count_venue_only: v.scoring === 'venue', included_activities: v.scoring === 'pick' ? v.activities : null }, gym.name)}</div>
                        <div className="text-[#888]">Top {v.board_size} on the board{preset?.attendance_bonus_points ? ` · +${preset.attendance_bonus_points} POWR for coming to the finale night` : ''}</div>
                    </ReviewRow>
                    <ReviewRow label="Prizes" onEdit={() => go(3)}>
                        <ol className="space-y-1.5">
                            {v.prizes.filter(p => p.label.trim()).map((p, i) => (
                                <li key={i} className="flex items-center gap-3">
                                    <span className="w-9 text-[11px] font-black text-[#BBBBBB]">{ordinal(i + 1)}</span>
                                    {p.image_url && <img src={storageImage(p.image_url, 80)} alt="" className="w-7 h-7 rounded-lg object-cover" />}
                                    <span>{p.label.trim()}</span>
                                </li>
                            ))}
                        </ol>
                    </ReviewRow>
                    <ReviewRow label="Promote" onEdit={() => go(4)}>
                        <div>{v.audience_radius_km ? `Your members, recent visitors and anyone within ${v.audience_radius_km} km` : 'Your members and recent visitors'}</div>
                        <div className="text-[#888]">
                            {pushesOn.length ? `Notifications: ${pushesOn.join(', ')}` : 'No one-off notifications'}
                            {v.pushes.rank_at ? `, daily standings at ${hourLabel(Number(v.pushes.rank_at.slice(0, 2)))}` : ''}
                        </div>
                        {v.booking_url.trim() && <div className="text-[#888] truncate">Booking: {v.booking_url.trim()}</div>}
                    </ReviewRow>
                    <ReviewRow label="Rules" onEdit={() => go(2)}>
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

    return (
        <Page>
            <Link to={id ? `/venue/events/${id}` : '/venue/events'} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                <ArrowLeft size={13} className="text-[#BBBBBB]" /><span className="text-[#BBBBBB] hover:text-[#8a7600]">{id ? 'Back to the event' : 'Events'}</span>
            </Link>
            <div ref={rootRef} className="scroll-mt-24">
                <PageTitle
                    eyebrow={id ? 'Edit event' : fromId ? 'Run it again' : 'New event'}
                    title={v?.name.trim() || (tpl ? tpl.name : 'New event')}
                    right={restored && !id ? (
                        <button type="button" onClick={startOver} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#8a7600]">
                            Start over
                        </button>
                    ) : null}
                />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_280px] 2xl:grid-cols-[210px_minmax(0,1fr)_320px] gap-6 lg:gap-8 items-start">
                <StepRail current={step} problems={problems} reachable={reachable} onJump={go} formatLocked={!!id} />
                <div className="min-w-0 space-y-5">
                    <Card className="p-6 sm:p-10">{body}</Card>
                    {previewEvent && step > 0 && cur !== 'review' && (
                        <div className="xl:hidden">
                            <button type="button" onClick={() => setShowPhone(s => !s)} aria-expanded={showPhone} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
                                <Smartphone size={13} /> {showPhone ? 'Hide the app preview' : 'See it in the app'}
                            </button>
                            {showPhone && <div className="mt-5"><EventAppPreview event={previewEvent} venue={previewVenue} pageTheme="light" /></div>}
                        </div>
                    )}

                    {error && <div className="text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}

                    <div className="flex flex-wrap items-center gap-3">
                        {step > 0 && (
                            <button type="button" onClick={() => go(step - 1)} className={BTN_GHOST} disabled={!!saving}>
                                <ArrowLeft size={13} /> Back
                            </button>
                        )}
                        {step < last && (
                            <button type="button" onClick={() => go(step + 1)} disabled={!!problem || !!uploading || !!saving} className={BTN_GOLD}>
                                Next: {STEPS[step + 1].title} <ArrowRight size={14} />
                            </button>
                        )}
                        {step < last && id && (
                            <button type="button" onClick={() => save(false)} disabled={!!uploading || !!saving} className={BTN_GHOST}>
                                {saving === 'save' ? 'Saving…' : 'Save changes'}
                            </button>
                        )}
                        {step === last && (
                            <>
                                <button type="button" onClick={() => save(false)} disabled={!!uploading || !!saving}
                                    className={id && !isDraft ? BTN_GOLD : BTN_GHOST}>
                                    {saving === 'save' ? 'Saving…' : id ? 'Save changes' : 'Save as a draft'}
                                </button>
                                {isDraft && (canPublish ? (
                                    <button type="button" onClick={() => save(true)} disabled={!!uploading || !!saving} className={BTN_GOLD}>
                                        {saving === 'publish' ? 'Working…' : trusted ? 'Publish' : 'Send to POWR'}
                                    </button>
                                ) : (
                                    <Link to="/venue/package" className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">Publishing needs Clash+</Link>
                                ))}
                            </>
                        )}
                        {problem && step < last && <span className="text-[11px] font-bold text-[#B45309]">{problem}</span>}
                        {uploading > 0 && <span className="text-[11px] font-bold text-[#888]">Uploading…</span>}
                    </div>
                    {step === last && isDraft && canPublish && (
                        <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-2xl">
                            {trusted
                                ? 'Publishing puts it in front of your members straight away.'
                                : 'Your first event gets a quick check from POWR before it goes out, usually within a day.'}
                        </p>
                    )}
                </div>
                {previewEvent && step > 0 && (
                    <div className="hidden xl:block xl:sticky xl:top-6">
                        <EventAppPreview event={previewEvent} venue={previewVenue} pageTheme="light" width={280} />
                    </div>
                )}
            </div>
        </Page>
    );
}
