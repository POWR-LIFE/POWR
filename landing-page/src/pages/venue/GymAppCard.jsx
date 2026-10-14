import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { ArrowDown, ArrowRight, ArrowUp, Camera, Check, ChevronLeft, ChevronRight, Eye, EyeOff, MapPin, Plus, Smartphone, Star, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../../App';
import { Card, Micro, Spinner, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import GymAppPreview from '../../components/GymAppPreview';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import { deleteGymTeamMember, fetchGymPlace, orderGymTeam, saveGymTeamMember, updateGymProfile } from './venueApi';
import { serverErrorText } from '../../lib/serverErrors';

// Your gym in the app: the page a member gets when they tap the gym's pin on
// Discover, drawn on a phone (GymAppPreview), with everything on it a tap
// away from changing. The cover, the logo, the name and address, the hours,
// the about, and the team: trainers, coaches and staff, each with a photo,
// what they do and a booking link, so a member can book them from the app.
// Changes show on the phone as they're typed and reach members on Save.
// Owners change things, and so can POWR admins previewing a gym (the server
// allows them and audits it as 'admin'), under a banner saying so. Staff look.
//
// Words: the editor is the gym's, so it follows the portal's language. The
// phone (GymAppPreview) is what members see and stays English for now. The
// role and specialty suggestions fill in text the gym could have typed, so
// they go in (and are stored) in the gym's language, like anything typed.

// Day keys are what's stored in opening_hours; the second item is the label's key.
const DAYS = [['mon', 'venueSettings:days.mon'], ['tue', 'venueSettings:days.tue'], ['wed', 'venueSettings:days.wed'], ['thu', 'venueSettings:days.thu'], ['fri', 'venueSettings:days.fri'], ['sat', 'venueSettings:days.sat'], ['sun', 'venueSettings:days.sun']];
const BG = { dark: '#141414', black: '#000000', white: '#FFFFFF' };
const BG_LABEL = { dark: 'venueSettings:logoBg.dark', black: 'venueSettings:logoBg.black', white: 'venueSettings:logoBg.white' };
// Suggestions, as keys: the first is also a new person's role.
const ROLES = ['venueSettings:app.roles.personalTrainer', 'venueSettings:app.roles.coach', 'venueSettings:app.roles.classInstructor', 'venueSettings:app.roles.physio', 'venueSettings:app.roles.nutritionist', 'venueSettings:app.roles.manager'];
const SPECIALTIES = [
    'venueSettings:app.specialtyTags.strength', 'venueSettings:app.specialtyTags.weightLoss', 'venueSettings:app.specialtyTags.muscle',
    'venueSettings:app.specialtyTags.mobility', 'venueSettings:app.specialtyTags.hiit', 'venueSettings:app.specialtyTags.hyrox',
    'venueSettings:app.specialtyTags.boxing', 'venueSettings:app.specialtyTags.rehab', 'venueSettings:app.specialtyTags.nutrition',
    'venueSettings:app.specialtyTags.natal', 'venueSettings:app.specialtyTags.yoga', 'venueSettings:app.specialtyTags.pilates',
];
const MAX_TEAM = 40;
const MAX_IMAGE_MB = 15;

const hoursFrom = (h) => Object.fromEntries(DAYS.map(([k]) => [k, h?.[k] ? { open: h[k].open, close: h[k].close } : null]));
const hasHours = (h) => !!h && DAYS.some(([k]) => !!h[k]);
// role: ROLES[0] in the portal's language, filled in where it's used (blankMember).
const BLANK_MEMBER = { name: '', role: '', experience: '', specialties: [], bio: '', booking_url: '', profile_url: '', photo_url: null, active: true };
const fieldsOf = (m) => ({
    name: m?.name ?? '', role: m?.role ?? '', experience: m?.experience ?? '', specialties: m?.specialties ?? [],
    bio: m?.bio ?? '', booking_url: m?.booking_url ?? '', profile_url: m?.profile_url ?? '', photo_url: m?.photo_url ?? null, active: m?.active !== false,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstName = (n) => (n || '').trim().split(/\s+/)[0];

// The checklist: what a finished page has. Done means members see it now.
// label and hint are keys.
const ITEMS = [
    { id: 'cover', label: 'venueSettings:app.items.cover', hint: 'venueSettings:app.items.coverHint', done: (p) => !!p.image_url },
    { id: 'logo', label: 'venueSettings:fields.logo', hint: 'venueSettings:app.items.logoHint', done: (p) => !!p.logo_url },
    { id: 'name', label: 'venueSettings:app.items.name', hint: 'venueSettings:app.items.nameHint', done: (p) => !!p.name && !!p.address },
    { id: 'hours', label: 'venueSettings:fields.openingHours', hint: 'venueSettings:app.items.hoursHint', done: (p) => hasHours(p.opening_hours) },
    { id: 'about', label: 'venueSettings:fields.about', hint: 'venueSettings:app.items.aboutHint', done: (p) => !!p.description },
    { id: 'team', label: 'venueSettings:app.items.team', hint: 'venueSettings:app.items.teamHint', done: (p, n) => n > 0 },
];
const itemOf = (sel) => (sel?.startsWith('member:') ? 'team' : sel);

function Saved({ on }) {
    const { t } = useTranslation();
    return on ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B7A57]"><Check size={12} /> {t('venueSettings:app.savedLive')}</span> : null;
}

function UploadButton({ label, busy, disabled, onFile, primary = false }) {
    const { t } = useTranslation();
    const ref = useRef(null);
    return (
        <>
            <button type="button" onClick={() => ref.current?.click()} disabled={busy || disabled}
                className={primary ? `${BTN_GOLD} h-11 px-6` : `${BTN_GHOST} h-10`}>
                <Upload size={13} /> {busy ? t('venueSettings:status.uploading') : label}
            </button>
            <input ref={ref} type="file" accept="image/*" className="hidden" aria-label={label}
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </>
    );
}

/**
 * Someone's photo: the circle is the button (tap to add or change), so the
 * column never has to hold anything wider than the photo itself.
 */
function PhotoPicker({ url, busy, canEdit, onFile, onRemove }) {
    const { t } = useTranslation();
    const ref = useRef(null);
    const label = url ? t('venueSettings:app.photo.change') : t('venueSettings:app.photo.add');
    return (
        <div className="w-28 flex flex-col items-center gap-2">
            <button type="button" onClick={() => ref.current?.click()} disabled={!canEdit || busy} aria-label={label} title={canEdit ? label : undefined}
                className="group relative w-28 h-28 rounded-full overflow-hidden border-2 border-[#E8D200] bg-[#F4F4F1] flex items-center justify-center enabled:hover:border-[#8a7600] transition-colors disabled:cursor-default">
                {url && <img src={storageImage(url, 300)} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                {!url && (
                    <span className="flex flex-col items-center gap-1.5 text-[#AAAAAA] group-enabled:group-hover:text-[#8a7600]">
                        <Camera size={18} />
                        <span className="text-[9px] uppercase tracking-[0.18em] font-black">{busy ? t('venueSettings:status.uploading') : canEdit ? t('venueSettings:app.photo.add') : t('venueSettings:app.photo.none')}</span>
                    </span>
                )}
                {url && canEdit && (
                    <span className={`absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1 text-white transition-opacity ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <Camera size={16} />
                        <span className="text-[9px] uppercase tracking-[0.18em] font-black">{busy ? t('venueSettings:status.uploading') : t('venueSettings:app.photo.changeShort')}</span>
                    </span>
                )}
            </button>
            {canEdit && url && !busy && (
                <button type="button" onClick={onRemove} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-red-600">{t('venueSettings:status.remove')}</button>
            )}
            <input ref={ref} type="file" accept="image/*" className="hidden" aria-label={label}
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
    );
}

function EditorHead({ title, children, onBack }) {
    const { t } = useTranslation();
    return (
        <div className="mb-5">
            {onBack && (
                <button type="button" onClick={onBack} className="inline-flex items-center gap-1 mb-3 text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">
                    <ChevronLeft size={12} /> {t('venueSettings:app.items.team')}
                </button>
            )}
            <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{title}</div>
            {children && <p className="text-[12px] text-[#888] leading-relaxed mt-1.5 max-w-lg">{children}</p>}
        </div>
    );
}

function SaveRow({ canEdit, dirty, busy, saved, onSave, onUndo, label }) {
    const { t } = useTranslation();
    if (!canEdit) return null;
    return (
        <div className="flex flex-wrap items-center gap-4 mt-5">
            <button type="button" onClick={onSave} disabled={!dirty || busy} className={BTN_GOLD}>{busy ? t('venueSettings:status.saving') : (label ?? t('common:actions.save'))}</button>
            {dirty && !busy && <button type="button" onClick={onUndo} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">{t('venueSettings:status.undo')}</button>}
            <Saved on={saved && !dirty} />
        </div>
    );
}

// ── The specialties: type and press Enter, or tap a suggestion ──────────────
function Specialties({ value, onChange, disabled }) {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const add = (raw) => {
        const s = raw.trim().replace(/,$/, '').trim();
        if (!s || s.length > 24 || value.length >= 6 || value.some((v) => v.toLowerCase() === s.toLowerCase())) return;
        onChange([...value, s]);
        setText('');
    };
    const left = SPECIALTIES.map((k) => t(k)).filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    return (
        <div>
            <div className={`${INPUT} h-auto min-h-12 py-2 px-3 flex flex-wrap items-center gap-1.5`}>
                {value.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 h-7 pl-3 pr-1.5 rounded-full bg-[#FBF8E1] border border-[#E8D200]/50 text-[12px] font-bold text-[#6b5c00]">
                        {s}
                        {!disabled && <button type="button" onClick={() => onChange(value.filter((v) => v !== s))} aria-label={t('venueSettings:app.specialties.remove', { name: s })} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-[#E8D200]/30"><X size={11} /></button>}
                    </span>
                ))}
                {value.length < 6 && !disabled && (
                    <input value={text} onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); add(text); }
                            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
                        }}
                        onBlur={() => text && add(text)}
                        maxLength={24} placeholder={value.length ? t('venueSettings:app.specialties.addAnother') : t('venueSettings:app.specialties.typeOne')} aria-label={t('venueSettings:app.specialties.aria')}
                        className="flex-1 min-w-[120px] h-8 bg-transparent outline-none text-[14px] sm:text-sm text-[#1A1A1A] placeholder-[#CCCCCC] px-1" />
                )}
            </div>
            {!disabled && value.length < 6 && left.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {left.slice(0, 8).map((s) => (
                        <button key={s} type="button" onClick={() => add(s)} className="h-7 px-3 rounded-full border border-dashed border-[#DDDDD6] text-[11px] font-bold text-[#888] hover:border-[#E8D200] hover:text-[#1A1A1A]">+ {s}</button>
                    ))}
                </div>
            )}
            <p className="text-[11px] text-[#AAAAAA] mt-2">{t('venueSettings:app.specialties.hint')}</p>
        </div>
    );
}

// ── The page ─────────────────────────────────────────────────────────────────

/**
 * @param profile   gym_profile, shared with the Overview (its moves read it)
 * @param onProfile the Overview's setter, so a save shows everywhere at once
 * @param team      gym_team ({ members, can_edit }), or { failed } if it didn't load
 * @param onTeam    the Overview's setter
 * @param focus     a part to open on arrival (/venue#app-team, #app-cover…)
 */
export default function GymAppCard({ gym, profile, onProfile, team, onTeam, focus }) {
    const { t } = useTranslation();
    const { isActingGym, refreshGymMemberships } = useAuth();
    const pid = gym.partner_id;
    const [place, setPlace] = useState(null);
    const [selected, setSelected] = useState(null);
    const [draft, setDraft] = useState({});              // unsaved profile fields
    const [member, setMember] = useState(null);           // { id: 'new' | uuid, fields } being edited
    const [busy, setBusy] = useState(null);
    const [saved, setSaved] = useState(null);
    const [error, setError] = useState(null);
    const editorRef = useRef(null);

    useEffect(() => {
        let alive = true;
        fetchGymPlace(pid).then((p) => { if (alive) setPlace(p); }).catch(() => {});
        return () => { alive = false; };
    }, [pid]);

    const ready = !!profile && !!profile.id && team != null;
    // gym_profile's can_edit: an owner, or a POWR admin (previewing any gym).
    const canEdit = !!profile?.can_edit;
    const members = useMemo(() => team?.members ?? [], [team]);
    const liveCount = members.filter((m) => m.active).length;

    // Open on the first thing still missing, or the team when it's all there.
    useEffect(() => {
        if (!ready || selected) return;
        const missing = ITEMS.find((i) => !i.done(profile, liveCount));
        setSelected(missing ? missing.id : 'team');
    }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

    const blankMember = useMemo(() => ({ ...BLANK_MEMBER, role: t(ROLES[0]) }), [t]);
    const original = member ? (member.id === 'new' ? blankMember : fieldsOf(members.find((m) => m.id === member.id))) : null;
    const memberDirty = !!member && !same(member.fields, original);
    const view = useMemo(() => ({ ...(profile ?? {}), area: place?.area, ...draft }), [profile, place, draft]);
    const teamView = useMemo(() => {
        if (!member) return members;
        if (member.id === 'new') return [...members, { id: 'new', ...member.fields }];
        return members.map((m) => (m.id === member.id ? { ...m, ...member.fields } : m));
    }, [members, member]);

    const dirty = {
        name: ['name', 'address'].some((k) => k in draft && (draft[k] ?? '') !== (profile?.[k] ?? '')),
        about: 'description' in draft && (draft.description ?? '') !== (profile?.description ?? ''),
        hours: 'opening_hours' in draft && !same(draft.opening_hours, hoursFrom(profile?.opening_hours)),
        team: memberDirty,
    };
    const anyDirty = Object.values(dirty).some(Boolean);
    useEffect(() => {
        if (!anyDirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [anyDirty]);

    const select = (id) => {
        if (!id || id === selected) return;
        const first = firstName(member?.fields.name);
        if (memberDirty && `member:${member.id}` !== id && !window.confirm(first ? t('venueSettings:app.member.confirmLeaveNamed', { name: first }) : t('venueSettings:app.member.confirmLeave'))) return;
        setError(null);
        if (id.startsWith('member:')) {
            const mid = id.slice(7);
            if (mid === 'new' && members.length >= MAX_TEAM) { setError(t('venueSettings:app.member.full', { max: MAX_TEAM })); return; }
            setMember({ id: mid, fields: mid === 'new' ? { ...blankMember } : fieldsOf(members.find((m) => m.id === mid)) });
        } else {
            setMember(null);
        }
        setSelected(id);
        // Stacked on a narrow screen, the editor sits under the phone: bring it up.
        if (window.innerWidth < 1024) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    };

    // Arriving from a move (/venue#app-team): open that part.
    useEffect(() => {
        if (!ready || !focus) return;
        select(focus === 'team' && !liveCount && canEdit ? 'member:new' : focus);
    }, [focus, ready]); // eslint-disable-line react-hooks/exhaustive-deps

    const flash = (what) => {
        setSaved(what);
        setTimeout(() => setSaved((s) => (s === what ? null : s)), 3000);
    };
    const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const undo = (...keys) => setDraft((d) => { const n = { ...d }; keys.forEach((k) => delete n[k]); return n; });

    const saveProfile = async (what, patch) => {
        setBusy(what);
        setError(null);
        try {
            const p = await updateGymProfile(pid, patch);
            onProfile(p);
            undo(...Object.keys(patch));
            flash(what);
            if ('name' in patch || 'logo_url' in patch || 'logo_bg' in patch) refreshGymMemberships?.();
        } catch (e) { setError(serverErrorText(e, t('venueSettings:errors.didntSave'))); }
        finally { setBusy(null); }
    };
    const uploadImage = async (what, file, folder) => {
        if (!file) return null;
        if (!file.type?.startsWith('image/')) { setError(t('venueSettings:app.upload.notImage')); return null; }
        if (file.size > MAX_IMAGE_MB * 1024 * 1024) { setError(t('venueSettings:app.upload.tooBig', { mb: MAX_IMAGE_MB })); return null; }
        setBusy(what);
        setError(null);
        try { return await uploadPublicImage('reward-images', file, `gym-events/${pid}/${folder}`); }
        catch (e) { setError(serverErrorText(e, t('venueSettings:errors.uploadFailed'))); return null; }
        finally { setBusy(null); }
    };
    const uploadProfileImage = async (what, field, file) => {
        const url = await uploadImage(what, file, 'brand');
        if (url) await saveProfile(what, { [field]: url });
    };

    // ── The team ──
    const teamCall = async (what, fn) => {
        setBusy(what);
        setError(null);
        try { const next = await fn(); onTeam(next); return next; }
        catch (e) { setError(serverErrorText(e, t('venueSettings:errors.didntSave'))); return null; }
        finally { setBusy(null); }
    };
    const saveMember = async () => {
        const isNew = member.id === 'new';
        const clean = (v) => (typeof v === 'string' ? v.trim() : v);
        // A new person sends what's filled in; someone already there, what changed.
        const out = {};
        for (const k of Object.keys(BLANK_MEMBER)) {
            const v = clean(member.fields[k]);
            if (isNew ? k === 'active' || (Array.isArray(v) ? v.length > 0 : !!v) : !same(v, clean(original[k]))) out[k] = v;
        }
        const next = await teamCall('member', () => saveGymTeamMember(pid, isNew ? null : member.id, out));
        if (!next) return;
        const id = next.saved_id ?? member.id;
        setMember({ id, fields: fieldsOf(next.members.find((m) => m.id === id)) });
        setSelected(`member:${id}`);
        flash('member');
    };
    const removeMember = async (m) => {
        if (!window.confirm(t('venueSettings:app.member.confirmRemove', { name: m.name }))) return;
        const next = await teamCall(`remove:${m.id}`, () => deleteGymTeamMember(pid, m.id));
        if (next && member?.id === m.id) { setMember(null); setSelected('team'); }
    };
    const toggleMember = (m) => teamCall(`toggle:${m.id}`, () => saveGymTeamMember(pid, m.id, { active: !m.active }));
    const moveMember = (i, dir) => {
        const ids = members.map((m) => m.id);
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        teamCall('order', () => orderGymTeam(pid, ids));
    };
    const setMemberField = (k, v) => setMember((m) => ({ ...m, fields: { ...m.fields, [k]: v } }));

    if (profile && !profile.id) {
        return (
            <div id="app" className="scroll-mt-6">
                <Card className="p-6">
                    <div className="flex items-center gap-2.5 mb-3"><Smartphone size={14} className="text-[#8a7600]" /><Micro>{t('venueSettings:app.title')}</Micro></div>
                    <p className="text-[13px] text-[#888]">{t('venueSettings:app.notLoading')}</p>
                </Card>
            </div>
        );
    }
    if (!ready) return <div id="app"><Card className="p-6"><Spinner className="py-16" /></Card></div>;

    const done = ITEMS.filter((i) => i.done(profile, liveCount)).length;
    const current = itemOf(selected);
    const expandedId = selected?.startsWith('member:') ? selected.slice(7) : null;
    const readOnlyNote = !canEdit && (
        <p className="text-[12px] text-[#888] bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl px-4 py-3 mb-5">
            {t('venueSettings:app.readOnly')}
        </p>
    );

    // ── The editor for whatever's selected ──
    let editor;
    if (current === 'cover') {
        editor = (
            <>
                <EditorHead title={t('venueSettings:app.items.cover')}>{t('venueSettings:app.cover.body')}</EditorHead>
                {readOnlyNote}
                <div className="rounded-2xl overflow-hidden border border-[#E6E6E1] aspect-[16/9] max-w-md bg-[#F4F4F1] flex items-center justify-center">
                    {view.image_url ? <img src={storageImage(view.image_url, 900)} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{busy === 'cover' ? t('venueSettings:status.uploading') : t('venueSettings:app.cover.none')}</span>}
                </div>
                {canEdit && (
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                        <UploadButton primary={!view.image_url} label={view.image_url ? t('venueSettings:status.replace') : t('venueSettings:app.cover.upload')} busy={busy === 'cover'} onFile={(f) => uploadProfileImage('cover', 'image_url', f)} />
                        {view.image_url && <button type="button" onClick={() => saveProfile('cover', { image_url: null })} disabled={!!busy} className={`${BTN_GHOST} h-10`}><Trash2 size={13} /> {t('venueSettings:status.remove')}</button>}
                        <Saved on={saved === 'cover'} />
                    </div>
                )}
                <p className="text-[11px] text-[#AAAAAA] mt-3">{t('venueSettings:app.cover.studio')}</p>
            </>
        );
    } else if (current === 'logo') {
        editor = (
            <>
                <EditorHead title={t('venueSettings:fields.logo')}>{t('venueSettings:app.logo.body')}</EditorHead>
                {readOnlyNote}
                <div className="flex flex-wrap items-start gap-6">
                    <div className="w-36 h-36 rounded-2xl border border-[#E6E6E1] flex items-center justify-center shrink-0" style={{ background: BG[view.logo_bg] ?? BG.dark }}>
                        {view.logo_url ? <img src={storageImage(view.logo_url, 400)} alt="" className="max-w-[72%] max-h-[72%] object-contain" /> : <span className="text-[10px] uppercase tracking-[0.25em] font-black" style={{ color: view.logo_bg === 'white' ? '#BBBBBB' : 'rgba(255,255,255,0.35)' }}>{busy === 'logo' ? t('venueSettings:status.uploading') : t('venueSettings:app.logo.none')}</span>}
                    </div>
                    <div className="min-w-0">
                        {canEdit && (
                            <div className="flex flex-wrap gap-2">
                                <UploadButton primary={!view.logo_url} label={view.logo_url ? t('venueSettings:status.replace') : t('venueSettings:app.logo.upload')} busy={busy === 'logo'} onFile={(f) => uploadProfileImage('logo', 'logo_url', f)} />
                                {view.logo_url && <button type="button" onClick={() => saveProfile('logo', { logo_url: null })} disabled={!!busy} className={`${BTN_GHOST} h-10`}><Trash2 size={13} /> {t('venueSettings:status.remove')}</button>}
                            </div>
                        )}
                        <label className={`${LABEL} mt-5`}>{t('venueSettings:app.logo.madeFor')}</label>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('venueSettings:logoBg.label')}>
                            {Object.keys(BG).map((k) => (
                                <button key={k} type="button" role="radio" aria-checked={view.logo_bg === k} disabled={!canEdit || !!busy} onClick={() => view.logo_bg !== k && saveProfile('logo', { logo_bg: k })}
                                    className={`h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-all ${view.logo_bg === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>
                                    {t(BG_LABEL[k])}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-[#AAAAAA] mt-2">{t('venueSettings:app.logo.bgHint')}</p>
                        <div className="mt-2"><Saved on={saved === 'logo'} /></div>
                    </div>
                </div>
            </>
        );
    } else if (current === 'name') {
        editor = (
            <>
                <EditorHead title={t('venueSettings:app.items.name')}>{t('venueSettings:app.name.body')}</EditorHead>
                {readOnlyNote}
                <div className="grid grid-cols-1 gap-4 max-w-lg">
                    <div><label className={LABEL} htmlFor="gap-name">{t('venueSettings:fields.gymName')}</label><input id="gap-name" className={INPUT} value={view.name ?? ''} onChange={(e) => setField('name', e.target.value)} disabled={!canEdit} maxLength={60} /></div>
                    <div><label className={LABEL} htmlFor="gap-address">{t('venueSettings:fields.address')}</label><input id="gap-address" className={INPUT} value={view.address ?? ''} onChange={(e) => setField('address', e.target.value)} disabled={!canEdit} maxLength={200} placeholder={t('venueSettings:app.name.addressPlaceholder')} /></div>
                </div>
                <SaveRow canEdit={canEdit} dirty={dirty.name} busy={busy === 'name'} saved={saved === 'name'} onUndo={() => undo('name', 'address')}
                    onSave={() => saveProfile('name', Object.fromEntries(['name', 'address'].filter((k) => k in draft).map((k) => [k, (draft[k] ?? '').trim()])))} />
            </>
        );
    } else if (current === 'hours') {
        const hours = draft.opening_hours ?? hoursFrom(profile.opening_hours);
        const setDay = (k, next) => setField('opening_hours', { ...hours, [k]: next });
        editor = (
            <>
                <EditorHead title={t('venueSettings:fields.openingHours')}>{t('venueSettings:app.hours.body')}</EditorHead>
                {readOnlyNote}
                <div className="divide-y divide-[#F0F0EC] max-w-lg">
                    {DAYS.map(([k, labelKey]) => {
                        const label = t(labelKey);
                        const d = hours[k];
                        return (
                            <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                                <label className="inline-flex items-center gap-3 w-32 text-[13px] text-[#1A1A1A]">
                                    <input type="checkbox" checked={!!d} disabled={!canEdit} onChange={(e) => setDay(k, e.target.checked ? { open: '06:00', close: '22:00' } : null)} className="accent-[#E8D200]" />
                                    {label}
                                </label>
                                {d ? (
                                    <div className="flex items-center gap-2 text-[12px] text-[#666]">
                                        <input type="time" value={d.open} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, open: e.target.value })} className={`${INPUT} h-10 w-28 px-3`} aria-label={t('venueSettings:hours.opens', { day: label })} />
                                        <span>{t('venueSettings:hours.to')}</span>
                                        <input type="time" value={d.close} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, close: e.target.value })} className={`${INPUT} h-10 w-28 px-3`} aria-label={t('venueSettings:hours.closes', { day: label })} />
                                    </div>
                                ) : <span className="text-[12px] text-[#AAAAAA]">{t('venueSettings:hours.closed')}</span>}
                            </div>
                        );
                    })}
                </div>
                {canEdit && hours.mon && (
                    <button type="button" onClick={() => setField('opening_hours', Object.fromEntries(DAYS.map(([k]) => [k, { ...hours.mon }])))}
                        className="mt-3 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600] hover:text-[#1A1A1A]">{t('venueSettings:app.hours.sameAsMonday')}</button>
                )}
                <SaveRow canEdit={canEdit} dirty={dirty.hours} busy={busy === 'hours'} saved={saved === 'hours'} onUndo={() => undo('opening_hours')}
                    onSave={() => saveProfile('hours', { opening_hours: hours })} label={t('venueSettings:hours.save')} />
            </>
        );
    } else if (current === 'about') {
        const text = view.description ?? '';
        editor = (
            <>
                <EditorHead title={t('venueSettings:fields.about')}>{t('venueSettings:app.about.body')}</EditorHead>
                {readOnlyNote}
                <div className="max-w-lg">
                    <textarea className={`${INPUT} h-auto py-3 min-h-[120px] resize-y`} value={text} onChange={(e) => setField('description', e.target.value)} disabled={!canEdit} maxLength={400} rows={4}
                        placeholder={t('venueSettings:app.about.placeholder')} aria-label={t('venueSettings:app.about.aria')} />
                    <div className="text-right text-[11px] text-[#AAAAAA] mt-1 tabular-nums">{text.length}/400</div>
                </div>
                <SaveRow canEdit={canEdit} dirty={dirty.about} busy={busy === 'about'} saved={saved === 'about'} onUndo={() => undo('description')}
                    onSave={() => saveProfile('about', { description: text.trim() })} />
            </>
        );
    } else if (current === 'pin') {
        editor = (
            <>
                <EditorHead title={t('venueSettings:app.pin.title')}>{t('venueSettings:app.pin.body')}</EditorHead>
                <div className="flex items-start gap-3 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] p-4 max-w-lg">
                    <MapPin size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <div className="min-w-0 text-[13px] text-[#1A1A1A]">
                        <div className="font-bold">{view.address || t('venueSettings:app.pin.noAddress')}</div>
                        <p className="text-[12px] text-[#888] mt-1 leading-relaxed">{t('venueSettings:app.pin.wrongPlace')}</p>
                    </div>
                </div>
                <Link to="/venue/settings#help" className={`${BTN_GHOST} h-10 mt-4`}>{t('venueSettings:app.pin.ask')} <ArrowRight size={12} /></Link>
            </>
        );
    } else if (current === 'home') {
        editor = (
            <>
                <EditorHead title={t('venueSettings:app.home.title')}>{t('venueSettings:app.home.body')}</EditorHead>
                <div className="flex items-start gap-3 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] p-4 max-w-lg">
                    <Star size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <p className="text-[12px] text-[#666] leading-relaxed">{t('venueSettings:app.home.detail')}</p>
                </div>
                <Link to="/venue/poster" className={`${BTN_GHOST} h-10 mt-4`}>{t('venueSettings:app.home.joinLink')} <ArrowRight size={12} /></Link>
            </>
        );
    } else if (selected?.startsWith('member:') && member) {
        const f = member.fields;
        const isNew = member.id === 'new';
        const saved_ = members.find((m) => m.id === member.id);
        editor = (
            <>
                <EditorHead title={isNew ? t('venueSettings:app.member.addTitle') : f.name || t('venueSettings:app.member.detailsTitle')} onBack={() => select('team')}>
                    {isNew ? t('venueSettings:app.member.addIntro') : t('venueSettings:app.member.editIntro')}
                </EditorHead>
                {readOnlyNote}
                <div className="grid grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)] gap-x-6 gap-y-5">
                    <PhotoPicker url={f.photo_url} busy={busy === 'photo'} canEdit={canEdit}
                        onFile={async (file) => { const url = await uploadImage('photo', file, 'team'); if (url) setMemberField('photo_url', url); }}
                        onRemove={() => setMemberField('photo_url', null)} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                        <div><label className={LABEL} htmlFor="gap-m-name">{t('venueSettings:app.member.name')}</label><input id="gap-m-name" className={INPUT} value={f.name} onChange={(e) => setMemberField('name', e.target.value)} disabled={!canEdit} maxLength={60} placeholder={t('venueSettings:app.member.namePlaceholder')} /></div>
                        <div><label className={LABEL} htmlFor="gap-m-exp">{t('venueSettings:app.member.experience')}</label><input id="gap-m-exp" className={INPUT} value={f.experience} onChange={(e) => setMemberField('experience', e.target.value)} disabled={!canEdit} maxLength={40} placeholder={t('venueSettings:app.member.experiencePlaceholder')} /></div>
                        <div className="sm:col-span-2">
                            <label className={LABEL} htmlFor="gap-m-role">{t('venueSettings:app.member.role')}</label>
                            <input id="gap-m-role" className={INPUT} value={f.role} onChange={(e) => setMemberField('role', e.target.value)} disabled={!canEdit} maxLength={30} placeholder={t(ROLES[0])} />
                            {canEdit && (
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {ROLES.map((k) => t(k)).map((r) => (
                                        <button key={r} type="button" onClick={() => setMemberField('role', r)}
                                            className={`h-7 px-3 rounded-full border text-[11px] font-bold transition-all ${f.role.trim().toLowerCase() === r.toLowerCase() ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>{r}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-5">
                    <div><label className={LABEL}>{t('venueSettings:app.member.specialties')}</label><Specialties value={f.specialties} onChange={(v) => setMemberField('specialties', v)} disabled={!canEdit} /></div>
                    <div>
                        <label className={LABEL} htmlFor="gap-m-bio">{t('venueSettings:app.member.bio')}</label>
                        <textarea id="gap-m-bio" className={`${INPUT} h-auto py-3 min-h-[100px] resize-y`} value={f.bio} onChange={(e) => setMemberField('bio', e.target.value)} disabled={!canEdit} maxLength={500} rows={3}
                            placeholder={t('venueSettings:app.member.bioPlaceholder')} />
                        <div className="text-right text-[11px] text-[#AAAAAA] mt-1 tabular-nums">{f.bio.length}/500</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={LABEL} htmlFor="gap-m-book">{t('venueSettings:app.member.booking')}</label>
                            <input id="gap-m-book" className={INPUT} value={f.booking_url} onChange={(e) => setMemberField('booking_url', e.target.value)} disabled={!canEdit} maxLength={300} inputMode="url" placeholder={t('venueSettings:app.member.bookingPlaceholder')} />
                            <p className="text-[11px] text-[#AAAAAA] mt-2"><Trans i18nKey="venueSettings:app.member.bookingHint" components={{ strong: <b className="text-[#888]" /> }} /></p>
                        </div>
                        <div>
                            <label className={LABEL} htmlFor="gap-m-profile">{t('venueSettings:app.member.profile')}</label>
                            <input id="gap-m-profile" className={INPUT} value={f.profile_url} onChange={(e) => setMemberField('profile_url', e.target.value)} disabled={!canEdit} maxLength={300} inputMode="url" placeholder={t('venueSettings:app.member.profilePlaceholder')} />
                            <p className="text-[11px] text-[#AAAAAA] mt-2"><Trans i18nKey="venueSettings:app.member.profileHint" components={{ strong: <b className="text-[#888]" /> }} /></p>
                        </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer max-w-lg">
                        <input type="checkbox" className="accent-[#E8D200] w-4 h-4 mt-0.5 shrink-0" checked={f.active} disabled={!canEdit} onChange={(e) => setMemberField('active', e.target.checked)} />
                        <span>
                            <span className="block text-[13px] font-bold text-[#1A1A1A]">{t('venueSettings:app.member.show')}</span>
                            <span className="block text-[12px] text-[#888] leading-relaxed mt-0.5">{t('venueSettings:app.member.showHint')}</span>
                        </span>
                    </label>
                </div>
                {canEdit && (
                    <div className="flex flex-wrap items-center gap-4 mt-6">
                        <button type="button" onClick={saveMember} disabled={!memberDirty || busy === 'member' || busy === 'photo' || f.name.trim().length < 2} className={BTN_GOLD}>
                            {busy === 'member' ? t('venueSettings:status.saving') : isNew ? t('venueSettings:app.member.add') : t('common:actions.save')}
                        </button>
                        {memberDirty && busy !== 'member' && !isNew && <button type="button" onClick={() => setMember({ id: member.id, fields: original })} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">{t('venueSettings:status.undo')}</button>}
                        <Saved on={saved === 'member' && !memberDirty} />
                        {saved === 'member' && !memberDirty && members.length < MAX_TEAM && (
                            <button type="button" onClick={() => select('member:new')} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600] hover:text-[#1A1A1A]"><Plus size={12} /> {t('venueSettings:app.member.addAnother')}</button>
                        )}
                        {!isNew && saved_ && (
                            <button type="button" onClick={() => removeMember(saved_)} disabled={!!busy} className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-red-600"><Trash2 size={12} /> {t('venueSettings:app.member.takeOff')}</button>
                        )}
                    </div>
                )}
            </>
        );
    } else {
        // The team, in the order members see them.
        editor = (
            <>
                <EditorHead title={t('venueSettings:app.items.team')}>{t('venueSettings:app.team.body')}</EditorHead>
                {readOnlyNote}
                {team?.failed ? (
                    <p className="text-[13px] text-[#888]">{t('venueSettings:app.team.notLoading')}</p>
                ) : members.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-[#E6E6E1] p-6 max-w-lg">
                        <div className="text-[15px] font-bold text-[#1A1A1A]">{t('venueSettings:app.team.emptyTitle')}</div>
                        <p className="text-[12px] text-[#888] leading-relaxed mt-1.5">{t('venueSettings:app.team.emptyBody')}</p>
                        {canEdit && <button type="button" onClick={() => select('member:new')} className={`${BTN_GOLD} mt-4`}><Plus size={14} /> {t('venueSettings:app.team.addFirst')}</button>}
                    </div>
                ) : (
                    <>
                        <ol className="divide-y divide-[#F0F0EC] border-y border-[#F0F0EC]">
                            {members.map((m, i) => (
                                <li key={m.id} className="flex items-center gap-3 py-2.5">
                                    <button type="button" onClick={() => select(`member:${m.id}`)} className="flex-1 min-w-0 flex items-center gap-3 text-left group">
                                        <span className={`w-10 h-10 rounded-full overflow-hidden border shrink-0 bg-[#F4F4F1] flex items-center justify-center ${m.active ? 'border-[#E8D200]/60' : 'border-[#E6E6E1] opacity-50'}`}>
                                            {m.photo_url ? <img src={storageImage(m.photo_url, 120)} alt="" className="w-full h-full object-cover" /> : <span className="text-[11px] font-black text-[#AAAAAA] uppercase">{m.name?.[0]}</span>}
                                        </span>
                                        <span className="min-w-0">
                                            <span className={`block text-[13px] font-bold truncate group-hover:text-[#8a7600] ${m.active ? 'text-[#1A1A1A]' : 'text-[#AAAAAA]'}`}>{m.name}</span>
                                            <span className="block text-[11px] text-[#888] truncate">
                                                {[m.role || t(ROLES[0]), m.experience].filter(Boolean).join(' · ')}
                                                {!m.active && <span className="ml-1.5 font-bold text-[#B45309]">{t('venueSettings:app.team.hidden')}</span>}
                                                {m.active && !m.booking_url && <span className="ml-1.5 text-[#AAAAAA]">· {t('venueSettings:app.team.noBookingLink')}</span>}
                                            </span>
                                        </span>
                                    </button>
                                    {canEdit && (
                                        <span className="flex items-center gap-0.5 shrink-0">
                                            <button type="button" onClick={() => moveMember(i, -1)} disabled={i === 0 || !!busy} aria-label={t('venueSettings:app.team.moveUp', { name: m.name })} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1] disabled:opacity-30 disabled:hover:bg-transparent"><ArrowUp size={14} /></button>
                                            <button type="button" onClick={() => moveMember(i, 1)} disabled={i === members.length - 1 || !!busy} aria-label={t('venueSettings:app.team.moveDown', { name: m.name })} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1] disabled:opacity-30 disabled:hover:bg-transparent"><ArrowDown size={14} /></button>
                                            <button type="button" onClick={() => toggleMember(m)} disabled={!!busy} aria-label={m.active ? t('venueSettings:app.team.hide', { name: m.name }) : t('venueSettings:app.team.show', { name: m.name })} title={m.active ? t('venueSettings:app.team.hideTitle') : t('venueSettings:app.team.showTitle')} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1]">{m.active ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                            <button type="button" onClick={() => removeMember(m)} disabled={!!busy} aria-label={t('venueSettings:app.team.takeOff', { name: m.name })} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                                        </span>
                                    )}
                                    <ChevronRight size={14} className="text-[#DDDDDD] shrink-0" />
                                </li>
                            ))}
                        </ol>
                        {canEdit && members.length < MAX_TEAM && (
                            <button type="button" onClick={() => select('member:new')} className={`${BTN_GHOST} h-10 mt-4`}><Plus size={13} /> {t('venueSettings:app.team.add')}</button>
                        )}
                    </>
                )}
            </>
        );
    }

    return (
        <div id="app" className="scroll-mt-6">
            <Card className="p-6 lg:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <div className="flex items-center gap-2.5 min-w-0"><Smartphone size={14} className="text-[#8a7600] shrink-0" /><Micro>{t('venueSettings:app.title')}</Micro></div>
                    <span className="text-[11px] font-bold text-[#AAAAAA]">{t('venueSettings:app.whatMembersSee')}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-8 lg:gap-10 items-start">
                    <div className="lg:sticky lg:top-4">
                        <GymAppPreview gym={view} team={teamView} selected={selected} expandedId={expandedId} onSelect={select} width={320} tz="Europe/London" />
                    </div>
                    <div className="min-w-0" ref={editorRef}>
                        {/* Ready for members: what a finished page has */}
                        <div className="flex items-baseline justify-between gap-3">
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{done}<span className="text-[#CCCCCC]">/{ITEMS.length}</span></span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{done === ITEMS.length ? t('venueSettings:app.complete') : t('venueSettings:app.ready')}</span>
                            </div>
                        </div>
                        <div className="mt-3 h-1.5 rounded-full bg-[#F4F4F1] overflow-hidden"><div className="h-full rounded-full bg-[#E8D200] transition-all" style={{ width: `${(done / ITEMS.length) * 100}%` }} /></div>
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {ITEMS.map((it) => {
                                const ok = it.done(profile, liveCount);
                                const on = current === it.id;
                                return (
                                    <button key={it.id} type="button" onClick={() => select(it.id === 'team' && !members.length && canEdit ? 'member:new' : it.id)} aria-pressed={on}
                                        className={`relative flex items-start gap-2.5 text-left rounded-xl border px-3 py-2.5 transition-all ${on ? 'bg-[#FBF8E1] border-[#E8D200]' : 'bg-white border-[#E6E6E1] hover:border-[#E8D200]/50'}`}>
                                        <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-[#0B7A57]' : 'border-2 border-[#DDDDD6]'}`}>{ok && <Check size={10} className="text-white" strokeWidth={3} />}</span>
                                        <span className="min-w-0">
                                            <span className="block text-[12px] font-bold text-[#1A1A1A] truncate">{it.id === 'team' && liveCount ? t('venueSettings:app.teamCount', { n: liveCount }) : t(it.label)}</span>
                                            <span className="block text-[10.5px] text-[#999] truncate">{t(it.hint)}</span>
                                        </span>
                                        {dirty[it.id] && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#B45309]" title={t('venueSettings:app.notSaved')} />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-6 pt-6 border-t border-[#F0F0EC]">
                            {/* POWR admins only: stays English */}
                            {isActingGym && canEdit && (
                                <div className="mb-5 flex items-start gap-2.5 text-[12px] text-[#6b5c00] bg-[#FBF8E1] border border-[#E8D200]/60 rounded-xl px-4 py-3">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#E8D200] shrink-0" />
                                    <span>You’re changing <b>{profile.name}</b>’s page as a POWR admin. Saves go live in the app straight away, and the gym can see them.</span>
                                </div>
                            )}
                            {error && <div className="mb-4 text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                            {editor}
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
