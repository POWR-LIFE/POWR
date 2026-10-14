import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { serverErrorText } from '../../lib/serverErrors';
import { useAuth } from '../../App';
import { PortalShell } from '../../components/portal/PortalShell';
import { INPUT, LABEL, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { staffApi } from './venueApi';
import { GymLogo } from './VenueLayout';

// /venue/setup/:token — the single-use link a gym owner or POWR sends.
// Two ways in, because many gym people already use the app:
//   · "I use POWR"   sign in (password or emailed link back to this page),
//                    then add the gym to that account (accept_invite);
//   · "New to POWR"  create a login here (redeem_invite), then sign straight in.
export default function VenueSetup() {
    const { t } = useTranslation();
    const { token } = useParams();
    const navigate = useNavigate();
    const { user, rolesFor, refreshGymMemberships, setActiveGym } = useAuth();

    const [state, setState] = useState('loading'); // loading | invalid | used | expired | valid
    const [invite, setInvite] = useState(null);    // { role, gym }
    const [mode, setMode] = useState('existing');  // existing | new
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [linkSent, setLinkSent] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const data = await staffApi('validate_invite', { token });
                if (!data?.ok) { setState(data?.reason ?? 'invalid'); return; }
                setInvite({ role: data.role, gym: data.gym });
                setState('valid');
            } catch {
                setState('invalid');
            }
        })();
    }, [token]);

    const finish = async (partnerId) => {
        await refreshGymMemberships();
        if (partnerId) setActiveGym(partnerId);
        navigate('/venue');
    };

    const accept = async () => {
        setBusy('accept'); setError(null);
        try {
            const data = await staffApi('accept_invite', { token });
            if (!data?.ok) { setState(data?.reason ?? 'invalid'); return; }
            await finish(data.partner_id);
        } catch (err) {
            setError(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    const signInExisting = async (e) => {
        e.preventDefault();
        const addr = email.trim().toLowerCase();
        if (!addr) return setError(t('venueShell:setup.enterEmail'));
        setError(null);
        if (!password) {
            setBusy('link');
            const { error: err } = await supabase.auth.signInWithOtp({
                email: addr,
                options: { shouldCreateUser: false, emailRedirectTo: window.location.href },
            });
            setBusy(null);
            if (err) {
                return setError(/signups? not allowed|not found|user_not_found/i.test(err.message)
                    ? t('venueShell:setup.noAccount')
                    : serverErrorText(err));
            }
            setLinkSent(true);
            return;
        }
        setBusy('password');
        const { error: err } = await supabase.auth.signInWithPassword({ email: addr, password });
        setBusy(null);
        if (err) setError(serverErrorText(err));
        // Signed in: the page re-renders into the "add to your account" step.
    };

    const createAccount = async (e) => {
        e.preventDefault();
        if (password !== confirm) return setError(t('venueShell:setup.passwordsDontMatch'));
        if (password.length < 8) return setError(t('venueShell:setup.passwordTooShort'));
        setBusy('create'); setError(null);
        try {
            const data = await staffApi('redeem_invite', { token, email, password, contact_name: name });
            if (!data?.ok) { setState(data?.reason ?? 'invalid'); return; }
            const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
            if (err) { navigate('/venue/login'); return; }
            await finish(null);
        } catch (err) {
            if (/already have a POWR account/i.test(err.message)) setMode('existing');
            setError(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    if (state === 'loading') {
        return (
            <PortalShell>
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                </div>
            </PortalShell>
        );
    }

    if (state !== 'valid') {
        const copy = {
            used:    [t('venueShell:setup.usedTitle'), t('venueShell:setup.usedBody')],
            expired: [t('venueShell:setup.expiredTitle'), t('venueShell:setup.expiredBody')],
            invalid: [t('venueShell:setup.invalidTitle'), t('venueShell:setup.invalidBody')],
        }[state] ?? [t('venueShell:setup.invalidTitle'), ''];
        return (
            <PortalShell>
                <div className="text-center py-6">
                    <h1 className="text-2xl font-light tracking-tight mb-3">{copy[0]}</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed mb-6">{copy[1]}</p>
                    <Link to="/venue/login" className={BTN_GOLD} style={{ color: '#080808' }}>{t('venueShell:auth.signIn')}</Link>
                </div>
            </PortalShell>
        );
    }

    const gymCard = (
        <div className="flex items-center gap-4 mb-8 p-4 sm:p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
            <GymLogo gym={invite.gym} size="w-12 h-12" />
            <div className="min-w-0">
                <div className="text-base font-bold text-[#1A1A1A] truncate">{invite.gym.name}</div>
                <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">
                    {invite.role === 'owner' ? t('venueShell:setup.ownerAccess') : t('venueShell:setup.teamAccess')}
                </div>
            </div>
        </div>
    );
    const errorBox = error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>;

    // Signed in (or just signed in): one tap adds the gym to this account.
    if (user && rolesFor === user.id) {
        return (
            <PortalShell eyebrow={t('venueShell:setup.invited')} title={t('venueShell:setup.joinTitle', { gym: invite.gym.name })} sub={t('venueShell:setup.joinSub', { email: user.email })}>
                {gymCard}
                <div className="space-y-4">
                    {errorBox}
                    <button onClick={accept} disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'accept' ? t('venueShell:setup.adding') : t('venueShell:setup.add', { gym: invite.gym.name })}
                    </button>
                    <button
                        onClick={() => supabase.auth.signOut()}
                        className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors"
                    >
                        {t('venueShell:setup.notYou')}
                    </button>
                </div>
            </PortalShell>
        );
    }

    if (linkSent) {
        return (
            <PortalShell eyebrow={t('venueShell:setup.invited')} title={t('venueShell:auth.checkEmail')} sub={t('venueShell:setup.linkSent', { email: email.trim() })}>
                <button onClick={() => setLinkSent(false)} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">{t('venueShell:auth.differentEmail')}</button>
            </PortalShell>
        );
    }

    return (
        <PortalShell eyebrow={t('venueShell:setup.invited')} title={t('venueShell:setup.title')} sub={t('venueShell:setup.sub')}>
            {gymCard}

            <div className="grid grid-cols-2 gap-2 mb-6">
                {[['existing', t('venueShell:setup.existing')], ['new', t('venueShell:setup.new')]].map(([m, label]) => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => { setMode(m); setError(null); }}
                        className={mode === m ? `${BTN_GOLD} h-10 px-4` : `${BTN_GHOST} h-10 px-4`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {mode === 'existing' ? (
                <form onSubmit={signInExisting} className="space-y-5">
                    <p className="text-[12px] text-[#888] font-light leading-relaxed">
                        {t('venueShell:setup.existingIntro')}
                    </p>
                    <div>
                        <label className={LABEL}>{t('venueShell:auth.emailAddress')}</label>
                        <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                    </div>
                    <div>
                        <label className={LABEL}>{t('venueShell:auth.password')} <span className="normal-case tracking-normal text-[#CCCCCC]">{t('venueShell:auth.optional')}</span></label>
                        <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    </div>
                    {errorBox}
                    <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'password' ? t('venueShell:auth.signingIn') : busy === 'link' ? t('venueShell:auth.sending') : password ? t('venueShell:auth.signIn') : t('venueShell:auth.emailLink')}
                    </button>
                </form>
            ) : (
                <form onSubmit={createAccount} className="space-y-5">
                    <div>
                        <label className={LABEL}>{t('venueShell:setup.yourName')}</label>
                        <input type="text" className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder={t('venueShell:setup.namePlaceholder')} autoComplete="name" />
                    </div>
                    <div>
                        <label className={LABEL}>{t('venueShell:auth.emailAddress')}</label>
                        <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                    </div>
                    <div>
                        <label className={LABEL}>{t('venueShell:auth.password')}</label>
                        <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
                    </div>
                    <div>
                        <label className={LABEL}>{t('venueShell:setup.confirmPassword')}</label>
                        <input type="password" className={INPUT} value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
                    </div>
                    {errorBox}
                    <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'create' ? t('venueShell:setup.settingUp') : t('venueShell:setup.createLogin')}
                    </button>
                </form>
            )}
        </PortalShell>
    );
}
