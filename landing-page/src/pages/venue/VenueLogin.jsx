import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { PortalShell } from '../../components/portal/PortalShell';
import { INPUT, LABEL, BTN_GOLD } from '../../components/portal/ui';

// Gym staff sign in with the same POWR account they use in the app, or the one
// their invite created. Many app accounts are Google/Apple with no password,
// so an emailed sign-in link is always offered. shouldCreateUser:false means
// the link can only sign into an account that already exists.
export default function VenueLogin() {
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
        if (!addr) return setError('Enter your email first.');
        setBusy('link'); setError(null);
        const { error: e } = await supabase.auth.signInWithOtp({
            email: addr,
            options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/venue` },
        });
        setBusy(null);
        if (e) {
            return setError(/signups? not allowed|not found|user_not_found/i.test(e.message)
                ? "We couldn't find a POWR account with that email. Use the one your invite was for, or open your invite link again."
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
                eyebrow="Gym Portal"
                title={paused ? 'Portal paused' : 'Not on a gym team'}
                sub={paused
                    ? `Your gym's portal is switched off right now. Get in touch with POWR and we'll sort it.`
                    : `You're signed in as ${user.email}, but this account isn't on a gym's team. Open the invite link your gym or POWR sent you, or sign in with the account you accepted it with.`}
            >
                <a href="mailto:support@powr.life" className={`${BTN_GOLD} w-full`} style={{ color: '#080808' }}>Contact POWR</a>
                <button onClick={signOut} className="w-full mt-4 text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">Sign out</button>
            </PortalShell>
        );
    }

    if (linkSent) {
        return (
            <PortalShell eyebrow="Gym Portal" title="Check your email" sub={`We've sent a sign-in link to ${email.trim()}. Open it on this device and you're in.`}>
                <button onClick={() => setLinkSent(false)} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">Use a different email</button>
            </PortalShell>
        );
    }

    return (
        <PortalShell eyebrow="Gym Portal" title="Welcome back" sub="Sign in with your POWR account. Use Google or Apple in the app? Leave the password blank and we'll email you a link.">
            <form onSubmit={passwordLogin} className="space-y-5">
                <div>
                    <label className={LABEL}>Email address</label>
                    <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                </div>
                <div>
                    <label className={LABEL}>Password <span className="normal-case tracking-normal text-[#CCCCCC]">— optional</span></label>
                    <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                {error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                    {busy === 'password' ? 'Signing in…' : busy === 'link' ? 'Sending…' : password ? 'Sign In' : 'Email me a sign-in link'}
                </button>
                {password && (
                    <button type="button" onClick={emailLink} disabled={!!busy} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">
                        Forgot it? Email me a sign-in link
                    </button>
                )}
            </form>
            <p className="text-[11px] text-[#AAAAAA] text-center mt-6 leading-relaxed">
                Run a gym and want it on POWR? <Link to="/partners"><span className="text-[#8a7600]">Partner with us</span></Link>
            </p>
        </PortalShell>
    );
}
