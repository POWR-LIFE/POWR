// Shared chrome for the docs site (/docs/*).
// Two shelves on one shell: reward partners (/docs, /docs/*) and gyms
// (/docs/gyms/*). Partner guides are public: brands and their developers read
// them before they have a login, and the site and emails link to them. Gym
// guides past Getting started need the gym portal's sign-in (see GuideGate):
// they spell out how the gym product works, and gyms are still being let in.
import React, { Suspense, useEffect } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
    Award, BadgePercent, CalendarDays, Code2, Compass, Gift, Lock, MapPin, Palette, PartyPopper,
    Rocket, Settings, Settings2, Store, Ticket, Tv, Users,
} from 'lucide-react';
import { useAuth } from '../../App';
import SHOTS from './shots.json';
import './docs.css';

export const API_BASE = 'https://powr.life/api/partner/v1';

// Placements is a beta brands can't see yet (system_config
// partner_placements_enabled is off). Until it opens, its guide is for POWR
// admins only and the other guides don't point at it. When it opens: set this
// to true, set system_config in scripts/docs-shots/fixtures/partner-base.mjs to
// 'true', and retake the partner shots so the sidebar in them shows Placements.
export const PLACEMENTS_LIVE = false;

// The three ways codes reach POWR. Order mirrors the portal's method chooser
// (manual → shopify → api, reading left-to-right in effort, not pitch order —
// docs sort by "easiest first").
export const METHOD_GUIDES = [
    { path: '/docs/promo-codes', label: 'Promo Codes', icon: Ticket, blurb: 'Upload or generate in the portal' },
    { path: '/docs/shopify', label: 'Shopify', icon: Store, blurb: 'Connect your store, mint per redemption' },
    { path: '/docs/api', label: 'API', icon: Code2, blurb: 'Keys, webhooks, JIT minting' },
];

// Grouped the way a brand meets the portal: get in, put rewards up, get codes
// delivering, get seen, then the day-to-day. Icons match the portal's own nav.
const PARTNER_GROUPS = [
    { title: 'Start here', guides: [
        { path: '/docs/getting-started', label: 'Getting started', icon: Rocket },
        { path: '/docs/rewards', label: 'Rewards', icon: Award },
    ] },
    { title: 'Delivering codes', guides: [
        { path: '/docs', label: 'How codes flow', icon: Compass },
        ...METHOD_GUIDES,
    ] },
    { title: 'Getting seen', guides: [
        { path: '/docs/whats-on', label: 'What’s On', icon: CalendarDays },
        { path: '/docs/placements', label: 'Placements', icon: MapPin, access: PLACEMENTS_LIVE ? 'public' : 'admin' },
        { path: '/docs/studio', label: 'Studio', icon: Palette },
    ] },
    { title: 'Day to day', guides: [
        { path: '/docs/redemptions', label: 'Redemptions', icon: Gift },
        { path: '/docs/settings', label: 'Settings & support', icon: Settings },
    ] },
];

// Same order as the gym portal's sidebar, with getting started in front.
const GYM_GROUPS = [
    { title: 'Start here', guides: [
        { path: '/docs/gyms', label: 'Getting started', icon: Rocket },
        { path: '/docs/gyms/settings', label: 'Settings & team', icon: Settings2, access: 'gym' },
    ] },
    { title: 'Compete', guides: [
        { path: '/docs/gyms/events', label: 'Events', icon: CalendarDays, access: 'gym' },
        { path: '/docs/gyms/discounts', label: 'Discounts', icon: BadgePercent, access: 'gym' },
        { path: '/docs/gyms/clash-nights', label: 'Clash Nights', icon: PartyPopper, access: 'gym' },
        { path: '/docs/gyms/screens', label: 'Screens', icon: Tv, access: 'gym' },
    ] },
    { title: 'Grow', guides: [
        { path: '/docs/gyms/studio', label: 'Studio', icon: Palette, access: 'gym' },
        { path: '/docs/gyms/members', label: 'Members & Retention', icon: Users, access: 'gym' },
    ] },
];

// Everything that differs between the two shelves lives here, so the layout
// below never branches on audience itself.
const AUDIENCES = {
    partner: {
        label: 'Reward partners',
        home: '/docs/getting-started',
        groups: PARTNER_GROUPS,
        portal: { href: '/partner', label: 'Partner portal' },
        help: { href: '/partner/support', label: 'Support' },
        sample: 'Peakform Nutrition',
    },
    gym: {
        label: 'Gyms',
        home: '/docs/gyms',
        groups: GYM_GROUPS,
        portal: { href: '/venue', label: 'Gym portal' },
        help: { href: '/venue/settings#help', label: 'Settings → Help' },
        sample: 'Northpoint Strength',
    },
};

