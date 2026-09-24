import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
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
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const signInExisting = async (e) => {
        e.preventDefault();
        const addr = email.trim().toLowerCase();
        if (!addr) return setError('Enter the email you use in the app.');
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
                    ? "We couldn't find a POWR account with that email. Create a login instead."
                    : err.message);
            }
            setLinkSent(true);
            return;
        }
        setBusy('password');
        const { error: err } = await supabase.auth.signInWithPassword({ email: addr, password });
        setBusy(null);
        if (err) setError(err.message);
        // Signed in: the page re-renders into the "add to your account" step.
    };

    const createAccount = async (e) => {
        e.preventDefault();
        if (password !== confirm) return setError('Passwords do not match');
        if (password.length < 8) return setError('Password must be at least 8 characters');
        setBusy('create'); setError(null);
        try {
            const data = await staffApi('redeem_invite', { token, email, password, contact_name: name });
            if (!data?.ok) { setState(data?.reason ?? 'invalid'); return; }
            const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
            if (err) { navigate('/venue/login'); return; }
            await finish(null);
        } catch (err) {
            if (/already have a POWR account/i.test(err.message)) setMode('existing');
            setError(err.message);
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
            used:    ['Already used', 'This link has already been used. If it was you, just sign in.'],
            expired: ['Link expired', 'Setup links last 14 days. Ask whoever sent it for a new one.'],
            invalid: ['Invalid link', "This setup link isn't valid or has been revoked. Ask whoever sent it for a new one."],
        }[state] ?? ['Invalid link', ''];
        return (
            <PortalShell>
                <div className="text-center py-6">
                    <h1 className="text-2xl font-light tracking-tight mb-3">{copy[0]}</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed mb-6">{copy[1]}</p>
                    <Link to="/venue/login" className={BTN_GOLD} style={{ color: '#080808' }}>Sign In</Link>
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
                    {invite.role === 'owner' ? 'Owner access' : 'Team access'}
                </div>
            </div>
        </div>
    );
    const errorBox = error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>;

    // Signed in (or just signed in): one tap adds the gym to this account.
    if (user && rolesFor === user.id) {
        return (
            <PortalShell eyebrow="You're invited" title={`Join ${invite.gym.name}`} sub={`This adds the gym portal to the POWR account you're signed in with: ${user.email}.`}>
                {gymCard}
                <div className="space-y-4">
                    {errorBox}
                    <button onClick={accept} disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'accept' ? 'Adding…' : `Add ${invite.gym.name}`}
                    </button>
                    <button
                        onClick={() => supabase.auth.signOut()}
                        className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors"
                    >
                        Not you? Use a different account
                    </button>
                </div>
            </PortalShell>
        );
    }

    if (linkSent) {
        return (
            <PortalShell eyebrow="You're invited" title="Check your email" sub={`We've sent a sign-in link to ${email.trim()}. Open it on this device and it brings you back here to finish.`}>
                <button onClick={() => setLinkSent(false)} className="w-full text-[10px] uppercase tracking-[0.3em] font-black text-[#BBBBBB] hover:text-[#8a7600] transition-colors">Use a different email</button>
            </PortalShell>
        );
    }

    return (
        <PortalShell eyebrow="You're invited" title="Set up your access" sub="Run your gym's screens and see who's training, all in one place.">
            {gymCard}

            <div className="grid grid-cols-2 gap-2 mb-6">
                {[['existing', 'I use POWR'], ['new', 'New to POWR']].map(([m, label]) => (
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
                        Sign in with the account you use in the POWR app. Use Google or Apple there? Leave the password blank and we’ll email you a link.
                    </p>
                    <div>
                        <label className={LABEL}>Email address</label>
                        <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                    </div>
                    <div>
                        <label className={LABEL}>Password <span className="normal-case tracking-normal text-[#CCCCCC]">— optional</span></label>
                        <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    </div>
                    {errorBox}
                    <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'password' ? 'Signing in…' : busy === 'link' ? 'Sending…' : password ? 'Sign In' : 'Email me a sign-in link'}
                    </button>
                </form>
            ) : (
                <form onSubmit={createAccount} className="space-y-5">
                    <div>
                        <label className={LABEL}>Your name</label>
                        <input type="text" className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="First & last name" autoComplete="name" />
                    </div>
                    <div>
                        <label className={LABEL}>Email address</label>
                        <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" inputMode="email" autoCapitalize="none" />
                    </div>
                    <div>
                        <label className={LABEL}>Password</label>
                        <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
                    </div>
                    <div>
                        <label className={LABEL}>Confirm password</label>
                        <input type="password" className={INPUT} value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
                    </div>
                    {errorBox}
                    <button type="submit" disabled={!!busy} className={`${BTN_GOLD} w-full`}>
                        {busy === 'create' ? 'Setting up…' : 'Create login'}
                    </button>
                </form>
            )}
        </PortalShell>
    );
}
