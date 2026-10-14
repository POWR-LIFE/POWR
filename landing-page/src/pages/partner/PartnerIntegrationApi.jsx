import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Eye, EyeOff, Plus, RefreshCw, Send, Trash2, TriangleAlert, Zap } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { serverErrorText } from '../../lib/serverErrors';
import {
    API_BASE_URL, DOCS_PATH, WEBHOOK_EVENTS,
    callPartnerApi, fetchDeliveries, fetchEndpoints, fetchIntegration,
} from '../../lib/partnerApi';
import {
    BTN_DARK, BTN_GHOST, ChangeMethodLink, CopyButton, FallbackPoolCard, GuideLink,
    HealthItem, INPUT, SectionCard, SetupFlow, timeAgo, WrongMethodNotice,
} from './integrationShared';

const STATUS_CHIP = {
    delivered: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    skipped: 'bg-[#F4F4F1] text-[#999] border-[#E6E6E1]',
};

// Delivery statuses the chip knows how to say; anything else shows as the server sent it.
const STATUS_LABEL = {
    delivered: 'brandIntegration:api.deliveries.status.delivered',
    pending: 'brandIntegration:api.deliveries.status.pending',
    failed: 'brandIntegration:api.deliveries.status.failed',
    skipped: 'brandIntegration:api.deliveries.status.skipped',
};

