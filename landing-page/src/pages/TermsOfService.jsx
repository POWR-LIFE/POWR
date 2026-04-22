import React from 'react';
import { Link } from 'react-router-dom';

export default function TermsOfService() {
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
                <h1 className="text-4xl font-light tracking-tight mb-2">Terms of Service</h1>
                <p className="text-[#444] text-sm mb-12">Last updated: 22 April 2026</p>

                <div className="space-y-10 text-[#B0B0B0] text-[15px] leading-relaxed">
                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">1. About POWR</h2>
                        <p>
                            POWR ("we", "us", "our") operates the POWR mobile application and website at powr.life.
                            By creating an account or using POWR, you agree to these Terms of Service. If you do not agree,
                            please do not use our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">2. Eligibility</h2>
                        <p>
                            You must be at least 16 years old to use POWR. By using our services, you confirm that you meet
                            this age requirement and that you have the legal capacity to enter into these terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">3. Your Account</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>You are responsible for keeping your account credentials secure and for all activity that occurs under your account.</li>
                            <li>Please notify us immediately at <a href="mailto:support@powr.life" className="text-[#E8D200] hover:underline">support@powr.life</a> if you suspect unauthorised access.</li>
                            <li>You must provide accurate information when creating your account and keep it up to date.</li>
                            <li>You may not create accounts on behalf of others without their consent.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">4. POWR Points &amp; Rewards</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>POWR Points are earned by completing verified physical activities and other qualifying actions within the app.</li>
                            <li>Points have no cash value and cannot be sold, transferred, or exchanged for money.</li>
                            <li>Rewards are subject to availability and may be withdrawn or changed at any time by us or our partner businesses.</li>
                            <li>We reserve the right to adjust, correct, or remove points if we reasonably believe they were earned through fraudulent activity, manipulation, or abuse of the system.</li>
                            <li>Points may expire if your account is inactive for 12 consecutive months.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">5. Health Data</h2>
                        <p>
                            POWR integrates with health platforms (such as Apple Health, Google Health Connect, and wearable devices)
                            to verify your physical activity. By connecting a health source, you consent to POWR reading relevant
                            activity data for the purpose of awarding points. You can revoke this access at any time in your device
                            settings. See our <Link to="/privacy" className="text-[#E8D200] hover:underline">Privacy Policy</Link> for
                            full details on how we handle health data.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">6. Acceptable Use</h2>
                        <p className="mb-3">You agree not to:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Use POWR for any unlawful purpose or in violation of any applicable laws.</li>
                            <li>Attempt to manipulate, cheat, or otherwise game the points or rewards system.</li>
                            <li>Use automated tools, bots, or scripts to interact with POWR.</li>
                            <li>Interfere with or disrupt the integrity or performance of the service.</li>
                            <li>Attempt to gain unauthorised access to any part of POWR or its systems.</li>
                            <li>Impersonate another person or misrepresent your identity.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">7. Partner Businesses</h2>
                        <p>
                            Rewards are provided by independent partner businesses. POWR acts as a platform connecting you
                            with these partners. We are not responsible for the quality, availability, or fulfilment of
                            rewards offered by partners. Any disputes regarding a specific reward should be raised with the
                            partner business directly, though we are happy to assist where we can.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">8. Intellectual Property</h2>
                        <p>
                            All content, branding, and software within the POWR app and website are owned by or licensed to POWR.
                            You may not reproduce, distribute, or create derivative works from any POWR content without our
                            prior written consent.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">9. Disclaimers</h2>
                        <p className="mb-3">
                            POWR is provided "as is" without warranties of any kind. We do not guarantee that:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>The service will be uninterrupted, error-free, or secure at all times.</li>
                            <li>Activity data synced from third-party health sources will always be accurate or complete.</li>
                            <li>Any specific reward will remain available for redemption.</li>
                        </ul>
                        <p className="mt-3">
                            POWR is a fitness rewards platform and is not a medical service. Always consult a healthcare
                            professional before starting a new exercise programme.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">10. Limitation of Liability</h2>
                        <p>
                            To the fullest extent permitted by law, POWR shall not be liable for any indirect, incidental,
                            or consequential damages arising from your use of the service, including but not limited to loss
                            of points, loss of rewards, or data inaccuracies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">11. Termination</h2>
                        <p>
                            We reserve the right to suspend or terminate your account at any time if you breach these terms
                            or engage in conduct that we believe is harmful to other users, partner businesses, or POWR.
                            You may delete your account at any time from within the app settings.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">12. Changes to These Terms</h2>
                        <p>
                            We may update these terms from time to time. We will notify you of material changes via the app
                            or by email. Continued use of POWR after changes take effect constitutes your acceptance of the
                            revised terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">13. Governing Law</h2>
                        <p>
                            These terms are governed by the laws of England and Wales. Any disputes arising from these terms
                            shall be subject to the exclusive jurisdiction of the courts of England and Wales.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">14. Contact Us</h2>
                        <p>
                            If you have any questions about these terms, please contact us at:
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
