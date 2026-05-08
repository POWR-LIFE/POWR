import React from 'react';
import { Link } from 'react-router-dom';

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
                    <section className="p-6 border border-[#1E1E1E] rounded-2xl bg-[#0B0B0B]">
                        <p className="text-[#999] text-[11px] uppercase tracking-[0.3em] font-black mb-3">Contact Support</p>
                        <p>
                            Email us anytime at{' '}
                            <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline font-medium">support@powr.life</a>.
                        </p>
                        <p className="mt-3">Typical response time: within 24 hours on business days.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">What to include in your message</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>The email linked to your POWR account</li>
                            <li>Your device model and OS version</li>
                            <li>A short description of the issue</li>
                            <li>Screenshots if available</li>
                        </ul>
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