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
