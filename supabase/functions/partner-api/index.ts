// @ts-nocheck — Deno runtime
// PARTNER DEVELOPER API — the machine-facing REST surface for reward brands.
// Docs: https://powr.life/developers
//
// Auth: `Authorization: Bearer powr_sk_live_…` — keys are minted in the brand
// portal (manage-partner-api), stored as sha256 hashes in
// reward_brand_api_keys, and scope every request to the key's brand. Platform
// JWT verification is OFF (config.toml): these are not Supabase users.
//
// Also reachable via the Vercel proxy: https://powr.life/api/partner/*
// (rewrites to /functions/v1/partner-api/*, so the path shape is identical).
//
//   GET  /v1/ping         → identity check
//   GET  /v1/rewards      → the brand's rewards + live code-pool stats
//   GET  /v1/codes        → list codes for a reward (keyset-paginated)
//   POST /v1/codes        → push a batch of codes into a reward's pool
//   GET  /v1/redemptions  → member-assigned codes since a cursor (no PII)
//   POST /v1/reconcile    → confirm codes used in the brand's own system
//
// Deliberately no CORS headers: this API is server-to-server. A key in a
// browser is a leaked key.

import { createClient } from '@supabase/supabase-js';
import { sha256Hex } from '../_shared/webhookSign.ts';

const RATE_LIMIT_PER_MIN = 120;
const MAX_BATCH = 5000;
// Partner systems mint codes in their own formats (Shopify etc.), so unlike
// the portal uploader we don't require the POWR- prefix — just a safe charset.
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,62}[A-Z0-9]$/;
const CODE_STATUSES = ['available', 'reserved', 'used', 'expired'];

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...extra },
  });

const err = (status, code, message) => json({ error: code, message }, status);

const encodeCursor = (ts, id) => btoa(`${ts}|${id}`);
const decodeCursor = (raw) => {
  try {
    const [ts, id] = atob(raw).split('|');
    if (!ts || !id) return null;
    return { ts, id };
  } catch { return null; }
};