const audienceFor = (pathname) => (pathname === '/docs/gyms' || pathname.startsWith('/docs/gyms/') ? 'gym' : 'partner');

const ALL_GUIDES = [...PARTNER_GROUPS, ...GYM_GROUPS].flatMap((g) => g.guides);

// public · gym (signed in to a gym's portal, or a POWR admin) · admin.
function readable(guide, { user, isGymStaff, isAdmin }) {
    const access = guide?.access ?? 'public';
    if (access === 'public') return true;
    if (access === 'gym') return !!user && (isGymStaff || isAdmin);
    return !!user && isAdmin;
}

/**
 * Wraps a guide's route. A reader who may not see it never loads it: the
 * guide is a lazy chunk, so its text only arrives once they're signed in.
 * Gym guides show a sign-in panel; an admin-only guide sends others to /docs.
 */
export function GuideGate({ children }) {
    const auth = useAuth();
    const location = useLocation();
    const guide = ALL_GUIDES.find((g) => g.path === location.pathname);
    const waiting = auth.loading || (!!auth.user && auth.rolesFor !== auth.user.id);
    if (guide && guide.access && guide.access !== 'public' && waiting) return <DocsLoading />;
    if (!readable(guide, auth)) {
        if (guide?.access === 'admin') return <Navigate to="/docs" replace />;
        return (
            <DocsLayout eyebrow={`Gym guide · ${guide?.label ?? 'Guide'}`} title={guide?.label ?? 'Gym guides'}
                intro="The gym guides are for gyms on POWR. Sign in to your gym portal to read this one: it opens again here once you have.">
                <div className="p-6 sm:p-8 bg-white border border-[#E6E6E1] rounded-3xl">
                    <div className="flex items-center gap-3 mb-3">
                        <Lock size={15} className="text-[#8a7600]" />
                        <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600]">Sign in to read</span>
                    </div>
                    <p className="text-[13px] text-[#555] leading-relaxed mb-6">
                        {auth.user
                            ? 'You’re signed in, but not to a gym’s portal. Sign in with the account your gym invited.'
                            : 'Use the email and password you use for the gym portal, or have a sign-in link emailed to you.'}
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <Link to="/venue/login" state={{ from: location }}
                            className="h-11 px-6 inline-flex items-center bg-[#E8D200] rounded-full text-[10px] font-black uppercase tracking-[0.2em]">
                            <span className="text-[#080808]">Sign in to the gym portal</span>
                        </Link>
                        <Link to="/docs/gyms"
                            className="h-11 px-6 inline-flex items-center bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em]">
                            <span className="text-[#666]">How gyms get access</span>
                        </Link>
                    </div>
                </div>
            </DocsLayout>
        );
    }
    return <Suspense fallback={<DocsLoading />}>{children}</Suspense>;
}

