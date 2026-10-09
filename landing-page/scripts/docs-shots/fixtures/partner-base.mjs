// Who is signed in to the partner portal: a Peakform Nutrition user, with one
// live reward on Promo Codes. Area fixtures (partner-*.mjs) add the rest.
import { BRAND, daysFromNow } from '../world.mjs';

export const REWARD = {
    id: '7a2e0c11-0000-4000-8000-00000000d001',
    title: '25% off your first order',
    active: true,
    reward_kind: 'digital',
    integration_type: 'POOL',
    promo_code: BRAND.code,
    brand_name: BRAND.name,
    description: `${BRAND.name} · Any product`,
    partner_blurb: 'Clean protein and recovery blends, made in small batches.',
    offer: 'Get 25% off any single order. New customers only.',
    terms: 'One use per member. Cannot be combined with other offers.',
    value_label: '',
    discount_type: 'percentage',
    discount_value: '25.00',
    powr_cost: 450,
    stock: null,
    per_user_limit: 1,
    image_url: BRAND.logo_url,
    hero_image_url: BRAND.hero_url,
    hero_video_url: '',
    url: BRAND.website,
    created_at: daysFromNow(-48),
    category: 'food',
};

export default {
    rest: {
        admin_roles: [],
        reward_brand_users: [{ brand_name: BRAND.name, user_id: '6f1d2c3b-0000-4000-8000-00000000c001' }],
        rewards: [REWARD],
        // Off, as it is for brands today: the sidebar in every shot has no Placements.
        // Placements' own shots switch it on (shots/partner-placements.mjs).
        system_config: [{ key: 'partner_placements_enabled', value: 'false' }],
    },
    fn: {
        'manage-partner-api': (b) => ({
            resolve_delivery_method: { ok: true, method: 'manual', inferred: false },
            list_keys: { ok: true, keys: [] },
            get_integration: { ok: true, integration: { mint_url: null, mint_enabled: false, delivery_method: 'manual' } },
        }[b.action] ?? { ok: true }),
        'shopify-connect': { ok: true, status: 'none' },
    },
};
