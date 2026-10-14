import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { serverErrorText } from '../../lib/serverErrors';
import { useAuth } from '../../App';
import { PortalShell } from '../../components/portal/PortalShell';
import { INPUT, LABEL, BTN_GOLD } from '../../components/portal/ui';

// Gym staff sign in with the same POWR account they use in the app, or the one
// their invite created. Many app accounts are Google/Apple with no password,
// so an emailed sign-in link is always offered. shouldCreateUser:false means
// the link can only sign into an account that already exists.
export default function VenueLogin() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, isGymStaff, isAdmin, gymMemberships, rolesFor, loading: authLoading } = useAuth();
    // Back to where sign-in was asked for (a portal page, or a gym guide),
    // never anywhere outside those two.
    const from = location.state?.from;
    const back = from && /^\/(venue|docs\/gyms)(\/|$)/.test(from.pathname)
        ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
        : '/venue';
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(null); // 'password' | 'link'
    const [error, setError] = useState(null);
    const [linkSent, setLinkSent] = useState(false);

    useEffect(() => {
        if (user && rolesFor === user.id && (isGymStaff || isAdmin)) navigate(back, { replace: true });
    }, [user, rolesFor, isGymStaff, isAdmin, navigate, back]);

    const emailLink = async () => {
        const addr = email.trim().toLowerCase();
        if (!addr) return setError(t('venueShell:login.enterEmail'));
        setBusy('link'); setError(null);
        const { error: e } = await supabase.auth.signInWithOtp({
            email: addr,
            options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/venue` },
        });
        setBusy(null);
        if (e) {
            return setError(/signups? not allowed|not found|user_not_found/i.test(e.message)
                ? t('venueShell:login.noAccount')
                : serverErrorText(e));
        }
        setLinkSent(true);
    };

    const passwordLogin = async (e) => {
        e.preventDefault();
        if (!password) return emailLink();
        setBusy('password'); setError(null);
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) { setError(serverErrorText(err)); setBusy(null); }
        // success: the auth listener resolves roles and the effect above navigates
    };

    const signOut = async () => { await supabase.auth.signOut(); setBusy(null); };

    // Signed in, roles resolved, but not (or no longer) on a gym's team.
    if (!authLoading && user && rolesFor === user.id && !isGymStaff && !isAdmin) {
        const paused = gymMemberships.length > 0;
        return (
            <PortalShell
                eyebrow={t('venueShell:portalName')}
                title={paused ? t('venueShell:login.pausedTitle') : t('venueShell:login.notOnTeamTitle')}
                sub={paused
                    ? t('venueShell:login.pausedBody')
                    : t('venueShell:login.notOnTeamBody', { email: user.email })}
            >
                <a href="mailto:support@powr.life" className={`${BTN_GOLD} w-full`} style={{ color: '#080808' }}>{t('venueShell:login.contact')}</a>
                <button onClick={signOut} className="w-full mt-4 text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">{t('venueShell:login.signOut')}</button>
            </PortalShell>
        );
    }

    if (linkSent) {
        return (
            <PortalShell eyebrow={t('venueShell:portalName')} title={t('venueShell:auth.checkEmail')} sub={t('venueShell:login.linkSent', { email: email.trim() })}>
                <button onClick={() => setLinkSent(false)} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">{t('venueShell:auth.differentEmail')}</button>
            </PortalShell>
        );
    }

    return (
        <PortalShell eyebrow={t('venueShell:portalName')} title={t('venueShell:login.welcome')} sub={t('venueShell:login.intro')}>
            <form onSubmit={passwordLogin} className="space-y-5">
                <div>
                    <label className={LABEL}>{t('venueShell:auth.emailAddress')}</label>
                    <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                </div>
                <div>
                    <label className={LABEL}>{t('venueShell:auth.password')} <span className="normal-case tracking-normal text-[#CCCCCC]">{t('venueShell:auth.optional')}</span></label>
                    <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                {error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                    {busy === 'password' ? t('venueShell:auth.signingIn') : busy === 'link' ? t('venueShell:auth.sending') : password ? t('venueShell:auth.signIn') : t('venueShell:auth.emailLink')}
                </button>
                {password && (
                    <button type="button" onClick={emailLink} disabled={!!busy} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">
                        {t('venueShell:login.forgot')}
                    </button>
                )}
            </form>
            <p className="text-[11px] text-[#AAAAAA] text-center mt-6 leading-relaxed">
                {t('venueShell:login.runAGym')} <Link to="/partners"><span className="text-[#8a7600]">{t('venueShell:login.partnerWithUs')}</span></Link>
            </p>
        </PortalShell>
    );
}
