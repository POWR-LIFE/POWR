import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';
import { CreatorShell } from './CreatorShell';
import { INPUT, LABEL, BTN_GOLD } from './ui';

export default function CreatorSetup() {
    const { token } = useParams();
    const navigate = useNavigate();

    const [tokenState, setTokenState] = useState('loading'); // loading | invalid | used | valid
    const [creator, setCreator] = useState(null);

    const [contactName, setContactName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        if (!token) { setTokenState('invalid'); return; }
        (async () => {
            try {
                const { data, error } = await supabase.functions.invoke('manage-creator-user', {
                    body: { action: 'validate_invite', token },
                });
                if (error || !data?.ok) {
                    setTokenState(data?.reason === 'used' ? 'used' : 'invalid');
                    return;
                }
                setCreator(data.creator ?? null);
                setTokenState('valid');
            } catch {
                setTokenState('invalid');
            }
        })();
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirm) { setError('Passwords do not match'); return; }
        if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
        setError(null);
        setSubmitting(true);
        setStatus('Creating your account...');
        try {
            const data = await invokeFn('manage-creator-user', {
                action: 'redeem_invite', token, email, password, contact_name: contactName,
            });
            if (!data?.ok) {
                if (data?.reason) { setTokenState(data.reason === 'used' ? 'used' : 'invalid'); return; }
                throw new Error(data?.error ?? 'Something went wrong');
            }

            // Web access is app-first: the portal opens from the app's Affiliate
            // screen. The login page explains that; no web session is started.
            navigate('/affiliate/login');
        } catch (err) {
            setError(err.message || 'Something went wrong. Please try again.');
            setStatus(null);
        } finally {
            setSubmitting(false);
        }
    };

    if (tokenState === 'loading') {
        return (
            <CreatorShell>
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                </div>
            </CreatorShell>
        );
    }

    if (tokenState === 'invalid') {
        return (
            <CreatorShell>
                <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-full border border-red-400/40 flex items-center justify-center text-red-500 text-xl mx-auto mb-6">✕</div>
                    <h1 className="text-2xl font-light tracking-tight mb-3">Invalid link</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed">This setup link isn't valid or has been revoked. Contact POWR for a new one.</p>
                </div>
            </CreatorShell>
        );
    }

    if (tokenState === 'used') {
        return (
            <CreatorShell>
                <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-full border border-[#E8D200]/50 flex items-center justify-center text-[#8a7600] text-xl mx-auto mb-6">✓</div>
                    <h1 className="text-2xl font-light tracking-tight mb-3">Already set up</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed mb-6">This link has already been used to create an account.</p>
                    <Link to="/affiliate/login" className={BTN_GOLD} style={{ color: '#080808' }}>Sign In</Link>
                </div>
            </CreatorShell>
        );
    }

    return (
        <CreatorShell eyebrow="You're invited" title="Create your account" sub="Track your link, see who's signed up, and follow your rewards — all in one place.">
            <div className="flex items-center gap-4 mb-8 p-4 sm:p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                {creator?.avatar_url ? (
                    <img src={creator.avatar_url} alt={creator?.display_name ?? ''} className="w-12 h-12 rounded-full object-cover shrink-0" />
                ) : (
                    <div className="w-12 h-12 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[12px] font-black text-[#8a7600] uppercase shrink-0">
                        {creator?.display_name?.[0] ?? '?'}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="text-base font-bold text-[#1A1A1A] truncate">{creator?.display_name ?? 'Your profile'}</div>
                    {creator?.handle && (
                        <div className="text-[10px] text-[#AAAAAA] font-black mt-0.5 truncate">powr.life/join/{creator.handle}</div>
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label className={LABEL}>Your name</label>
                    <input type="text" className={INPUT} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="First & last name" autoComplete="name" />
                </div>
                <div>
                    <label className={LABEL}>Email address</label>
                    <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required autoComplete="email" inputMode="email" autoCapitalize="none" />
                </div>
                <div>
                    <label className={LABEL}>Password</label>
                    <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
                </div>
                <div>
                    <label className={LABEL}>Confirm password</label>
                    <input type="password" className={INPUT} value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
                </div>

                {error && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
                {status && <div className="text-[#8a7600] text-xs bg-[#E8D200]/5 p-3 border border-[#E8D200]/20 rounded-xl animate-pulse">{status}</div>}

                <button type="submit" disabled={submitting} className={`${BTN_GOLD} w-full`}>
                    {submitting ? 'Setting up...' : 'Create Account'}
                </button>
                <p className="text-center text-[10px] text-[#BBBBBB] leading-relaxed">
                    Already have an account? <Link to="/affiliate/login"><span className="text-[#8a7600] hover:underline">Sign in</span></Link>
                </p>
            </form>
        </CreatorShell>
    );
}
