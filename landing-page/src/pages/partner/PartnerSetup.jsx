import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';

const INPUT = "w-full h-12 px-4 bg-white border border-[#E6E6E1] rounded-lg focus:border-[#E8D200] outline-none transition-all text-sm text-[#1A1A1A]";

function Shell({ children }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] fixed inset-0 z-[100] overflow-y-auto py-10">
            <div className="w-full max-w-md p-8 bg-white border border-[#E6E6E1] rounded-2xl shadow-2xl my-auto">
                {children}
            </div>
        </div>
    );
}

export default function PartnerSetup() {
    const { token } = useParams();
    const navigate = useNavigate();

    const [tokenState, setTokenState] = useState('loading'); // loading | invalid | used | valid
    const [partner, setPartner] = useState(null);

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
                const { data, error } = await supabase.functions.invoke('manage-partner-user', {
                    body: { action: 'validate_invite', token },
                });
                if (error || !data?.ok) {
                    setTokenState(data?.reason === 'used' ? 'used' : 'invalid');
                    return;
                }
                setPartner(data.brand ?? null);
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
            const data = await invokeFn('manage-partner-user', {
                action: 'redeem_invite', token, email, password, contact_name: contactName,
            });
            if (!data?.ok) {
                if (data?.reason) { setTokenState(data.reason === 'used' ? 'used' : 'invalid'); return; }
                throw new Error(data?.error ?? 'Something went wrong');
            }

            // Account created — sign straight in and land on the portal
            setStatus('Signing you in...');
            const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
            if (signInErr) {
                // Account exists; just send them to the login page
                navigate('/partner/login');
                return;
            }
            navigate('/partner');
        } catch (err) {
            setError(err.message || 'Something went wrong. Please try again.');
            setStatus(null);
        } finally {
            setSubmitting(false);
        }
    };

    if (tokenState === 'loading') {
        return (
            <Shell>
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
                </div>
            </Shell>
        );
    }

    if (tokenState === 'invalid') {
        return (
            <Shell>
                <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-full border border-red-400/40 flex items-center justify-center text-red-500 text-xl mx-auto mb-6">✕</div>
                    <h1 className="text-2xl font-light tracking-tight mb-3">Invalid link</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed">This setup link isn't valid or has been revoked. Contact POWR for a new one.</p>
                </div>
            </Shell>
        );
    }

    if (tokenState === 'used') {
        return (
            <Shell>
                <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-full border border-[#E8D200]/50 flex items-center justify-center text-[#8a7600] text-xl mx-auto mb-6">✓</div>
                    <h1 className="text-2xl font-light tracking-tight mb-3">Already set up</h1>
                    <p className="text-sm text-[#888] font-light leading-relaxed mb-6">This link has already been used to create an account.</p>
                    <Link to="/partner/login" className="inline-block h-12 px-8 leading-[48px] bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-lg hover:translate-y-[-2px] transition-all">
                        Sign In
                    </Link>
                </div>
            </Shell>
        );
    }

    return (
        <Shell>
            <div className="flex justify-center mb-6">
                <img src="/powr-logo-black.png" alt="POWR" className="h-10" />
            </div>

            {/* Brand identity */}
            <div className="flex items-center justify-center gap-4 mb-8 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                {partner?.logo_url ? (
                    <img
                        src={partner.logo_url}
                        alt={partner?.name ?? ''}
                        className="w-12 h-12 rounded-xl object-contain border border-[#E6E6E1] p-1"
                        style={{ background: '#1a1a1a' }}
                    />
                ) : null}
                <div>
                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-1">Partner Portal Setup</div>
                    <div className="text-base font-bold text-[#1A1A1A]">{partner?.name ?? 'Your brand'}</div>
                </div>
            </div>

            <h2 className="text-xl font-light text-center mb-2 tracking-tight">Create your account</h2>
            <p className="text-center text-xs text-[#999] font-light mb-8 leading-relaxed">
                Manage your rewards, track redemptions and update your listing — all in one place.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Your name</label>
                    <input type="text" className={INPUT} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="First & last name" />
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Email address</label>
                    <input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@brand.com" required />
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Password</label>
                    <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[#777777] font-bold mb-2">Confirm password</label>
                    <input type="password" className={INPUT} value={confirm} onChange={e => setConfirm(e.target.value)} required />
                </div>

                {error && <div className="text-red-400 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-lg">{error}</div>}
                {status && <div className="text-[#8a7600] text-xs bg-[#E8D200]/5 p-3 border border-[#E8D200]/20 rounded-lg animate-pulse">{status}</div>}

                <button type="submit" disabled={submitting} className="w-full h-12 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-lg hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-50">
                    {submitting ? 'Setting up...' : 'Create Account'}
                </button>
                <p className="text-center text-[10px] text-[#BBBBBB] leading-relaxed">
                    Already have an account? <Link to="/partner/login" className="text-[#8a7600] hover:underline">Sign in</Link>
                </p>
            </form>
        </Shell>
    );
}