export default function PartnerIntegrationApi() {
    const { t } = useTranslation();
    const toast = useToast();
    const { partnerData } = useAuth();
    const brand = partnerData?.brand_name;

    const [keys, setKeys] = useState([]);
    const [endpoints, setEndpoints] = useState([]);
    const [deliveries, setDeliveries] = useState([]);
    const [integration, setIntegration] = useState(null);
    const [loading, setLoading] = useState(true);

    // API keys
    const [newKeyLabel, setNewKeyLabel] = useState('');
    const [creatingKey, setCreatingKey] = useState(false);
    const [freshKey, setFreshKey] = useState(null); // shown exactly once

    // Webhook endpoints
    const [newUrl, setNewUrl] = useState('');
    const [newEvents, setNewEvents] = useState(WEBHOOK_EVENTS.map(e => e.id));
    const [addingEndpoint, setAddingEndpoint] = useState(false);
    const [revealSecret, setRevealSecret] = useState({});
    const [testResult, setTestResult] = useState({});
    const [busyEndpoint, setBusyEndpoint] = useState(null);

    // JIT
    const [mintUrl, setMintUrl] = useState('');
    const [threshold, setThreshold] = useState(10);
    const [savingIntegration, setSavingIntegration] = useState(false);
    const [mintTest, setMintTest] = useState(null);
    const [testingMint, setTestingMint] = useState(false);
    const [connTest, setConnTest] = useState(null); // the one-click connection test

    const refresh = useCallback(async () => {
        if (!brand) return;
        // allSettled so one transient failure can't blank the whole page —
        // whatever loaded still renders, and the failure surfaces once.
        const [keysRes, eps, dels, integ] = await Promise.allSettled([
            callPartnerApi('list_keys', brand),
            fetchEndpoints(brand),
            fetchDeliveries(brand),
            fetchIntegration(brand),
        ]);
        if (keysRes.status === 'fulfilled') setKeys(keysRes.value.keys ?? []);
        if (eps.status === 'fulfilled') setEndpoints(eps.value);
        if (dels.status === 'fulfilled') setDeliveries(dels.value);
        if (integ.status === 'fulfilled') {
            setIntegration(integ.value);
            setMintUrl(integ.value?.mint_url ?? '');
            setThreshold(integ.value?.pool_low_threshold ?? 10);
        }
        const failed = [keysRes, eps, dels, integ].find(r => r.status === 'rejected');
        if (failed) toast.error(t('brandIntegration:api.toast.loadFailed', {
            reason: failed.reason?.message != null ? serverErrorText(failed.reason) : t('brandIntegration:shared.networkError'),
        }));
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brand]);

    useEffect(() => { refresh(); }, [refresh]);

    if (!partnerData) return null;

    const handleCreateKey = async () => {
        setCreatingKey(true);
        try {
            // The default label is stored with the key, so it stays English.
            const res = await callPartnerApi('create_key', brand, { label: newKeyLabel || 'API key' });
            setFreshKey(res.key);
            setNewKeyLabel('');
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
        setCreatingKey(false);
    };

    const handleRevokeKey = async (keyId) => {
        if (!window.confirm(t('brandIntegration:api.confirm.revokeKey'))) return;
        try {
            await callPartnerApi('revoke_key', brand, { key_id: keyId });
            toast.success(t('brandIntegration:api.toast.keyRevoked'));
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
    };

    const handleAddEndpoint = async () => {
        if (!newUrl.trim()) { toast.error(t('brandIntegration:api.toast.enterUrl')); return; }
        if (newEvents.length === 0) { toast.error(t('brandIntegration:api.toast.pickEvent')); return; }
        setAddingEndpoint(true);
        try {
            await callPartnerApi('create_endpoint', brand, { url: newUrl.trim(), events: newEvents });
            toast.success(t('brandIntegration:api.toast.endpointAdded'));
            setNewUrl('');
            setNewEvents(WEBHOOK_EVENTS.map(e => e.id));
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
        setAddingEndpoint(false);
    };

    const handleToggleEndpoint = async (ep) => {
        setBusyEndpoint(ep.id);
        try {
            await callPartnerApi('update_endpoint', brand, { endpoint_id: ep.id, active: !ep.active });
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
        setBusyEndpoint(null);
    };

    const handleDeleteEndpoint = async (ep) => {
        if (!window.confirm(t('brandIntegration:api.confirm.deleteEndpoint'))) return;
        try {
            await callPartnerApi('delete_endpoint', brand, { endpoint_id: ep.id });
            toast.success(t('brandIntegration:api.toast.endpointDeleted'));
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
    };

    const handleTestEndpoint = async (ep) => {
        setBusyEndpoint(ep.id);
        setTestResult(prev => ({ ...prev, [ep.id]: { pending: true } }));
        try {
            const res = await callPartnerApi('test_endpoint', brand, { endpoint_id: ep.id });
            setTestResult(prev => ({ ...prev, [ep.id]: res }));
        } catch (err) {
            setTestResult(prev => ({ ...prev, [ep.id]: { ok: false, error: serverErrorText(err) } }));
        }
        setBusyEndpoint(null);
    };

    const handleRedeliver = async (deliveryId) => {
        try {
            await callPartnerApi('redeliver', brand, { delivery_id: deliveryId });
            toast.success(t('brandIntegration:api.toast.redeliveryQueued'));
            await refresh();
        } catch (err) { toast.error(serverErrorText(err)); }
    };

    // One click, every wire: fires the signed webhook test at each active
    // endpoint plus the JIT mint probe, all via already-deployed actions.
    const handleRunConnectionTest = async () => {
        setConnTest({ running: true, items: [] });
        const activeEps = endpoints.filter(e => e.active);
        const results = await Promise.allSettled([
            ...activeEps.map(ep => callPartnerApi('test_endpoint', brand, { endpoint_id: ep.id }).then(r => ({ kind: 'webhook', ep, r }))),
            ...(integration?.mint_url ? [callPartnerApi('test_mint', brand).then(r => ({ kind: 'mint', r }))] : []),
        ]);
        const items = results.map(res => {
            if (res.status === 'rejected') return {
                ok: false, label: t('brandIntegration:api.verify.callFailed'),
                detail: res.reason?.message != null ? serverErrorText(res.reason) : t('brandIntegration:shared.networkError'),
            };
            const { kind, ep, r } = res.value;
            if (kind === 'webhook') {
                let host = ep.url; try { host = new URL(ep.url).host; } catch { /* show raw */ }
                return {
                    ok: !!r.ok, label: t('brandIntegration:api.verify.webhookTo', { host }),
                    detail: r.ok ? t('brandIntegration:api.verify.delivered', { status: r.status })
                        : (r.error != null ? serverErrorText(r.error) : t('brandIntegration:shared.httpStatus', { status: r.status })),
                };
            }
            return {
                ok: !!r.ok, label: t('brandIntegration:api.verify.mintLabel'),
                detail: !r.ok ? serverErrorText(r.error)
                    : r.warning ? t('brandIntegration:api.verify.mintRespondedWarning', { ms: r.elapsed_ms, warning: serverErrorText(r.warning) })
                    : t('brandIntegration:api.verify.mintResponded', { ms: r.elapsed_ms }),
            };
        });
        if (activeEps.length === 0) items.unshift({ ok: false, label: t('brandIntegration:api.verify.webhooksLabel'), detail: t('brandIntegration:api.verify.noEndpoint') });
        setConnTest({ running: false, items });
    };

    const handleTestMint = async () => {
        setTestingMint(true);
        setMintTest(null);
        try {
            const res = await callPartnerApi('test_mint', brand);
            setMintTest(res);
        } catch (err) {
            setMintTest({ ok: false, error: serverErrorText(err) });
        }
        setTestingMint(false);
    };

    const handleSaveIntegration = async (patch) => {
        setSavingIntegration(true);
        try {
            const res = await callPartnerApi('set_integration', brand, patch);
            setIntegration(res.integration);
            setMintUrl(res.integration?.mint_url ?? '');
            setThreshold(res.integration?.pool_low_threshold ?? 10);
            toast.success(t('brandIntegration:api.toast.settingsSaved'));
        } catch (err) { toast.error(serverErrorText(err)); }
        setSavingIntegration(false);
    };

    // ── Derived setup state — drives both the steps and the health rail ──
    const activeKeys = keys.filter(k => !k.revoked_at);
    const keyUsed = activeKeys.some(k => k.last_used_at);
    const activeEps = endpoints.filter(e => e.active);
    const failingEps = activeEps.filter(e => e.consecutive_failures > 0);
    const disabledEps = endpoints.filter(e => !e.active && e.disabled_reason);
    const lastDelivered = deliveries.find(d => d.status === 'delivered');
    const circuitOpen = integration?.mint_disabled_until && new Date(integration.mint_disabled_until) > new Date();
    const connTestPassed = !!connTest && !connTest.running && connTest.items.length > 0 && connTest.items.every(it => it.ok);
    const lastKeyCall = activeKeys.map(k => k.last_used_at).filter(Boolean).sort().pop();

    // ── Step contents ─────────────────────────────────────────────

    const renderKeys = () => (
        <>
                {freshKey && (
                    <div className="mb-6 p-5 bg-[#E8D200]/10 border border-[#E8D200]/40 rounded-2xl">
                        <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600] mb-2">{t('brandIntegration:api.keys.freshTitle')}</div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <code className="text-[12px] font-mono text-[#1A1A1A] break-all">{freshKey}</code>
                            <CopyButton value={freshKey} />
                            <button type="button" className={BTN_GHOST} onClick={() => setFreshKey(null)}>{t('brandIntegration:api.keys.dismiss')}</button>
                        </div>
                    </div>
                )}

                {keys.length === 0 && !loading ? (
                    <p className="text-[12px] text-[#AAA] mb-6">{t('brandIntegration:api.keys.empty')}</p>
                ) : (
                    <div className="space-y-3 mb-6">
                        {keys.map((k) => (
                            <div key={k.id} className={`flex items-center gap-4 p-4 rounded-2xl border ${k.revoked_at ? 'bg-[#F4F4F1] border-[#E6E6E1] opacity-60' : 'bg-[#F4F4F1] border-[#E6E6E1]'}`}>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[12px] font-bold text-[#222] truncate">{k.label}</div>
                                    <div className="text-[11px] font-mono text-[#999] mt-0.5">{k.key_prefix}…</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[9px] uppercase tracking-[0.2em] font-black text-[#BBB]">
                                        {k.revoked_at ? t('brandIntegration:api.keys.revoked')
                                            : k.last_used_at ? t('brandIntegration:api.keys.used', { when: timeAgo(k.last_used_at) })
                                            : t('brandIntegration:api.keys.neverUsed')}
                                    </div>
                                </div>
                                {!k.revoked_at && (
                                    <button type="button" onClick={() => handleRevokeKey(k.id)}
                                        className="h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] rounded-full text-red-500/60 hover:text-red-500 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all">
                                        {t('brandIntegration:api.keys.revoke')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-3">
                    <input
                        type="text" placeholder={t('brandIntegration:api.keys.labelPlaceholder')} value={newKeyLabel}
                        onChange={e => setNewKeyLabel(e.target.value)} className={INPUT + ' flex-1'} maxLength={60}
                    />
                    <button type="button" onClick={handleCreateKey} disabled={creatingKey} className={BTN_DARK + ' h-14 shrink-0 flex items-center gap-2'}>
                        <Plus size={13} /> {creatingKey ? t('brandIntegration:api.keys.creating') : t('brandIntegration:api.keys.create')}
                    </button>
                </div>
                <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                    <Trans
                        i18nKey="brandIntegration:api.keys.pingHint"
                        values={{ url: API_BASE_URL }}
                        components={{
                            code: <code className="font-mono text-[#8a7600]" />,
                            docs: <a href={DOCS_PATH} target="_blank" rel="noreferrer" className="text-[#8a7600] underline" />,
                        }}
                    />
                </p>
        </>
    );

    const renderWebhooks = () => (
        <>
                <div className="space-y-4 mb-8">
                    {endpoints.length === 0 && !loading && (
                        <p className="text-[12px] text-[#AAA]">{t('brandIntegration:api.webhooks.empty')}</p>
                    )}
                    {endpoints.map((ep) => {
                        const res = testResult[ep.id];
                        return (
                            <div key={ep.id} className="p-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className={`h-2 w-2 rounded-full shrink-0 ${ep.active ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                    <code className="text-[12px] font-mono text-[#1A1A1A] break-all flex-1 min-w-[200px]">{ep.url}</code>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button type="button" className={BTN_GHOST} disabled={busyEndpoint === ep.id} onClick={() => handleTestEndpoint(ep)}>
                                            <span className="flex items-center gap-1.5"><Send size={11} /> {t('brandIntegration:api.webhooks.test')}</span>
                                        </button>
                                        <button type="button" className={BTN_GHOST} disabled={busyEndpoint === ep.id} onClick={() => handleToggleEndpoint(ep)}>
                                            {ep.active ? t('brandIntegration:api.webhooks.disable') : t('brandIntegration:api.webhooks.enable')}
                                        </button>
                                        <button type="button" onClick={() => handleDeleteEndpoint(ep)}
                                            className="h-9 w-9 flex items-center justify-center rounded-full text-red-500/50 hover:text-red-500 hover:bg-red-500/5 transition-all">
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                    {(ep.events ?? []).map(ev => (
                                        <span key={ev} className="text-[9px] uppercase tracking-[0.2em] font-black text-[#8a7600] bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full px-3 py-1">{ev}</span>
                                    ))}
                                    {!ep.active && ep.disabled_reason && (
                                        <span className="text-[10px] text-red-500/80">{serverErrorText(ep.disabled_reason)}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 mt-3">
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBB]">{t('brandIntegration:api.webhooks.signingSecret')}</span>
                                    <code className="text-[11px] font-mono text-[#666]">
                                        {revealSecret[ep.id] ? ep.secret : '••••••••••••••••'}
                                    </code>
                                    <button type="button" onClick={() => setRevealSecret(p => ({ ...p, [ep.id]: !p[ep.id] }))}
                                        className="text-[#BBB] hover:text-[#666] transition-colors">
                                        {revealSecret[ep.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                    <CopyButton value={ep.secret} label={t('brandIntegration:shared.copySecret')} />
                                </div>
                                {res && !res.pending && (
                                    <div className={`mt-3 text-[11px] font-bold ${res.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {res.ok ? t('brandIntegration:api.webhooks.testDelivered', { status: res.status })
                                            : t('brandIntegration:api.webhooks.testFailed', {
                                                error: res.error != null ? serverErrorText(res.error) : t('brandIntegration:shared.httpStatus', { status: res.status }),
                                            })}
                                    </div>
                                )}
                                {res?.pending && <div className="mt-3 text-[11px] text-[#999]">{t('brandIntegration:api.webhooks.sendingTest')}</div>}
                            </div>
                        );
                    })}
                </div>

                <div className="pt-6 border-t border-[#E6E6E1]">
                    <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">{t('brandIntegration:api.webhooks.add')}</div>
                    <input type="url" placeholder="https://your-system.example.com/powr/webhooks" value={newUrl}
                        onChange={e => setNewUrl(e.target.value)} className={INPUT} />
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                        {WEBHOOK_EVENTS.map(ev => {
                            const on = newEvents.includes(ev.id);
                            return (
                                <button key={ev.id} type="button" title={t(ev.descriptionKey)}
                                    onClick={() => setNewEvents(prev => on ? prev.filter(x => x !== ev.id) : [...prev, ev.id])}
                                    className={`text-[9px] uppercase tracking-[0.2em] font-black rounded-full px-4 py-2 border transition-all ${
                                        on ? 'bg-[#E8D200] text-[#080808] border-[#E8D200]' : 'bg-white text-[#999] border-[#E6E6E1] hover:border-[#E8D200]/50'
                                    }`}>
                                    {ev.id}
                                </button>
                            );
                        })}
                        <div className="flex-1" />
                        <button type="button" onClick={handleAddEndpoint} disabled={addingEndpoint} className={BTN_DARK}>
                            {addingEndpoint ? t('brandIntegration:api.webhooks.adding') : t('brandIntegration:api.webhooks.add')}
                        </button>
                    </div>
                </div>
        </>
    );

    // ── Recent deliveries — a log, not a step; rendered under the flow ──
    const deliveriesCard = (
            <SectionCard
                icon={Send} title={t('brandIntegration:api.deliveries.title')}
                aside={
                    <button type="button" className={BTN_GHOST} onClick={refresh}>
                        <span className="flex items-center gap-1.5"><RefreshCw size={11} /> {t('brandIntegration:shared.refresh')}</span>
                    </button>
                }
            >
                {deliveries.length === 0 ? (
                    <p className="text-[12px] text-[#AAA]">{t('brandIntegration:api.deliveries.empty')}</p>
                ) : (
                    <div className="space-y-2">
                        {deliveries.map((d) => (
                            <div key={d.id} className="flex items-center gap-4 p-3.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <span className={`text-[9px] uppercase tracking-[0.2em] font-black rounded-full px-3 py-1 border shrink-0 ${STATUS_CHIP[d.status] ?? STATUS_CHIP.skipped}`}>
                                    {STATUS_LABEL[d.status] ? t(STATUS_LABEL[d.status]) : d.status}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[12px] font-bold text-[#222]">{d.event_type}</div>
                                    <div className="text-[10px] text-[#999] truncate mt-0.5">
                                        {d.reward_brand_webhook_endpoints?.url ?? ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[10px] text-[#999]">{timeAgo(d.created_at)}</div>
                                    <div className="text-[9px] text-[#BBB] mt-0.5">
                                        {d.attempts > 0 ? t('brandIntegration:api.deliveries.attempts', { count: d.attempts }) : ''}
                                        {d.last_response_status ? ` · HTTP ${d.last_response_status}` : ''}
                                    </div>
                                </div>
                                {(d.status === 'failed' || d.status === 'skipped') && (
                                    <button type="button" className={BTN_GHOST} onClick={() => handleRedeliver(d.id)}>{t('brandIntegration:api.deliveries.redeliver')}</button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>
    );

    const renderJit = () => (
        <>
                <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-xl">
                    <Trans i18nKey="brandIntegration:api.jit.intro" components={{ em: <em /> }} />
                </p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandIntegration:api.jit.mintUrl')}</label>
                        <input type="url" placeholder="https://your-system.example.com/powr/mint" value={mintUrl}
                            onChange={e => setMintUrl(e.target.value)} className={INPUT} />
                    </div>
                    {integration?.mint_secret && (
                        <div className="flex items-center gap-3">
                            <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBB]">{t('brandIntegration:api.jit.mintSecret')}</span>
                            <code className="text-[11px] font-mono text-[#666]">
                                {revealSecret.mint ? integration.mint_secret : '••••••••••••••••'}
                            </code>
                            <button type="button" onClick={() => setRevealSecret(p => ({ ...p, mint: !p.mint }))}
                                className="text-[#BBB] hover:text-[#666] transition-colors">
                                {revealSecret.mint ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                            <CopyButton value={integration.mint_secret} label={t('brandIntegration:shared.copySecret')} />
                        </div>
                    )}
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">{t('brandIntegration:api.jit.threshold')}</label>
                        <input type="number" min={0} max={10000} value={threshold}
                            onChange={e => setThreshold(e.target.value)} className={INPUT + ' max-w-[160px]'} />
                        <p className="text-[10px] text-[#BBB] mt-1.5">{t('brandIntegration:api.jit.thresholdHint')}</p>
                    </div>
                    {mintTest && (
                        <div className={`text-[11px] font-bold ${mintTest.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                            {!mintTest.ok ? t('brandIntegration:api.jit.mintFailed', { error: serverErrorText(mintTest.error) })
                                : mintTest.warning ? t('brandIntegration:api.jit.mintOkWarning', {
                                    ms: mintTest.elapsed_ms, code: mintTest.code_preview, warning: serverErrorText(mintTest.warning),
                                })
                                : t('brandIntegration:api.jit.mintOk', { ms: mintTest.elapsed_ms, code: mintTest.code_preview })}
                        </div>
                    )}
                    {testingMint && <div className="text-[11px] text-[#999]">{t('brandIntegration:api.jit.sendingMint')}</div>}
                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                            <span className={`h-2 w-2 rounded-full ${integration?.mint_enabled ? 'bg-emerald-500' : 'bg-[#CCC]'}`} />
                            <span className="text-[11px] font-bold text-[#666]">
                                {integration?.mint_enabled ? t('brandIntegration:api.jit.statusOn') : t('brandIntegration:api.jit.statusOff')}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            {integration?.mint_url && (
                                <button type="button" disabled={testingMint} className={BTN_GHOST} onClick={handleTestMint}>
                                    <span className="flex items-center gap-1.5"><Send size={11} /> {t('brandIntegration:api.jit.testMint')}</span>
                                </button>
                            )}
                            {integration?.mint_url && (
                                <button type="button" disabled={savingIntegration} className={BTN_GHOST}
                                    onClick={() => handleSaveIntegration({ mint_enabled: !integration?.mint_enabled })}>
                                    {integration?.mint_enabled ? t('brandIntegration:api.jit.turnOff') : t('brandIntegration:api.jit.turnOn')}
                                </button>
                            )}
                            <button type="button" disabled={savingIntegration} className={BTN_DARK}
                                onClick={() => handleSaveIntegration({ mint_url: mintUrl.trim() || null, pool_low_threshold: threshold })}>
                                {savingIntegration ? t('common:actions.saving') : t('brandIntegration:api.jit.save')}
                            </button>
                        </div>
                    </div>
                </div>
        </>
    );

    const renderVerify = () => (
        <>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-xl">
                {t('brandIntegration:api.verify.intro')}
            </p>
            <button type="button" disabled={connTest?.running} onClick={handleRunConnectionTest}
                className="flex items-center justify-center gap-2 h-12 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all disabled:opacity-50">
                <Zap size={13} /> {connTest?.running ? t('brandIntegration:api.verify.testing') : t('brandIntegration:api.verify.run')}
            </button>
            {connTest && !connTest.running && (
                <div className="mt-5 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <div className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-2">{t('brandIntegration:api.verify.results')}</div>
                    {connTest.items.map((it, i) => (
                        <div key={i} className="flex items-start gap-2.5 py-1.5">
                            {it.ok ? <Check size={13} className="text-emerald-600 shrink-0 mt-0.5" /> : <TriangleAlert size={13} className="text-red-500 shrink-0 mt-0.5" />}
                            <div className="min-w-0">
                                <div className="text-[11.5px] font-bold text-[#333]">{it.label}</div>
                                <div className={`text-[11px] leading-relaxed ${it.ok ? 'text-[#999]' : 'text-red-500'}`}>{it.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );

    // ── The staged flow — key, webhooks, JIT, then prove it works ──
    const steps = [
        {
            id: 'key',
            title: t('brandIntegration:api.steps.key.title'),
            detail: t('brandIntegration:api.steps.key.detail'),
            summary: keyUsed
                ? t('brandIntegration:api.steps.key.summaryCalled', { count: activeKeys.length, when: timeAgo(lastKeyCall) })
                : t('brandIntegration:api.steps.key.summaryNotCalled', { count: activeKeys.length }),
            done: activeKeys.length > 0,
            // A fresh key is shown exactly once — never collapse it away.
            forceOpen: !!freshKey,
            render: renderKeys,
        },
        {
            id: 'webhook',
            title: t('brandIntegration:api.steps.webhook.title'),
            detail: t('brandIntegration:api.steps.webhook.detail'),
            summary: activeEps.length === 0 ? undefined
                : lastDelivered ? t('brandIntegration:api.steps.webhook.summaryDelivered', { count: activeEps.length, when: timeAgo(lastDelivered.delivered_at) })
                : t('brandIntegration:api.steps.webhook.summary', { count: activeEps.length }),
            done: activeEps.length > 0,
            render: renderWebhooks,
        },
        {
            id: 'jit',
            title: t('brandIntegration:api.steps.jit.title'),
            detail: t('brandIntegration:api.steps.jit.detail'),
            summary: t('brandIntegration:api.steps.jit.summary'),
            done: !!(integration?.mint_url && integration?.mint_enabled),
            optional: true,
            render: renderJit,
        },
        {
            id: 'verify',
            title: t('brandIntegration:api.steps.verify.title'),
            detail: t('brandIntegration:api.steps.verify.detail'),
            // A key that has been called proves the key works, not that the
            // integration does — step 1 tells partners to GET /ping, which
            // used to tick this step while a broken webhook went unnoticed.
            // Only a passed test or a genuinely delivered webhook counts.
            summary: connTestPassed
                ? t('brandIntegration:api.steps.verify.summaryPassed')
                : t('brandIntegration:api.steps.verify.summaryDelivered', { when: timeAgo(lastDelivered?.delivered_at) }),
            done: connTestPassed || !!lastDelivered,
            render: renderVerify,
        },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{t('brandIntegration:api.eyebrow')}</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">API</h1>
                    <div className="flex items-center gap-3">
                        <ChangeMethodLink />
                        <GuideLink method="api" label={t('brandIntegration:api.docs')} />
                    </div>
                </div>
                <p className="text-[12px] text-[#999] leading-relaxed mt-4 max-w-xl">
                    {t('brandIntegration:api.intro')}
                </p>
                <div className="mt-5 flex items-center gap-3">
                    <code className="text-[11px] font-mono text-[#666] bg-white border border-[#E6E6E1] rounded-full px-4 py-2">{API_BASE_URL}</code>
                    <CopyButton value={API_BASE_URL} label={t('brandIntegration:api.copyBaseUrl')} />
                </div>
            </div>

            <WrongMethodNotice pageMethod="api" />

            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            {/* ── Connection health — sticky rail on wide screens, stacked on
                   top otherwise. Sticky works because PartnerLayout's main is
                   the scroll container (same trick as the Rewards preview). */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6">
            {!loading && (
                <SectionCard icon={Activity} title={t('brandIntegration:api.health.title')}>
                    <HealthItem
                        state={activeKeys.length === 0 ? 'off' : keyUsed ? 'ok' : 'warn'}
                        label={t('brandIntegration:api.health.key.label')}
                        detail={activeKeys.length === 0 ? t('brandIntegration:api.health.key.none')
                            : keyUsed ? t('brandIntegration:api.health.key.working', { when: timeAgo(lastKeyCall) })
                            : t('brandIntegration:api.health.key.unused')}
                    />
                    <HealthItem
                        state={activeEps.length === 0 ? (disabledEps.length ? 'warn' : 'off') : failingEps.length ? 'warn' : 'ok'}
                        label={t('brandIntegration:api.health.webhook.label')}
                        detail={activeEps.length === 0
                            ? (disabledEps.length ? t('brandIntegration:api.health.webhook.autoDisabled') : t('brandIntegration:api.health.webhook.none'))
                            : failingEps.length ? t('brandIntegration:api.health.webhook.failing', { count: failingEps[0].consecutive_failures })
                            : lastDelivered ? t('brandIntegration:api.health.webhook.receiving', { when: timeAgo(lastDelivered.delivered_at) })
                            : t('brandIntegration:api.health.webhook.active')}
                    />
                    <HealthItem
                        state={!integration?.mint_url ? 'off' : circuitOpen ? 'warn' : integration?.mint_enabled ? 'ok' : 'warn'}
                        label={t('brandIntegration:api.health.jit.label')}
                        detail={!integration?.mint_url ? t('brandIntegration:api.health.jit.none')
                            : circuitOpen ? t('brandIntegration:api.health.jit.paused')
                            : integration?.mint_enabled ? t('brandIntegration:api.health.jit.on')
                            : t('brandIntegration:api.health.jit.off')}
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

                {!loading && deliveriesCard}

                {/* ── Fallback pool ────────────────────────────────────── */}
                <FallbackPoolCard />
            </div>
            </div>
        </div>
    );
}
