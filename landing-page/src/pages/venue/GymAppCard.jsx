import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Eye, EyeOff, MapPin, Plus, Smartphone, Star, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../../App';
import { Card, Micro, Spinner, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import GymAppPreview from '../../components/GymAppPreview';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import { deleteGymTeamMember, fetchGymPlace, orderGymTeam, saveGymTeamMember, updateGymProfile } from './venueApi';

// Your gym in the app: the page a member gets when they tap the gym's pin on
// Discover, drawn on a phone (GymAppPreview), with everything on it a tap
// away from changing. The cover, the logo, the name and address, the hours,
// the about, and the team: trainers, coaches and staff, each with a photo,
// what they do and a booking link, so a member can book them from the app.
// Changes show on the phone as they're typed and reach members on Save.
// Owners change things, and so can POWR admins previewing a gym (the server
// allows them and audits it as 'admin'), under a banner saying so. Staff look.

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const BG = { dark: '#141414', black: '#000000', white: '#FFFFFF' };
const BG_LABEL = { dark: 'On dark', black: 'On black', white: 'On white' };
const ROLES = ['Personal trainer', 'Coach', 'Class instructor', 'Physio', 'Nutritionist', 'Manager'];
const SPECIALTIES = ['Strength', 'Weight loss', 'Muscle building', 'Mobility', 'HIIT', 'Hyrox', 'Boxing', 'Rehab', 'Nutrition', 'Pre & postnatal', 'Yoga', 'Pilates'];
const MAX_TEAM = 40;
const MAX_IMAGE_MB = 15;

const hoursFrom = (h) => Object.fromEntries(DAYS.map(([k]) => [k, h?.[k] ? { open: h[k].open, close: h[k].close } : null]));
const hasHours = (h) => !!h && DAYS.some(([k]) => !!h[k]);
const BLANK_MEMBER = { name: '', role: 'Personal trainer', experience: '', specialties: [], bio: '', booking_url: '', profile_url: '', photo_url: null, active: true };
const fieldsOf = (m) => ({
    name: m?.name ?? '', role: m?.role ?? '', experience: m?.experience ?? '', specialties: m?.specialties ?? [],
    bio: m?.bio ?? '', booking_url: m?.booking_url ?? '', profile_url: m?.profile_url ?? '', photo_url: m?.photo_url ?? null, active: m?.active !== false,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'them';

// The checklist: what a finished page has. Done means members see it now.
const ITEMS = [
    { id: 'cover', label: 'Cover photo', hint: 'The first thing they see', done: (p) => !!p.image_url },
    { id: 'logo', label: 'Logo', hint: 'On your pin and your page', done: (p) => !!p.logo_url },
    { id: 'name', label: 'Name & address', hint: 'How members find you', done: (p) => !!p.name && !!p.address },
    { id: 'hours', label: 'Opening hours', hint: 'Open or closed, live', done: (p) => hasHours(p.opening_hours) },
    { id: 'about', label: 'About', hint: 'What it’s like here', done: (p) => !!p.description },
    { id: 'team', label: 'Your team', hint: 'Trainers members can book', done: (p, n) => n > 0 },
];
const itemOf = (sel) => (sel?.startsWith('member:') ? 'team' : sel);

function Saved({ on }) {
    return on ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B7A57]"><Check size={12} /> Saved. Members see it now.</span> : null;
}

function UploadButton({ label, busy, disabled, onFile, compact = false, primary = false }) {
    const ref = useRef(null);
    return (
        <>
            <button type="button" onClick={() => ref.current?.click()} disabled={busy || disabled}
                className={primary ? `${BTN_GOLD} h-11 px-6` : `${BTN_GHOST} h-10 ${compact ? 'px-4 gap-2 tracking-[0.12em] whitespace-nowrap' : ''}`}>
                <Upload size={13} /> {busy ? 'Uploading' : label}
            </button>
            <input ref={ref} type="file" accept="image/*" className="hidden" aria-label={label}
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </>
    );
}

function EditorHead({ title, children, onBack }) {
    return (
        <div className="mb-5">
            {onBack && (
                <button type="button" onClick={onBack} className="inline-flex items-center gap-1 mb-3 text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">
                    <ChevronLeft size={12} /> Your team
                </button>
            )}
            <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{title}</div>
            {children && <p className="text-[12px] text-[#888] leading-relaxed mt-1.5 max-w-lg">{children}</p>}
        </div>
    );
}

function SaveRow({ canEdit, dirty, busy, saved, onSave, onUndo, label = 'Save' }) {
    if (!canEdit) return null;
    return (
        <div className="flex flex-wrap items-center gap-4 mt-5">
            <button type="button" onClick={onSave} disabled={!dirty || busy} className={BTN_GOLD}>{busy ? 'Saving' : label}</button>
            {dirty && !busy && <button type="button" onClick={onUndo} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Undo</button>}
            <Saved on={saved && !dirty} />
        </div>
    );
}

// ── The specialties: type and press Enter, or tap a suggestion ──────────────
function Specialties({ value, onChange, disabled }) {
    const [text, setText] = useState('');
    const add = (raw) => {
        const s = raw.trim().replace(/,$/, '').trim();
        if (!s || s.length > 24 || value.length >= 6 || value.some((v) => v.toLowerCase() === s.toLowerCase())) return;
        onChange([...value, s]);
        setText('');
    };
    const left = SPECIALTIES.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    return (
        <div>
            <div className={`${INPUT} h-auto min-h-12 py-2 px-3 flex flex-wrap items-center gap-1.5`}>
                {value.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 h-7 pl-3 pr-1.5 rounded-full bg-[#FBF8E1] border border-[#E8D200]/50 text-[12px] font-bold text-[#6b5c00]">
                        {s}
                        {!disabled && <button type="button" onClick={() => onChange(value.filter((v) => v !== s))} aria-label={`Remove ${s}`} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-[#E8D200]/30"><X size={11} /></button>}
                    </span>
                ))}
                {value.length < 6 && !disabled && (
                    <input value={text} onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); add(text); }
                            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
                        }}
                        onBlur={() => text && add(text)}
                        maxLength={24} placeholder={value.length ? 'Add another' : 'Type one and press Enter'} aria-label="Add a specialty"
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
            <p className="text-[11px] text-[#AAAAAA] mt-2">Up to 6. They show as tags when a member opens their card.</p>
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

    const original = member ? (member.id === 'new' ? BLANK_MEMBER : fieldsOf(members.find((m) => m.id === member.id))) : null;
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
        if (memberDirty && `member:${member.id}` !== id && !window.confirm(`Leave ${member.fields.name ? `${firstName(member.fields.name)}’s` : 'these'} changes unsaved?`)) return;
        setError(null);
        if (id.startsWith('member:')) {
            const mid = id.slice(7);
            if (mid === 'new' && members.length >= MAX_TEAM) { setError(`That’s ${MAX_TEAM} people already. Take someone off first.`); return; }
            setMember({ id: mid, fields: mid === 'new' ? { ...BLANK_MEMBER } : fieldsOf(members.find((m) => m.id === mid)) });
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
        } catch (e) { setError(e.message || 'That didn’t save.'); }
        finally { setBusy(null); }
    };
    const uploadImage = async (what, file, folder) => {
        if (!file) return null;
        if (!file.type?.startsWith('image/')) { setError('That isn’t an image. Try a JPG or PNG.'); return null; }
        if (file.size > MAX_IMAGE_MB * 1024 * 1024) { setError(`That image is over ${MAX_IMAGE_MB} MB. Try a smaller one.`); return null; }
        setBusy(what);
        setError(null);
        try { return await uploadPublicImage('reward-images', file, `gym-events/${pid}/${folder}`); }
        catch (e) { setError(e.message || 'That upload failed.'); return null; }
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
        try { const t = await fn(); onTeam(t); return t; }
        catch (e) { setError(e.message || 'That didn’t save.'); return null; }
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
        const t = await teamCall('member', () => saveGymTeamMember(pid, isNew ? null : member.id, out));
        if (!t) return;
        const id = t.saved_id ?? member.id;
        setMember({ id, fields: fieldsOf(t.members.find((m) => m.id === id)) });
        setSelected(`member:${id}`);
        flash('member');
    };
    const removeMember = async (m) => {
        if (!window.confirm(`Take ${m.name} off your page in the app?`)) return;
        const t = await teamCall(`remove:${m.id}`, () => deleteGymTeamMember(pid, m.id));
        if (t && member?.id === m.id) { setMember(null); setSelected('team'); }
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
                    <div className="flex items-center gap-2.5 mb-3"><Smartphone size={14} className="text-[#8a7600]" /><Micro>Your gym in the app</Micro></div>
                    <p className="text-[13px] text-[#888]">Your page isn’t loading right now. Try again in a minute.</p>
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
            Only an owner can change your page. You can see everything here.
        </p>
    );

    // ── The editor for whatever's selected ──
    let editor;
    if (current === 'cover') {
        editor = (
            <>
                <EditorHead title="Cover photo">The big picture at the top of your page. Landscape works best: the floor or the front, with people in it if you can.</EditorHead>
                {readOnlyNote}
                <div className="rounded-2xl overflow-hidden border border-[#E6E6E1] aspect-[16/9] max-w-md bg-[#F4F4F1] flex items-center justify-center">
                    {view.image_url ? <img src={storageImage(view.image_url, 900)} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">{busy === 'cover' ? 'Uploading' : 'No cover yet'}</span>}
                </div>
                {canEdit && (
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                        <UploadButton primary={!view.image_url} label={view.image_url ? 'Replace' : 'Upload a photo'} busy={busy === 'cover'} onFile={(f) => uploadProfileImage('cover', 'image_url', f)} />
                        {view.image_url && <button type="button" onClick={() => saveProfile('cover', { image_url: null })} disabled={!!busy} className={`${BTN_GHOST} h-10`}><Trash2 size={13} /> Remove</button>}
                        <Saved on={saved === 'cover'} />
                    </div>
                )}
                <p className="text-[11px] text-[#AAAAAA] mt-3">It also goes behind the posts the Studio makes for you.</p>
            </>
        );
    } else if (current === 'logo') {
        editor = (
            <>
                <EditorHead title="Logo">On your page, on your pin on the map, on your screens and on every post. A PNG with a see-through background is best.</EditorHead>
                {readOnlyNote}
                <div className="flex flex-wrap items-start gap-6">
                    <div className="w-36 h-36 rounded-2xl border border-[#E6E6E1] flex items-center justify-center shrink-0" style={{ background: BG[view.logo_bg] ?? BG.dark }}>
                        {view.logo_url ? <img src={storageImage(view.logo_url, 400)} alt="" className="max-w-[72%] max-h-[72%] object-contain" /> : <span className="text-[10px] uppercase tracking-[0.25em] font-black" style={{ color: view.logo_bg === 'white' ? '#BBBBBB' : 'rgba(255,255,255,0.35)' }}>{busy === 'logo' ? 'Uploading' : 'No logo'}</span>}
                    </div>
                    <div className="min-w-0">
                        {canEdit && (
                            <div className="flex flex-wrap gap-2">
                                <UploadButton primary={!view.logo_url} label={view.logo_url ? 'Replace' : 'Upload your logo'} busy={busy === 'logo'} onFile={(f) => uploadProfileImage('logo', 'logo_url', f)} />
                                {view.logo_url && <button type="button" onClick={() => saveProfile('logo', { logo_url: null })} disabled={!!busy} className={`${BTN_GHOST} h-10`}><Trash2 size={13} /> Remove</button>}
                            </div>
                        )}
                        <label className={`${LABEL} mt-5`}>It’s made for</label>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Logo background">
                            {Object.keys(BG).map((k) => (
                                <button key={k} type="button" role="radio" aria-checked={view.logo_bg === k} disabled={!canEdit || !!busy} onClick={() => view.logo_bg !== k && saveProfile('logo', { logo_bg: k })}
                                    className={`h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-all ${view.logo_bg === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>
                                    {BG_LABEL[k]}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-[#AAAAAA] mt-2">The background your logo is drawn for, so it never sits on the wrong one.</p>
                        <div className="mt-2"><Saved on={saved === 'logo'} /></div>
                    </div>
                </div>
            </>
        );
    } else if (current === 'name') {
        editor = (
            <>
                <EditorHead title="Name & address">At the top of your page and under your pin. Moving the pin itself is on us: tap it on the map.</EditorHead>
                {readOnlyNote}
                <div className="grid grid-cols-1 gap-4 max-w-lg">
                    <div><label className={LABEL} htmlFor="gap-name">Gym name</label><input id="gap-name" className={INPUT} value={view.name ?? ''} onChange={(e) => setField('name', e.target.value)} disabled={!canEdit} maxLength={60} /></div>
                    <div><label className={LABEL} htmlFor="gap-address">Address</label><input id="gap-address" className={INPUT} value={view.address ?? ''} onChange={(e) => setField('address', e.target.value)} disabled={!canEdit} maxLength={200} placeholder="12 High Street, London" /></div>
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
                <EditorHead title="Opening hours">Members see “Open now” or “Closed” as it happens, and today’s hours under it.</EditorHead>
                {readOnlyNote}
                <div className="divide-y divide-[#F0F0EC] max-w-lg">
                    {DAYS.map(([k, label]) => {
                        const d = hours[k];
                        return (
                            <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                                <label className="inline-flex items-center gap-3 w-32 text-[13px] text-[#1A1A1A]">
                                    <input type="checkbox" checked={!!d} disabled={!canEdit} onChange={(e) => setDay(k, e.target.checked ? { open: '06:00', close: '22:00' } : null)} className="accent-[#E8D200]" />
                                    {label}
                                </label>
                                {d ? (
                                    <div className="flex items-center gap-2 text-[12px] text-[#666]">
                                        <input type="time" value={d.open} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, open: e.target.value })} className={`${INPUT} h-10 w-28 px-3`} aria-label={`${label} opens`} />
                                        <span>to</span>
                                        <input type="time" value={d.close} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, close: e.target.value })} className={`${INPUT} h-10 w-28 px-3`} aria-label={`${label} closes`} />
                                    </div>
                                ) : <span className="text-[12px] text-[#AAAAAA]">Closed</span>}
                            </div>
                        );
                    })}
                </div>
                {canEdit && hours.mon && (
                    <button type="button" onClick={() => setField('opening_hours', Object.fromEntries(DAYS.map(([k]) => [k, { ...hours.mon }])))}
                        className="mt-3 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600] hover:text-[#1A1A1A]">Same as Monday, every day</button>
                )}
                <SaveRow canEdit={canEdit} dirty={dirty.hours} busy={busy === 'hours'} saved={saved === 'hours'} onUndo={() => undo('opening_hours')}
                    onSave={() => saveProfile('hours', { opening_hours: hours })} label="Save hours" />
            </>
        );
    } else if (current === 'about') {
        const text = view.description ?? '';
        editor = (
            <>
                <EditorHead title="About">A line or two under your name: what it’s like here, who it’s for, what you’re known for.</EditorHead>
                {readOnlyNote}
                <div className="max-w-lg">
                    <textarea className={`${INPUT} h-auto py-3 min-h-[120px] resize-y`} value={text} onChange={(e) => setField('description', e.target.value)} disabled={!canEdit} maxLength={400} rows={4}
                        placeholder="Independent strength gym in Hackney. Open 24/7, coached classes every evening, and the best playlist in E8." aria-label="About your gym" />
                    <div className="text-right text-[11px] text-[#AAAAAA] mt-1 tabular-nums">{text.length}/400</div>
                </div>
                <SaveRow canEdit={canEdit} dirty={dirty.about} busy={busy === 'about'} saved={saved === 'about'} onUndo={() => undo('description')}
                    onSave={() => saveProfile('about', { description: text.trim() })} />
            </>
        );
    } else if (current === 'pin') {
        editor = (
            <>
                <EditorHead title="Your pin">Where members find you on the map, and where Get Directions takes them. It should sit on your front door.</EditorHead>
                <div className="flex items-start gap-3 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] p-4 max-w-lg">
                    <MapPin size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <div className="min-w-0 text-[13px] text-[#1A1A1A]">
                        <div className="font-bold">{view.address || 'No address yet'}</div>
                        <p className="text-[12px] text-[#888] mt-1 leading-relaxed">In the wrong place, or on the wrong side of the building? Tell us and we’ll move it. It matters: it’s how members get to you.</p>
                    </div>
                </div>
                <Link to="/venue/settings#help" className={`${BTN_GHOST} h-10 mt-4`}>Ask POWR to move it <ArrowRight size={12} /></Link>
            </>
        );
    } else if (current === 'home') {
        editor = (
            <>
                <EditorHead title="Set as Home Gym">The button that makes you someone’s gym in POWR.</EditorHead>
                <div className="flex items-start gap-3 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] p-4 max-w-lg">
                    <Star size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <p className="text-[12px] text-[#666] leading-relaxed">A member who taps it counts as one of yours: on your board, for you in Gym Clash, and in your numbers here. The quickest way to get them to tap it is your join link.</p>
                </div>
                <Link to="/venue/poster" className={`${BTN_GHOST} h-10 mt-4`}>Get your join link <ArrowRight size={12} /></Link>
            </>
        );
    } else if (selected?.startsWith('member:') && member) {
        const f = member.fields;
        const isNew = member.id === 'new';
        const saved_ = members.find((m) => m.id === member.id);
        editor = (
            <>
                <EditorHead title={isNew ? 'Add someone' : f.name || 'Their details'} onBack={() => select('team')}>
                    {isNew ? 'A trainer, a coach, anyone members should know. They show on your page as you fill this in.' : 'Changes show on the phone as you type, and reach members when you save.'}
                </EditorHead>
                {readOnlyNote}
                <div className="grid grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)] gap-x-6 gap-y-5">
                    <div>
                        <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-[#E8D200] bg-[#F4F4F1] flex items-center justify-center">
                            {f.photo_url ? <img src={storageImage(f.photo_url, 300)} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#BBBBBB]">{busy === 'photo' ? '…' : 'Photo'}</span>}
                        </div>
                        {canEdit && (
                            <div className="flex flex-col items-start gap-1.5 mt-3">
                                <UploadButton compact label={f.photo_url ? 'Replace' : 'Add photo'} busy={busy === 'photo'}
                                    onFile={async (file) => { const url = await uploadImage('photo', file, 'team'); if (url) setMemberField('photo_url', url); }} />
                                {f.photo_url && <button type="button" onClick={() => setMemberField('photo_url', null)} className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] hover:text-[#1A1A1A] pl-2">Remove</button>}
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                        <div><label className={LABEL} htmlFor="gap-m-name">Name</label><input id="gap-m-name" className={INPUT} value={f.name} onChange={(e) => setMemberField('name', e.target.value)} disabled={!canEdit} maxLength={60} placeholder="Sam Carter" /></div>
                        <div><label className={LABEL} htmlFor="gap-m-exp">Experience</label><input id="gap-m-exp" className={INPUT} value={f.experience} onChange={(e) => setMemberField('experience', e.target.value)} disabled={!canEdit} maxLength={40} placeholder="8 years" /></div>
                        <div className="sm:col-span-2">
                            <label className={LABEL} htmlFor="gap-m-role">What they do</label>
                            <input id="gap-m-role" className={INPUT} value={f.role} onChange={(e) => setMemberField('role', e.target.value)} disabled={!canEdit} maxLength={30} placeholder="Personal trainer" />
                            {canEdit && (
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {ROLES.map((r) => (
                                        <button key={r} type="button" onClick={() => setMemberField('role', r)}
                                            className={`h-7 px-3 rounded-full border text-[11px] font-bold transition-all ${f.role.trim().toLowerCase() === r.toLowerCase() ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>{r}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-5">
                    <div><label className={LABEL}>Specialties</label><Specialties value={f.specialties} onChange={(v) => setMemberField('specialties', v)} disabled={!canEdit} /></div>
                    <div>
                        <label className={LABEL} htmlFor="gap-m-bio">Bio</label>
                        <textarea id="gap-m-bio" className={`${INPUT} h-auto py-3 min-h-[100px] resize-y`} value={f.bio} onChange={(e) => setMemberField('bio', e.target.value)} disabled={!canEdit} maxLength={500} rows={3}
                            placeholder="Former county rugby player. Strength first, and making it stick around a busy week." />
                        <div className="text-right text-[11px] text-[#AAAAAA] mt-1 tabular-nums">{f.bio.length}/500</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={LABEL} htmlFor="gap-m-book">Booking link</label>
                            <input id="gap-m-book" className={INPUT} value={f.booking_url} onChange={(e) => setMemberField('booking_url', e.target.value)} disabled={!canEdit} maxLength={300} inputMode="url" placeholder="calendly.com/sam" />
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Gives them a <b className="text-[#888]">Book Session</b> button. Any booking page, or a WhatsApp link.</p>
                        </div>
                        <div>
                            <label className={LABEL} htmlFor="gap-m-profile">Profile link</label>
                            <input id="gap-m-profile" className={INPUT} value={f.profile_url} onChange={(e) => setMemberField('profile_url', e.target.value)} disabled={!canEdit} maxLength={300} inputMode="url" placeholder="instagram.com/sam" />
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Gives them a <b className="text-[#888]">View Profile</b> button: their Instagram or their page on your site.</p>
                        </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer max-w-lg">
                        <input type="checkbox" className="accent-[#E8D200] w-4 h-4 mt-0.5 shrink-0" checked={f.active} disabled={!canEdit} onChange={(e) => setMemberField('active', e.target.checked)} />
                        <span>
                            <span className="block text-[13px] font-bold text-[#1A1A1A]">Show them in the app</span>
                            <span className="block text-[12px] text-[#888] leading-relaxed mt-0.5">Untick to hide them for now without losing their details.</span>
                        </span>
                    </label>
                </div>
                {canEdit && (
                    <div className="flex flex-wrap items-center gap-4 mt-6">
                        <button type="button" onClick={saveMember} disabled={!memberDirty || busy === 'member' || busy === 'photo' || f.name.trim().length < 2} className={BTN_GOLD}>
                            {busy === 'member' ? 'Saving' : isNew ? 'Add to your page' : 'Save'}
                        </button>
                        {memberDirty && busy !== 'member' && !isNew && <button type="button" onClick={() => setMember({ id: member.id, fields: original })} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Undo</button>}
                        <Saved on={saved === 'member' && !memberDirty} />
                        {saved === 'member' && !memberDirty && members.length < MAX_TEAM && (
                            <button type="button" onClick={() => select('member:new')} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600] hover:text-[#1A1A1A]"><Plus size={12} /> Add someone else</button>
                        )}
                        {!isNew && saved_ && (
                            <button type="button" onClick={() => removeMember(saved_)} disabled={!!busy} className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-red-600"><Trash2 size={12} /> Take off</button>
                        )}
                    </div>
                )}
            </>
        );
    } else {
        // The team, in the order members see them.
        editor = (
            <>
                <EditorHead title="Your team">Trainers, coaches and staff, on your page in the app. Members can book a session straight from someone’s card.</EditorHead>
                {readOnlyNote}
                {team?.failed ? (
                    <p className="text-[13px] text-[#888]">Your team isn’t loading right now. Try again in a minute.</p>
                ) : members.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-[#E6E6E1] p-6 max-w-lg">
                        <div className="text-[15px] font-bold text-[#1A1A1A]">Nobody on your page yet</div>
                        <p className="text-[12px] text-[#888] leading-relaxed mt-1.5">Put your PTs in front of every member who opens your page. Each one gets a card with their photo, what they’re good at and a Book Session button.</p>
                        {canEdit && <button type="button" onClick={() => select('member:new')} className={`${BTN_GOLD} mt-4`}><Plus size={14} /> Add your first</button>}
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
                                                {[m.role || 'Personal trainer', m.experience].filter(Boolean).join(' · ')}
                                                {!m.active && <span className="ml-1.5 font-bold text-[#B45309]">Hidden</span>}
                                                {m.active && !m.booking_url && <span className="ml-1.5 text-[#AAAAAA]">· no booking link</span>}
                                            </span>
                                        </span>
                                    </button>
                                    {canEdit && (
                                        <span className="flex items-center gap-0.5 shrink-0">
                                            <button type="button" onClick={() => moveMember(i, -1)} disabled={i === 0 || !!busy} aria-label={`Move ${m.name} up`} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1] disabled:opacity-30 disabled:hover:bg-transparent"><ArrowUp size={14} /></button>
                                            <button type="button" onClick={() => moveMember(i, 1)} disabled={i === members.length - 1 || !!busy} aria-label={`Move ${m.name} down`} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1] disabled:opacity-30 disabled:hover:bg-transparent"><ArrowDown size={14} /></button>
                                            <button type="button" onClick={() => toggleMember(m)} disabled={!!busy} aria-label={m.active ? `Hide ${m.name}` : `Show ${m.name}`} title={m.active ? 'Hide from members' : 'Show to members'} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-[#1A1A1A] hover:bg-[#F4F4F1]">{m.active ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                            <button type="button" onClick={() => removeMember(m)} disabled={!!busy} aria-label={`Take ${m.name} off`} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#AAAAAA] hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                                        </span>
                                    )}
                                    <ChevronRight size={14} className="text-[#DDDDDD] shrink-0" />
                                </li>
                            ))}
                        </ol>
                        {canEdit && members.length < MAX_TEAM && (
                            <button type="button" onClick={() => select('member:new')} className={`${BTN_GHOST} h-10 mt-4`}><Plus size={13} /> Add someone</button>
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
                    <div className="flex items-center gap-2.5 min-w-0"><Smartphone size={14} className="text-[#8a7600] shrink-0" /><Micro>Your gym in the app</Micro></div>
                    <span className="text-[11px] font-bold text-[#AAAAAA]">What a member sees when they tap your pin on Discover</span>
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
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{done === ITEMS.length ? 'Your page is complete' : 'Ready for members'}</span>
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
                                            <span className="block text-[12px] font-bold text-[#1A1A1A] truncate">{it.id === 'team' && liveCount ? `Your team (${liveCount})` : it.label}</span>
                                            <span className="block text-[10.5px] text-[#999] truncate">{it.hint}</span>
                                        </span>
                                        {dirty[it.id] && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#B45309]" title="Not saved yet" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-6 pt-6 border-t border-[#F0F0EC]">
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
