// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Terra data webhook. Terra POSTs normalised health data here whenever a
// connected user has new activity/sleep/daily data, plus auth/deauth lifecycle
// events. Deployed with verify_jwt = false (Terra is not a Supabase user) —
// security rests on the terra-signature HMAC check below.
//
// The data handlers (sessions, sleep, steps, points, merging re-deliveries)
// live in _shared/wearableIngest.ts, shared with garmin-webhook. This file
// keeps what is Terra's own: the signature check, the pause switch, freshness
// stamps on terra_connections, and the auth/deauth lifecycle.
import { createClient } from '@supabase/supabase-js';
import { verifyTerraSignature } from '../_shared/terraSignature.ts';
import { isTerraPaused } from '../_shared/terraPause.ts';
import { profileAfterDeauth } from '../_shared/terraDeauth.ts';
import { DATA_TYPES, extractDeviceFreshness, freshnessPatch } from '../_shared/deviceFreshness.ts';
import { handleActivity, handleDaily, handleSleep, resolveUserId } from '../_shared/wearableIngest.ts';

const SIGNING_SECRET = Deno.env.get('TERRA_SIGNING_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Payload handlers ────────────────────────────────────────────────────────────

// Cloud-wearable provider keys (lowercased). Used to enforce one-wearable-at-a-time
// without touching the user's native (Apple Health / Health Connect) connection.
const WEARABLE_KEYS = new Set([
  'whoop', 'oura', 'garmin', 'polar', 'fitbit', 'strava', 'huawei', 'withings', 'peloton', 'zepp', 'technogym',
  'coros', 'suunto', 'wahoo', 'zwift', 'concept2', 'ifit', 'underarmour',
]);

/**
 * On a fresh connection, ask Terra to (re)send the last week so the Progress
 * surfaces (BODY tab, sleep, sessions) fill immediately instead of accruing
 * from today — before this, a new wearable only ever received terra-poll's
 * rolling 2-day window and the page started near-empty.
 *
 * Same request shape as terra-poll: to_webhook=true routes the data back
 * through this function's normal handlers, so dedup and the bounded-extras
 * rule (terraExtras) apply to backfilled sessions exactly as to live ones.
 * Best-effort on purpose — a failed request costs the user nothing but a
 * slower fill (the poll still covers the last 2 days), so nothing here throws.
 */
const BACKFILL_DAYS = 7;
const BACKFILL_RESOURCES = ['sleep', 'activity', 'daily'];

async function requestBackfill(terraUserId: string): Promise<void> {
  const devId = Deno.env.get('TERRA_DEV_ID');
  const apiKey = Deno.env.get('TERRA_API_KEY');
  if (!devId || !apiKey) return;

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const start = isoDate(new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000));
  const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  for (const r of BACKFILL_RESOURCES) {
    try {
      const url = `https://api.tryterra.co/v2/${r}?user_id=${encodeURIComponent(terraUserId)}`
        + `&start_date=${start}&end_date=${end}&to_webhook=true`;
      const res = await fetch(url, { headers: { 'dev-id': devId, 'x-api-key': apiKey } });
      if (!res.ok) {
        console.warn(`[terra-webhook] backfill ${r} → ${res.status}`);
      }
    } catch (e) {
      console.warn(`[terra-webhook] backfill ${r} threw:`, e?.message ?? e);
    }
  }
}

