import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, Clock, Image as ImageIcon, LifeBuoy, Package, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, PageTitle, Card, Micro, Spinner, Empty, INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import GymStaffPanel from '../../components/GymStaffPanel';
import { storageImage, uploadPublicImage } from '../../lib/storage';
import { fetchGymProfile, updateGymProfile } from './venueApi';
import { PackageContext, packageLine } from './packages';

// Settings: the gym's own details (what the app, the boards and every post
// show), its logo and photo, opening hours, the team, the package and help.
// Owners change things; staff can see them.

const SUPPORT_EMAIL = 'support@powr.life';
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const TEXT_FIELDS = ['name', 'description', 'address', 'phone', 'website'];
const BG = { dark: '#141414', black: '#000000', white: '#FFFFFF' };
const BG_LABEL = { dark: 'On dark', black: 'On black', white: 'On white' };

const pick = (p) => Object.fromEntries(TEXT_FIELDS.map((k) => [k, p?.[k] ?? '']));
const hoursFrom = (h) => Object.fromEntries(DAYS.map(([k]) => [k, h?.[k] ? { open: h[k].open, close: h[k].close } : null]));

function Field({ label, hint, children }) {
    return (
        <div>
            <label className={LABEL}>{label}</label>
            {children}
            {hint && <p className="text-[11px] text-[#AAAAAA] mt-2">{hint}</p>}
        </div>
    );
}

/** An image slot: preview, upload, remove. Uploads go to our storage under the gym's folder. */
function ImageSlot({ label, hint, url, bg, prefix, canEdit, onChange, wide = false }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const inputRef = useRef(null);
    const take = async (file) => {
        if (!file) return;
        setBusy(true);
        setErr(null);
        try {
            const next = await uploadPublicImage('reward-images', file, prefix);
            await onChange(next);
        } catch (e) { setErr(e.message || 'That upload failed.'); }
        finally { setBusy(false); }
    };
    return (
        <div>
            <label className={LABEL}>{label}</label>
            <div className={`rounded-2xl overflow-hidden border border-[#E6E6E1] flex items-center justify-center ${wide ? 'aspect-[16/9]' : 'aspect-square'}`} style={{ background: bg ?? '#F4F4F1' }}>
                {url
                    ? <img src={storageImage(url, 800)} alt="" className={`${wide ? 'w-full h-full object-cover' : 'max-w-[70%] max-h-[70%] object-contain'}`} />
                    : <span className="text-[10px] uppercase tracking-[0.25em] font-black" style={{ color: bg === '#FFFFFF' ? '#BBBBBB' : 'rgba(255,255,255,0.35)' }}>{busy ? 'Uploading' : 'Nothing yet'}</span>}
            </div>
            {canEdit && (
                <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={`${BTN_GHOST} h-10`}><Upload size={13} /> {url ? 'Replace' : 'Upload'}</button>
                    {url && <button type="button" onClick={() => onChange(null)} disabled={busy} className={`${BTN_GHOST} h-10`}><Trash2 size={13} /> Remove</button>}
                    <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} aria-label={label} />
                </div>
            )}
            {hint && <p className="text-[11px] text-[#AAAAAA] mt-2">{hint}</p>}
            {err && <p className="text-[11px] text-red-600 mt-2">{err}</p>}
        </div>
    );
}

