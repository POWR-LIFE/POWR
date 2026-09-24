import React, { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Card, Micro, Spinner, BTN_GOLD } from '../../components/portal/ui';

// Gym Clash packages (Jamie's "Gym Clash packages" sheet, 2026-09-24). What a
// package UNLOCKS is decided in the database (_gym_features) and arrives here
// as gym_package().features; this file is only the words and prices the
// portal shows, and the lock panel.

export const PACKAGE_LABEL = { clash: 'Clash', clash_plus: 'Clash+', pro: 'Clash Pro', founding: 'Founding Pro' };

export const PACKAGES = [
    {
        key: 'clash', name: 'Clash', line: 'Get on the board.', price: 'Free', per: '', note: 'Always',
        items: [
            'Your gym on the POWR area leaderboard',
            'Gym vs gym, scored per active member so size doesn’t win',
            'Member leaderboard inside your gym',
            'Your live ranking',
        ],
    },
    {
        key: 'clash_plus', name: 'Clash+', line: 'Compete and reward. Prizes on us.', price: '£129', per: '/ month', note: 'Cancel anytime',
        items: [
            'Everything in Clash',
            'Run your own in-gym challenges, monthly or whenever you want',
            'Prizes supplied by POWR brand partners',
            'Monthly data dashboard: activity, engagement trends, event turnout',
        ],
    },
    {
        key: 'pro', name: 'Clash Pro', line: 'Events, content and data. The full engine.', price: '£349', per: '/ month', note: 'or £4,188 / year', tag: 'Most complete',
        items: [
            'Everything in Clash+',
            '4 POWR Clash Nights a year, one per quarter. We bring the DJ, photographer and partner prizes',
            'Content portal: event footage turned into branded reels, TikToks and carousels, ready to post',
            'Upload your own footage from classes and PT sessions, and make content in minutes',
            'Full member insights (opted-in members), including early warning when members go quiet',
            'Bring-a-friend guest leads from every event',
            'Quarterly insights report: 3 trends, 3 actions, with a matched brand partner',
        ],
    },
    {
        key: 'founding', name: 'Founding Pro', line: 'Clash Pro at the founding price, locked in.', price: '£1,995', per: '/ year', note: 'Paid upfront. Save over 50%', tag: 'First 10 gyms',
        items: [
            'Everything in Clash Pro',
            'All 4 Clash Night dates booked at signing',
            'Price locked on renewal',
            'Founding gym status on the POWR leaderboard',
            'Prefer monthly? £249 / month',
        ],
    },
];

// The first package that includes each gated part of the portal.
export const FEATURE_PACKAGE = { events: 'clash_plus', insights: 'clash_plus', studio: 'pro' };

const LOCKS = {
    events: {
        title: 'Your own challenges come with Clash+',
        body: 'Monthly challenges, weekend sprints and finale nights that run themselves: the board, the pushes and the reveal.',
    },
    insights: {
        title: 'The Members dashboard comes with Clash+',
        body: 'Who’s training, when your gym is busiest and what your members do, week by week.',
    },
    studio: {
        title: 'Studio comes with Clash Pro',
        body: 'Turn your photos and clips into posts, reels and posters in minutes, filled from your events and your board.',
    },
};

export function trialDaysLeft(pkg) {
    if (!pkg?.on_trial || !pkg.trial_ends_at) return 0;
    return Math.max(1, Math.ceil((new Date(pkg.trial_ends_at).getTime() - Date.now()) / 86400000));
}

export const fmtDate = (iso) => (iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
    : '');

/** "Free trial · 91 days left" or "Clash+". */
export function packageLine(pkg) {
    if (!pkg) return '';
    if (pkg.on_trial) {
        const n = trialDaysLeft(pkg);
        return `Trial · ${n} day${n === 1 ? '' : 's'} left`;
    }
    return pkg.package === 'clash' ? 'Clash · free' : PACKAGE_LABEL[pkg.package];
}

// Stand-in when gym_package can't be read: every page opens, no package shown.
export const PACKAGE_UNKNOWN = { unknown: true, features: { boards: true, events: true, insights: true, studio: true } };

// The layout loads the gym's package once and shares it with every page.
export const PackageContext = createContext({ pkg: null, refresh: () => {} });
export const usePackage = () => useContext(PackageContext);

/** What a gym sees in place of a part its package doesn't include. */
export function Locked({ feature }) {
    const { pkg } = usePackage();
    const lock = LOCKS[feature];
    const want = PACKAGES.find((p) => p.key === FEATURE_PACKAGE[feature]);
    return (
        <Card className="p-8 sm:p-12" glow>
            <div className="flex items-center gap-3 mb-5">
                <Lock size={14} className="text-[#8a7600]" />
                <Micro gold>{want.name}{want.key === 'clash_plus' ? ' and Clash Pro' : ''}</Micro>
            </div>
            <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05] max-w-2xl">{lock.title}</h2>
            <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-xl">{lock.body}</p>
            {pkg && !pkg.on_trial && (
                <p className="text-[12px] text-[#AAAAAA] mt-3">
                    You’re on {PACKAGE_LABEL[pkg.package]}{pkg.package === 'clash' ? ', the free package' : ''}.
                </p>
            )}
            <Link to="/venue/package" className={`${BTN_GOLD} mt-8`} style={{ color: '#080808' }}>See packages</Link>
        </Card>
    );
}

/** Route wrapper: the page if the package includes it, else the lock panel. */
export function Gate({ feature, children }) {
    const { pkg } = usePackage();
    if (!pkg) return <Spinner />;
    return pkg.features?.[feature] ? children : <Locked feature={feature} />;
}