async function handleAuth(supabase, payload): Promise<void> {
  const u = payload.user ?? {};
  const terraUserId = u.user_id;
  const userId = await resolveUserId(supabase, payload);
  const provider = (u.provider ?? '').toUpperCase();
  if (!terraUserId || !userId || !provider) return;

  await supabase.from('terra_connections').upsert({
    terra_user_id: terraUserId, user_id: userId, provider, deauthed_at: null,
  });
  // One wearable at a time: mark this user's OTHER Terra connections as deauthed so
  // stale wearable data is ignored going forward.
  await supabase.from('terra_connections')
    .update({ deauthed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .neq('terra_user_id', terraUserId)
    .is('deauthed_at', null);

  const key = provider.toLowerCase();
  const { data: prof } = await supabase
    .from('profiles').select('health_provider_connections, active_health_provider')
    .eq('id', userId).maybeSingle();
  const conns = prof?.health_provider_connections ?? {};
  // Drop any other wearable entry (single wearable; native is kept) and promote this
  // wearable to the active source of truth.
  for (const k of Object.keys(conns)) {
    if (k !== key && WEARABLE_KEYS.has(k)) delete conns[k];
  }
  conns[key] = { connected_at: new Date().toISOString(), terra_user_id: terraUserId };
  void requestBackfill(terraUserId);
  await supabase.from('profiles').update({
    health_provider_connections: conns,
    active_health_provider: key,
  }).eq('id', userId);
}

async function handleDeauth(supabase, payload): Promise<void> {
  const terraUserId = payload?.user?.user_id;
  const provider = (payload?.user?.provider ?? '').toUpperCase();
  if (terraUserId) {
    await supabase.from('terra_connections')
      .update({ deauthed_at: new Date().toISOString() })
      .eq('terra_user_id', terraUserId);
  }
  const userId = await resolveUserId(supabase, payload);
  if (!userId || !provider) return;
  const { data: prof } = await supabase
    .from('profiles').select('health_provider_connections, active_health_provider')
    .eq('id', userId).maybeSingle();
  const next = profileAfterDeauth(
    prof?.health_provider_connections ?? {}, prof?.active_health_provider ?? null, provider,
  );
  await supabase.from('profiles').update(next).eq('id', userId);
}


// ── Entry ────────────────────────────────────────────────────────────────────

/** Connection lifecycle events — handled even while Terra is paused. */
const LIFECYCLE_TYPES = new Set(['auth', 'deauth', 'access_revoked', 'connection_error', 'user_reauth']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rawBody = await req.text();
  const ok = await verifyTerraSignature(rawBody, req.headers.get('terra-signature'), SIGNING_SECRET);
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Paused (system_config 'terra_paused'): data is ignored — the app reads
    // the phone's health store for these users instead, and taking both would
    // pay the same workout twice. Lifecycle events still run below: switching
    // Terra off for good (terra-deauth-all) depends on deauth landing. 200, so
    // Terra doesn't retry what we chose to drop.
    if (!LIFECYCLE_TYPES.has(payload.type) && await isTerraPaused(supabase)) {
      return json({ received: true, skipped: 'terra_paused' });
    }

    // Freshness stamp: a sleep/activity/body payload marks this connection as
    // recently delivered, so the terra-poll cron skips it (see
    // terra-poll/index.ts). Lifecycle events (auth/deauth) deliberately don't
    // count — a connection that only ever authed still needs polling. 'daily'
    // doesn't count either: terra-poll requests it unconditionally every cycle
    // (providers like Whoop never auto-push it), and letting those deliveries
    // stamp freshness would mark every connection permanently fresh and starve
    // the sleep/activity re-poll.
    if (['activity', 'sleep', 'body'].includes(payload.type) && payload.user?.user_id) {
      await supabase.from('terra_connections')
        .update({ last_event_at: new Date().toISOString() })
        .eq('terra_user_id', payload.user.user_id);
    }

    // User-facing freshness (powers the home wearable chip + the stale-wearable
    // banner). Unlike last_event_at above, this DOES include 'daily' — otherwise
    // a provider with no sleep/activity data (Strava) would read as silent while
    // syncing fine. Never stamped by auth/deauth: a connection that only ever
    // authed has delivered nothing and must read as "never synced".
    if (DATA_TYPES.has(payload.type) && payload.user?.user_id) {
      await supabase.from('terra_connections')
        .update(freshnessPatch(extractDeviceFreshness(payload)))
        .eq('terra_user_id', payload.user.user_id);
    }

    switch (payload.type) {
      case 'auth': await handleAuth(supabase, payload); break;
      case 'deauth':
      case 'access_revoked':
      case 'connection_error': await handleDeauth(supabase, payload); break;
      case 'activity': await handleActivity(supabase, payload); break;
      case 'sleep': await handleSleep(supabase, payload); break;
      case 'daily': await handleDaily(supabase, payload); break;
      // 'body' and others: ignored for now.
      default: break;
    }
  } catch (e) {
    console.error('[terra-webhook] handler error:', e?.message ?? e);
    // Still 200 so Terra doesn't hammer retries on a single bad record; logged for triage.
  }

  return json({ received: true });
});
