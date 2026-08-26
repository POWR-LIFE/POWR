import React from 'react';

// ─── Creator portal design language ────────────────────────────────────────
// Same light palette as the partner + admin portals (Jamie, 2026-08-26: a
// black canvas is hard for some people to read). What makes it feel like a
// reward rather than a spreadsheet is structure, not darkness: the journey
// hero, the gold glow on the card that matters, big light numbers, and two
// deliberate dark highlight cards (the code, the per-conversion deal).
//
// Anchor gotcha (style.css: unlayered `a { color: inherit }`): never rely on a
// text-* utility on a <Link>/<a>. Colour goes on an inner <span> or inline
// style — see [[project-tailwind-v4-unlayered-anchor-colour]].

export const C = {
    bg:      '#F4F4F1',
    card:    '#FFFFFF',
    ink:     '#1A1A1A',
    border:  '#E6E6E1',
    dark:    '#1A1A1A',
    darkBorder: 'rgba(255,255,255,0.1)',
    gold:    '#E8D200',
    goldInk: '#8a7600',
    goldMid: 'rgba(232,210,0,0.35)',
};

export const INPUT = 'w-full h-12 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-[15px] sm:text-sm text-[#1A1A1A] placeholder-[#CCCCCC] focus:border-[#E8D200]/50 focus:bg-white outline-none transition-all';
export const LABEL = 'block text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3';
export const BTN_GOLD = 'inline-flex items-center justify-center gap-3 h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(232,210,0,0.25)] active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
export const BTN_GHOST = 'inline-flex items-center justify-center gap-3 h-12 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.2em] font-black text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all disabled:opacity-30';

/**
 * Page wrapper: staggers its direct children in on mount.
 *
 * Pure CSS (keyframes in style.css, `creatorRise`), NOT framer-motion: a JS
 * enter animation that never gets its first frame leaves the whole page at
 * opacity 0 — seen in headless Chrome, and the same failure mode exists for
 * a background tab or a throttled phone. `animation-fill-mode: both` from
 * a stylesheet cannot strand content. Reduced-motion users get no animation.
 */
export function Page({ children, className = '' }) {
    return (
        <div className={`space-y-6 sm:space-y-8 ${className}`}>
            {React.Children.map(children, (child, i) =>
                child == null || child === false ? null : (
                    <div key={i} className="creator-rise" style={{ animationDelay: `${i * 60}ms` }}>{child}</div>
                ),
            )}
        </div>
    );
}

export function Card({ children, className = '', glow = false, dark = false, style }) {
    return (
        <div
            className={`relative rounded-3xl border overflow-hidden ${
                dark ? 'bg-[#1A1A1A] text-white' : 'bg-white'
            } ${className}`}
            style={{ borderColor: glow ? C.goldMid : dark ? C.darkBorder : C.border, ...style }}
        >
            {/* Children are DIRECT children of the card so space-y-* / p-* on
                className behave. The glow is absolutely positioned, so the
                margin space-y hands it is inert. */}
            {glow && (
                <div
                    aria-hidden
                    className="absolute -top-32 -right-32 w-80 h-80 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(232,210,0,0.16) 0%, transparent 70%)' }}
                />
            )}
            {children}
        </div>
    );
}

/** Micro-caps label used for every card title / stat label. */
// `onDark`: inside a dark highlight card gold text needs the bright gold.
export function Micro({ children, className = '', gold = false, onDark = false }) {
    const tone = gold ? (onDark ? 'text-[#E8D200]' : 'text-[#8a7600]') : (onDark ? 'text-white/40' : 'text-[#BBBBBB]');
    return (
        <div className={`text-[9px] uppercase tracking-[0.4em] font-black ${tone} ${className}`}>
            {children}
        </div>
    );
}

export function PageTitle({ eyebrow, title, sub, right }) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="min-w-0">
                {eyebrow && <Micro gold className="mb-3">{eyebrow}</Micro>}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tighter text-[#1A1A1A] leading-[0.95]">
                    {title}
                </h1>
                {sub && <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-3">{sub}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
        </div>
    );
}

export function Spinner({ className = 'py-24' }) {
    return (
        <div className={`flex justify-center ${className}`}>
            <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
        </div>
    );
}

export function Empty({ title, children, action }) {
    return (
        <div className="text-center py-16 sm:py-24 px-6">
            <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-[#1A1A1A] mb-3">{title}</h2>
            {children && <p className="text-sm text-[#888] font-light leading-relaxed max-w-md mx-auto">{children}</p>}
            {action && <div className="mt-8">{action}</div>}
        </div>
    );
}

export function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtNum(n) {
    return (n ?? 0).toLocaleString();
}

/** Gold progress bar with a soft glow on the fill. */
export function Bar({ pct, tall = false }) {
    const w = Math.max(0, Math.min(100, pct));
    return (
        <div className={`${tall ? 'h-2.5' : 'h-1.5'} rounded-full overflow-hidden bg-[#F4F4F1] border border-[#E6E6E1]`}>
            <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${w}%`, background: 'linear-gradient(90deg, #B8A600, #E8D200)', boxShadow: w > 0 ? '0 0 16px rgba(232,210,0,0.45)' : 'none' }}
            />
        </div>
    );
}
