import React, { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw, ShoppingBag, Sparkles, Store } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { callShopify } from '../../lib/partnerApi';
import { BTN_DARK, BTN_GHOST, ChangeMethodLink, FallbackPoolCard, INPUT, SectionCard } from './integrationShared';

const HOW_IT_WORKS = [
    { icon: Link2, title: 'Connect', detail: 'Approve the POWR app on your store — one click, no code.' },
    { icon: ShoppingBag, title: 'Map', detail: 'Create a template discount in Shopify and pick it for each reward below.' },
    { icon: Sparkles, title: 'Done', detail: 'Every redemption mints a fresh single-use code; it confirms as used the moment it\'s spent at your checkout.' },
];

export default function PartnerIntegrationShopify() {
    const toast = useToast();
    const { partnerData } = useAuth();
    const brand = partnerData?.brand_name;

    const [shopify, setShopify] = useState(null);
    const [shopDomain, setShopDomain] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [discounts, setDiscounts] = useState(null);
    const [brandRewards, setBrandRewards] = useState([]);
    const [mappingBusy, setMappingBusy] = useState(null);
    const [loading, setLoading] = useState(true);

    // Shopify connection state + the brand's rewards (for discount mapping).
    const refresh = useCallback(async () => {
        if (!brand) return;
        try {
            const [status, { data: rewards }] = await Promise.all([
                callShopify('status', brand),
                supabase.from('rewards')
                    .select('id, title, active, integration_type')
                    .ilike('brand_name', brand)
                    .order('created_at', { ascending: false }),
            ]);
            setShopify(status);
            setBrandRewards(rewards ?? []);
            if (status?.connected) {
                const d = await callShopify('list_discounts', brand);
                setDiscounts(d.discounts ?? []);
            }
        } catch (err) {
            setShopify((prev) => prev ?? { connected: false });
            console.error('shopify status failed', err);
        }
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brand]);

    useEffect(() => { refresh(); }, [refresh]);

    // Returning from the Shopify OAuth screen (?shopify=connected|error).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const outcome = params.get('shopify');
        if (!outcome) return;
        if (outcome === 'connected') toast.success('Shopify connected — pick which discount each reward mints from');
        else toast.error(`Shopify connection failed (${params.get('reason') ?? 'unknown'}) — try again`);
        window.history.replaceState({}, '', window.location.pathname);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!partnerData) return null;

    const handleConnect = async () => {
        if (!shopDomain.trim()) { toast.error('Enter your store domain (your-store.myshopify.com)'); return; }
        setConnecting(true);
        try {
            const res = await callShopify('start', brand, { shop_domain: shopDomain.trim() });
            window.location.href = res.authorize_url;
        } catch (err) {
            toast.error(err.message);
            setConnecting(false);
        }
    };

    const handleMapReward = async (rewardId, discountGid) => {
        setMappingBusy(rewardId);
        try {
            if (discountGid) {
                await callShopify('map_reward', brand, { reward_id: rewardId, discount_gid: discountGid });
                toast.success('Reward now mints from that discount');
            } else {
                await callShopify('unmap_reward', brand, { reward_id: rewardId });
                toast.success('Mapping removed');
            }
            await refresh();
        } catch (err) { toast.error(err.message); }
        setMappingBusy(null);
    };

    const handleDisconnect = async () => {
        if (!window.confirm('Disconnect Shopify? Minting stops immediately; mapped rewards fall back to any buffer pool codes.')) return;
        try {
            await callShopify('disconnect', brand);
            toast.success('Shopify disconnected');
            setDiscounts(null);
            await refresh();
        } catch (err) { toast.error(err.message); }
    };

    const activeRewards = brandRewards.filter(r => r.active);

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-3xl">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Integration · Shopify</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Shopify</h1>
                    <ChangeMethodLink />
                </div>
                <p className="text-[12px] text-[#999] leading-relaxed mt-4 max-w-xl">
                    The zero-effort integration: connect your store and POWR creates a fresh single-use
                    discount code in Shopify every time a member redeems — and marks it used the moment
                    it's spent at your checkout. No CSVs, no API work, nothing to host.
                </p>
            </div>

            {/* ── Connection ───────────────────────────────────────────── */}
            <SectionCard
                icon={Store} title="Store Connection"
                aside={shopify?.connected && (
                    <div className="flex items-center gap-2">
                        <button type="button" className={BTN_GHOST} onClick={refresh}>
                            <span className="flex items-center gap-1.5"><RefreshCw size={11} /> Refresh</span>
                        </button>
                        <button type="button" onClick={handleDisconnect}
                            className="h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] rounded-full text-red-500/60 hover:text-red-500 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all">
                            Disconnect
                        </button>
                    </div>
                )}
            >
                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : !shopify?.connected ? (
                    <>
                        {shopify?.status === 'uninstalled' && (
                            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-[11px] font-bold text-amber-600">
                                The POWR app was uninstalled from your store — reconnect below to resume minting.
                            </div>
                        )}
                        <div className="flex gap-3">
                            <input type="text" placeholder="your-store.myshopify.com" value={shopDomain}
                                onChange={e => setShopDomain(e.target.value)} className={INPUT + ' flex-1'} />
                            <button type="button" onClick={handleConnect} disabled={connecting}
                                className={BTN_DARK + ' h-14 shrink-0'}>
                                {connecting ? 'Redirecting…' : 'Connect Shopify'}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            <code className="text-[12px] font-mono text-[#1A1A1A]">{shopify.shop_domain}</code>
                            <span className="text-[9px] uppercase tracking-[0.2em] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">Connected</span>
                        </div>
                        {shopify.health && !shopify.health.token_ok && (
                            <div className="mt-6 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-[11px] font-bold text-red-500">
                                Shopify session expired — hit Connect Shopify again to restore minting and order tracking.
                            </div>
                        )}
                        {shopify.health?.token_ok && !shopify.health.orders_webhook && (
                            <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-[11px] font-bold text-amber-600 leading-relaxed">
                                Order tracking isn't active yet, so used codes won't confirm automatically. In your
                                Shopify app settings, approve “Protected customer data” access (reason: app
                                functionality), then reload this page — it repairs itself.
                            </div>
                        )}
                    </>
                )}
            </SectionCard>

            {/* ── Discount mappings ────────────────────────────────────── */}
            {shopify?.connected && (
                <SectionCard icon={ShoppingBag} title="Reward Mappings">
                    <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">Which discount should each reward mint from?</div>
                    {activeRewards.length === 0 ? (
                        <p className="text-[12px] text-[#AAA]">No active rewards yet — once a reward is live it appears here.</p>
                    ) : (
                        <div className="space-y-3">
                            {activeRewards.map((r) => {
                                const mapping = (shopify.mappings ?? []).find(m => m.reward_id === r.id);
                                return (
                                    <div key={r.id} className="flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-bold text-[#222] truncate">{r.title}</div>
                                            <div className="text-[10px] text-[#999] mt-0.5">
                                                {mapping ? `Mints from “${mapping.discount_title}”` : 'Not minting yet — pick a discount'}
                                            </div>
                                        </div>
                                        <select
                                            value={mapping?.discount_gid ?? ''}
                                            disabled={mappingBusy === r.id || discounts === null}
                                            onChange={e => handleMapReward(r.id, e.target.value || null)}
                                            className="h-11 px-4 bg-white border border-[#E6E6E1] rounded-xl text-[12px] text-[#1A1A1A] outline-none focus:border-[#E8D200]/50 max-w-[240px]"
                                        >
                                            <option value="">No minting</option>
                                            {(discounts ?? []).filter(d => d.cloneable).map(d => (
                                                <option key={d.gid} value={d.gid}>{d.title}</option>
                                            ))}
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="text-[10px] text-[#BBB] mt-4 leading-relaxed">
                        Create the template discount in Shopify (percentage or fixed amount) — POWR clones it
                        into a single-use code per redemption. Codes confirm as used automatically when spent
                        at your checkout.
                    </p>
                </SectionCard>
            )}

            {/* ── How it works ─────────────────────────────────────────── */}
            {!shopify?.connected && !loading && (
                <SectionCard icon={Sparkles} title="How It Works">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {HOW_IT_WORKS.map((beat, index) => (
                            <div key={beat.title} className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                                    <beat.icon size={17} className="text-[#8a7600]" />
                                </div>
                                <div>
                                    <div className="text-[13px] font-bold text-[#222]">
                                        <span className="text-[#8a7600] mr-2">{index + 1}</span>{beat.title}
                                    </div>
                                    <div className="text-[11px] text-[#999] mt-1 leading-relaxed">{beat.detail}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            )}

            {/* ── Fallback pool ────────────────────────────────────────── */}
            <FallbackPoolCard />
        </div>
    );
}
