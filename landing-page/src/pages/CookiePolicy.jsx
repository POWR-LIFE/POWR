import React from 'react';
import { Link } from 'react-router-dom';

export default function CookiePolicy() {
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
                <h1 className="text-4xl font-light tracking-tight mb-2">Cookie Policy</h1>
                <p className="text-[#444] text-sm mb-12">Last updated: 17 April 2026</p>

                <div className="space-y-10 text-[#B0B0B0] text-[15px] leading-relaxed">
                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">1. What Are Cookies</h2>
                        <p>
                            Cookies are small text files stored on your device when you visit a website. They help the
                            website remember your preferences and understand how you use the site. We use cookies and
                            similar technologies on powr.life to provide and improve our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">2. Cookies We Use</h2>
                        <p className="mb-4">We use the following categories of cookies:</p>

                        <div className="space-y-6">
                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Strictly Necessary</h3>
                                <p className="text-sm">
                                    These cookies are essential for the website to function. They include authentication cookies
                                    that keep you signed in and security cookies that protect against fraud. You cannot opt out
                                    of these cookies.
                                </p>
                            </div>

                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Functional</h3>
                                <p className="text-sm">
                                    These cookies remember your preferences and choices (such as your language or region) to
                                    provide a more personalised experience.
                                </p>
                            </div>

                            <div className="p-5 border border-[#1E1E1E] rounded-xl">
                                <h3 className="text-sm font-bold text-[#F2F2F2] uppercase tracking-wide mb-2">Analytics</h3>
                                <p className="text-sm">
                                    These cookies help us understand how visitors interact with our website by collecting
                                    anonymous usage data. We use this information to improve our website and services.
                                    We do not use these cookies to identify individual users.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">3. Third-Party Cookies</h2>
                        <p>
                            Some cookies are placed by third-party services that appear on our pages. We use third-party
                            services for hosting (Vercel), authentication (Supabase), and fonts (Google Fonts). These
                            services may set their own cookies according to their own privacy policies. We do not use
                            third-party advertising or tracking cookies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">4. Managing Cookies</h2>
                        <p className="mb-3">
                            You can control and manage cookies in several ways:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong className="text-[#F2F2F2]">Browser settings:</strong> most browsers allow you to block or delete cookies through their settings. Note that blocking all cookies may affect the functionality of our website.</li>
                            <li><strong className="text-[#F2F2F2]">Device settings:</strong> your mobile device may provide settings to manage cookies and similar technologies in apps.</li>
                        </ul>
                        <p className="mt-3">
                            For more information about managing cookies, visit{' '}
                            <a href="https://www.aboutcookies.org" target="_blank" rel="noopener noreferrer" className="text-[#E8D200] hover:underline">aboutcookies.org</a>.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">5. Cookie Duration</h2>
                        <p>
                            Cookies can be either "session" cookies or "persistent" cookies. Session cookies are deleted
                            when you close your browser. Persistent cookies remain on your device for a set period or
                            until you delete them. Our authentication cookies persist for up to 30 days to keep you signed in.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">6. Changes to This Policy</h2>
                        <p>
                            We may update this cookie policy from time to time to reflect changes in our practices or for
                            operational, legal, or regulatory reasons. We will update the "Last updated" date at the top of
                            this page when we make changes.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">7. Contact Us</h2>
                        <p>
                            If you have any questions about our use of cookies, please contact us at:
                        </p>
                        <p className="mt-3">
                            <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a>
                        </p>
                        <p className="mt-3">
                            For more information about how we handle your personal data, please see our{' '}
                            <Link to="/privacy" className="text-[#E8D200] hover:underline">Privacy Policy</Link>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
