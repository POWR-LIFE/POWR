// Shared chrome for the public docs site (/docs/*).
// One shell, four guides: an overview of how codes flow through POWR, plus a
// setup guide per delivery method. Deliberately static and dependency-free —
// a partner should be able to get live from these pages alone, signed out.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Code2, Compass, Store, Ticket } from 'lucide-react';

export const API_BASE = 'https://powr.life/api/partner/v1';

// Order mirrors the portal's method chooser (overview, then manual → shopify → api
// reading left-to-right in effort, not pitch order — docs sort by "easiest first").
export const GUIDES = [
    { path: '/docs', label: 'Overview', icon: Compass, blurb: 'How codes flow through POWR' },
    { path: '/docs/promo-codes', label: 'Promo Codes', icon: Ticket, blurb: 'Upload or generate in the portal' },
    { path: '/docs/shopify', label: 'Shopify', icon: Store, blurb: 'Connect your store, mint per redemption' },
    { path: '/docs/api', label: 'API', icon: Code2, blurb: 'Keys, webhooks, JIT minting' },
];

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

export function Param({ name, type, children, required }) {
    return (
        <div className="flex gap-4 py-2.5 border-b border-[#EFEFEC] text-[12.5px]">
            <code className="font-mono font-bold text-[#1A1A1A] w-44 shrink-0 break-words">{name}</code>
            <span className="text-[#999] w-24 shrink-0">{type}{required ? <span className="text-[#8a7600] font-bold"> · req</span> : ''}</span>
            <span className="text-[#555] leading-relaxed">{children}</span>
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
    return <div className="my-6">{children}</div>;
}

export function Step({ n, title, children }) {
    return (
        <div className="flex gap-5 pb-8 last:pb-0 relative">
            {/* connecting spine */}
            <div className="absolute left-[17px] top-10 bottom-0 w-[1px] bg-[#E6E6E1] last:hidden" />
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

export function NextUp({ to, label, detail }) {
    return (
        <Link to={to} className="group flex items-center gap-5 p-6 bg-white border border-[#E6E6E1] rounded-3xl hover:border-[#E8D200]/50 transition-all">
            <div className="flex-1 min-w-0">
                <div className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-1.5">Next</div>
                <div className="text-[15px] font-bold text-[#1A1A1A] group-hover:text-[#8a7600] transition-colors">{label}</div>
                <div className="text-[12px] text-[#999] mt-1 leading-relaxed">{detail}</div>
            </div>
            <span className="text-[#CCC] group-hover:text-[#8a7600] transition-colors text-xl shrink-0">→</span>
        </Link>
    );
}

export function DocsLayout({ eyebrow, title, intro, toc = [], children }) {
    const { pathname } = useLocation();
    return (
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] text-[#1A1A1A]">
            <header className="sticky top-0 z-50 bg-[#F4F4F1]/80 backdrop-blur-xl border-b border-[#E6E6E1]">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
                    <Link to="/" className="flex items-center gap-3 shrink-0">
                        <img src="/powr-logo-black.png" alt="POWR" style={{ height: 22 }} />
                        <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#8a7600] mt-0.5">Docs</span>
                    </Link>
                    <a href="/partner" className="h-9 px-5 flex items-center bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all whitespace-nowrap">
                        Partner portal →
                    </a>
                </div>
            </header>

            <div className="max-w-6xl mx-auto px-6 py-14 flex gap-14">
                <nav className="hidden lg:block w-52 shrink-0">
                    <div className="sticky top-24">
                        <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-4">Guides</div>
                        <div className="space-y-1 mb-9">
                            {GUIDES.map(g => {
                                const active = pathname === g.path;
                                return (
                                    <Link key={g.path} to={g.path}
                                        className={`flex items-center gap-2.5 py-2 px-3 -mx-3 rounded-xl text-[12px] font-bold transition-colors ${
                                            active ? 'bg-[#E8D200]/15 text-[#8a7600]' : 'text-[#888] hover:text-[#1A1A1A]'
                                        }`}>
                                        <g.icon size={14} className={active ? 'text-[#8a7600]' : 'text-[#BBB]'} />
                                        {g.label}
                                    </Link>
                                );
                            })}
                        </div>
                        {toc.length > 0 && (
                            <>
                                <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-4">On this page</div>
                                <div className="space-y-1">
                                    {toc.map(([id, label]) => (
                                        <a key={id} href={`#${id}`} className="block py-1.5 text-[12px] font-bold text-[#888] hover:text-[#1A1A1A] transition-colors">{label}</a>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </nav>

                <main className="flex-1 min-w-0 max-w-3xl">
                    <div className="mb-14">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="h-[1px] w-10 bg-[#8a7600]" />
                            <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{eyebrow}</span>
                        </div>
                        <h1 className="text-5xl font-light tracking-tighter mb-5">{title}</h1>
                        <p className="text-[15px] text-[#666] leading-relaxed">{intro}</p>
                    </div>

                    {/* Mobile guide switcher — the sidebar is desktop-only */}
                    <div className="lg:hidden flex gap-2 flex-wrap mb-12">
                        {GUIDES.map(g => (
                            <Link key={g.path} to={g.path}
                                className={`flex items-center gap-2 h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-colors ${
                                    pathname === g.path ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]' : 'bg-white border-[#E6E6E1] text-[#888]'
                                }`}>
                                <g.icon size={12} /> {g.label}
                            </Link>
                        ))}
                    </div>

                    {children}

                    <div className="pt-8 pb-20 border-t border-[#E6E6E1] mt-16">
                        <p className="text-[13px] text-[#777]">
                            Stuck on something this page doesn't cover? Raise a ticket from{' '}
                            <a href="/partner/support" className="font-bold text-[#8a7600] hover:underline">Support</a> in the portal,
                            or email <a href="mailto:partners@powr.life" className="font-bold text-[#8a7600] hover:underline">partners@powr.life</a>.
                        </p>
                    </div>
                </main>
            </div>
        </div>
    );
}