const sameBrand = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// Reward lookup that enforces brand ownership.
async function getBrandReward(admin, brand, rewardId) {
  if (!rewardId) return { error: err(400, 'missing_reward_id', 'reward_id is required') };
  const { data: reward } = await admin
    .from('rewards')
    .select('id, title, brand_name, active, integration_type, code_expiry_days')
    .eq('id', rewardId)
    .maybeSingle();
  if (!reward || !sameBrand(reward.brand_name, brand)) {
    return { error: err(404, 'reward_not_found', 'No such reward for this brand') };
  }
  return { reward };
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  // Path arrives as /partner-api/v1/… (direct) — normalise to /v1/…
  const path = url.pathname.replace(/^\/partner-api/, '') || '/';

  // ── Key auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const keyMatch = authHeader.match(/^Bearer\s+(powr_sk_[A-Za-z0-9_]+)\s*$/i);
  if (!keyMatch) {
    return err(401, 'missing_key', 'Send your API key as: Authorization: Bearer powr_sk_…');
  }

  const keyHash = await sha256Hex(keyMatch[1]);
  const { data: apiKey } = await admin
    .from('reward_brand_api_keys')
    .select('id, brand_name, scopes, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (!apiKey || apiKey.revoked_at) {
    return err(401, 'invalid_key', 'This API key is unknown or has been revoked');
  }

  const { data: allowed } = await admin.rpc('bump_api_rate', {
    p_key_id: apiKey.id,
    p_limit: RATE_LIMIT_PER_MIN,
  });
  if (allowed === false) {
    return err(429, 'rate_limited', `Limit is ${RATE_LIMIT_PER_MIN} requests per minute per key`);
  }

  await admin.from('reward_brand_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id);

  const brand = apiKey.brand_name;
  const isWrite = req.method === 'POST';
  const neededScope = isWrite ? 'write' : 'read';
  if (!(apiKey.scopes ?? []).includes(neededScope)) {
    return err(403, 'insufficient_scope', `This key lacks the '${neededScope}' scope`);
  }

  // ── Idempotency (mutations only) ─────────────────────────────────────────
  const idemKey = isWrite ? (req.headers.get('Idempotency-Key') ?? '').trim().slice(0, 128) : '';
  if (idemKey) {
    const { data: prior } = await admin
      .from('reward_brand_api_idempotency')
      .select('response_status, response_body')
      .eq('key_id', apiKey.id)
      .eq('idem_key', idemKey)
      .maybeSingle();
    if (prior) {
      return json(prior.response_body, prior.response_status, { 'Idempotency-Replay': 'true' });
    }
  }

  // Runs the handler, then persists the response for idempotent replay.
  const respond = async (body, status = 200) => {
    if (idemKey) {
      await admin.from('reward_brand_api_idempotency')
        .upsert(
          { key_id: apiKey.id, idem_key: idemKey, response_status: status, response_body: body },
          { onConflict: 'key_id,idem_key', ignoreDuplicates: true },
        );
    }
    return json(body, status);
  };

  let body = {};
  if (isWrite) {
    try { body = await req.json(); } catch { return err(400, 'invalid_json', 'Request body must be JSON'); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /v1/ping
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/v1/ping') {
    return json({ ok: true, brand_name: brand, scopes: apiKey.scopes });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /v1/rewards — the brand's rewards with live code-pool stats
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/v1/rewards') {
    const { data: rewards, error: rErr } = await admin
      .from('rewards')
      .select('id, title, active, integration_type, powr_cost, code_expiry_days, max_redemptions_per_user, created_at')
      .ilike('brand_name', brand)
      .order('created_at', { ascending: false });
    if (rErr) return err(500, 'query_failed', rErr.message);

    const withStats = await Promise.all((rewards ?? []).map(async (r) => {
      const counts = await Promise.all(CODE_STATUSES.map((s) =>
        admin.from('redemption_codes')
          .select('id', { count: 'exact', head: true })
          .eq('reward_id', r.id)
          .eq('status', s),
      ));
      const codes = {};
      CODE_STATUSES.forEach((s, i) => { codes[s] = counts[i].count ?? 0; });
      return { ...r, codes };
    }));

    return json({ data: withStats });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /v1/codes?reward_id=&status=&limit=&cursor=
  // Oldest-first keyset pagination — stable for full-pool syncs.
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/v1/codes') {
    const { reward, error } = await getBrandReward(admin, brand, url.searchParams.get('reward_id'));
    if (error) return error;

    const status = url.searchParams.get('status');
    if (status && !CODE_STATUSES.includes(status)) {
      return err(400, 'invalid_status', `status must be one of ${CODE_STATUSES.join(', ')}`);
    }
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 500);

    let q = admin.from('redemption_codes')
      .select('id, code, status, source, assigned_at, used_at, expires_at, created_at')
      .eq('reward_id', reward.id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    if (status) q = q.eq('status', status);

    const cursorRaw = url.searchParams.get('cursor');
    if (cursorRaw) {
      const cur = decodeCursor(cursorRaw);
      if (!cur) return err(400, 'invalid_cursor', 'cursor is not valid');
      q = q.or(`created_at.gt.${cur.ts},and(created_at.eq.${cur.ts},id.gt.${cur.id})`);
    }

    const { data: rows, error: qErr } = await q;
    if (qErr) return err(500, 'query_failed', qErr.message);

    const last = rows?.length === limit ? rows[rows.length - 1] : null;
    return json({
      data: rows ?? [],
      next_cursor: last ? encodeCursor(last.created_at, last.id) : null,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POST /v1/codes — push a batch of codes into a reward's pool
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST' && path === '/v1/codes') {
    const { reward, error } = await getBrandReward(admin, brand, body.reward_id);
    if (error) return error;

    if (!Array.isArray(body.codes) || body.codes.length === 0) {
      return err(400, 'missing_codes', 'codes must be a non-empty array of strings');
    }
    if (body.codes.length > MAX_BATCH) {
      return err(400, 'too_many_codes', `A batch can contain at most ${MAX_BATCH} codes`);
    }

    let expiry;
    if (body.expires_at) {
      const d = new Date(body.expires_at);
      if (isNaN(d.getTime()) || d <= new Date()) {
        return err(400, 'invalid_expires_at', 'expires_at must be a future ISO-8601 timestamp');
      }
      expiry = d.toISOString();
    } else {
      expiry = new Date(Date.now() + (reward.code_expiry_days || 90) * 86400_000).toISOString();
    }

    const rejected = [];
    const seen = new Set();
    const candidates = [];
    for (const raw of body.codes) {
      const code = String(raw ?? '').trim().toUpperCase();
      if (!code) continue;
      if (seen.has(code)) { rejected.push({ code, reason: 'duplicate_in_batch' }); continue; }
      seen.add(code);
      if (!CODE_RE.test(code)) { rejected.push({ code, reason: 'invalid_format' }); continue; }
      candidates.push(code);
    }

    // Classify pre-existing codes (the code column is globally unique).
    const existing = new Map();
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const { data } = await admin
        .from('redemption_codes')
        .select('code, reward_id')
        .in('code', chunk);
      for (const row of data ?? []) existing.set(row.code, row.reward_id);
    }

    let alreadyInPool = 0;
    const toInsert = [];
    for (const code of candidates) {
      const owner = existing.get(code);
      if (owner === undefined) {
        toInsert.push({ reward_id: reward.id, code, source: 'PARTNER_UPLOAD', status: 'available', expires_at: expiry });
      } else if (owner === reward.id) {
        alreadyInPool++;
      } else {
        rejected.push({ code, reason: 'code_in_different_reward' });
      }
    }

    let accepted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      // upsert+ignoreDuplicates rides out races with concurrent pushes.
      const { data, error: insErr } = await admin
        .from('redemption_codes')
        .upsert(chunk, { onConflict: 'code', ignoreDuplicates: true })
        .select('code');
      if (insErr) {
        for (const row of chunk) rejected.push({ code: row.code, reason: 'insert_failed' });
        continue;
      }
      accepted += data?.length ?? 0;
      if ((data?.length ?? 0) < chunk.length) {
        const inserted = new Set((data ?? []).map((r) => r.code));
        for (const row of chunk) {
          if (!inserted.has(row.code)) rejected.push({ code: row.code, reason: 'already_exists' });
        }
      }
    }

    return respond({
      accepted,
      already_in_pool: alreadyInPool,
      rejected,
      expires_at: expiry,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /v1/redemptions?reward_id=&since=&limit=&cursor=
  // Codes assigned to members, oldest-first. Never includes member identity.
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/v1/redemptions') {
    const { data: brandRewards } = await admin
      .from('rewards')
      .select('id, title')
      .ilike('brand_name', brand);
    const titleById = new Map((brandRewards ?? []).map((r) => [r.id, r.title]));
    if (titleById.size === 0) return json({ data: [], next_cursor: null });

    let rewardIds = [...titleById.keys()];
    const filterReward = url.searchParams.get('reward_id');
    if (filterReward) {
      if (!titleById.has(filterReward)) return err(404, 'reward_not_found', 'No such reward for this brand');
      rewardIds = [filterReward];
    }

    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 500);

    let q = admin.from('redemptions')
      .select('id, reward_id, code, status, powr_spent, redeemed_at, expires_at')
      .in('reward_id', rewardIds)
      .order('redeemed_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);

    const since = url.searchParams.get('since');
    if (since) {
      const d = new Date(since);
      if (isNaN(d.getTime())) return err(400, 'invalid_since', 'since must be an ISO-8601 timestamp');
      q = q.gte('redeemed_at', d.toISOString());
    }

    const cursorRaw = url.searchParams.get('cursor');
    if (cursorRaw) {
      const cur = decodeCursor(cursorRaw);
      if (!cur) return err(400, 'invalid_cursor', 'cursor is not valid');
      q = q.or(`redeemed_at.gt.${cur.ts},and(redeemed_at.eq.${cur.ts},id.gt.${cur.id})`);
    }

    const { data: rows, error: qErr } = await q;
    if (qErr) return err(500, 'query_failed', qErr.message);

    const data = (rows ?? []).map((r) => ({
      id: r.id,
      reward_id: r.reward_id,
      reward_title: titleById.get(r.reward_id) ?? null,
      code: r.code,
      status: r.status,
      powr_spent: r.powr_spent,
      redeemed_at: r.redeemed_at,
      expires_at: r.expires_at,
    }));
    const last = rows?.length === limit ? rows[rows.length - 1] : null;
    return json({
      data,
      next_cursor: last ? encodeCursor(last.redeemed_at, last.id) : null,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POST /v1/reconcile — confirm codes were used in the brand's own system.
  // One-way: only 'reserved' (member-assigned) codes can become 'used'.
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST' && path === '/v1/reconcile') {
    const { reward, error } = await getBrandReward(admin, brand, body.reward_id);
    if (error) return error;

    if (!Array.isArray(body.codes) || body.codes.length === 0) {
      return err(400, 'missing_codes', 'codes must be a non-empty array of strings');
    }
    if (body.codes.length > MAX_BATCH) {
      return err(400, 'too_many_codes', `A batch can contain at most ${MAX_BATCH} codes`);
    }

    let usedAt = new Date().toISOString();
    if (body.used_at) {
      const d = new Date(body.used_at);
      if (isNaN(d.getTime())) return err(400, 'invalid_used_at', 'used_at must be an ISO-8601 timestamp');
      usedAt = d.toISOString();
    }

    const { data: result, error: rpcErr } = await admin.rpc('reconcile_brand_redemption_codes', {
      p_brand_name: brand,
      p_reward_id: reward.id,
      p_codes: body.codes.map((c) => String(c ?? '')),
      p_used_at: usedAt,
    });
    if (rpcErr) return err(400, 'reconcile_failed', rpcErr.message);

    const row = Array.isArray(result) ? result[0] : result;
    return respond({
      submitted: row?.submitted_count ?? 0,
      matched: row?.matched_count ?? 0,
      marked_used: row?.marked_used_count ?? 0,
      already_used: row?.already_used_count ?? 0,
      not_assignable: row?.unavailable_count ?? 0,
    });
  }

  return err(404, 'not_found', `No route for ${req.method} ${path}`);
});
