import React, { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n, { formatLocale } from '../../lib/i18n';
import { Card, Micro, Spinner, BTN_GOLD } from '../../components/portal/ui';

// Gym Clash packages (Jamie's "Gym Clash packages" sheet, 2026-09-24). What a
// package UNLOCKS is decided in the database (_gym_features) and arrives here
// as gym_package().features; this file is only the words and prices the
// portal shows, and the lock panel.
//
// Package names (Clash, Clash+, Clash Pro, Founding Pro) are product names and
// stay as they are in every language. `price` / `per` stay English for the
// admin pages (GymPortals); the gym's own pages show `priceKey` / `perKey`.
// `line`, `note`, `tag` and `items` are venueShell keys, translated where shown.

export const PACKAGE_LABEL = { clash: 'Clash', clash_plus: 'Clash+', pro: 'Clash Pro', founding: 'Founding Pro' };

export const PACKAGES = [
    {
        key: 'clash', name: 'Clash', line: 'venueShell:packages.clash.line', price: 'Free', priceKey: 'venueShell:packages.free', per: '', note: 'venueShell:packages.clash.note',
        items: [
            'venueShell:packages.clash.items.board',
            'venueShell:packages.clash.items.perMember',
            'venueShell:packages.clash.items.leaderboard',
            'venueShell:packages.clash.items.ranking',
        ],
    },
    {
        key: 'clash_plus', name: 'Clash+', line: 'venueShell:packages.clashPlus.line', price: '£129', per: '/ month', perKey: 'venueShell:packages.perMonth', note: 'venueShell:packages.clashPlus.note',
        items: [
            'venueShell:packages.clashPlus.items.everything',
            'venueShell:packages.clashPlus.items.challenges',
            'venueShell:packages.clashPlus.items.discounts',
            'venueShell:packages.clashPlus.items.eventCode',
            'venueShell:packages.clashPlus.items.dashboard',
            'venueShell:packages.clashPlus.items.retention',
        ],
    },
    {
        key: 'pro', name: 'Clash Pro', line: 'venueShell:packages.pro.line', price: '£349', per: '/ month', perKey: 'venueShell:packages.perMonth', note: 'venueShell:packages.pro.note', tag: 'venueShell:packages.pro.tag',
        items: [
            'venueShell:packages.pro.items.everything',
            'venueShell:packages.pro.items.nights',
            'venueShell:packages.pro.items.studio',
            'venueShell:packages.pro.items.footage',
            'venueShell:packages.pro.items.retention',
            'venueShell:packages.pro.items.insights',
            'venueShell:packages.pro.items.leads',
            'venueShell:packages.pro.items.report',
        ],
    },
    {
        key: 'founding', name: 'Founding Pro', line: 'venueShell:packages.founding.line', price: '£1,995', per: '/ year', perKey: 'venueShell:packages.perYear', note: 'venueShell:packages.founding.note', tag: 'venueShell:packages.founding.tag',
        items: [
            'venueShell:packages.founding.items.everything',
            'venueShell:packages.founding.items.dates',
            'venueShell:packages.founding.items.priceLocked',
            'venueShell:packages.founding.items.status',
            'venueShell:packages.founding.items.monthly',
        ],
    },
];

// The first package that includes each gated part of the portal.
export const FEATURE_PACKAGE = { events: 'clash_plus', insights: 'clash_plus', studio: 'pro', people: 'pro' };

const LOCKS = {
    events: {
        title: 'venueShell:locks.events.title',
        body: 'venueShell:locks.events.body',
    },
    insights: {
        title: 'venueShell:locks.insights.title',
        body: 'venueShell:locks.insights.body',
    },
    people: {
        title: 'venueShell:locks.people.title',
        body: 'venueShell:locks.people.body',
    },
    // Unlocked with 'insights' (Clash+), in its own words.
    retention: {
        title: 'venueShell:locks.retention.title',
        body: 'venueShell:locks.retention.body',
    },
    studio: {
        title: 'venueShell:locks.studio.title',
        body: 'venueShell:locks.studio.body',
    },
    // Unlocked with 'events' (Clash+), in its own words.
    discounts: {
        title: 'venueShell:locks.discounts.title',
        body: 'venueShell:locks.discounts.body',
    },
};

export function trialDaysLeft(pkg) {
    if (!pkg?.on_trial || !pkg.trial_ends_at) return 0;
    return Math.max(0, Math.ceil((new Date(pkg.trial_ends_at).getTime() - Date.now()) / 86400000));
}

export const fmtDate = (iso) => (iso
    ? new Intl.DateTimeFormat(formatLocale(), { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
    : '');

/** "Trial · 91 days left" or "Clash+", in the language on screen. */
export function packageLine(pkg) {
    if (!pkg) return '';
    if (pkg.on_trial) {
        const n = trialDaysLeft(pkg);
        if (n === 0) return i18n.t('venueShell:packageLine.trialEnded');
        return i18n.t('venueShell:packageLine.trial', { count: n });
    }
    return pkg.package === 'clash' ? i18n.t('venueShell:packageLine.clashFree') : PACKAGE_LABEL[pkg.package];
}

// Stand-in when gym_package can't be read: every page opens, no package shown.
export const PACKAGE_UNKNOWN = { unknown: true, features: { boards: true, events: true, insights: true, studio: true, people: true } };

// The layout loads the gym's package once and shares it with every page.
export const PackageContext = createContext({ pkg: null, refresh: () => {} });
export const usePackage = () => useContext(PackageContext);

/** What a gym sees in place of a part its package doesn't include. */
export function Locked({ feature, lock: lockKey }) {
    const { t } = useTranslation();
    const { pkg } = usePackage();
    const lock = LOCKS[lockKey ?? feature];
    const want = PACKAGES.find((p) => p.key === FEATURE_PACKAGE[feature]);
    return (
        <Card className="p-8 sm:p-12" glow>
            <div className="flex items-center gap-3 mb-5">
                <Lock size={14} className="text-[#8a7600]" />
                <Micro gold>{want.key === 'clash_plus' ? t('venueShell:locks.andPro', { name: want.name }) : want.name}</Micro>
            </div>
            <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05] max-w-2xl">{t(lock.title)}</h2>
            <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-xl">{t(lock.body)}</p>
            {pkg && !pkg.on_trial && (
                <p className="text-[12px] text-[#AAAAAA] mt-3">
                    {t(pkg.package === 'clash' ? 'venueShell:locks.youreOnFree' : 'venueShell:locks.youreOn', { name: PACKAGE_LABEL[pkg.package] })}
                </p>
            )}
            <Link to="/venue/package" className={`${BTN_GOLD} mt-8`} style={{ color: '#080808' }}>{t('venueShell:locks.seePackages')}</Link>
        </Card>
    );
}

/** Route wrapper: the page if the package includes it, else the lock panel (`lock` picks other words for it). */
export function Gate({ feature, lock, children }) {
    const { pkg } = usePackage();
    if (!pkg) return <Spinner />;
    return pkg.features?.[feature] ? children : <Locked feature={feature} lock={lock} />;
}
