import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { callShopify } from '../../lib/partnerApi';
import { BTN_DARK, BTN_GHOST, ChangeMethodLink, CopyButton, FallbackPoolCard, HealthItem, INPUT, SectionCard, SetupFlow, WrongMethodNotice } from './integrationShared';

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

    // Connection self-test: mint one labelled code, then watch it flip to
    // 'used' when it's spent at the store's checkout.
    const [testCode, setTestCode] = useState(null);      // { code, reward_id, status }
    const [testBusy, setTestBusy] = useState(false);
    const pollRef = useRef(null);

    const checkTestCode = useCallback(async (code) => {
        const { data } = await supabase
            .from('redemption_codes')
            .select('status, used_at')
            .eq('code', code)
            .maybeSingle();
        if (!data) return;
        setTestCode(prev => (prev && prev.code === code ? { ...prev, status: data.status } : prev));
        if (data.status === 'used' && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    // Poll for the used-flip for a couple of minutes after minting; the
    // manual refresh button keeps working after that.
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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

    const handleCreateTestCode = async () => {
        setTestBusy(true);
        try {
            const res = await callShopify('create_test_code', brand);
            setTestCode({ code: res.code, reward_id: res.reward_id, status: 'reserved' });
            if (pollRef.current) clearInterval(pollRef.current);
            let ticks = 0;
            pollRef.current = setInterval(() => {
                ticks += 1;
                if (ticks > 20 && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; return; }
                checkTestCode(res.code);
            }, 6000);
        } catch (err) { toast.error(err.message); }
        setTestBusy(false);
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

    const connected = !!shopify?.connected;
    const mappings = shopify?.mappings ?? [];

    // Mapping deliberately includes NOT-yet-live rewards: partners (and app
    // reviewers) wire up delivery BEFORE a reward goes live in the app, so
    // members can never hit a live-but-unmapped reward. Live ones sort first.
    const mappableRewards = [...brandRewards].sort((a, b) => Number(b.active) - Number(a.active));

    // ── Step contents ─────────────────────────────────────────────

    const renderConnect = () => !connected ? (
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
            <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                You'll approve the POWR Rewards app on Shopify's screen and land straight back here.
            </p>
        </>
    ) : (
        <>
            <div className="flex items-center gap-3 flex-wrap">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <code className="text-[12px] font-mono text-[#1A1A1A]">{shopify.shop_domain}</code>
                <span className="text-[9px] uppercase tracking-[0.2em] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">Connected</span>
                <div className="flex-1" />
                <button type="button" className={BTN_GHOST} onClick={refresh}>
                    <span className="flex items-center gap-1.5"><RefreshCw size={11} /> Refresh</span>
                </button>
                <button type="button" onClick={handleDisconnect}
                    className="h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] rounded-full text-red-500/60 hover:text-red-500 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all">
                    Disconnect
                </button>
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
    );

    const renderMappings = () => !connected ? (
        <p className="text-[12px] text-[#AAA]">Connect your store first — your Shopify discounts will appear here to choose from.</p>
    ) : (
        <>
            {mappableRewards.length === 0 ? (
                <p className="text-[12px] text-[#AAA]">No rewards yet — create one in My Rewards and it appears here. It doesn't need to be live in the app to wire up minting.</p>
            ) : (
                <div className="space-y-3">
                    {mappableRewards.map((r) => {
                        const mapping = mappings.find(m => m.reward_id === r.id);
                        return (
                            <div key={r.id} className="flex items-center gap-4 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[12px] font-bold text-[#222] truncate">
                                        {r.title}
                                        {!r.active && (
                                            <span className="ml-2 text-[8px] uppercase tracking-[0.2em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-2 py-0.5 align-middle">
                                                Not live in app yet
                                            </span>
                                        )}
                                    </div>
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
        </>
    );

    const renderTest = () => !connected ? (
        <p className="text-[12px] text-[#AAA]">Connect your store first.</p>
    ) : mappings.length === 0 ? (
        <p className="text-[12px] text-[#AAA]">Map a reward to a discount in step 2 first.</p>
    ) : (
        <>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-xl">
                Mints one single-use code from your mapped template — exactly like a member
                redemption, just without the member. Apply it at your own checkout and watch it
                confirm as used automatically.
            </p>
            <button type="button" onClick={handleCreateTestCode} disabled={testBusy} className={BTN_DARK}>
                {testBusy ? 'Minting…' : 'Create test code'}
            </button>
            {testCode && (
                <div className="mt-6 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <div className="flex items-center gap-3 flex-wrap">
                        <code className="text-[15px] font-mono font-bold text-[#1A1A1A] tracking-wider">{testCode.code}</code>
                        <CopyButton value={testCode.code} />
                        <div className="flex-1" />
                        {testCode.status === 'used' ? (
                            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5">
                                <CheckCircle2 size={12} /> Used — reconciled
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-4 py-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#E8D200] animate-pulse" />
                                Waiting for checkout
                            </span>
                        )}
                        <button type="button" className={BTN_GHOST} onClick={() => checkTestCode(testCode.code)}>
                            <span className="flex items-center gap-1.5"><RefreshCw size={11} /> Check</span>
                        </button>
                    </div>
                    <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                        {testCode.status === 'used'
                            ? 'The full loop works: minted in Shopify, spent at checkout, confirmed back to POWR.'
                            : 'This is a real single-use discount in your store (it expires in 7 days). Place a test order with it — the status here flips to Used within a minute.'}
                    </p>
                </div>
            )}
        </>
    );

    // ── The staged flow — connect, map, prove it works ────────────
    const steps = [
        {
            id: 'connect',
            title: 'Connect your store',
            detail: 'Approve the POWR app on your Shopify store — one click, no code, takes a minute.',
            summary: connected ? `${shopify.shop_domain} · connected` : undefined,
            done: connected,
            render: renderConnect,
        },
        {
            id: 'map',
            title: 'Pick a discount for each reward',
            detail: 'Create a template discount in Shopify, then choose it here — POWR clones it into a fresh single-use code per redemption.',
            summary: `${mappings.length} reward${mappings.length === 1 ? '' : 's'} minting from your discounts`,
            done: connected && mappings.length > 0,
            render: renderMappings,
        },
        {
            id: 'test',
            title: 'Test the full loop',
            detail: 'Mint a real test code and spend it at your own checkout — proves minting and order tracking end to end.',
            summary: 'Full loop proven — minted, spent at checkout, confirmed back to POWR.',
            done: testCode?.status === 'used',
            optional: 'Recommended',
            render: renderTest,
        },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
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
                    The zero-effort integration: three steps and every redemption mints a fresh single-use
                    code in your store — marked used the moment it's spent at your checkout. No CSVs, no
                    API work, nothing to host.
                </p>
            </div>

            <WrongMethodNotice pageMethod="shopify" />

            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            {/* ── Store health — sticky rail on wide screens, stacked on top
                   otherwise. Sticky works because PartnerLayout's main is the
                   scroll container (same trick as the API page's rail). */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6">
            {!loading && (
                <SectionCard icon={Activity} title="Store Health">
                    <HealthItem
                        state={!connected ? 'off' : shopify.health && !shopify.health.token_ok ? 'warn' : 'ok'}
                        label="Store connection"
                        detail={!connected ? 'Not connected yet — start with step 1.'
                            : shopify.health && !shopify.health.token_ok ? 'Session expired — reconnect in step 1 to restore minting.'
                            : `Connected to ${shopify.shop_domain}.`}
                    />
                    <HealthItem
                        state={!connected ? 'off' : shopify.health?.orders_webhook ? 'ok' : 'warn'}
                        label="Order tracking"
                        detail={!connected ? 'Activates automatically when your store connects.'
                            : shopify.health?.orders_webhook ? 'Live — codes spent at your checkout confirm as used by themselves.'
                            : 'Not active — approve “Protected customer data” in your Shopify app settings, then reload.'}
                    />
                    <HealthItem
                        state={mappings.length > 0 ? 'ok' : 'off'}
                        label="Reward minting"
                        detail={mappings.length > 0
                            ? `${mappings.length} reward${mappings.length === 1 ? '' : 's'} minting from your discounts.`
                            : 'No rewards minting yet — map one in step 2.'}
                    />
                </SectionCard>
            )}
            </aside>

            <div className="flex-1 min-w-0 max-w-3xl xl:order-1">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : (
                    <SetupFlow steps={steps} />
                )}

                {/* ── Fallback pool ────────────────────────────────────── */}
                <FallbackPoolCard />
            </div>
            </div>
        </div>
    );
}
