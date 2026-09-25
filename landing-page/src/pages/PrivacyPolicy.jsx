import React from 'react';
import { Link } from 'react-router-dom';
import { LOGO_SRC } from '../landing/LogoMorph';

export default function PrivacyPolicy() {
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
                <h1 className="text-4xl font-light tracking-tight mb-2">Privacy Policy</h1>
                <p className="text-[#444] text-sm mb-12">Last updated: 24 September 2026</p>

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
                            <li><strong className="text-[#F2F2F2]">Affiliate programme data:</strong> if you join our invite-only affiliate programme, a public profile (name, photo, short bio), the number of people who tap your link and sign up with your code (never who they are), and — only if you choose to provide it — a postal address so we can send you physical rewards you have earned.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">3. How We Use Your Information</h2>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>To provide and operate the POWR rewards platform, including tracking activity and awarding points.</li>
                            <li>To verify gym visits and workout sessions for reward eligibility.</li>
                            <li>To display relevant partner rewards and offers near your location.</li>
                            <li>To give the gym you pick anonymous totals about its members’ activity, and your own activity only if you switch that on (see “Your gym” below).</li>
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
                            <li><strong className="text-[#F2F2F2]">Consent:</strong> for health data and location data, which you explicitly opt in to share, and for sharing your activity with your gym if you switch that on.</li>
                            <li><strong className="text-[#F2F2F2]">Legitimate interest:</strong> for analytics, fraud prevention, and service improvement.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#F2F2F2] mb-3">5. Data Sharing</h2>
                        <p className="mb-3">We do not sell your personal data. We may share data with:</p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong className="text-[#F2F2F2]">Reward partners:</strong> only the minimum information needed to fulfil a reward you choose to redeem (e.g. a redemption code). We never share your health data with reward partners.</li>
                            <li>
                                <strong className="text-[#F2F2F2]">Your gym:</strong> if you pick a gym as your gym in the app and it uses POWR’s gym portal:
                                <ul className="list-[circle] pl-6 space-y-1.5 mt-2">
                                    <li>it sees anonymous totals about its members’ activity, such as how many members ran this month or which days are busiest, never who did what. We only show these once at least five members have picked that gym;</li>
                                    <li>if you switch on “Share with [your gym]” (Settings, then Privacy), it also sees your name, POWR ID and your recent activity: what you did, when and how often, for example so staff notice if you stop training. It is off unless you turn it on, it stops if you pick another gym, and you can turn it off at any time. If you have gone quiet, that gym can ask POWR to send you one reminder, in POWR’s words, no more than once a fortnight; the Notifications switches in the app apply;</li>
                                    <li>we never share your sleep, heart rate, steps or location with a gym;</li>
                                    <li>if you join an event a gym runs on POWR, that gym sees your name and POWR ID for the event, and gyms that show POWR leaderboards on screens show the names and points of members who train there. You can take yourself off gym boards and screens in Settings, then Privacy.</li>
                                </ul>
                            </li>
                            <li><strong className="text-[#F2F2F2]">Delivery services:</strong> if you are an affiliate who has earned a physical reward, your name and postal address are shared with the courier delivering it, and with nobody else. You can remove your address from your creator settings at any time.</li>
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
