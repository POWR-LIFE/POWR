// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Garmin sign-in broker (OAuth 2.0 PKCE). Holds GARMIN_CLIENT_SECRET — Garmin
// has no secretless flow, and the code exchange must run on a server.
//
// verify_jwt = false because Garmin's redirect (a browser GET) carries no
// Supabase session. The POST actions check the caller's JWT themselves; the
// callback is bound to its sign-in by the one-time `state` row.
//
//   POST { action: 'start', return_to? }   (user JWT)
//     → { url }  Garmin's consent page, to open in a system auth session.
//     Refused (403) unless garmin_direct_allowed() — the rollout switch.
//
//   GET  /garmin-auth/callback?code=…&state=…   (Garmin redirects here)
//     → 302 to return_to?status=connected | denied | already_linked | failed
//     Swaps the code for tokens, reads the Garmin user id, records the link,
//     and makes Garmin the user's one wearable.
//
//   POST { action: 'disconnect' }   (user JWT)
//     → { ok: true }  Deletes the registration at Garmin (required whenever
//     the app offers its own disconnect) and ends the link here.
//
//   POST { action: 'refresh_due' }   (x-resolve-token, for a cron)
//     → { refreshed, failed }  Refreshes tokens whose refresh token expires
//     within 30 days. Garmin refresh tokens last ~90 days and must be
//     refreshed to keep access.
import { createClient } from '@supabase/supabase-js';
import {
  authorizeUrl,
  codeChallengeFor,
  deleteRegistration,
  exchangeCode,
  expiriesFrom,
  fetchPermissions,
  fetchUserId,
  newCodeVerifier,
  randomUrlSafe,
  safeReturnTo,
  withParams,
} from '../_shared/garminApi.ts';
import { accessTokenFor, endGarminConnection } from '../_shared/garminConnection.ts';

