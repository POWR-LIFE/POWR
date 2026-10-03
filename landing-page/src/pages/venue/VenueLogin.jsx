import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../lib/i18n';
import { supabase } from '../../lib/supabase';
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
    const { user, isGymStaff, isAdmin, gymMemberships, rolesFor, loading: authLoading } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(null); // 'password' | 'link'
    const [error, setError] = useState(null);
    const [linkSent, setLinkSent] = useState(false);

    useEffect(() => {
        if (user && rolesFor === user.id && (isGymStaff || isAdmin)) navigate('/venue');
    }, [user, rolesFor, isGymStaff, isAdmin, navigate]);

    const emailLink = async () => {
        const addr = email.trim().toLowerCase();
        if (!addr) return setError(t('gym.login.enterEmail'));
        setBusy('link'); setError(null);
        const { error: e } = await supabase.auth.signInWithOtp({
            email: addr,
            options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/venue` },
        });
        setBusy(null);
        if (e) {
            return setError(/signups? not allowed|not found|user_not_found/i.test(e.message)
                ? t('gym.login.noAccount')
                : e.message);
        }
        setLinkSent(true);
    };

    const passwordLogin = async (e) => {
        e.preventDefault();
        if (!password) return emailLink();
        setBusy('password'); setError(null);
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) { setError(err.message); setBusy(null); }
        // success: the auth listener resolves roles and the effect above navigates
    };

    const signOut = async () => { await supabase.auth.signOut(); setBusy(null); };

    // Signed in, roles resolved, but not (or no longer) on a gym's team.
    if (!authLoading && user && rolesFor === user.id && !isGymStaff && !isAdmin) {
        const paused = gymMemberships.length > 0;
        return (
            <PortalShell
                eyebrow={t('gym.portalName')}
                title={paused ? t('gym.login.pausedTitle') : t('gym.login.noTeamTitle')}
                sub={paused ? t('gym.login.pausedSub') : t('gym.login.noTeamSub', { email: user.email })}
            >
                <a href="mailto:support@powr.life" className={`${BTN_GOLD} w-full`} style={{ color: '#080808' }}>{t('gym.login.contact')}</a>
                <button onClick={signOut} className="w-full mt-4 text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">{t('gym.login.signOut')}</button>
            </PortalShell>
        );
    }

    if (linkSent) {
        return (
            <PortalShell eyebrow={t('gym.portalName')} title={t('gym.login.checkEmailTitle')} sub={t('gym.login.checkEmailSub', { email: email.trim() })}>
                <button onClick={() => setLinkSent(false)} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">{t('gym.login.differentEmail')}</button>
            </PortalShell>
        );
    }

    return (
        <PortalShell eyebrow={t('gym.portalName')} title={t('gym.login.welcomeTitle')} sub={t('gym.login.welcomeSub')}>
            <form onSubmit={passwordLogin} className="space-y-5">
                <div>
                    <label className={LABEL}>{t('gym.login.email')}</label>
                    <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                </div>
                <div>
                    <label className={LABEL}>{t('gym.login.password')} <span className="normal-case tracking-normal text-[#CCCCCC]">{t('gym.login.optional')}</span></label>
                    <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                {error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                    {busy === 'password' ? t('gym.login.signingIn') : busy === 'link' ? t('gym.login.sending') : password ? t('gym.login.signIn') : t('gym.login.emailLink')}
                </button>
                {password && (
                    <button type="button" onClick={emailLink} disabled={!!busy} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">
                        {t('gym.login.forgot')}
                    </button>
                )}
            </form>
            <p className="text-[11px] text-[#AAAAAA] text-center mt-6 leading-relaxed">
                {t('gym.login.partnerPrompt')} <Link to="/partners"><span className="text-[#8a7600]">{t('gym.login.partnerLink')}</span></Link>
            </p>
        </PortalShell>
    );
}
