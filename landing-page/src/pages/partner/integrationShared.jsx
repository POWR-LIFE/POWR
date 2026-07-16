// Shared chrome + method metadata for the integration surfaces (hub, API,
// Shopify, promo codes) — split out of the old single Developers page.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Check, Code2, LifeBuoy, Minus, Store, Ticket, TriangleAlert } from 'lucide-react';
import { useToast } from '../../lib/toast';

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
