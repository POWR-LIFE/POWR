import { supabase } from './supabase';
import { invokeFn } from './invokeFn';
import i18n, { formatLocale } from './i18n';

// Client helpers for the brand developer-integration surface (API keys,
// webhook endpoints, JIT minting). All WRITES go through manage-partner-api
// (secrets are generated server-side; admins pass brand_name, brand users are
// server-forced to their own brand). Reads are direct RLS-scoped queries.

export const API_BASE_URL = 'https://powr.life/api/partner/v1';
export const DOCS_PATH = '/docs/api';

// Public guide per delivery method — every method page links to its own, so
// "how do I set this up" is one click from wherever the partner is standing.
export const DOCS_PATHS = {
    api: '/docs/api',
    shopify: '/docs/shopify',
    manual: '/docs/promo-codes',
};

// id is the event name developers subscribe to and receive — never translated.
// The label and description are keys, translated where they render.
export const WEBHOOK_EVENTS = [
    {
        id: 'code.assigned',
        labelKey: 'brandIntegration:webhookEvents.codeAssigned.label',
        descriptionKey: 'brandIntegration:webhookEvents.codeAssigned.description',
    },
    {
        id: 'code.used',
        labelKey: 'brandIntegration:webhookEvents.codeUsed.label',
        descriptionKey: 'brandIntegration:webhookEvents.codeUsed.description',
    },
    {
        id: 'pool.low',
        labelKey: 'brandIntegration:webhookEvents.poolLow.label',
        descriptionKey: 'brandIntegration:webhookEvents.poolLow.description',
    },
    {
        id: 'voucher.confirmed',
        labelKey: 'brandIntegration:webhookEvents.voucherConfirmed.label',
        descriptionKey: 'brandIntegration:webhookEvents.voucherConfirmed.description',
    },
    {
        id: 'voucher.swiped',
        labelKey: 'brandIntegration:webhookEvents.voucherSwiped.label',
        descriptionKey: 'brandIntegration:webhookEvents.voucherSwiped.description',
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
// its "not set up" line instead of blanking everything. `line` is a getter:
// pages keep this object in state, and reading it at render time keeps the
// words in the language on screen even after a switch.
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
            get line() {
                if (activeKeys === 0 && activeEps === 0 && !mintOn) return i18n.t('brandIntegration:status.api.notSetUp');
                return [
                    i18n.t('brandIntegration:status.api.keys', { count: activeKeys }),
                    i18n.t('brandIntegration:status.api.webhooks', { count: activeEps }),
                    mintOn ? i18n.t('brandIntegration:status.api.jitOn') : null,
                ].filter(Boolean).join(' · ');
            },
        },
        shopify: {
            configured: !!shop?.connected,
            get line() {
                return shop?.connected ? i18n.t('brandIntegration:status.shopify.connected', { domain: shop.shop_domain })
                    : shop?.status === 'uninstalled' ? i18n.t('brandIntegration:status.shopify.uninstalled')
                    : i18n.t('brandIntegration:status.shopify.notConnected');
            },
        },
        manual: {
            configured: availableCodes > 0,
            get line() {
                return availableCodes > 0
                    ? i18n.t('brandIntegration:status.manual.available', {
                        count: availableCodes,
                        codes: availableCodes.toLocaleString(formatLocale()),
                    })
                    : i18n.t('brandIntegration:status.manual.none');
            },
        },
    };
}
