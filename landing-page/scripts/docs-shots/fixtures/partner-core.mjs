// Data several partner pages share: Peakform Nutrition's claims, its code
// pool, its reward submissions and its cap. The brand has been live for about
// six weeks with one reward ("25% off your first order", 450 POWR, from
// partner-base.mjs), delivers codes by hand (Promo Codes) and is busy:
//
//   236 claims all-time (plus 4 refunded), 183 of them in the last 30 days
//   106,200 POWR spent with the brand (236 × 450)
//   550 codes loaded in two batches: POWR-PEAK-XXXXXX
//     batch 1, 300 codes uploaded 47 days ago (every claim so far came from it)
//     batch 2, 250 codes generated in the portal 9 days ago (untouched)
//   298 available · 85 reserved · 151 used · 16 expired (12 retired + 4 refunded)
//   A member has 30 days to use a claimed code; the brand reconciles weekly
//   (last run 3 days ago), so recent claims are still "reserved".
//   One approved submission (the live reward) and one "Listing update" in review.
//   Reward cap 2 (1 used).
//
// Everything is derived from the per-day claim counts below, so the figures on
// Overview, Redemptions and Promo Codes always agree with each other.
import { BRAND, BRAND_USER, PEOPLE, uid, photo } from '../world.mjs';
import { REWARD } from './partner-base.mjs';

const DAY = 864e5;
/** Local time, `d` days ago, at h:m. */
const at = (d, h = 0, m = 0) => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - d);
    t.setHours(h, m, 0, 0);
    return t;
};
const iso = (t) => new Date(t).toISOString();

// FNV-1a: stable pseudo-randomness, so every run draws the same data.
const hash = (s) => {
    let h = 0x811c9dc5;
    for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
};

// ── Members who claimed ──────────────────────────────────────────────────────
// One claim per member (the reward's per_user_limit is 1), so 240 people: the
// world's 40, then made-up first name + initial pairs.
const MORE_FIRST = [
    'Abi', 'Alfie', 'Anya', 'Ash', 'Bella', 'Blake', 'Cara', 'Casey', 'Dan', 'Darcy',
    'Eden', 'Elliot', 'Esme', 'Evan', 'Faye', 'Freddie', 'Gemma', 'George', 'Hollie', 'Harvey',
    'Imogen', 'Isaac', 'Jas', 'Jamal', 'Keira', 'Kieran', 'Lacey', 'Luca', 'Mia', 'Mason',
    'Nadia', 'Noah', 'Olive', 'Owen', 'Poppy', 'Rafi', 'Ruby', 'Ryan', 'Sienna', 'Theo',
    'Tilly', 'Toby', 'Una', 'Vik', 'Wren', 'Zac', 'Aisha', 'Ravi', 'Sofia', 'Tom',
];
const INITIALS = 'ABCDEFGHJKLMNPRSTW';
export const MEMBERS = [
    ...PEOPLE.map((p) => ({ id: p.id, name: p.name, username: p.username })),
    ...Array.from({ length: 200 }, (_, n) => {
        const first = MORE_FIRST[n % 50];
        const initial = INITIALS[((n % 50) + 5 * Math.floor(n / 50)) % INITIALS.length];
        return { id: uid('member', n + 1), name: `${first} ${initial}.`, username: `${first.toLowerCase()}${n + 52}` };
    }),
];

// ── Claims per day ───────────────────────────────────────────────────────────
// Days ago 46..31: the first fortnight, building up. Day 30: none, so the
// "last 30 days" line never depends on what time the shots are taken.
const EARLY = [1, 2, 3, 2, 4, 3, 5, 2, 4, 6, 3, 4, 5, 3, 2, 4];               // 53
// Days ago 29..0. The busy middle week is the brand's What's On feature.
const LAST_30 = [
    5, 6, 5, 3, 2, 8, 5,
    6, 4, 5, 8, 3, 2, 6,
    9, 12, 11, 8, 14, 9, 7,                                                   // featured week
    5, 6, 4, 7, 3, 6, 6, 5, 3,
];                                                                            // 183
const PER_DAY = new Map();
EARLY.forEach((n, i) => PER_DAY.set(46 - i, n));
PER_DAY.set(30, 0);
LAST_30.forEach((n, i) => PER_DAY.set(29 - i, n));
// One claim on each of these days was refunded (points back, code retired).
const REFUND_DAYS = [41, 33, 19, 6];
// The brand uploads its checkout export once a week; those codes become 'used'.
const RECONCILE_DAYS = [38, 31, 24, 17, 10, 3];
const reconcileRuns = RECONCILE_DAYS.map((d) => at(d, 11, 0).getTime());
const CLAIM_WINDOW_DAYS = 30;

