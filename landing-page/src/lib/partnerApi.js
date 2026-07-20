import { supabase } from './supabase';
import { invokeFn } from './invokeFn';

// Client helpers for the brand developer-integration surface (API keys,
// webhook endpoints, JIT minting). All WRITES go through manage-partner-api
// (secrets are generated server-side; admins pass brand_name, brand users are
// server-forced to their own brand). Reads are direct RLS-scoped queries.

export const API_BASE_URL = 'https://powr.life/api/partner/v1';
export const DOCS_PATH = '/developers';

export const WEBHOOK_EVENTS = [
    {
        id: 'code.assigned',
        label: 'Code assigned',
        description: 'A member redeemed a reward and was handed one of your codes.',
    },
    {
        id: 'code.used',
        label: 'Code used',
        description: 'A code was confirmed as used in your system (via reconciliation).',
    },
    {
        id: 'pool.low',
        label: 'Pool running low',
        description: 'A reward’s available code stock dipped below your threshold.',
    },
];

export const callPartnerApi = (action, brandName, params = {}) =>
    invokeFn('manage-partner-api', { action, brand_name: brandName, ...params });

export const callShopify = (action, brandName, params = {}) =>
    invokeFn('shopify-connect', { action, brand_name: brandName, ...params });

export async function fetchEndpoints(brandName) {
    const { data, error } = await supabase
        .from('reward_brand_webhook_endpoints')
        .select('*')
        .ilike('brand_name', brandName)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

export async function fetchDeliveries(brandName, { limit = 25 } = {}) {
    const { data, error } = await supabase
        .from('reward_brand_webhook_deliveries')
        .select('id, event_type, status, attempts, next_attempt_at, last_response_status, last_error, created_at, delivered_at, reward_brand_webhook_endpoints(url)')
        .ilike('brand_name', brandName)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data ?? [];
}

export async function fetchIntegration(brandName) {
    const { data, error } = await supabase
        .from('reward_brand_integrations')
        .select('*')
        .ilike('brand_name', brandName)
        .maybeSingle();
    if (error) throw error;
    return data ?? null;
}

// One { configured, line } status per delivery method — drives the hub cards
// and the Overview connection bar. allSettled so one flaky source degrades to
// its "not set up" line instead of blanking everything.
export async function fetchMethodStatuses(brandName) {
    const [keysRes, epsRes, integRes, shopRes, rewardsRes] = await Promise.allSettled([
        callPartnerApi('list_keys', brandName),
        fetchEndpoints(brandName),
        fetchIntegration(brandName),
        callShopify('status', brandName),
        supabase.from('rewards').select('id').ilike('brand_name', brandName),
    ]);

    // Manual = available codes across the brand's rewards (same proven
    // two-step pattern as the Promo Codes page).
    let availableCodes = 0;
    if (rewardsRes.status === 'fulfilled') {
        const ids = (rewardsRes.value.data ?? []).map(r => r.id);
        if (ids.length) {
            const { count } = await supabase
                .from('redemption_codes')
                .select('id', { count: 'exact', head: true })
                .in('reward_id', ids)
                .eq('status', 'available');
            availableCodes = count ?? 0;
        }
    }

    const activeKeys = keysRes.status === 'fulfilled' ? (keysRes.value.keys ?? []).filter(k => !k.revoked_at).length : 0;
    const activeEps = epsRes.status === 'fulfilled' ? epsRes.value.filter(e => e.active).length : 0;
    const mintOn = integRes.status === 'fulfilled' && integRes.value?.mint_enabled;
    const shop = shopRes.status === 'fulfilled' ? shopRes.value : null;

    return {
        api: {
            configured: activeKeys > 0 || activeEps > 0 || !!mintOn,
            line: activeKeys === 0 && activeEps === 0 && !mintOn
                ? 'Not set up yet'
                : [`${activeKeys} key${activeKeys === 1 ? '' : 's'}`, `${activeEps} webhook${activeEps === 1 ? '' : 's'}`, mintOn ? 'JIT minting on' : null]
                    .filter(Boolean).join(' · '),
        },
        shopify: {
            configured: !!shop?.connected,
            line: shop?.connected ? `Connected to ${shop.shop_domain}`
                : shop?.status === 'uninstalled' ? 'App uninstalled — reconnect to resume'
                : 'Not connected yet',
        },
        manual: {
            configured: availableCodes > 0,
            line: availableCodes > 0
                ? `${availableCodes.toLocaleString()} code${availableCodes === 1 ? '' : 's'} available`
                : 'No codes uploaded yet',
        },
    };
}