const CLIENT_ID = Deno.env.get('GARMIN_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GARMIN_CLIENT_SECRET') ?? '';
// Must match the OAuth redirect URL registered on the Garmin app exactly.
const REDIRECT_URI = Deno.env.get('GARMIN_REDIRECT_URI')
  ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/garmin-auth/callback`;

/** A sign-in left unfinished this long is abandoned. */
const STATE_TTL_MS = 20 * 60 * 1000;

// Cloud-wearable keys on profiles.health_provider_connections. One wearable at
// a time: linking Garmin drops the others (the phone's own store is kept).
const WEARABLE_KEYS = new Set([
  'whoop', 'oura', 'garmin', 'polar', 'fitbit', 'strava', 'huawei', 'withings', 'peloton', 'zepp', 'technogym',
  'coros', 'suunto', 'wahoo', 'zwift', 'concept2', 'ifit', 'underarmour',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function callerFrom(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  return error ? null : user;
}

// ── start ─────────────────────────────────────────────────────────────────────

async function start(req: Request, body) {
  const user = await callerFrom(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Garmin is not configured' }, 503);

  const supabase = serviceClient();
  const { data: allowed, error: gateErr } = await supabase.rpc('garmin_direct_allowed', { p_user: user.id });
  if (gateErr) {
    console.error('[garmin-auth] gate check failed:', gateErr.message);
    return json({ error: 'Unavailable' }, 503);
  }
  if (allowed !== true) return json({ error: 'Garmin is not available yet' }, 403);

  // Housekeeping: sign-ins nobody finished.
  await supabase.from('garmin_oauth_states')
    .delete()
    .lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString());

  const state = randomUrlSafe(32);
  const verifier = newCodeVerifier();
  const { error } = await supabase.from('garmin_oauth_states').insert({
    state,
    user_id: user.id,
    code_verifier: verifier,
    return_to: safeReturnTo(body?.return_to),
  });
  if (error) {
    console.error('[garmin-auth] state insert failed:', error.message);
    return json({ error: 'Could not start Garmin sign-in' }, 500);
  }

  const url = authorizeUrl({
    clientId: CLIENT_ID,
    codeChallenge: await codeChallengeFor(verifier),
    redirectUri: REDIRECT_URI,
    state,
  });
  return json({ url });
}

// ── callback ──────────────────────────────────────────────────────────────────

async function callback(url: URL) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const supabase = serviceClient();

  // One-time: take the row as we read it, so a replayed redirect finds nothing.
  const { data: pending } = state
    ? await supabase.from('garmin_oauth_states').delete().eq('state', state).select().maybeSingle()
    : { data: null };
  const back = pending?.return_to ? safeReturnTo(pending.return_to) : 'powr://garmin-callback';
  const done = (status: string) => redirect(withParams(back, { status }));

  if (!pending) return done('failed');
  if (Date.now() - new Date(pending.created_at).getTime() > STATE_TTL_MS) return done('failed');
  // Declined on Garmin's consent page, or Garmin reported an error.
  if (!code || url.searchParams.get('error')) return done('denied');

  const userId = pending.user_id as string;
  try {
    const tokens = await exchangeCode({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code,
      codeVerifier: pending.code_verifier,
      redirectUri: REDIRECT_URI,
    });
    const garminUserId = await fetchUserId(tokens.access_token);
    const permissions = await fetchPermissions(tokens.access_token).catch(() => []);

    // A Garmin account already live on ANOTHER POWR account stays there: one
    // watch paying two accounts is exactly the double credit we closed for
    // Terra. Nothing is written for this user.
    const { data: holder } = await supabase.from('garmin_connections')
      .select('user_id')
      .eq('garmin_user_id', garminUserId)
      .is('deregistered_at', null)
      .neq('user_id', userId)
      .maybeSingle();
    if (holder) {
      console.warn(`[garmin-auth] Garmin account already linked to another POWR user (${holder.user_id})`);
      return done('already_linked');
    }

    // Relinking with a DIFFERENT Garmin account: release the old one at Garmin
    // first, while we still hold its tokens. Best effort.
    const { data: previous } = await supabase.from('garmin_connections')
      .select('garmin_user_id, deregistered_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (previous && !previous.deregistered_at && previous.garmin_user_id !== garminUserId) {
      const oldToken = await accessTokenFor(supabase, userId);
      if (oldToken) await deleteRegistration(oldToken).catch(() => {});
    }

    const now = new Date().toISOString();
    // A relink starts the freshness clock again: created_at is "connected at"
    // for the wearable chip, and an old last_upload_at would read a link made
    // a minute ago as long silent.
    const { error: connErr } = await supabase.from('garmin_connections').upsert({
      user_id: userId,
      garmin_user_id: garminUserId,
      permissions,
      deregistered_at: null,
      created_at: now,
      updated_at: now,
      last_upload_at: null,
    }, { onConflict: 'user_id' });
    if (connErr) {
      // 23505: the live-account index caught a race with another POWR user.
      if (connErr.code === '23505') return done('already_linked');
      throw new Error(`connection upsert: ${connErr.message}`);
    }

    const { error: tokErr } = await supabase.from('garmin_tokens').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ...expiriesFrom(tokens),
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (tokErr) throw new Error(`token upsert: ${tokErr.message}`);

    // Garmin becomes the one wearable and the source of truth. The app's
    // connect flow has already disconnected any other wearable; marking the
    // Terra rows ended here as well keeps the freshness chip honest if that
    // step failed.
    await supabase.from('terra_connections')
      .update({ deauthed_at: now })
      .eq('user_id', userId)
      .is('deauthed_at', null);

    const { data: prof } = await supabase.from('profiles')
      .select('health_provider_connections')
      .eq('id', userId)
      .maybeSingle();
    const conns = { ...(prof?.health_provider_connections ?? {}) };
    for (const k of Object.keys(conns)) {
      if (k !== 'garmin' && WEARABLE_KEYS.has(k)) delete conns[k];
    }
    conns.garmin = { connected_at: now, garmin_user_id: garminUserId };
    const { error: profErr } = await supabase.from('profiles').update({
      health_provider_connections: conns,
      active_health_provider: 'garmin',
    }).eq('id', userId);
    if (profErr) throw new Error(`profile update: ${profErr.message}`);

    console.log(`[garmin-auth] linked user ${userId} (permissions: ${permissions.join(',') || 'none'})`);
    return done('connected');
  } catch (e) {
    console.error('[garmin-auth] callback failed:', e?.message ?? e);
    return done('failed');
  }
}

// ── disconnect ────────────────────────────────────────────────────────────────

async function disconnect(req: Request) {
  const user = await callerFrom(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const supabase = serviceClient();

  // Garmin requires the DELETE whenever our app offers a disconnect. If the
  // token is gone (the user already removed POWR in Garmin Connect), there is
  // nothing left to delete there — still end the link here.
  const token = await accessTokenFor(supabase, user.id);
  if (token) {
    try { await deleteRegistration(token); }
    catch (e) { console.warn('[garmin-auth] delete registration failed:', e?.message ?? e); }
  }
  await endGarminConnection(supabase, user.id);
  return json({ ok: true });
}

// ── refresh_due (cron) ────────────────────────────────────────────────────────

async function refreshDue(req: Request) {
  const supabase = serviceClient();
  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return json({ error: 'Forbidden' }, 403);

  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await supabase.from('garmin_tokens')
    .select('user_id, access_expires_at')
    .lt('refresh_expires_at', soon)
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  let refreshed = 0;
  let failed = 0;
  for (const row of due ?? []) {
    // Force the refresh by treating the access token as expired.
    await supabase.from('garmin_tokens')
      .update({ access_expires_at: new Date(0).toISOString() })
      .eq('user_id', row.user_id);
    const ok = await accessTokenFor(supabase, row.user_id);
    if (ok) refreshed++; else failed++;
  }
  return json({ refreshed, failed });
}

// ── Entry ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') return await callback(url);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { action?: string; return_to?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  switch (body.action) {
    case 'start': return await start(req, body);
    case 'disconnect': return await disconnect(req);
    case 'refresh_due': return await refreshDue(req);
    default: return json({ error: 'Unknown action' }, 400);
  }
});
