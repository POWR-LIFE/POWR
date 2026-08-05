import React from 'react';
import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
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
                <h1 className="text-4xl font-light tracking-tight mb-2">Privacy Policy</h1>
                <p className="text-[#444] text-sm mb-12">Last updated: 17 April 2026</p>

                <div className="space-y-10 text-[#B0B0B0] text-[15px] leading-relaxed">
                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">1. Who We Are</h2>
                        <p>
                            POWR ("we", "us", "our") operates the POWR mobile application and website at powr.life.
                            We are committed to protecting your personal data and respecting your privacy.
                            This policy explains how we collect, use, and safeguard your information when you use our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">2. Information We Collect</h2>
                        <p className="mb-3">We collect the following categories of information:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong className="text-[#F2F2F2]">Account information:</strong> name, email address, and profile details you provide when you register.</li>
                            <li><strong className="text-[#F2F2F2]">Health and fitness data:</strong> step counts, workout sessions, distance walked or run, and other activity data synced from your device or connected wearables (e.g. Apple Health, Google Health Connect, Fitbit).</li>
                            <li><strong className="text-[#F2F2F2]">Location data:</strong> approximate location used to verify gym visits and show nearby partner rewards. We only access location when you grant permission.</li>
                            <li><strong className="text-[#F2F2F2]">Usage data:</strong> how you interact with the app, features you use, and crash reports to help us improve the service.</li>
                            <li><strong className="text-[#F2F2F2]">Waitlist data:</strong> email address and optional website URL submitted via our waitlist forms.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">3. How We Use Your Information</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>To provide and operate the POWR rewards platform, including tracking activity and awarding points.</li>
                            <li>To verify gym visits and workout sessions for reward eligibility.</li>
                            <li>To display relevant partner rewards and offers near your location.</li>
                            <li>To communicate with you about your account, rewards, and service updates.</li>
                            <li>To improve our services, fix bugs, and develop new features.</li>
                            <li>To prevent fraud and ensure the integrity of the rewards system.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">4. Legal Basis for Processing</h2>
                        <p>We process your personal data on the following legal bases under UK GDPR:</p>
                        <ul className="list-disc pl-6 space-y-2 mt-3">
                            <li><strong className="text-[#F2F2F2]">Contract:</strong> processing necessary to provide you with the POWR service you signed up for.</li>
                            <li><strong className="text-[#F2F2F2]">Consent:</strong> for health data and location data, which you explicitly opt in to share.</li>
                            <li><strong className="text-[#F2F2F2]">Legitimate interest:</strong> for analytics, fraud prevention, and service improvement.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">5. Data Sharing</h2>
                        <p className="mb-3">We do not sell your personal data. We may share data with:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong className="text-[#F2F2F2]">Partner businesses:</strong> only the minimum information needed to fulfil a reward you choose to redeem (e.g. a redemption code). We never share your health data with partners.</li>
                            <li><strong className="text-[#F2F2F2]">Service providers:</strong> trusted third parties who help us operate our platform (e.g. hosting, analytics), bound by data processing agreements.</li>
                            <li><strong className="text-[#F2F2F2]">Legal obligations:</strong> where required by law or to protect our rights.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">6. Data Retention</h2>
                        <p>
                            We retain your personal data for as long as your account is active or as needed to provide you with our services.
                            If you delete your account, we will remove your personal data within 30 days, except where we are required to retain it by law.
                            Waitlist data is retained until the information is no longer needed for its original purpose.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">7. Your Rights</h2>
                        <p className="mb-3">Under UK GDPR, you have the right to:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Access the personal data we hold about you.</li>
                            <li>Request correction of inaccurate data.</li>
                            <li>Request deletion of your data.</li>
                            <li>Withdraw consent at any time (e.g. for health or location data).</li>
                            <li>Object to processing based on legitimate interest.</li>
                            <li>Request data portability.</li>
                        </ul>
                        <p className="mt-3">To exercise any of these rights, contact us at <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a>.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">8. Data Security</h2>
                        <p>
                            We implement appropriate technical and organisational measures to protect your personal data,
                            including encryption in transit and at rest, access controls, and regular security reviews.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">9. International Transfers</h2>
                        <p>
                            Your data may be processed on servers outside the UK. Where this occurs, we ensure appropriate
                            safeguards are in place, such as Standard Contractual Clauses, to protect your data.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">10. Children's Privacy</h2>
                        <p>
                            POWR is not intended for children under the age of 16. We do not knowingly collect personal
                            data from children. If you believe a child has provided us with personal data, please contact us
                            and we will delete it.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">11. Changes to This Policy</h2>
                        <p>
                            We may update this privacy policy from time to time. We will notify you of any material changes
                            by posting the updated policy on our website and updating the "Last updated" date above.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">12. Contact Us</h2>
                        <p>
                            If you have any questions about this privacy policy or our data practices, please contact us at:
                        </p>
                        <p className="mt-3">
                            <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a>
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
