import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle2, RefreshCw, Ticket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { serverErrorText } from '../../lib/serverErrors';
import { callShopify } from '../../lib/partnerApi';
import { BTN_DARK, BTN_GHOST, ChangeMethodLink, CopyButton, FallbackPoolCard, GuideLink, HealthItem, INPUT, SectionCard, SetupFlow, WrongMethodNotice } from './integrationShared';

export default function PartnerIntegrationShopify() {
    const { t } = useTranslation();
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
    const [statusError, setStatusError] = useState(null);

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
    // allSettled so one transient failure can't blank the whole page. A
    // failed status stays unknown rather than becoming "not connected" — a
    // cold edge function must never send a live store back through OAuth.
    const refresh = useCallback(async () => {
        if (!brand) return;
        const [statusRes, rewardsRes] = await Promise.allSettled([
            callShopify('status', brand),
            supabase.from('rewards')
                .select('id, title, active, integration_type')
                .ilike('brand_name', brand)
                .order('created_at', { ascending: false }),
        ]);
        if (rewardsRes.status === 'fulfilled') setBrandRewards(rewardsRes.value.data ?? []);
        if (statusRes.status === 'rejected') {
            console.error('shopify status failed', statusRes.reason);
            setStatusError(statusRes.reason?.message ?? 'network error');
            toast.error(t('brandIntegration:shopify.toast.unreachable'));
        } else {
            setShopify(statusRes.value);
            setStatusError(null);
            if (statusRes.value?.connected) {
                try {
                    const d = await callShopify('list_discounts', brand);
                    setDiscounts(d.discounts ?? []);
                } catch (err) {
                    console.error('shopify discounts failed', err);
                    setDiscounts(null);
                }
            }
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
        if (outcome === 'connected') toast.success(t('brandIntegration:shopify.toast.connected'));
        else toast.error(t('brandIntegration:shopify.toast.connectFailed', {
            reason: params.get('reason') ?? t('brandIntegration:shopify.toast.unknownReason'),
        }));
        window.history.replaceState({}, '', window.location.pathname);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!partnerData) return null;

    const handleConnect = async () => {
        if (!shopDomain.trim()) { toast.error(t('brandIntegration:shopify.toast.enterDomain')); return; }
        setConnecting(true);
        try {
            const res = await callShopify('start', brand, { shop_domain: shopDomain.trim() });
            window.location.href = res.authorize_url;
        } catch (err) {
            toast.error(serverErrorText(err));
            setConnecting(false);
        }
    };

    const handleMapReward = async (rewardId, discountGid) => {
        setMappingBusy(rewardId);
        try {
            if (discountGid) {
                await callShopify('map_reward', brand, { reward_id: rewardId, discount_gid: discountGid });
                toast.success(t('brandIntegration:shopify.toast.mapped'));
            } else {
                await callShopify('unmap_reward', brand, { reward_id: rewardId });
                toast.success(t('brandIntegration:shopify.toast.unmapped'));
            }
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
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
        } catch (err) { toast.error(serverErrorText(err)); }
        setTestBusy(false);
    };

    const handleDisconnect = async () => {
        if (!window.confirm(t('brandIntegration:shopify.confirmDisconnect'))) return;
        try {
            await callShopify('disconnect', brand);
            toast.success(t('brandIntegration:shopify.toast.disconnected'));
            setDiscounts(null);
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
    };

    const connected = !!shopify?.connected;
    const mappings = shopify?.mappings ?? [];
    // Never reached Shopify at all — distinct from a store we know is
    // disconnected, and the difference decides what we tell the partner.
    const statusUnknown = !shopify && !!statusError;

    // Only cloneable template discounts can back minting. With none of them
    // and nothing already mapped, the reward rows would be a column of dead
    // selects, so the step names the missing piece instead.
    const cloneableDiscounts = (discounts ?? []).filter(d => d.cloneable);
    const noDiscountsToPick = discounts !== null && cloneableDiscounts.length === 0 && mappings.length === 0;

    // Mapping deliberately includes NOT-yet-live rewards: partners (and app
    // reviewers) wire up delivery BEFORE a reward goes live in the app, so
    // members can never hit a live-but-unmapped reward. Live ones sort first.
    const mappableRewards = [...brandRewards].sort((a, b) => Number(b.active) - Number(a.active));

    // A live reward with no discount behind it cannot mint, so step 2 is only
    // finished once every one of them is covered — "1 of 5 mapped" was
    // ticking the step and collapsing the four rows still to do.
    const liveRewards = brandRewards.filter(r => r.active);
    const unmappedLive = liveRewards.filter(r => !mappings.some(m => m.reward_id === r.id));
    const mappedLiveCount = liveRewards.length - unmappedLive.length;

    // ── Step contents ─────────────────────────────────────────────

    const renderConnect = () => statusUnknown ? (
        <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            <p className="text-[11px] font-bold text-amber-600 leading-relaxed">
                {t('brandIntegration:shopify.connect.unreachable')}
            </p>
            <button type="button" className={BTN_GHOST + ' mt-4'}
                onClick={() => { setLoading(true); refresh(); }}>
                <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shared.retry')}</span>
            </button>
        </div>
    ) : !connected ? (
        <>
            {shopify?.status === 'uninstalled' && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-[11px] font-bold text-amber-600">
                    {t('brandIntegration:shopify.connect.uninstalled')}
                </div>
            )}
            <div className="flex gap-3">
                <input type="text" placeholder="your-store.myshopify.com" value={shopDomain}
                    onChange={e => setShopDomain(e.target.value)} className={INPUT + ' flex-1'} />
                <button type="button" onClick={handleConnect} disabled={connecting}
                    className={BTN_DARK + ' h-14 shrink-0'}>
                    {connecting ? t('brandIntegration:shopify.connect.redirecting') : t('brandIntegration:shopify.connect.connect')}
                </button>
            </div>
            <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                {t('brandIntegration:shopify.connect.approveHint')}
            </p>
        </>
    ) : (
        <>
            <div className="flex items-center gap-3 flex-wrap">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <code className="text-[12px] font-mono text-[#1A1A1A]">{shopify.shop_domain}</code>
                <span className="text-[9px] uppercase tracking-[0.2em] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">{t('brandIntegration:shopify.connect.connected')}</span>
                <div className="flex-1" />
                <button type="button" className={BTN_GHOST} onClick={refresh}>
                    <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shared.refresh')}</span>
                </button>
                <button type="button" onClick={handleDisconnect}
                    className="h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] rounded-full text-red-500/60 hover:text-red-500 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all">
                    {t('brandIntegration:shopify.connect.disconnect')}
                </button>
            </div>
            {shopify.health && !shopify.health.token_ok && (
                <div className="mt-6 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-[11px] font-bold text-red-500">
                    {t('brandIntegration:shopify.connect.sessionExpired')}
                </div>
            )}
            {shopify.health?.token_ok && !shopify.health.orders_webhook && (
                <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-[11px] font-bold text-amber-600 leading-relaxed">
                    {t('brandIntegration:shopify.connect.ordersInactive')}
                </div>
            )}
        </>
    );

    const renderMappings = () => !connected ? (
        <p className="text-[12px] text-[#AAA]">{statusUnknown
            ? t('brandIntegration:shopify.map.waiting')
            : t('brandIntegration:shopify.map.connectFirst')}</p>
    ) : (
        <>
            {discounts === null && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between gap-4 flex-wrap">
                    <p className="text-[11px] font-bold text-amber-600 leading-relaxed flex-1 min-w-[240px]">
                        {t('brandIntegration:shopify.map.discountsFailed')}
                    </p>
                    <button type="button" className={BTN_GHOST + ' shrink-0'} onClick={refresh}>
                        <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shared.retry')}</span>
                    </button>
                </div>
            )}
            {mappableRewards.length === 0 ? (
                <div className="flex items-center justify-between gap-6 flex-wrap">
                    <p className="text-[12px] text-[#AAA] leading-relaxed max-w-xl">
                        {t('brandIntegration:shopify.map.noRewards')}
                    </p>
                    <Link to="/partner/rewards" className={BTN_GHOST + ' flex items-center shrink-0'}>
                        {t('brandIntegration:shopify.map.createReward')}
                    </Link>
                </div>
            ) : noDiscountsToPick ? (
                <div className="py-16 text-center">
                    <Ticket size={26} className="text-[#E6E6E1] mx-auto mb-4" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">{t('brandIntegration:shopify.map.noDiscountsTitle')}</p>
                    <p className="text-xs text-[#BBBBBB] mt-3 leading-relaxed max-w-sm mx-auto">
                        {t('brandIntegration:shopify.map.noDiscountsBody')}
                    </p>
                    <button type="button" className={BTN_GHOST + ' mt-6'} onClick={refresh}>
                        <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shared.refresh')}</span>
                    </button>
                </div>
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
                                                {t('brandIntegration:shopify.map.notLive')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-[#999] mt-0.5">
                                        {mapping
                                            ? t('brandIntegration:shopify.map.mintsFrom', { discount: mapping.discount_title })
                                            : t('brandIntegration:shopify.map.notMinting')}
                                    </div>
                                </div>
                                <select
                                    value={mapping?.discount_gid ?? ''}
                                    disabled={mappingBusy === r.id || discounts === null}
                                    onChange={e => handleMapReward(r.id, e.target.value || null)}
                                    className="h-11 px-4 bg-white border border-[#E6E6E1] rounded-xl text-[12px] text-[#1A1A1A] outline-none focus:border-[#E8D200]/50 max-w-[240px]"
                                >
                                    <option value="">{t('brandIntegration:shopify.map.noMinting')}</option>
                                    {cloneableDiscounts.map(d => (
                                        <option key={d.gid} value={d.gid}>{d.title}</option>
                                    ))}
                                    {/* A mapping can point at a discount the picker hides
                                        (e.g. a POWR-minted code chosen before the filter
                                        existed) — keep it selectable so the select shows
                                        the truth instead of falling back to "No minting". */}
                                    {mapping && !(discounts ?? []).some(d => d.gid === mapping.discount_gid) && (
                                        <option value={mapping.discount_gid}>{t('brandIntegration:shopify.map.currentOption', { discount: mapping.discount_title })}</option>
                                    )}
                                </select>
                            </div>
                        );
                    })}
                </div>
            )}
            {!noDiscountsToPick && (
                <p className="text-[10px] text-[#BBB] mt-4 leading-relaxed">
                    {t('brandIntegration:shopify.map.templateHint')}
                </p>
            )}
        </>
    );

    const renderTest = () => !connected ? (
        <p className="text-[12px] text-[#AAA]">{statusUnknown ? t('brandIntegration:shopify.test.waiting') : t('brandIntegration:shopify.test.connectFirst')}</p>
    ) : mappings.length === 0 ? (
        <p className="text-[12px] text-[#AAA]">{t('brandIntegration:shopify.test.mapFirst')}</p>
    ) : (
        <>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-xl">
                {t('brandIntegration:shopify.test.intro')}
            </p>
            <button type="button" onClick={handleCreateTestCode} disabled={testBusy} className={BTN_DARK}>
                {testBusy ? t('brandIntegration:shopify.test.minting') : t('brandIntegration:shopify.test.create')}
            </button>
            {testCode && (
                <div className="mt-6 p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <div className="flex items-center gap-3 flex-wrap">
                        <code className="text-[15px] font-mono font-bold text-[#1A1A1A] tracking-wider">{testCode.code}</code>
                        <CopyButton value={testCode.code} />
                        <div className="flex-1" />
                        {testCode.status === 'used' ? (
                            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5">
                                <CheckCircle2 size={12} /> {t('brandIntegration:shopify.test.used')}
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-4 py-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#E8D200] animate-pulse" />
                                {t('brandIntegration:shopify.test.waitingCheckout')}
                            </span>
                        )}
                        <button type="button" className={BTN_GHOST} onClick={() => checkTestCode(testCode.code)}>
                            <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shopify.test.check')}</span>
                        </button>
                    </div>
                    <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                        {testCode.status === 'used'
                            ? t('brandIntegration:shopify.test.loopWorks')
                            : t('brandIntegration:shopify.test.realCode')}
                    </p>
                </div>
            )}
        </>
    );

    // ── The staged flow — connect, map, prove it works ────────────
    const steps = [
        {
            id: 'connect',
            title: t('brandIntegration:shopify.steps.connect.title'),
            detail: t('brandIntegration:shopify.steps.connect.detail'),
            summary: connected ? t('brandIntegration:shopify.steps.connect.summary', { domain: shopify.shop_domain }) : undefined,
            done: connected,
            render: renderConnect,
        },
        {
            id: 'map',
            title: t('brandIntegration:shopify.steps.map.title'),
            detail: connected && unmappedLive.length > 0
                ? t('brandIntegration:shopify.steps.map.detailUnmapped', { count: unmappedLive.length })
                : t('brandIntegration:shopify.steps.map.detail'),
            summary: liveRewards.length > 0
                ? t('brandIntegration:shopify.steps.map.summaryLive', { count: liveRewards.length, mapped: mappedLiveCount })
                : t('brandIntegration:shopify.steps.map.summary', { count: mappings.length }),
            done: connected && mappings.length > 0 && unmappedLive.length === 0,
            render: renderMappings,
        },
        {
            id: 'test',
            title: t('brandIntegration:shopify.steps.test.title'),
            detail: t('brandIntegration:shopify.steps.test.detail'),
            summary: t('brandIntegration:shopify.steps.test.summary'),
            // Server-derived so the proof survives a reload; the local test
            // code still counts for the moment it flips, before the next
            // status refresh catches up.
            done: testCode?.status === 'used' || !!shopify?.loop_proven,
            optional: t('brandIntegration:shared.setup.recommended'),
            render: renderTest,
        },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandIntegration:shopify.eyebrow')}</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Shopify</h1>
                    <div className="flex items-center gap-3">
                        <ChangeMethodLink />
                        <GuideLink method="shopify" />
                    </div>
                </div>
                <p className="text-[12px] text-[#999] leading-relaxed mt-4 max-w-xl">
                    {t('brandIntegration:shopify.intro')}
                </p>
            </div>

            <WrongMethodNotice pageMethod="shopify" />

            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            {/* ── Store health — sticky rail on wide screens, stacked on top
                   otherwise. Sticky works because PartnerLayout's main is the
                   scroll container (same trick as the API page's rail). */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6">
            {/* An unreachable status tells us nothing about the store, so the
                rail says exactly that rather than reporting three 'off' rows
                as if the integration were idle. */}
            {!loading && statusUnknown && (
                <SectionCard icon={Activity} title={t('brandIntegration:shopify.health.title')}>
                    <HealthItem
                        state="warn"
                        label={t('brandIntegration:shopify.health.connection.label')}
                        detail={t('brandIntegration:shopify.health.connection.unreachable')}
                    />
                </SectionCard>
            )}
            {!loading && !statusUnknown && (
                <SectionCard icon={Activity} title={t('brandIntegration:shopify.health.title')}>
                    <HealthItem
                        state={!connected ? 'off' : shopify.health && !shopify.health.token_ok ? 'warn' : 'ok'}
                        label={t('brandIntegration:shopify.health.connection.label')}
                        detail={!connected ? t('brandIntegration:shopify.health.connection.none')
                            : shopify.health && !shopify.health.token_ok ? t('brandIntegration:shopify.health.connection.expired')
                            : t('brandIntegration:shopify.health.connection.connected', { domain: shopify.shop_domain })}
                    />
                    <HealthItem
                        state={!connected ? 'off' : shopify.health?.orders_webhook ? 'ok' : 'warn'}
                        label={t('brandIntegration:shopify.health.orders.label')}
                        detail={!connected ? t('brandIntegration:shopify.health.orders.none')
                            : shopify.health?.orders_webhook ? t('brandIntegration:shopify.health.orders.live')
                            : t('brandIntegration:shopify.health.orders.inactive')}
                    />
                    <HealthItem
                        state={mappings.length > 0 ? 'ok' : 'off'}
                        label={t('brandIntegration:shopify.health.minting.label')}
                        detail={mappings.length > 0
                            ? t('brandIntegration:shopify.health.minting.count', { count: mappings.length })
                            : t('brandIntegration:shopify.health.minting.none')}
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
