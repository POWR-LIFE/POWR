// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Public edge function backing the partner reward-submission portal.
// The invite_token is the credential — there is NO logged-in user. All reads
// and writes run with the service role; reward_submissions has no anon policy.
//
//   action: 'validate' → { token }
//     Returns the minimal context for a valid `invited` token so the form can
//     prefill / lock the brand + promo-code prefix. Never leaks other rows.
//
//   action: 'submit'   → { token, payload }
//     Writes whitelisted fields and flips the row invited → pending. Rejects
//     anything that isn't currently `invited`. The caller can never set
//     status / powr_cost / reviewer fields.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Sanitize the partner-chosen promo-code middle segment: A–Z 0–9, 2–8 chars.
function cleanPrefix(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.slice(0, 8);
}

const trim = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const CATEGORIES = ['food', 'gym', 'health', 'gear', 'nutrition', 'fashion'];
const DISCOUNT_TYPES = ['percentage', 'fixed_amount'];
const REWARD_KINDS = ['digital', 'physical'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { action?: string; token?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, token } = body;
  if (!token) return json({ error: 'token is required' }, 400);

  // Load the submission + (optional) linked partner code.
  const { data: sub, error: subErr } = await admin
    .from('reward_submissions')
    .select('id, status, brand_name, partner_id, code_prefix, partners(name, partner_code)')
    .eq('invite_token', token)
    .maybeSingle();

  if (subErr) return json({ error: subErr.message }, 500);
  if (!sub) return json({ ok: false, reason: 'invalid' });

  const partner = Array.isArray(sub.partners) ? sub.partners[0] : sub.partners;
  const partnerCode = partner?.partner_code ?? null;
  const prefixLocked = !!partnerCode;

  // ── validate ──────────────────────────────────────────────────
  if (action === 'validate') {
    if (sub.status !== 'invited') return json({ ok: false, reason: 'used', status: sub.status });
    return json({
      ok: true,
      context: {
        brandName: sub.brand_name ?? partner?.name ?? '',
        brandLocked: !!partner?.name,
        partnerCode,
        prefixLocked,
        codePrefix: prefixLocked ? partnerCode : (sub.code_prefix ?? ''),
      },
    });
  }

  // ── submit ────────────────────────────────────────────────────
  if (action === 'submit') {
    if (sub.status !== 'invited') {
      return json({ ok: false, reason: 'used', status: sub.status }, 409);
    }
    const p = body.payload ?? {};

    // Promo-code prefix: forced to the partner code when the invite is linked.
    const prefix = prefixLocked ? partnerCode : cleanPrefix(p.code_prefix);

    const category = CATEGORIES.includes(p.category as string) ? p.category : null;
    const discountType = DISCOUNT_TYPES.includes(p.discount_type as string) ? p.discount_type : null;
    const rewardKind = REWARD_KINDS.includes(p.reward_kind as string) ? p.reward_kind : 'digital';
    const discountValue =
      discountType && p.discount_value !== '' && p.discount_value != null && Number.isFinite(Number(p.discount_value))
        ? Number(p.discount_value)
        : null;

    const update = {
      brand_name:     prefixLocked ? sub.brand_name : trim(p.brand_name),
      contact_name:   trim(p.contact_name),
      contact_email:  trim(p.contact_email),
      title:          trim(p.title),
      description:    trim(p.description),
      category,
      value_label:    trim(p.value_label),
      discount_type:  discountType,
      discount_value: discountValue,
      offer:          trim(p.offer),
      partner_blurb:  trim(p.partner_blurb),
      terms:          trim(p.terms),
      reward_kind:    rewardKind,
      url:            trim(p.url),
      image_url:      trim(p.image_url),
      hero_image_url: trim(p.hero_image_url),
      hero_video_url: trim(p.hero_video_url),
      brand_color:    trim(p.brand_color),
      code_prefix:    prefix || null,
      status:         'pending',
      submitted_at:   new Date().toISOString(),
    };

    // Every field is required — backstop the client-side validation so an
    // incomplete reward can never be submitted (even via a direct API call).
    const requiredFields = {
      'brand name':      update.brand_name,
      'contact name':    update.contact_name,
      'contact email':   update.contact_email,
      'reward title':    update.title,
      'short description': update.description,
      'sector':          update.category,
      'offer detail':    update.offer,
      'about your brand': update.partner_blurb,
      'terms':           update.terms,
      'website':         update.url,
      'logo image':      update.image_url,
      'hero image':      update.hero_image_url,
    };
    const missing = Object.entries(requiredFields).filter(([, v]) => !v).map(([k]) => k);
    if (!update.value_label && !(update.discount_type && update.discount_value != null)) missing.push('reward value');
    if (!update.code_prefix || update.code_prefix.length < 2) missing.push('promo code name');
    if (missing.length) return json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);

    // Guard against a race: only flip rows still `invited`.
    const { data: updated, error: updErr } = await admin
      .from('reward_submissions')
      .update(update)
      .eq('id', sub.id)
      .eq('status', 'invited')
      .select('id')
      .maybeSingle();

    if (updErr) return json({ error: updErr.message }, 500);
    if (!updated) return json({ ok: false, reason: 'used' }, 409);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