// ── Codes ────────────────────────────────────────────────────────────────────
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const seen = new Set();
const makeCode = (seed) => {
    for (let salt = 0; ; salt++) {
        let h = hash(`${seed}:${salt}`);
        let s = '';
        for (let i = 0; i < 6; i++) { s += ALPHABET[h % 32]; h = Math.floor(h / 32) || hash(`${seed}:${salt}:${i}`); }
        const code = `POWR-${BRAND.code}-${s}`;
        if (!seen.has(code)) { seen.add(code); return code; }
    }
};
const BATCH_1 = { created_at: iso(at(47, 10, 12)), expires_at: iso(at(-43, 23, 59)), source: 'PARTNER_UPLOAD', size: 300 };
const BATCH_2 = { created_at: iso(at(9, 14, 36)), expires_at: iso(at(-81, 23, 59)), source: 'POWR_GENERATED', size: 250 };
const codeRow = (batch, n, i) => ({
    id: uid(`code-${n}`, i + 1),
    reward_id: REWARD.id,
    code: makeCode(`${n}-${i}`),
    source: batch.source,
    status: 'available',
    assigned_user_id: null,
    assigned_at: null,
    used_at: null,
    expires_at: batch.expires_at,
    created_at: batch.created_at,
    profiles: null,
});
const batch1 = Array.from({ length: BATCH_1.size }, (_, i) => codeRow(BATCH_1, 1, i));
const batch2 = Array.from({ length: BATCH_2.size }, (_, i) => codeRow(BATCH_2, 2, i));

// ── Build every claim in time order, handing out batch-1 codes as it goes ─────
const claims = [];
const nowMs = Date.now();
for (let d = 46; d >= 0; d--) {
    const n = (PER_DAY.get(d) ?? 0) + (REFUND_DAYS.includes(d) ? 1 : 0);
    let times;
    if (d === 0) {
        // Today: always in the past, whatever the hour.
        times = Array.from({ length: n }, (_, k) => nowMs - (25 + k * 61) * 60000).reverse();
    } else {
        times = Array.from({ length: n }, (_, k) => {
            const h = hash(`claim-${d}-${k}`);
            return at(d, 7 + (h % 15), (h >>> 5) % 60).getTime();
        }).sort((a, b) => a - b);
    }
    times.forEach((t, k) => claims.push({ t, d, refunded: REFUND_DAYS.includes(d) && k === Math.floor(n / 2) }));
}

export const REDEMPTIONS = claims.map((c, i) => {
    const member = MEMBERS[i];
    const code = batch1[i];
    const expires = iso(c.t + CLAIM_WINDOW_DAYS * DAY);
    const nextRun = reconcileRuns.find((r) => r > c.t);
    const rate = c.d > 30 ? 78 : 64;
    const used = !c.refunded && nextRun != null && hash(`used-${i}`) % 100 < rate;
    Object.assign(code, {
        status: c.refunded ? 'expired' : used ? 'used' : 'reserved',
        assigned_user_id: member.id,
        assigned_at: iso(c.t),
        used_at: used ? iso(nextRun) : null,
        expires_at: expires,
        profiles: { display_name: member.name, username: member.username },
    });
    return {
        id: uid('redemption', i + 1),
        user_id: member.id,
        reward_id: REWARD.id,
        code: code.code,
        code_id: code.id,
        status: c.refunded ? 'refunded' : 'active',
        integration_type: 'POOL',
        powr_spent: REWARD.powr_cost,
        redeemed_at: iso(c.t),
        expires_at: expires,
        used_at: null,
        rewards: { title: REWARD.title },
        redemption_codes: { status: code.status },
    };
}).reverse(); // newest first, as every page orders them

