// Shared chrome + method metadata for the integration surfaces (hub, API,
// Shopify, promo codes) — split out of the old single Developers page.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, BookOpen, Check, ChevronDown, ChevronRight, Code2, LifeBuoy, Minus, Store, Ticket, TriangleAlert } from 'lucide-react';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { DOCS_PATHS } from '../../lib/partnerApi';

export const INPUT = "w-full h-14 px-5 bg-white border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/50 outline-none transition-all font-['Outfit']";
export const BTN_DARK = 'h-11 px-8 bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all disabled:opacity-50';
export const BTN_GHOST = 'h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A] transition-all disabled:opacity-50';

// The one place the three delivery methods are described. Order matters:
// this is the pitch order on the chooser (API first, then Shopify, then
// manual) and everywhere cards are rendered.
export const DELIVERY_METHODS = [
    {
        id: 'api',
        label: 'API',
        icon: Code2,
        path: '/partner/integration/api',
        tagline: 'Full control from your own stack — API keys, signed webhooks, and just-in-time code minting.',
        bestFor: 'Teams with engineers',
        beats: ['Create an API key', 'Receive signed webhooks', 'Mint codes on demand'],
    },
    {
        id: 'shopify',
        label: 'Shopify',
        icon: Store,
        path: '/partner/integration/shopify',
        tagline: 'Connect your store once — POWR mints a fresh single-use discount per redemption and marks it used at your checkout.',
        bestFor: 'Stores on Shopify',
        beats: ['Connect your store', 'Pick a template discount', 'Codes mint & reconcile themselves'],
    },
    {
        id: 'manual',
        label: 'Promo Codes',
        icon: Ticket,
        path: '/partner/promo-codes',
        tagline: 'Upload or generate batches of codes right here in the portal — no development work at all.',
        bestFor: 'Getting live fast',
        beats: ['Upload or generate codes', 'POWR hands them to members', 'Reconcile used codes anytime'],
    },
];

export const methodMeta = (id) => DELIVERY_METHODS.find(m => m.id === id) ?? null;
export const integrationPathFor = (id) => methodMeta(id)?.path ?? '/partner/integration';

export const timeAgo = (iso) => {
    if (!iso) return '—';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

export function CopyButton({ value, label = 'Copy' }) {
    const toast = useToast();
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className={BTN_GHOST}
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch {
                    toast.error('Could not copy — select it manually');
                }
            }}
        >
            {copied ? <span className="flex items-center gap-1.5"><Check size={11} /> Copied</span> : label}
        </button>
    );
}

