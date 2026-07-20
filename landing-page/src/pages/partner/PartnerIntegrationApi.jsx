import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Eye, EyeOff, Plus, RefreshCw, Send, Trash2, TriangleAlert, Zap } from 'lucide-react';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
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

export default function PartnerIntegrationApi() {
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
        if (failed) toast.error(`Some data failed to load — refresh to retry (${failed.reason?.message ?? 'network error'})`);
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brand]);

    useEffect(() => { refresh(); }, [refresh]);

    if (!partnerData) return null;

    const handleCreateKey = async () => {
        setCreatingKey(true);
        try {
            const res = await callPartnerApi('create_key', brand, { label: newKeyLabel || 'API key' });
            setFreshKey(res.key);
            setNewKeyLabel('');
            await refresh();
        } catch (err) { toast.error(err.message); }
        setCreatingKey(false);
    };

    const handleRevokeKey = async (keyId) => {
        if (!window.confirm('Revoke this key? Integrations using it will stop working immediately.')) return;
        try {
            await callPartnerApi('revoke_key', brand, { key_id: keyId });
            toast.success('Key revoked');
            await refresh();
        } catch (err) { toast.error(err.message); }
    };

    const handleAddEndpoint = async () => {
        if (!newUrl.trim()) { toast.error('Enter an endpoint URL'); return; }
        if (newEvents.length === 0) { toast.error('Pick at least one event'); return; }
        setAddingEndpoint(true);
        try {
            await callPartnerApi('create_endpoint', brand, { url: newUrl.trim(), events: newEvents });
            toast.success('Endpoint added');
            setNewUrl('');
            setNewEvents(WEBHOOK_EVENTS.map(e => e.id));
            await refresh();
        } catch (err) { toast.error(err.message); }
        setAddingEndpoint(false);
    };

    const handleToggleEndpoint = async (ep) => {
        setBusyEndpoint(ep.id);
        try {
            await callPartnerApi('update_endpoint', brand, { endpoint_id: ep.id, active: !ep.active });
            await refresh();
        } catch (err) { toast.error(err.message); }
        setBusyEndpoint(null);
    };

    const handleDeleteEndpoint = async (ep) => {
        if (!window.confirm('Delete this endpoint? Its delivery history goes with it.')) return;
        try {
            await callPartnerApi('delete_endpoint', brand, { endpoint_id: ep.id });
            toast.success('Endpoint deleted');
            await refresh();
        } catch (err) { toast.error(err.message); }
    };

    const handleTestEndpoint = async (ep) => {
        setBusyEndpoint(ep.id);
        setTestResult(prev => ({ ...prev, [ep.id]: { pending: true } }));
        try {
            const res = await callPartnerApi('test_endpoint', brand, { endpoint_id: ep.id });
            setTestResult(prev => ({ ...prev, [ep.id]: res }));
        } catch (err) {
            setTestResult(prev => ({ ...prev, [ep.id]: { ok: false, error: err.message } }));
        }
        setBusyEndpoint(null);
    };

    const handleRedeliver = async (deliveryId) => {
        try {
            await callPartnerApi('redeliver', brand, { delivery_id: deliveryId });
            toast.success('Queued for redelivery');
            await refresh();
        } catch (err) { toast.error(err.message); }
    };

    // One click, every wire: fires the signed webhook test at each active
    // endpoint plus the JIT mint probe, all via already-deployed actions.
    const [connTest, setConnTest] = useState(null);
    const handleRunConnectionTest = async () => {
        setConnTest({ running: true, items: [] });
        const activeEps = endpoints.filter(e => e.active);
        const results = await Promise.allSettled([
            ...activeEps.map(ep => callPartnerApi('test_endpoint', brand, { endpoint_id: ep.id }).then(r => ({ kind: 'webhook', ep, r }))),
            ...(integration?.mint_url ? [callPartnerApi('test_mint', brand).then(r => ({ kind: 'mint', r }))] : []),
        ]);
        const items = results.map(res => {
            if (res.status === 'rejected') return { ok: false, label: 'Test call failed', detail: res.reason?.message ?? 'network error' };
            const { kind, ep, r } = res.value;
            if (kind === 'webhook') {
                let host = ep.url; try { host = new URL(ep.url).host; } catch { /* show raw */ }
                return { ok: !!r.ok, label: `Webhook → ${host}`, detail: r.ok ? `Delivered — HTTP ${r.status}` : (r.error ?? `HTTP ${r.status}`) };
            }
            return {
                ok: !!r.ok, label: 'JIT mint endpoint',
                detail: r.ok ? `Responded in ${r.elapsed_ms}ms with a valid code${r.warning ? ` — ${r.warning}` : ''}` : r.error,
            };
        });
        if (activeEps.length === 0) items.unshift({ ok: false, label: 'Webhooks', detail: 'No active endpoint to test — add one below.' });
        setConnTest({ running: false, items });
    };

    const handleTestMint = async () => {
        setTestingMint(true);
        setMintTest(null);
        try {
            const res = await callPartnerApi('test_mint', brand);
            setMintTest(res);
        } catch (err) {
            setMintTest({ ok: false, error: err.message });
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
            toast.success('Integration settings saved');
        } catch (err) { toast.error(err.message); }
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

    // ── Step contents ─────────────────────────────────────────────

    const renderKeys = () => (
        <>
                {freshKey && (
                    <div className="mb-6 p-5 bg-[#E8D200]/10 border border-[#E8D200]/40 rounded-2xl">
                        <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#8a7600] mb-2">Copy your new key now — it will not be shown again</div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <code className="text-[12px] font-mono text-[#1A1A1A] break-all">{freshKey}</code>
                            <CopyButton value={freshKey} />
                            <button type="button" className={BTN_GHOST} onClick={() => setFreshKey(null)}>Done</button>
                        </div>
                    </div>
                )}

                {keys.length === 0 && !loading ? (
                    <p className="text-[12px] text-[#AAA] mb-6">No API keys yet. Create one to start calling the API.</p>
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
                                        {k.revoked_at ? 'Revoked' : k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : 'Never used'}
                                    </div>
                                </div>
                                {!k.revoked_at && (
                                    <button type="button" onClick={() => handleRevokeKey(k.id)}
                                        className="h-9 px-4 text-[9px] font-black uppercase tracking-[0.2em] rounded-full text-red-500/60 hover:text-red-500 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-all">
                                        Revoke
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-3">
                    <input
                        type="text" placeholder="Key label (e.g. Shopify sync)" value={newKeyLabel}
                        onChange={e => setNewKeyLabel(e.target.value)} className={INPUT + ' flex-1'} maxLength={60}
                    />
                    <button type="button" onClick={handleCreateKey} disabled={creatingKey} className={BTN_DARK + ' h-14 shrink-0 flex items-center gap-2'}>
                        <Plus size={13} /> {creatingKey ? 'Creating…' : 'Create key'}
                    </button>
                </div>
                <p className="text-[10px] text-[#BBB] mt-3 leading-relaxed">
                    Then prove it works from your server: <code className="font-mono text-[#8a7600]">GET {API_BASE_URL}/ping</code> with
                    the key as a bearer token. Full details in the <a href={DOCS_PATH} target="_blank" rel="noreferrer" className="text-[#8a7600] underline">API docs</a>.
                </p>
        </>
    );

    const renderWebhooks = () => (
        <>
                <div className="space-y-4 mb-8">
                    {endpoints.length === 0 && !loading && (
                        <p className="text-[12px] text-[#AAA]">No endpoints yet. Add one and we'll POST signed events to it as they happen.</p>
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
                                            <span className="flex items-center gap-1.5"><Send size={11} /> Test</span>
                                        </button>
                                        <button type="button" className={BTN_GHOST} disabled={busyEndpoint === ep.id} onClick={() => handleToggleEndpoint(ep)}>
                                            {ep.active ? 'Disable' : 'Enable'}
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
                                        <span className="text-[10px] text-red-500/80">{ep.disabled_reason}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 mt-3">
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBB]">Signing secret</span>
                                    <code className="text-[11px] font-mono text-[#666]">
                                        {revealSecret[ep.id] ? ep.secret : '••••••••••••••••'}
                                    </code>
                                    <button type="button" onClick={() => setRevealSecret(p => ({ ...p, [ep.id]: !p[ep.id] }))}
                                        className="text-[#BBB] hover:text-[#666] transition-colors">
                                        {revealSecret[ep.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                    <CopyButton value={ep.secret} label="Copy secret" />
                                </div>
                                {res && !res.pending && (
                                    <div className={`mt-3 text-[11px] font-bold ${res.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {res.ok ? `Test delivered — HTTP ${res.status}` : `Test failed — ${res.error ?? `HTTP ${res.status}`}`}
                                    </div>
                                )}
                                {res?.pending && <div className="mt-3 text-[11px] text-[#999]">Sending test event…</div>}
                            </div>
                        );
                    })}
                </div>

                <div className="pt-6 border-t border-[#E6E6E1]">
                    <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-3">Add endpoint</div>
                    <input type="url" placeholder="https://your-system.example.com/powr/webhooks" value={newUrl}
                        onChange={e => setNewUrl(e.target.value)} className={INPUT} />
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                        {WEBHOOK_EVENTS.map(ev => {
                            const on = newEvents.includes(ev.id);
                            return (
                                <button key={ev.id} type="button" title={ev.description}
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
                            {addingEndpoint ? 'Adding…' : 'Add endpoint'}
                        </button>
                    </div>
                </div>
        </>
    );

    // ── Recent deliveries — a log, not a step; rendered under the flow ──
    const deliveriesCard = (
            <SectionCard
                icon={Send} title="Recent Deliveries"
                aside={
                    <button type="button" className={BTN_GHOST} onClick={refresh}>
                        <span className="flex items-center gap-1.5"><RefreshCw size={11} /> Refresh</span>
                    </button>
                }
            >
                {deliveries.length === 0 ? (
                    <p className="text-[12px] text-[#AAA]">Nothing delivered yet. Events appear here the moment members interact with your rewards.</p>
                ) : (
                    <div className="space-y-2">
                        {deliveries.map((d) => (
                            <div key={d.id} className="flex items-center gap-4 p-3.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                                <span className={`text-[9px] uppercase tracking-[0.2em] font-black rounded-full px-3 py-1 border shrink-0 ${STATUS_CHIP[d.status] ?? STATUS_CHIP.skipped}`}>
                                    {d.status}
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
                                        {d.attempts > 0 ? `${d.attempts} attempt${d.attempts > 1 ? 's' : ''}` : ''}
                                        {d.last_response_status ? ` · HTTP ${d.last_response_status}` : ''}
                                    </div>
                                </div>
                                {(d.status === 'failed' || d.status === 'skipped') && (
                                    <button type="button" className={BTN_GHOST} onClick={() => handleRedeliver(d.id)}>Redeliver</button>
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
                    When a member redeems, POWR asks <em>your</em> endpoint for a fresh single-use
                    code — no pre-loaded pools, no reconciliation. Applies to rewards set to
                    API-validated delivery. Keep a small buffer of pool codes loaded as a fallback for outages.
                </p>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Mint endpoint URL</label>
                        <input type="url" placeholder="https://your-system.example.com/powr/mint" value={mintUrl}
                            onChange={e => setMintUrl(e.target.value)} className={INPUT} />
                    </div>
                    {integration?.mint_secret && (
                        <div className="flex items-center gap-3">
                            <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#BBB]">Mint signing secret</span>
                            <code className="text-[11px] font-mono text-[#666]">
                                {revealSecret.mint ? integration.mint_secret : '••••••••••••••••'}
                            </code>
                            <button type="button" onClick={() => setRevealSecret(p => ({ ...p, mint: !p.mint }))}
                                className="text-[#BBB] hover:text-[#666] transition-colors">
                                {revealSecret.mint ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                            <CopyButton value={integration.mint_secret} label="Copy secret" />
                        </div>
                    )}
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-2">Pool-low alert threshold</label>
                        <input type="number" min={0} max={10000} value={threshold}
                            onChange={e => setThreshold(e.target.value)} className={INPUT + ' max-w-[160px]'} />
                        <p className="text-[10px] text-[#BBB] mt-1.5">We send pool.low when a reward's available codes dip to this level. 0 turns it off.</p>
                    </div>
                    {mintTest && (
                        <div className={`text-[11px] font-bold ${mintTest.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                            {mintTest.ok
                                ? `Mint endpoint working — responded in ${mintTest.elapsed_ms}ms with a valid code (${mintTest.code_preview}).${mintTest.warning ? ` ⚠ ${mintTest.warning}` : ''}`
                                : `Mint test failed — ${mintTest.error}`}
                        </div>
                    )}
                    {testingMint && <div className="text-[11px] text-[#999]">Sending a test mint request…</div>}
                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                            <span className={`h-2 w-2 rounded-full ${integration?.mint_enabled ? 'bg-emerald-500' : 'bg-[#CCC]'}`} />
                            <span className="text-[11px] font-bold text-[#666]">
                                JIT minting is {integration?.mint_enabled ? 'ON' : 'OFF'}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            {integration?.mint_url && (
                                <button type="button" disabled={testingMint} className={BTN_GHOST} onClick={handleTestMint}>
                                    <span className="flex items-center gap-1.5"><Send size={11} /> Test mint endpoint</span>
                                </button>
                            )}
                            {integration?.mint_url && (
                                <button type="button" disabled={savingIntegration} className={BTN_GHOST}
                                    onClick={() => handleSaveIntegration({ mint_enabled: !integration?.mint_enabled })}>
                                    {integration?.mint_enabled ? 'Turn off' : 'Turn on'}
                                </button>
                            )}
                            <button type="button" disabled={savingIntegration} className={BTN_DARK}
                                onClick={() => handleSaveIntegration({ mint_url: mintUrl.trim() || null, pool_low_threshold: threshold })}>
                                {savingIntegration ? 'Saving…' : 'Save settings'}
                            </button>
                        </div>
                    </div>
                </div>
        </>
    );

    const renderVerify = () => (
        <>
            <p className="text-[12px] text-[#999] leading-relaxed mb-6 max-w-xl">
                One click fires a signed test event at every active webhook endpoint — plus a probe of
                your mint endpoint if you've configured one — and shows you exactly what came back.
            </p>
            <button type="button" disabled={connTest?.running} onClick={handleRunConnectionTest}
                className="flex items-center justify-center gap-2 h-12 px-8 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all disabled:opacity-50">
                <Zap size={13} /> {connTest?.running ? 'Testing…' : 'Run connection test'}
            </button>
            {connTest && !connTest.running && (
                <div className="mt-5 p-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <div className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-2">Live test results</div>
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
            title: 'Create an API key',
            detail: 'Your server authenticates every call with a bearer key — create one and store it somewhere safe.',
            summary: `${activeKeys.length} active key${activeKeys.length === 1 ? '' : 's'}${keyUsed ? ` · last call ${timeAgo(activeKeys.map(k => k.last_used_at).filter(Boolean).sort().pop())}` : ' · not called yet'}`,
            done: activeKeys.length > 0,
            // A fresh key is shown exactly once — never collapse it away.
            forceOpen: !!freshKey,
            render: renderKeys,
        },
        {
            id: 'webhook',
            title: 'Add a webhook endpoint',
            detail: 'We POST signed events to your system the moment they happen — a code is assigned, a code is used, a pool runs low.',
            summary: activeEps.length > 0
                ? `${activeEps.length} active endpoint${activeEps.length === 1 ? '' : 's'}${lastDelivered ? ` · last delivery ${timeAgo(lastDelivered.delivered_at)}` : ''}`
                : undefined,
            done: activeEps.length > 0,
            render: renderWebhooks,
        },
        {
            id: 'jit',
            title: 'Turn on just-in-time minting',
            detail: 'The deepest integration — POWR asks your endpoint for a fresh code at each redemption. Skip it if you\'d rather pre-load code pools.',
            summary: 'On — POWR mints from your endpoint at redemption time.',
            done: !!(integration?.mint_url && integration?.mint_enabled),
            optional: true,
            render: renderJit,
        },
        {
            id: 'verify',
            title: 'Verify the integration',
            detail: 'Fire a signed test at everything you\'ve wired up and watch it come back green.',
            summary: keyUsed ? 'Verified — your server is making live API calls.' : 'All test calls passed.',
            done: keyUsed || connTestPassed,
            render: renderVerify,
        },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700 max-w-[1160px]">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#8a7600]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Integration · API</span>
                </div>
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">API</h1>
                    <div className="flex items-center gap-3">
                        <ChangeMethodLink />
                        <GuideLink method="api" label="API Docs" />
                    </div>
                </div>
                <p className="text-[12px] text-[#999] leading-relaxed mt-4 max-w-xl">
                    Automate your code supply and usage reconciliation in four steps — push codes, hear
                    about redemptions the second they happen, and skip the CSV uploads entirely.
                </p>
                <div className="mt-5 flex items-center gap-3">
                    <code className="text-[11px] font-mono text-[#666] bg-white border border-[#E6E6E1] rounded-full px-4 py-2">{API_BASE_URL}</code>
                    <CopyButton value={API_BASE_URL} label="Copy base URL" />
                </div>
            </div>

            <WrongMethodNotice pageMethod="api" />

            <div className="flex flex-col xl:flex-row xl:items-start xl:gap-10">
            {/* ── Connection health — sticky rail on wide screens, stacked on
                   top otherwise. Sticky works because PartnerLayout's main is
                   the scroll container (same trick as the Rewards preview). */}
            <aside className="xl:order-2 xl:w-[340px] xl:shrink-0 xl:sticky xl:top-6">
            {!loading && (
                <SectionCard icon={Activity} title="Connection Health">
                    <HealthItem
                        state={activeKeys.length === 0 ? 'off' : keyUsed ? 'ok' : 'warn'}
                        label="API key"
                        detail={activeKeys.length === 0 ? 'No key yet — create one in step 1.'
                            : keyUsed ? `Working — last call ${timeAgo(activeKeys.map(k => k.last_used_at).filter(Boolean).sort().pop())}.`
                            : 'Key created but never used — try GET /v1/ping from your server.'}
                    />
                    <HealthItem
                        state={activeEps.length === 0 ? (disabledEps.length ? 'warn' : 'off') : failingEps.length ? 'warn' : 'ok'}
                        label="Webhook endpoint"
                        detail={activeEps.length === 0
                            ? (disabledEps.length ? 'Your endpoint was auto-disabled after repeated failures — fix it, then re-enable it in step 2.' : 'No endpoint yet — add one in step 2 to hear about redemptions live.')
                            : failingEps.length ? `${failingEps[0].consecutive_failures} recent deliveries failed — check your receiver, or hit Test.`
                            : lastDelivered ? `Receiving — last successful delivery ${timeAgo(lastDelivered.delivered_at)}.`
                            : 'Endpoint active — verify in step 4 to confirm it receives signed events.'}
                    />
                    <HealthItem
                        state={!integration?.mint_url ? 'off' : circuitOpen ? 'warn' : integration?.mint_enabled ? 'ok' : 'warn'}
                        label="Just-in-time minting"
                        detail={!integration?.mint_url ? 'Optional — configure it in step 3 if you want codes minted from your system at redemption time.'
                            : circuitOpen ? 'Paused after repeated mint failures — test your endpoint in step 3; it resumes automatically.'
                            : integration?.mint_enabled ? 'On — POWR asks your endpoint for a fresh code at each redemption.'
                            : 'Configured but off — run "Test mint endpoint" in step 3, then turn it on.'}
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
