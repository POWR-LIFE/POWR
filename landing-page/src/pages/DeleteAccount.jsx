import React from 'react';
import { Link } from 'react-router-dom';
import { LOGO_SRC } from '../landing/LogoMorph';

export default function DeleteAccount() {
    return (
        <div className="min-h-screen bg-[#080808] text-[#F2F2F2] font-['Outfit'] fixed inset-0 z-[100] overflow-y-auto">
            <nav className="border-b border-[#1E1E1E] bg-[#080808]/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link to="/">
                        <img
                            src={LOGO_SRC}
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
                <h1 className="text-4xl font-light tracking-tight mb-2">Delete Your Account</h1>
                <p className="text-[#444] text-sm mb-12">How to permanently delete your POWR account and associated data.</p>

                <div className="space-y-10 text-[#B0B0B0] text-[15px] leading-relaxed">

                    <section className="p-6 border border-[#1E1E1E] rounded-2xl bg-[#0B0B0B]">
                        <p className="text-[#999] text-[11px] uppercase tracking-[0.3em] font-black mb-3">Option 1 — In-App (Instant)</p>
                        <ol className="list-decimal pl-5 space-y-2">
                            <li>Open the POWR app and go to <strong className="text-[#F2F2F2]">Settings</strong>.</li>
                            <li>Scroll to the bottom and tap <strong className="text-[#F2F2F2]">Delete Account</strong>.</li>
                            <li>Confirm when prompted. Your account and all data will be permanently deleted immediately.</li>
                        </ol>
                    </section>

                    <section className="p-6 border border-[#1E1E1E] rounded-2xl bg-[#0B0B0B]">
                        <p className="text-[#999] text-[11px] uppercase tracking-[0.3em] font-black mb-3">Option 2 — Email Request</p>
                        <p>
                            If you no longer have access to the app, email us at{' '}
                            <a href="mailto:support@powr.life?subject=Account%20Deletion%20Request" className="text-[#E8D200] hover:underline font-medium">
                                support@powr.life
                            </a>{' '}
                            with the subject line <strong className="text-[#F2F2F2]">Account Deletion Request</strong> and include the email address linked to your account. We will process your request within 30 days.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-4">What gets deleted</h2>
                        <p className="mb-4">When your account is deleted, the following data is permanently and irreversibly removed:</p>
                        <div className="space-y-3">
                            {[
                                'Your profile (name, profile photo, bio)',
                                'Activity sessions and health data synced to POWR',
                                'Points balance and reward redemption history',
                                'Wearable connections (Fitbit, WHOOP, Samsung Health)',
                                'Notification preferences and device tokens',
                                'All other account-level data stored by POWR',
                            ].map(item => (
                                <div key={item} className="flex items-start gap-3 p-4 border border-[#1E1E1E] rounded-xl">
                                    <span className="text-[#E8D200] mt-0.5 shrink-0">✓</span>
                                    <span className="text-sm">{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">Retention period</h2>
                        <p>
                            Deletion is permanent and takes effect immediately when performed in-app, or within 30 days for email requests. We do not retain your personal data after deletion. Anonymised, aggregated analytics that cannot be linked back to you may be retained for service improvement purposes.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">Questions</h2>
                        <p>
                            For any questions about your data, see our{' '}
                            <Link to="/privacy" className="text-[#E8D200] hover:underline">Privacy Policy</Link>{' '}
                            or contact us at{' '}
                            <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a>.
                        </p>
                    </section>

                </div>
            </main>
        </div>
    );
}