// 12 batch-1 codes the brand retired after they turned up on a deal site.
const RETIRED = 12;
for (let i = claims.length; i < claims.length + RETIRED; i++) batch1[i].status = 'expired';

// Newest batch first (the pages order by created_at desc).
export const CODES = [...batch2, ...batch1];

const count = (rows, f) => rows.filter(f).length;
const kept = REDEMPTIONS.filter((r) => r.status !== 'refunded');
export const FACTS = {
    claimsAllTime: kept.length,
    claimsLast30: count(kept, (r) => Date.parse(r.redeemed_at) > nowMs - 30 * DAY),
    refunded: REDEMPTIONS.length - kept.length,
    powrSpent: kept.reduce((s, r) => s + r.powr_spent, 0),
    codes: {
        total: CODES.length,
        available: count(CODES, (c) => c.status === 'available'),
        reserved: count(CODES, (c) => c.status === 'reserved'),
        used: count(CODES, (c) => c.status === 'used'),
        expired: count(CODES, (c) => c.status === 'expired'),
    },
    firstClaim: REDEMPTIONS[REDEMPTIONS.length - 1].redeemed_at,
};

// ── Reward submissions ───────────────────────────────────────────────────────
const SUBMISSION_BASE = {
    invite_token: 'docs-invite-peakform',
    brand_name: BRAND.name,
    partner_id: null,
    contact_name: BRAND_USER.name,
    contact_email: BRAND_USER.email,
    title: REWARD.title,
    description: REWARD.description,
    category: REWARD.category,
    value_label: REWARD.value_label,
    discount_type: REWARD.discount_type,
    discount_value: REWARD.discount_value,
    offer: REWARD.offer,
    partner_blurb: REWARD.partner_blurb,
    terms: REWARD.terms,
    reward_kind: 'digital',
    url: REWARD.url,
    image_url: REWARD.image_url,
    hero_image_url: REWARD.hero_image_url,
    hero_video_url: null,
    brand_color: null,
    code_prefix: BRAND.code,
    delivery_method: 'code_pool',
    fulfilment_notes: null,
    stock: null,
    max_redemptions_per_user: 1,
    partner_feedback: null,
    reviewer_notes: null,
    reviewed_by: null,
};
export const SUBMISSIONS = [
    // A listing update for the live reward, sent yesterday and with POWR now.
    {
        ...SUBMISSION_BASE,
        id: uid('submission', 2),
        status: 'pending',
        target_reward_id: REWARD.id,
        created_reward_id: null,
        offer: 'Get 25% off any single order, bundles included. New customers only.',
        partner_blurb: 'Clean protein and recovery blends, made in small batches in Riverton.',
        hero_image_url: photo('runner-pan.jpg'),
        submitted_at: iso(at(1, 16, 42)),
        reviewed_at: null,
        created_at: iso(at(1, 16, 5)),
        updated_at: iso(at(1, 16, 42)),
    },
    // The original submission, approved the day the reward went live.
    {
        ...SUBMISSION_BASE,
        id: uid('submission', 1),
        status: 'approved',
        target_reward_id: null,
        created_reward_id: REWARD.id,
        submitted_at: iso(at(50, 15, 20)),
        reviewed_at: REWARD.created_at,
        created_at: iso(at(51, 11, 3)),
        updated_at: REWARD.created_at,
    },
];

export default {
    rest: {
        // Not an affiliate either: the portal shows a plain brand account.
        creator_users: [],
        brand_reward_limits: [{ brand_key: BRAND.name.toLowerCase(), reward_limit: 2, updated_at: REWARD.created_at }],
        reward_submissions: SUBMISSIONS,
        redemptions: REDEMPTIONS,
        redemption_codes: CODES,
        // Manual delivery: no API keys, webhooks or minting.
        reward_brand_integrations: [{
            brand_name: BRAND.name,
            delivery_method: 'manual',
            delivery_method_set_at: BATCH_1.created_at,
            mint_url: null,
            mint_enabled: false,
            mint_consecutive_failures: 0,
            mint_disabled_until: null,
            pool_low_threshold: 25,
            created_at: BATCH_1.created_at,
            updated_at: BATCH_1.created_at,
        }],
        reward_brand_webhook_endpoints: [],
    },
    rpc: {
        // A brand user is on no gym's team.
        gym_my_memberships: [],
    },
};
