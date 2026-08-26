import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, INPUT, LABEL, BTN_GOLD } from './ui';

function Section({ title, intro, children }) {
    return (
        <Card className="p-5 sm:p-8">
            <Micro className="mb-2">{title}</Micro>
            {intro && <p className="text-[12px] text-[#888] font-light leading-relaxed mb-6 max-w-xl">{intro}</p>}
            {!intro && <div className="mb-6" />}
            {children}
        </Card>
    );
}

const BLANK_ADDR = { line1: '', line2: '', city: '', postcode: '', country: '' };

export default function CreatorSettings() {
    const { creatorData, user, refreshCreator } = useAuth();

    const [displayName, setDisplayName] = useState('');
    const [bio, setBio] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [shipName, setShipName] = useState('');
    const [addr, setAddr] = useState(BLANK_ADDR);

    const [savingProfile, setSavingProfile] = useState(false);
    const [savingAddr, setSavingAddr] = useState(false);
    const [msg, setMsg] = useState(null);
    const [err, setErr] = useState(null);

    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [savingPw, setSavingPw] = useState(false);

    useEffect(() => {
        if (!creatorData) return;
        setDisplayName(creatorData.display_name ?? '');
        setBio(creatorData.bio ?? '');
        setAvatarUrl(creatorData.avatar_url ?? '');
        setShipName(creatorData.shipping_name ?? '');
        setAddr({ ...BLANK_ADDR, ...(creatorData.shipping_address ?? {}) });
    }, [creatorData]);

    const flash = (text, isError) => {
        setMsg(isError ? null : text);
        setErr(isError ? text : null);
        setTimeout(() => { setMsg(null); setErr(null); }, 4000);
    };

    // Only display_name / avatar_url / bio / shipping_* are writable by the
    // creator — the column grant in the migration is what enforces that, not
    // this form. Sending anything else back would just be refused.
    const saveProfile = async (e) => {
        e.preventDefault();
        setSavingProfile(true);
        const { error } = await supabase
            .from('creators')
            .update({
                display_name: displayName.trim(),
                bio: bio.trim() || null,
                avatar_url: avatarUrl.trim() || null,
            })
            .eq('id', creatorData.id);
        setSavingProfile(false);
        if (error) return flash(error.message, true);
        await refreshCreator?.();
        flash('Profile saved');
    };

    const saveAddress = async (e) => {
        e.preventDefault();
        setSavingAddr(true);
        const { error } = await supabase
            .from('creators')
            .update({
                shipping_name: shipName.trim() || null,
                shipping_address: Object.values(addr).some(v => v.trim()) ? addr : null,
            })
            .eq('id', creatorData.id);
        setSavingAddr(false);
        if (error) return flash(error.message, true);
        await refreshCreator?.();
        flash('Address saved');
    };

    const savePassword = async (e) => {
        e.preventDefault();
        if (pw !== pw2) return flash('Passwords do not match', true);
        if (pw.length < 8) return flash('Password must be at least 8 characters', true);
        setSavingPw(true);
        const { error } = await supabase.auth.updateUser({ password: pw });
        setSavingPw(false);
        if (error) return flash(error.message, true);
        setPw(''); setPw2('');
        flash('Password updated');
    };

    if (!creatorData) return null;

    const hasAddress = !!creatorData.shipping_address;

    return (
        <Page className="max-w-3xl">
            <PageTitle eyebrow={`@${creatorData.handle}`} title="Settings" />

            {msg && <div className="text-[#8a7600] text-xs bg-[#E8D200]/5 p-4 border border-[#E8D200]/20 rounded-2xl">{msg}</div>}
            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl">{err}</div>}

            <form onSubmit={saveProfile}>
                <Section title="Your profile" intro="This is what people see when your link is shared.">
                    <div className="space-y-6">
                        <div>
                            <label className={LABEL}>Display name</label>
                            <input className={INPUT} value={displayName} onChange={e => setDisplayName(e.target.value)} required />
                        </div>
                        <div>
                            <label className={LABEL}>Photo URL</label>
                            <input className={INPUT} value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." inputMode="url" autoCapitalize="none" />
                        </div>
                        <div>
                            <label className={LABEL}>Bio</label>
                            <textarea
                                className={`${INPUT} h-28 py-4 resize-none`}
                                value={bio}
                                onChange={e => setBio(e.target.value)}
                                maxLength={280}
                                placeholder="One line about you — this is the preview text when your link is shared."
                            />
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={savingProfile} className={`${BTN_GOLD} w-full sm:w-auto`}>
                                {savingProfile ? 'Saving...' : 'Save profile'}
                            </button>
                        </div>
                    </div>
                </Section>
            </form>

            <form onSubmit={saveAddress}>
                <Section
                    title="Where we send your stuff"
                    intro={hasAddress
                        ? 'Hit a milestone with a product attached and this is where it goes. Only you and the POWR team can see it.'
                        : 'Hit a milestone with a product attached and this is where it goes. Add it now so nothing waits on you later. Only you and the POWR team can see it.'}
                >
                    <div className="space-y-6">
                        <div>
                            <label className={LABEL}>Name</label>
                            <input className={INPUT} value={shipName} onChange={e => setShipName(e.target.value)} placeholder="Who's on the parcel" autoComplete="name" />
                        </div>
                        <div>
                            <label className={LABEL}>Address line 1</label>
                            <input className={INPUT} value={addr.line1} onChange={e => setAddr({ ...addr, line1: e.target.value })} autoComplete="address-line1" />
                        </div>
                        <div>
                            <label className={LABEL}>Address line 2</label>
                            <input className={INPUT} value={addr.line2} onChange={e => setAddr({ ...addr, line2: e.target.value })} autoComplete="address-line2" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                                <label className={LABEL}>City</label>
                                <input className={INPUT} value={addr.city} onChange={e => setAddr({ ...addr, city: e.target.value })} autoComplete="address-level2" />
                            </div>
                            <div>
                                <label className={LABEL}>Postcode</label>
                                <input className={INPUT} value={addr.postcode} onChange={e => setAddr({ ...addr, postcode: e.target.value })} autoComplete="postal-code" />
                            </div>
                        </div>
                        <div>
                            <label className={LABEL}>Country</label>
                            <input className={INPUT} value={addr.country} onChange={e => setAddr({ ...addr, country: e.target.value })} autoComplete="country-name" />
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={savingAddr} className={`${BTN_GOLD} w-full sm:w-auto`}>
                                {savingAddr ? 'Saving...' : 'Save address'}
                            </button>
                        </div>
                    </div>
                </Section>
            </form>

            <form onSubmit={savePassword}>
                <Section title="Password">
                    <div className="space-y-6">
                        <div className="px-5 py-4 bg-[#F4F4F1] rounded-2xl border border-[#E6E6E1]">
                            <Micro className="mb-1">Signed in as</Micro>
                            <div className="text-[12px] text-[#666] font-mono break-all">{user?.email}</div>
                        </div>
                        <div>
                            <label className={LABEL}>New password</label>
                            <input type="password" className={INPUT} value={pw} onChange={e => setPw(e.target.value)} minLength={8} autoComplete="new-password" />
                        </div>
                        <div>
                            <label className={LABEL}>Confirm new password</label>
                            <input type="password" className={INPUT} value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={savingPw || !pw} className={`${BTN_GOLD} w-full sm:w-auto`}>
                                {savingPw ? 'Updating...' : 'Update password'}
                            </button>
                        </div>
                    </div>
                </Section>
            </form>
        </Page>
    );
}