function DocsLoading() {
    return (
        <div className="min-h-screen bg-[#F4F4F1] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

export function CodeBlock({ children, title }) {
    return (
        <div className="my-4 rounded-2xl overflow-hidden border border-[#E6E6E1]">
            {title && (
                <div className="px-5 py-2.5 bg-[#111] border-b border-white/10 text-[10px] uppercase tracking-[0.3em] font-black text-[#888]">{title}</div>
            )}
            <pre className="p-5 bg-[#0d0d0d] text-[12.5px] leading-relaxed text-[#e8e8e2] font-mono overflow-x-auto whitespace-pre">{children}</pre>
        </div>
    );
}

export function Method({ verb }) {
    const color = verb === 'GET' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-[#E8D200]/15 text-[#8a7600] border-[#E8D200]/40';
    return <span className={`text-[10px] font-black tracking-[0.15em] rounded-full px-3 py-1 border ${color}`}>{verb}</span>;
}

export function Endpoint({ verb, path, children }) {
    return (
        <div className="mt-10 mb-6">
            <div className="flex items-center gap-3 flex-wrap">
                <Method verb={verb} />
                <code className="text-[14px] font-mono font-bold text-[#1A1A1A]">{path}</code>
            </div>
            <div className="mt-3 text-[13px] text-[#555] leading-relaxed">{children}</div>
        </div>
    );
}

// Stacks on a phone: two fixed columns leave the description too narrow for
// unbreakable error codes, which then push the page sideways.
export function Param({ name, type, children, required }) {
    return (
        <div className="flex flex-wrap sm:flex-nowrap gap-x-4 gap-y-1 py-2.5 border-b border-[#EFEFEC] text-[12.5px]">
            <code className="font-mono font-bold text-[#1A1A1A] sm:w-44 shrink-0 break-words">{name}</code>
            <span className="text-[#999] sm:w-24 shrink-0">{type}{required ? <span className="text-[#8a7600] font-bold"> · req</span> : ''}</span>
            <span className="text-[#555] leading-relaxed basis-full sm:basis-auto min-w-0 break-words">{children}</span>
        </div>
    );
}

export function Section({ id, title, children }) {
    return (
        <section id={id} className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-4">{title}</h2>
            {children}
        </section>
    );
}

export function P({ children }) {
    return <p className="text-[13px] text-[#555] leading-relaxed mb-3">{children}</p>;
}

// tone: 'note' (gold) · 'warn' (amber) · 'good' (emerald)
export function Callout({ tone = 'note', title, children }) {
    const styles = {
        note: 'bg-[#E8D200]/[0.07] border-[#E8D200]/30 text-[#8a7600]',
        warn: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
        good: 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-700',
    }[tone];
    return (
        <div className={`my-5 p-5 border rounded-2xl ${styles}`}>
            {title && <div className="text-[9px] uppercase tracking-[0.3em] font-black mb-2">{title}</div>}
            <div className="text-[12.5px] leading-relaxed font-medium">{children}</div>
        </div>
    );
}

// Numbered setup steps — the docs mirror of the portal's SetupFlow, so the
// page and the screen read as the same sequence.
export function Steps({ children }) {
    // Drops the spine on the final step — it has nothing below to connect to.
    // Reaching in from the parent keeps Step itself unaware of its position.
    return <div className="my-6 [&>div:last-child>div:first-child]:hidden">{children}</div>;
}

export function Step({ n, title, children }) {
    return (
        <div className="flex gap-5 pb-8 last:pb-0 relative">
            {/* connecting spine */}
            <div className="absolute left-[17px] top-10 bottom-0 w-[1px] bg-[#E6E6E1]" />
            <span className="h-9 w-9 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-[13px] font-black shrink-0 relative z-10">{n}</span>
            <div className="flex-1 min-w-0 pt-1">
                <h3 className="text-[16px] font-bold tracking-tight text-[#1A1A1A] mb-2">{title}</h3>
                <div className="text-[13px] text-[#555] leading-relaxed">{children}</div>
            </div>
        </div>
    );
}

// Scrolls inside its own container so the page body never scrolls sideways.
export function Table({ head, rows }) {
    return (
        <div className="my-5 rounded-2xl border border-[#E6E6E1] overflow-x-auto bg-white">
            <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                    <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                        {head.map(h => (
                            <th key={h} className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.3em] text-[#999] whitespace-nowrap">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFEC]">
                    {rows.map((row, i) => (
                        <tr key={i} className="align-top">
                            {row.map((cell, j) => (
                                <td key={j} className={`px-5 py-3.5 text-[12.5px] leading-relaxed ${j === 0 ? 'font-bold text-[#1A1A1A]' : 'text-[#555]'}`}>{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// A real portal screen, taken by scripts/docs-shots/capture.mjs with made-up
// data. notes = [[markerKey, text], …]: each becomes a numbered pin on the
// picture (placed where the capture found that part of the page) and the
// same number in the list underneath. Never shown wider than it was taken,
// so a narrow panel stays sharp; click to open it full size.
export function Shot({ id, alt, caption, notes = [] }) {
    const shot = SHOTS[id];
    if (!shot) {
        return import.meta.env.DEV ? (
            <div className="my-6 p-6 rounded-2xl border border-dashed border-amber-500/50 text-[12px] text-amber-700">
                Screenshot <code className="font-mono">{id}</code> hasn’t been captured. Run scripts/docs-shots/capture.mjs {id}.
            </div>
        ) : null;
    }
    const src = `/docs/shots/${id}.webp?v=${shot.captured}`;
    const pins = notes.filter(([key]) => shot.markers?.[key]);
    // A narrow panel (a sidebar, a card) sits beside its list on wider screens.
    const side = shot.w <= 420 && pins.length > 0;
    return (
        <figure className={`my-8 ${side ? 'sm:flex sm:items-start sm:gap-8' : ''}`}>
            {/* Beside its list the picture keeps its own width; on a phone it may shrink to fit. */}
            <div className={`relative ${side ? 'mx-auto sm:mx-0 shrink-0 sm:w-[var(--shot-w)]' : 'mx-auto'}`} style={{ maxWidth: shot.w, '--shot-w': `${shot.w}px` }}>
                <a href={src} target="_blank" rel="noopener" className="block rounded-2xl overflow-hidden border border-[#E6E6E1] bg-white shadow-[0_18px_50px_rgba(26,26,26,0.07)]">
                    <img src={src} width={shot.w} height={shot.h} alt={alt ?? caption ?? ''} loading="lazy" decoding="async" className="block w-full h-auto" />
                </a>
                {/* Smaller on a phone, where a wide page shot shrinks to a third. */}
                {pins.map(([key], i) => (
                    <span key={key} aria-hidden="true"
                        className="absolute -translate-x-1/2 -translate-y-1/2 h-[18px] w-[18px] sm:h-6 sm:w-6 rounded-full bg-[#E8D200] text-[#080808] ring-2 ring-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] text-[9px] sm:text-[11px] font-black flex items-center justify-center pointer-events-none"
                        style={{ left: `${shot.markers[key][0]}%`, top: `${shot.markers[key][1]}%` }}>
                        {i + 1}
                    </span>
                ))}
            </div>
            {(caption || pins.length > 0) && (
                <figcaption className={side ? 'mt-5 sm:mt-2 flex-1 min-w-0' : 'mt-4 mx-auto'} style={side ? undefined : { maxWidth: Math.max(shot.w, 480) }}>
                    {caption && <p className="text-[11px] uppercase tracking-[0.2em] font-black text-[#AAA] mb-3">{caption}</p>}
                    {pins.length > 0 && (
                        <ol className="space-y-2.5">
                            {pins.map(([key, text], i) => (
                                <li key={key} className="flex gap-3 text-[12.5px] text-[#555] leading-relaxed">
                                    <span className="h-5 w-5 mt-px rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                                    <span>{text}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                </figcaption>
            )}
        </figure>
    );
}

// nextNote: optional { label, detail } that dresses the Next card in the page's
// own words, for when "what comes next" deserves a reason.
export function DocsLayout({ eyebrow, title, intro, toc = [], nextNote, children }) {
    const { pathname, hash } = useLocation();
    const audience = audienceFor(pathname);
    // The router keeps scroll between routes, so a Next card at the foot of one
    // guide would open the next one at its foot too. Hash links still land.
    useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname, hash]);
    const auth = useAuth();
    const { portal, help, sample } = AUDIENCES[audience];
    // An admin-only guide isn't listed for anyone else; a gym guide is listed
    // with a lock, so a signed-out gym can see what signing in opens.
    const groups = AUDIENCES[audience].groups
        .map((g) => ({ ...g, guides: g.guides.filter((guide) => guide.access !== 'admin' || readable(guide, auth)).map((guide) => ({ ...guide, locked: !readable(guide, auth) })) }))
        .filter((g) => g.guides.length);
    const guides = groups.flatMap(g => g.guides);
    return (
        <div className="powr-docs min-h-screen bg-[#F4F4F1] font-['Outfit'] text-[#1A1A1A]">
            <header className="sticky top-0 z-50 bg-[#F4F4F1]/80 backdrop-blur-xl border-b border-[#E6E6E1]">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4 sm:gap-8 min-w-0">
                        <Link to="/" className="flex items-center gap-3 shrink-0">
                            <img src="/powr-logo-black.png" alt="POWR" style={{ height: 22 }} />
                            <span className="hidden sm:inline text-[10px] uppercase tracking-[0.4em] font-black text-[#8a7600] mt-0.5">Docs</span>
                        </Link>
                        <nav aria-label="Docs for" className="flex items-center gap-1 p-1 bg-white border border-[#E6E6E1] rounded-full">
                            {Object.entries(AUDIENCES).map(([key, a]) => (
                                <Link key={key} to={a.home} aria-current={audience === key ? 'page' : undefined}
                                    className={`h-7 px-3 sm:px-4 flex items-center rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap transition-colors ${
                                        audience === key ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'
                                    }`}>
                                    {a.label}
                                </Link>
                            ))}
                        </nav>
                    </div>
                    <a href={portal.href} className="hidden sm:flex h-9 px-5 items-center bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all whitespace-nowrap">
                        {portal.label} →
                    </a>
                </div>
            </header>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14 flex gap-14">
                <nav className="hidden lg:block w-52 shrink-0">
                    <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6">
                        {groups.map(group => (
                            <div key={group.title} className="mb-7">
                                <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-3">{group.title}</div>
                                <div className="space-y-0.5">
                                    {group.guides.map(g => {
                                        const active = pathname === g.path;
                                        return (
                                            <Link key={g.path} to={g.path}
                                                className={`flex items-center gap-2.5 py-2 px-3 -mx-3 rounded-xl text-[12px] font-bold transition-colors ${
                                                    active ? 'bg-[#E8D200]/15 text-[#8a7600]' : 'text-[#888] hover:text-[#1A1A1A]'
                                                }`}>
                                                <g.icon size={14} className={active ? 'text-[#8a7600]' : 'text-[#BBB]'} />
                                                {g.label}
                                                {g.locked && <Lock size={11} className="ml-auto text-[#CCC]" aria-label="Sign in to read" />}
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        {toc.length > 0 && (
                            <div className="pt-2">
                                <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-3">On this page</div>
                                <div className="space-y-1">
                                    {toc.map(([id, label]) => (
                                        <a key={id} href={`#${id}`} className="block py-1.5 text-[12px] font-bold text-[#888] hover:text-[#1A1A1A] transition-colors">{label}</a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </nav>

                <main className="flex-1 min-w-0 max-w-3xl">
                    <div className="mb-12 sm:mb-14">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="h-[1px] w-10 bg-[#8a7600]" />
                            <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{eyebrow}</span>
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-light tracking-tighter mb-5">{title}</h1>
                        <p className="text-[15px] text-[#666] leading-relaxed">{intro}</p>
                    </div>

                    {/* Mobile guide picker: the sidebar is desktop-only */}
                    <div className="lg:hidden mb-12">
                        <label htmlFor="docs-guide" className="block text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-2">Guides</label>
                        <GuidePicker id="docs-guide" groups={groups} pathname={pathname} />
                    </div>

                    {children}

                    <PrevNext guides={guides} pathname={pathname} nextNote={nextNote} />

                    <div className="pt-8 pb-20 border-t border-[#E6E6E1] mt-12">
                        <p className="text-[13px] text-[#777]">
                            Stuck on something this page doesn’t cover? Ask from{' '}
                            <a href={help.href} className="font-bold text-[#8a7600] hover:underline">{help.label}</a> in the portal,
                            or email <a href="mailto:support@powr.life" className="font-bold text-[#8a7600] hover:underline">support@powr.life</a>.
                        </p>
                        <p className="text-[11px] text-[#AAA] mt-3">
                            The screens in these guides are the real portal, filled with sample data: {sample} and its
                            members are made up.
                        </p>
                    </div>
                </main>
            </div>
        </div>
    );
}

// A native select: a dozen guides as pills wraps to five rows on a phone.
function GuidePicker({ id, groups, pathname }) {
    const navigate = useNavigate();
    return (
        <select id={id} value={pathname} onChange={e => navigate(e.target.value)}
            className="w-full h-12 px-4 bg-white border border-[#E6E6E1] rounded-2xl text-[13px] font-bold text-[#1A1A1A]">
            {groups.map(group => (
                <optgroup key={group.title} label={group.title}>
                    {group.guides.map(g => <option key={g.path} value={g.path}>{g.locked ? `${g.label} (sign in)` : g.label}</option>)}
                </optgroup>
            ))}
        </select>
    );
}

// Previous / next in sidebar order, so a reader can go cover to cover.
function PrevNext({ guides, pathname, nextNote }) {
    const i = guides.findIndex(g => g.path === pathname);
    if (i < 0) return null;
    const prev = guides[i - 1];
    const next = guides[i + 1];
    return (
        <div className="grid grid-cols-2 gap-3 mt-16">
            {prev ? (
                <Link to={prev.path} className="group p-5 bg-white border border-[#E6E6E1] rounded-2xl hover:border-[#E8D200]/50 transition-all">
                    <div className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-1">← Previous</div>
                    <div className="text-[13px] font-bold text-[#1A1A1A] group-hover:text-[#8a7600] transition-colors">{prev.label}</div>
                </Link>
            ) : <span />}
            {next && (
                <Link to={next.path} className="group p-5 bg-white border border-[#E6E6E1] rounded-2xl hover:border-[#E8D200]/50 transition-all text-right">
                    <div className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-1">Next →</div>
                    <div className="text-[13px] font-bold text-[#1A1A1A] group-hover:text-[#8a7600] transition-colors">{nextNote?.label ?? next.label}</div>
                    {nextNote?.detail && <div className="text-[12px] text-[#999] mt-1 leading-relaxed">{nextNote.detail}</div>}
                </Link>
            )}
        </div>
    );
}
