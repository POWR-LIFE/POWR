import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { callPartnerApi, DOCS_PATHS, fetchMethodStatuses } from '../../lib/partnerApi';
import { DELIVERY_METHODS } from './integrationShared';

// Permanent opt-out of the first-run auto-redirect (per brand); the chooser
// stays reachable from the nav and the Home checklist.
export const methodLaterKey = (brandName) =>
    `powr-partner-method-later:${String(brandName ?? '').trim().toLowerCase()}`;

export default function PartnerIntegrationHub() {
    const toast = useToast();
    const navigate = useNavigate();
    const { partnerData, deliveryMethod, updateDeliveryMethod } = useAuth();
    const brand = partnerData?.brand_name;

    // First-run = no method chosen (and none inferable server-side).
    const firstRun = deliveryMethod === null;

    const [statuses, setStatuses] = useState(null); // { api, shopify, manual } status lines
    const [choosing, setChoosing] = useState(null);

    const fetchStatuses = useCallback(async () => {
        if (!brand) return;
        setStatuses(await fetchMethodStatuses(brand));
    }, [brand]);

    useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

    if (!partnerData) return null;

    const choose = async (method) => {
        if (deliveryMethod === method.id) { navigate(method.path); return; }
        if (deliveryMethod && !window.confirm(
            `Switch your delivery method to ${method.label}? Nothing is deleted — your existing setup keeps working and you can switch back anytime.`
        )) return;
        setChoosing(method.id);
        try {
            await callPartnerApi('set_integration', brand, { delivery_method: method.id });
            updateDeliveryMethod(method.id);
            navigate(method.path);
        } catch (err) { toast.error(err.message); }
        setChoosing(null);
    };

    const decideLater = () => {
        localStorage.setItem(methodLaterKey(brand), '1');
        navigate('/partner');
    };

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <header className="mb-14">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">
                        {firstRun ? 'One decision to get started' : 'Integration'}
                    </span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4 max-w-2xl">
                    {firstRun ? 'How will you deliver rewards to members?' : 'Delivery method'}
                </h1>
                <p className="text-[12px] text-[#999] leading-relaxed max-w-xl">
                    {firstRun
                        ? 'When a member redeems one of your rewards, POWR hands them a code. Pick how those codes reach us — you can change this at any time.'
                        : 'How codes reach members when they redeem your rewards. Switching is non-destructive — existing setup keeps working.'}
                </p>
            </header>

            {/* Method cards — pitch order: API, Shopify, manual */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {DELIVERY_METHODS.map((method, index) => {
                    const current = deliveryMethod === method.id;
                    const status = statuses?.[method.id];
                    return (
                        <div key={method.id}
                            className={`relative flex flex-col bg-white border rounded-3xl p-8 transition-all ${
                                current ? 'border-[#E8D200] shadow-[0_20px_50px_rgba(232,210,0,0.12)]' : 'border-[#E6E6E1] hover:border-[#E8D200]/40 hover:shadow-lg'
                            }`}>
                            {current && (
                                <span className="absolute -top-3 left-8 text-[9px] uppercase tracking-[0.3em] font-black text-[#080808] bg-[#E8D200] rounded-full px-4 py-1.5">
                                    Current method
                                </span>
                            )}
                            <div className="flex items-center justify-between mb-6">
                                <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] flex items-center justify-center">
                                    <method.icon size={22} className="text-[#8a7600]" />
                                </div>
                                <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#CCC]">{`0${index + 1}`}</span>
                            </div>
                            <h2 className="text-2xl font-light tracking-tighter text-[#1A1A1A] mb-3">{method.label}</h2>
                            <p className="text-[12px] text-[#999] leading-relaxed mb-4 flex-0">{method.tagline}</p>
                            {/* Read before you commit — the guide answers "is this me?"
                                without making the partner pick a method to find out.
                                Colour sits on the span: style.css's unlayered
                                `a { color: inherit }` outranks text-* utilities on <a>. */}
                            <a href={DOCS_PATHS[method.id]} target="_blank" rel="noreferrer"
                                className="self-start mb-6 group/guide">
                                <span className="text-[10px] uppercase tracking-[0.2em] font-black text-[#BBB] group-hover/guide:text-[#8a7600] transition-colors">
                                    Read the guide →
                                </span>
                            </a>

                            <div className="space-y-2.5 mb-8">
                                {method.beats.map(beat => (
                                    <div key={beat} className="flex items-center gap-3">
                                        <span className="h-5 w-5 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/20 flex items-center justify-center shrink-0">
                                            <Check size={10} className="text-[#8a7600]" />
                                        </span>
                                        <span className="text-[11px] text-[#666] font-bold">{beat}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-auto">
                                <div className="flex items-center gap-2.5 mb-5">
                                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status?.configured ? 'bg-emerald-500' : 'bg-[#D5D5D0]'}`} />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#AAA] truncate">
                                        {status?.line ?? '…'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBB]">Best for<br /><span className="text-[#666]">{method.bestFor}</span></span>
                                    <button type="button" disabled={!!choosing} onClick={() => choose(method)}
                                        className={`flex items-center gap-2 h-11 px-6 text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all disabled:opacity-50 ${
                                            current
                                                ? 'bg-[#1A1A1A] text-white hover:bg-[#333]'
                                                : 'bg-[#E8D200] text-[#080808] hover:brightness-95'
                                        }`}>
                                        {choosing === method.id ? 'Saving…' : current ? 'Open setup' : firstRun ? `Choose ${method.label}` : 'Switch'}
                                        {current ? <ChevronRight size={13} /> : <ArrowRight size={13} />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {firstRun && (
                <div className="mt-12 text-center">
                    <button type="button" onClick={decideLater}
                        className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] hover:text-[#8a7600] font-black transition-colors">
                        Not sure yet? Decide later — you can pick a method anytime from the sidebar
                    </button>
                </div>
            )}
        </div>
    );
}