export default function VenueSettings() {
    const { gym, user, isActingGym, refreshGymMemberships } = useAuth();
    const { pkg } = React.useContext(PackageContext) ?? {};
    const location = useLocation();
    const [profile, setProfile] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [form, setForm] = useState(pick(null));
    const [hours, setHours] = useState(hoursFrom(null));
    const [saving, setSaving] = useState(null);      // 'details' | 'hours' | 'logo' | 'photo'
    const [saved, setSaved] = useState(null);
    const [error, setError] = useState(null);

    const load = async () => {
        setLoadError(null);
        try {
            const p = await fetchGymProfile(gym.partner_id);
            setProfile(p);
            setForm(pick(p));
            setHours(hoursFrom(p.opening_hours));
        } catch (e) { setLoadError(e.message); }
    };
    useEffect(() => { setProfile(null); load(); }, [gym.partner_id]); // eslint-disable-line react-hooks/exhaustive-deps

    // #team from the old Team page lands on the team card.
    useEffect(() => {
        if (!profile || location.hash !== '#team') return;
        document.getElementById('team')?.scrollIntoView({ block: 'start' });
    }, [profile, location.hash]);

    const canEdit = !!profile?.can_edit;
    const dirty = useMemo(() => profile && TEXT_FIELDS.some((k) => (form[k] ?? '') !== (profile[k] ?? '')), [form, profile]);
    const hoursDirty = useMemo(() => profile && JSON.stringify(hoursFrom(profile.opening_hours)) !== JSON.stringify(hours), [hours, profile]);

    const apply = async (what, patch) => {
        setSaving(what);
        setError(null);
        setSaved(null);
        try {
            const p = await updateGymProfile(gym.partner_id, patch);
            setProfile(p);
            setForm(pick(p));
            setHours(hoursFrom(p.opening_hours));
            setSaved(what);
            if ('name' in patch || 'logo_url' in patch || 'logo_bg' in patch) refreshGymMemberships?.();
            setTimeout(() => setSaved((s) => (s === what ? null : s)), 2500);
        } catch (e) { setError(e.message || 'That didn’t save.'); }
        finally { setSaving(null); }
    };
    const saveDetails = () => {
        const patch = {};
        for (const k of TEXT_FIELDS) if ((form[k] ?? '') !== (profile[k] ?? '')) patch[k] = form[k].trim();
        return apply('details', patch);
    };
    const saveHours = () => apply('hours', { opening_hours: hours });
    const setDay = (k, next) => setHours((h) => ({ ...h, [k]: next }));

    if (loadError) return <Page><Empty title="Couldn’t load your settings" action={<button type="button" onClick={load} className={BTN_GHOST}>Try again</button>}>{loadError}</Empty></Page>;
    if (!profile) return <Page><Spinner /></Page>;

    const prefix = `gym-events/${gym.partner_id}/brand`;
    const busy = (what) => saving === what;

    return (
        <Page>
            <PageTitle eyebrow="Settings" title="Your gym" sub={profile.name} />
            {!canEdit && <p className="text-[12px] text-[#888] mt-4">Only an owner can change these details. You can see them, and the team.</p>}
            {error && <div className="mt-4 text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}

            <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
                <div className="space-y-6 min-w-0">
                    {/* Details */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-6"><Building2 size={15} className="text-[#8a7600]" /><Micro>Details</Micro></div>
                        <p className="text-[12px] text-[#888] leading-relaxed mb-6">What members see in the app, on your screens and on every post. The name and address also place you on the map.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div className="sm:col-span-2"><Field label="Gym name"><input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} maxLength={60} /></Field></div>
                            <div className="sm:col-span-2">
                                <Field label="About" hint="A sentence or two, up to 400 characters. Shown on your gym’s page in the app.">
                                    <textarea className={`${INPUT} h-auto py-3 min-h-[96px] resize-y`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!canEdit} maxLength={400} rows={3} />
                                </Field>
                            </div>
                            <div className="sm:col-span-2"><Field label="Address"><input className={INPUT} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={!canEdit} maxLength={200} /></Field></div>
                            <Field label="Phone"><input className={INPUT} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} maxLength={30} inputMode="tel" /></Field>
                            <Field label="Website"><input className={INPUT} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} disabled={!canEdit} maxLength={200} placeholder="yourgym.com" inputMode="url" /></Field>
                        </div>
                        {canEdit && (
                            <div className="flex items-center gap-4 mt-6">
                                <button type="button" onClick={saveDetails} disabled={!dirty || busy('details')} className={BTN_GOLD}>{busy('details') ? 'Saving' : 'Save details'}</button>
                                {saved === 'details' && <span className="text-[11px] font-bold text-[#0B7A57]">Saved.</span>}
                                {dirty && saved !== 'details' && <button type="button" onClick={() => setForm(pick(profile))} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Undo</button>}
                            </div>
                        )}
                    </Card>

                    {/* Opening hours */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-6"><Clock size={15} className="text-[#8a7600]" /><Micro>Opening hours</Micro></div>
                        <div className="divide-y divide-[#F0F0EC]">
                            {DAYS.map(([k, label]) => {
                                const d = hours[k];
                                return (
                                    <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                                        <label className="inline-flex items-center gap-3 w-36 text-[13px] text-[#1A1A1A]">
                                            <input type="checkbox" checked={!!d} disabled={!canEdit} onChange={(e) => setDay(k, e.target.checked ? { open: '06:00', close: '22:00' } : null)} className="accent-[#E8D200]" />
                                            {label}
                                        </label>
                                        {d ? (
                                            <div className="flex items-center gap-2 text-[12px] text-[#666]">
                                                <input type="time" value={d.open} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, open: e.target.value })} className={`${INPUT} h-10 w-32 px-3`} aria-label={`${label} opens`} />
                                                <span>to</span>
                                                <input type="time" value={d.close} disabled={!canEdit} onChange={(e) => setDay(k, { ...d, close: e.target.value })} className={`${INPUT} h-10 w-32 px-3`} aria-label={`${label} closes`} />
                                            </div>
                                        ) : <span className="text-[12px] text-[#AAAAAA]">Closed</span>}
                                    </div>
                                );
                            })}
                        </div>
                        {canEdit && (
                            <div className="flex items-center gap-4 mt-6">
                                <button type="button" onClick={saveHours} disabled={!hoursDirty || busy('hours')} className={BTN_GOLD}>{busy('hours') ? 'Saving' : 'Save hours'}</button>
                                {saved === 'hours' && <span className="text-[11px] font-bold text-[#0B7A57]">Saved.</span>}
                            </div>
                        )}
                    </Card>

                    {/* Team */}
                    <div id="team">
                        <GymStaffPanel partnerId={gym.partner_id} gymName={profile.name} adminView={isActingGym} selfUserId={isActingGym ? null : user?.id} />
                    </div>

                    {/* Help */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-4"><LifeBuoy size={15} className="text-[#8a7600]" /><Micro>Help</Micro></div>
                        <p className="text-[13px] text-[#1A1A1A] leading-relaxed">Stuck, or something looks wrong? Write to us and a person answers, usually the same day.</p>
                        <div className="flex flex-wrap gap-3 mt-5">
                            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${profile.name} · gym portal`)}`} className={BTN_GOLD}>Email {SUPPORT_EMAIL}</a>
                            <Link to="/venue/screens" className={BTN_GHOST}>Putting the board on a TV</Link>
                        </div>
                    </Card>
                </div>

                <div className="space-y-6 min-w-0">
                    {/* Logo */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-6"><ImageIcon size={15} className="text-[#8a7600]" /><Micro>Logo</Micro></div>
                        <ImageSlot label="Your logo" hint="A PNG with a transparent background is best. It appears on your screens, in the app and on every post the Studio makes." url={profile.logo_url} bg={BG[profile.logo_bg] ?? BG.dark} prefix={prefix} canEdit={canEdit} onChange={(url) => apply('logo', { logo_url: url })} />
                        <div className="mt-5">
                            <label className={LABEL}>It looks right</label>
                            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Logo background">
                                {Object.keys(BG).map((k) => (
                                    <button key={k} type="button" role="radio" aria-checked={profile.logo_bg === k} disabled={!canEdit || busy('logo')} onClick={() => profile.logo_bg !== k && apply('logo', { logo_bg: k })}
                                        className={`h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-all ${profile.logo_bg === k ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888] hover:text-[#1A1A1A]'}`}>
                                        {BG_LABEL[k]}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-[#AAAAAA] mt-2">Pick the background your logo is made for, so it never sits on the wrong one.</p>
                            {saved === 'logo' && <p className="text-[11px] font-bold text-[#0B7A57] mt-2">Saved.</p>}
                        </div>
                    </Card>

                    {/* Photo */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-6"><ImageIcon size={15} className="text-[#8a7600]" /><Micro>Photo</Micro></div>
                        <ImageSlot label="Your gym" hint="The big picture on your gym’s page in the app. Landscape, the floor or the front, people in it if you can." url={profile.image_url} prefix={prefix} canEdit={canEdit} onChange={(url) => apply('photo', { image_url: url })} wide />
                        {saved === 'photo' && <p className="text-[11px] font-bold text-[#0B7A57] mt-2">Saved.</p>}
                    </Card>

                    {/* Package */}
                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-4"><Package size={15} className="text-[#8a7600]" /><Micro>Package</Micro></div>
                        <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">{packageLine(pkg)}</div>
                        <p className="text-[12px] text-[#888] leading-relaxed mt-2">What’s switched on, what each package includes, and how to change it.</p>
                        <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>See packages</Link>
                    </Card>
                </div>
            </div>
        </Page>
    );
}