// ── Staged setup flow ────────────────────────────────────────────
// The "do this, then this, then this" spine every method page shares.
// steps: [{ id, title, detail, summary?, done, optional?, render }]
//  - done derives from live data, so progress survives reloads
//  - the first unfinished required step auto-expands ("Do this next");
//    any step can still be opened or closed by hand
//  - optional: true → "Optional" tag; a string → custom tag ("Recommended")
//  - forceOpen: keep the step expanded even once done (e.g. a shown-once
//    secret is on screen); a manual collapse still wins
export function SetupFlow({ steps }) {
    const [toggled, setToggled] = useState({});
    const current = steps.find(s => !s.done && !s.optional) ?? steps.find(s => !s.done) ?? null;
    const doneCount = steps.filter(s => s.done).length;
    const allDone = doneCount === steps.length;

    return (
        <div className="mb-6">
            <div className="flex items-center gap-4 mb-5 px-1">
                <div className="flex-1 h-[3px] bg-[#ECECE7] rounded-full overflow-hidden">
                    <div
                        className="h-full bg-[#E8D200] rounded-full transition-all duration-700"
                        style={{ width: `${Math.max(3, (doneCount / steps.length) * 100)}%` }}
                    />
                </div>
                <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#999] shrink-0">
                    {allDone ? 'All set — this now runs itself' : `${doneCount} of ${steps.length} steps done`}
                </span>
            </div>

            {steps.map((step, i) => {
                const isCurrent = !allDone && current && step.id === current.id;
                const expanded = toggled[step.id] ?? (isCurrent || !!step.forceOpen);
                return (
                    <div
                        key={step.id}
                        className={`bg-white border rounded-3xl mb-4 transition-all ${
                            isCurrent ? 'border-[#E8D200]/60 shadow-[0_16px_40px_rgba(232,210,0,0.08)]' : 'border-[#E6E6E1]'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => setToggled(p => ({ ...p, [step.id]: !expanded }))}
                            className="w-full flex items-center gap-5 p-6 md:px-8 text-left"
                        >
                            <span className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                                step.done ? 'bg-[#E8D200] border-[#E8D200]'
                                : isCurrent ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                : 'bg-[#F4F4F1] border-[#E6E6E1]'
                            }`}>
                                {step.done
                                    ? <Check size={16} className="text-[#080808]" strokeWidth={3} />
                                    : <span className={`text-[13px] font-black ${isCurrent ? 'text-white' : 'text-[#BBB]'}`}>{i + 1}</span>}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="flex items-center gap-2.5 flex-wrap">
                                    <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB]">Step {i + 1}</span>
                                    {step.optional && (
                                        <span className="text-[8px] uppercase tracking-[0.2em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-2.5 py-0.5">
                                            {step.optional === true ? 'Optional' : step.optional}
                                        </span>
                                    )}
                                    {isCurrent && (
                                        <span className="text-[8px] uppercase tracking-[0.2em] font-black text-[#080808] bg-[#E8D200] rounded-full px-2.5 py-0.5">
                                            Do this next
                                        </span>
                                    )}
                                </span>
                                <span className="block text-[17px] font-bold tracking-tight text-[#1A1A1A] mt-1">{step.title}</span>
                                <span className={`block text-[11px] mt-0.5 leading-relaxed ${step.done ? 'text-emerald-600 font-bold' : 'text-[#999]'}`}>
                                    {step.done ? (step.summary ?? 'Done') : step.detail}
                                </span>
                            </span>
                            <ChevronDown size={15} className={`text-[#BBB] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        {expanded && <div className="px-6 md:px-8 pb-8 md:pl-[96px]">{step.render()}</div>}
                    </div>
                );
            })}
        </div>
    );
}

// Compact horizontal variant for pages where the workspace below stays
// put (promo codes) — same numbered-circle language as SetupFlow, plus a
// one-line hint that always says what to do next.
export function StageStrip({ steps, doneHint }) {
    const current = steps.find(s => !s.done) ?? null;
    const allDone = !current;
    return (
        <div className="mb-8 p-5 px-6 bg-white border border-[#E6E6E1] rounded-3xl">
            <div className="flex items-center flex-wrap gap-y-3">
                {steps.map((s, i) => {
                    const isCurrent = current && s === current;
                    return (
                        <React.Fragment key={s.label}>
                            {i > 0 && <span className="h-[1px] w-5 md:w-10 bg-[#E6E6E1] mx-3 shrink-0" />}
                            <span className="flex items-center gap-2.5 shrink-0">
                                <span className={`h-7 w-7 rounded-full flex items-center justify-center border text-[11px] font-black shrink-0 ${
                                    s.done ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]'
                                    : isCurrent ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#BBB]'
                                }`}>
                                    {s.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                                </span>
                                <span className={`text-[10px] uppercase tracking-[0.2em] font-black ${
                                    s.done ? 'text-[#333]' : isCurrent ? 'text-[#1A1A1A]' : 'text-[#BBB]'
                                }`}>{s.label}</span>
                            </span>
                        </React.Fragment>
                    );
                })}
            </div>
            <p className={`text-[11px] leading-relaxed mt-3 ${allDone ? 'text-emerald-600 font-bold' : 'text-[#999]'}`}>
                {allDone ? (doneHint ?? 'All set.') : current.hint}
            </p>
        </div>
    );
}

export function SectionCard({ icon: Icon, title, children, aside }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Icon size={16} className="text-[#BBBBBB]" />
                    <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#BBBBBB]">{title}</h2>
                </div>
                {aside}
            </div>
            {children}
        </div>
    );
}

// state: 'ok' | 'warn' | 'off' — stacked layout so it reads well in the
// narrow sticky rail.
export function HealthItem({ state, label, detail }) {
    const icon = state === 'ok' ? <Check size={13} className="text-emerald-600" />
        : state === 'warn' ? <TriangleAlert size={13} className="text-amber-500" />
        : <Minus size={13} className="text-[#CCC]" />;
    return (
        <div className="py-3 border-b border-[#EFEFEC] last:border-0">
            <div className="flex items-center gap-3">
                <span className={`h-7 w-7 rounded-full flex items-center justify-center border shrink-0 ${
                    state === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20'
                    : state === 'warn' ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-[#F4F4F1] border-[#E6E6E1]'
                }`}>{icon}</span>
                <span className="text-[12px] font-bold text-[#333]">{label}</span>
            </div>
            <p className="text-[11px] text-[#999] leading-relaxed mt-1.5 pl-10">{detail}</p>
        </div>
    );
}

// Rail chrome for the sticky asides (support, settings) — HealthItem's
// stacked layout without the state semantics.
export function RailRow({ icon: Icon, label, detail }) {
    return (
        <div className="py-3 border-b border-[#EFEFEC] last:border-0">
            <div className="flex items-center gap-3">
                <span className="h-7 w-7 rounded-full flex items-center justify-center border bg-[#F4F4F1] border-[#E6E6E1] shrink-0">
                    <Icon size={13} className="text-[#8a7600]" />
                </span>
                <span className="text-[12px] font-bold text-[#333]">{label}</span>
            </div>
            {detail && <p className="text-[11px] text-[#999] leading-relaxed mt-1.5 pl-10">{detail}</p>}
        </div>
    );
}

export function RailLink({ to, icon: Icon, label, detail }) {
    return (
        <Link to={to} className="block py-3 border-b border-[#EFEFEC] last:border-0 group">
            <span className="flex items-center gap-3">
                <span className="h-7 w-7 rounded-full flex items-center justify-center border bg-[#F4F4F1] border-[#E6E6E1] shrink-0 group-hover:border-[#E8D200]/40 transition-colors">
                    <Icon size={13} className="text-[#8a7600]" />
                </span>
                <span className="text-[12px] font-bold text-[#333] group-hover:text-[#8a7600] transition-colors flex-1">{label}</span>
                <ChevronRight size={13} className="text-[#CCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
            </span>
            {detail && <p className="text-[11px] text-[#999] leading-relaxed mt-1.5 pl-10">{detail}</p>}
        </Link>
    );
}

// Header link back to the hub — every method page carries one so switching
// is always one click away.
export function ChangeMethodLink() {
    return (
        <Link to="/partner/integration"
            className="flex items-center gap-2 h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-[#E6E6E1] rounded-full text-[#666] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A] transition-all">
            <ArrowLeftRight size={11} /> Change method
        </Link>
    );
}

// Every method page carries a link to its own public guide, in the same slot,
// so "how do I set this up" never depends on knowing the docs exist.
export function GuideLink({ method, label }) {
    const path = DOCS_PATHS[method];
    if (!path) return null;
    return (
        <a href={path} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 h-11 px-6 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all">
            <BookOpen size={14} /> {label ?? 'Setup guide'}
        </a>
    );
}

// Soft exclusivity: exactly one method delivers at a time. A brand can still
// open and prepare a different method's page (migration prep), but it's
// flagged so nobody thinks two paths are live at once.
export function WrongMethodNotice({ pageMethod }) {
    const { deliveryMethod } = useAuth();
    if (!deliveryMethod || deliveryMethod === pageMethod) return null;
    const current = methodMeta(deliveryMethod);
    const here = methodMeta(pageMethod);
    return (
        <div className="mb-8 p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-4 flex-wrap">
            <TriangleAlert size={15} className="text-amber-600 shrink-0" />
            <p className="text-[11px] font-bold text-amber-600 leading-relaxed flex-1 min-w-[240px]">
                Your rewards currently deliver via {current?.label}. You can prepare {here?.label} here,
                but it won't take over until you switch methods.
            </p>
            <Link to="/partner/integration"
                className="h-9 px-4 flex items-center text-[9px] font-black uppercase tracking-[0.2em] bg-white border border-amber-500/30 rounded-full text-amber-600 hover:border-amber-500/60 transition-all shrink-0">
                Switch method
            </Link>
        </div>
    );
}

// API and Shopify brands still want a small buffer pool for outages — the
// promo-codes workspace stays reachable from their pages even though it's
// hidden from their nav.
export function FallbackPoolCard() {
    return (
        <SectionCard icon={LifeBuoy} title="Fallback Codes">
            <div className="flex items-center justify-between gap-6 flex-wrap">
                <p className="text-[12px] text-[#999] leading-relaxed max-w-xl">
                    Keep a small buffer of pre-loaded codes — if your integration is ever unavailable at
                    redemption time, POWR falls back to the pool automatically so members never hit a wall.
                </p>
                <Link to="/partner/promo-codes"
                    className="flex items-center gap-2 h-11 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all shrink-0">
                    <Ticket size={13} /> Manage fallback pool
                </Link>
            </div>
        </SectionCard>
    );
}
