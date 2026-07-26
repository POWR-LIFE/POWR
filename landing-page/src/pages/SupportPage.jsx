import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Mirrors CATEGORIES in app/help-centre.tsx and the allowlist in the
// submit-support-ticket function — all three must agree or the insert 400s.
const CATEGORIES = [
    { id: 'points_rewards', label: 'Points & Rewards' },
    { id: 'account',        label: 'Account & Profile' },
    { id: 'health_sync',    label: 'Health & Sync' },
    { id: 'gym_checkin',    label: 'Gym Check-in' },
    { id: 'challenges',     label: 'Challenges' },
    { id: 'technical',      label: 'Technical Issue' },
    { id: 'feedback',       label: 'Feedback / Other' },
];

const FIELD = 'w-full bg-[#0B0B0B] border border-[#1E1E1E] rounded-xl px-4 py-3 text-[15px] text-[#F2F2F2] placeholder-[#444] focus:outline-none focus:border-[#E8D200]/50 transition-colors';

function ContactForm() {
    const [category, setCategory] = useState('');
    const [email, setEmail]       = useState('');
    const [subject, setSubject]   = useState('');
    const [message, setMessage]   = useState('');
    const [company, setCompany]   = useState(''); // honeypot — real users never see this
    const [status, setStatus]     = useState('idle'); // idle | sending | sent
    const [error, setError]       = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setStatus('sending');
        try {
            const { data, error: fnError } = await supabase.functions.invoke('submit-support-ticket', {
                body: { email, category, subject, message, company },
            });
            if (fnError) {
                // supabase-js surfaces a non-2xx as FunctionsHttpError and leaves the
                // body unparsed on error.context — that is where our message lives.
                let msg = 'Could not send your message. Please try again.';
                try {
                    const parsed = await fnError.context?.json();
                    if (parsed?.error) msg = parsed.error;
                } catch { /* non-JSON body — keep the generic message */ }
                setError(msg);
                setStatus('idle');
                return;
            }
            if (!data?.ok) {
                setError(data?.error ?? 'Could not send your message. Please try again.');
                setStatus('idle');
                return;
            }
            setStatus('sent');
        } catch {
            setError('Could not reach support. Please check your connection and try again.');
            setStatus('idle');
        }
    };

    if (status === 'sent') {
        return (
            <section className="p-6 border border-[#E8D200]/30 rounded-2xl bg-[#E8D200]/[0.04]">
                <p className="text-[#E8D200] text-[11px] uppercase tracking-[0.3em] font-black mb-3">Message sent</p>
                <p className="text-[#F2F2F2]">Thanks — we have your message and will reply within one business day.</p>
                <p className="mt-3 text-sm text-[#B0B0B0]">
                    We will get back to you at <span className="text-[#F2F2F2]">{email}</span>.
                </p>
            </section>
        );
    }

    return (
        <section className="p-6 border border-[#1E1E1E] rounded-2xl bg-[#0B0B0B]">
            <p className="text-[#999] text-[11px] uppercase tracking-[0.3em] font-black mb-5">Contact Support</p>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="support-category" className="block text-xs uppercase tracking-widest text-[#777] font-bold mb-2">
                        What do you need help with?
                    </label>
                    <select
                        id="support-category"
                        required
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className={FIELD}
                    >
                        <option value="" disabled>Choose a topic…</option>
                        {CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="support-email" className="block text-xs uppercase tracking-widest text-[#777] font-bold mb-2">
                        The email on your POWR account
                    </label>
                    <input
                        id="support-email"
                        type="email"
                        required
                        maxLength={254}
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className={FIELD}
                    />
                </div>

                <div>
                    <label htmlFor="support-subject" className="block text-xs uppercase tracking-widest text-[#777] font-bold mb-2">
                        Subject
                    </label>
                    <input
                        id="support-subject"
                        type="text"
                        required
                        maxLength={200}
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Short summary of the issue"
                        className={FIELD}
                    />
                </div>

                <div>
                    <label htmlFor="support-message" className="block text-xs uppercase tracking-widest text-[#777] font-bold mb-2">
                        How can we help?
                    </label>
                    <textarea
                        id="support-message"
                        required
                        minLength={10}
                        maxLength={5000}
                        rows={6}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Include your device model and OS version, and what you expected to happen."
                        className={`${FIELD} resize-y`}
                    />
                </div>

                {/* Honeypot. Off-screen rather than display:none so bots that skip
                    hidden fields still fill it; hidden from assistive tech and tab order. */}
                <div aria-hidden="true" className="absolute left-[-9999px] w-px h-px overflow-hidden">
                    <label htmlFor="support-company">Company</label>
                    <input
                        id="support-company"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                    />
                </div>

                {error && (
                    <p role="alert" className="text-sm text-[#F87171]">{error}</p>
                )}

                <button
                    type="submit"
                    disabled={status === 'sending'}
                    className="w-full sm:w-auto px-8 py-3 rounded-full bg-[#E8D200] text-[#0d0d0d] text-sm font-bold tracking-wide hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {status === 'sending' ? 'Sending…' : 'Send message'}
                </button>

                <p className="text-xs text-[#555] pt-1">
                    Prefer email? Write to{' '}
                    <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a>.
                    Typical response time: within 24 hours on business days.
                </p>
            </form>
        </section>
    );
}

export default function SupportPage() {
    return (
        <div className="min-h-screen bg-[#080808] text-[#F2F2F2] font-['Outfit'] fixed inset-0 z-[100] overflow-y-auto">
            <nav className="border-b border-[#1E1E1E] bg-[#080808]/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link to="/">
                        <img
                            src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext.png?v=1.1"
                            alt="POWR Logo"
                            className="h-8"
                        />
                    </Link>
                    <Link to="/" className="text-[10px] uppercase tracking-widest text-[#444] hover:text-[#E8D200] transition-colors font-bold">
                        Back to Home
                    </Link>
                </div>
            </nav>

            <main className="max-w-3xl mx-auto px-6 py-16 pb-32">
                <h1 className="text-4xl font-light tracking-tight mb-2">Support</h1>
                <p className="text-[#444] text-sm mb-12">Need help with POWR? We are here for you.</p>

                <div className="space-y-10 text-[#B0B0B0] text-[15px] leading-relaxed">
                    <ContactForm />

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">What to include in your message</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>The email linked to your POWR account</li>
                            <li>Your device model and OS version</li>
                            <li>A short description of the issue</li>
                        </ul>
                        <p className="mt-3 text-sm text-[#777]">
                            Already using the app? Settings → Help Centre has the same form plus answers to
                            common questions, and it links your ticket to your account automatically.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">Common topics</h2>
                        <div className="space-y-4">
                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Points and Rewards</h3>
                                <p className="text-sm">Questions about point balances, redemptions, reward eligibility, and partner offers.</p>
                            </div>

                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Health and Activity Sync</h3>
                                <p className="text-sm">Support for Apple Health, Health Connect, Fitbit, WHOOP, and Samsung Health syncing issues.</p>
                            </div>

                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Account and Security</h3>
                                <p className="text-sm">Help with sign-in, password reset, email changes, and account access.</p>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">Related policies</h2>
                        <p>
                            For details on how we handle your data, please read our{' '}
                            <Link to="/privacy" className="text-[#E8D200] hover:underline">Privacy Policy</Link>{' '}
                            and{' '}
                            <Link to="/cookies" className="text-[#E8D200] hover:underline">Cookie Policy</Link>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}