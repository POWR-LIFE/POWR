// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Garmin push receiver. Garmin POSTs each summary type as its own JSON body
// ({ "activities": [...] }, { "dailies": [...] }, ...) to the URLs set in
// Garmin's Endpoint Configuration tool, plus deregistration and permission
// change notices.
//
// Endpoint configuration (https://apis.garmin.com/tools/endpoints), Push, all to
//   https://<project>.supabase.co/functions/v1/garmin-webhook/<GARMIN_WEBHOOK_KEY>
// (the key in the PATH: Garmin's tool strips query strings when it saves)
//   Health:   dailies, sleeps, hrv
//   Activity: activities
//   Common:   deregistrations, userPermissionsChange
// Everything else stays disabled — nothing here reads it, and activityDetails
// in particular can run to 100 MB a push.
//
// verify_jwt = false (Garmin is not a Supabase user). Garmin doesn't sign its
// pushes, so the secret key in the URL we gave Garmin is what proves the
// sender; a wrong or missing key gets 401.
//
// Garmin's rules: answer 200 within 30 s, and do the work after answering
// (holding the request open is "the most common cause of instability"). Any
// non-200 is retried with back-off. So: check the key, parse, 200, then credit
// in the background via EdgeRuntime.waitUntil. Crediting goes through
// _shared/wearableIngest — the same engine, merging and caps as Terra.
import { createClient } from '@supabase/supabase-js';
import { constantTimeEqual } from '../_shared/terraSignature.ts';
import {
  garminActivitySkipReason,
  garminActivityToRecord,
  garminDailyToRecord,
  garminDeviceName,
  garminHrvToRecord,
  garminSleepSkipReason,
  garminSleepToRecord,
  groupByUser,
} from '../_shared/garminMap.ts';
import { endGarminConnection } from '../_shared/garminConnection.ts';
import { handleActivity, handleDaily, handleSleep } from '../_shared/wearableIngest.ts';

const WEBHOOK_KEY = (Deno.env.get('GARMIN_WEBHOOK_KEY') ?? '').trim();
const CLIENT_ID = (Deno.env.get('GARMIN_CLIENT_ID') ?? '').trim();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The POWR user behind a Garmin user id, if their link is live AND the
 * rollout switch lets them use it. Switched off, their data is dropped — the
 * app reads their phone's health store instead, and taking both would pay the
 * same workout twice (the rule terra-webhook follows while Terra is paused).
 */
async function liveUser(supabase, garminUserId: string, cache: Map<string, string | null>) {
  if (cache.has(garminUserId)) return cache.get(garminUserId);
  const { data } = await supabase.from('garmin_connections')
    .select('user_id')
    .eq('garmin_user_id', garminUserId)
    .is('deregistered_at', null)
    .maybeSingle();
  let userId: string | null = data?.user_id ?? null;
  if (userId) {
    const { data: allowed } = await supabase.rpc('garmin_direct_allowed', { p_user: userId });
    if (allowed !== true) userId = null;
  }
  cache.set(garminUserId, userId);
  return userId;
}

/** The engine's input: Terra's payload shape, with the user already resolved. */
function enginePayload(userId: string, data: unknown[]) {
  return { user: { reference_id: userId, provider: 'GARMIN' }, data };
}

async function stampFresh(supabase, userId: string, deviceName: string | null) {
  const patch: Record<string, unknown> = { last_upload_at: new Date().toISOString() };
  if (deviceName) patch.device_name = deviceName;
  const { error } = await supabase.from('garmin_connections').update(patch).eq('user_id', userId);
  if (error) console.error('[garmin-webhook] freshness stamp failed:', error.message);
}

async function ingest(payload: Record<string, unknown>) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const users = new Map<string, string | null>();

  for (const [kind, list] of Object.entries(payload)) {
    if (!Array.isArray(list)) continue;

    // ── Lifecycle ────────────────────────────────────────────────────────────
    if (kind === 'deregistrations') {
      for (const d of list) {
        const garminUserId = typeof d?.userId === 'string' ? d.userId : null;
        if (!garminUserId) continue;
        const { data: rows } = await supabase.from('garmin_connections')
          .select('user_id')
          .eq('garmin_user_id', garminUserId)
          .is('deregistered_at', null);
        for (const r of rows ?? []) {
          await endGarminConnection(supabase, r.user_id, garminUserId);
          console.log(`[garmin-webhook] deregistered user ${r.user_id}`);
        }
      }
      continue;
    }
    if (kind === 'userPermissionsChange') {
      for (const p of list) {
        if (typeof p?.userId !== 'string' || !Array.isArray(p.permissions)) continue;
        const { error } = await supabase.from('garmin_connections')
          .update({ permissions: p.permissions, updated_at: new Date().toISOString() })
          .eq('garmin_user_id', p.userId)
          .is('deregistered_at', null);
        if (error) console.error('[garmin-webhook] permissions update failed:', error.message);
      }
      continue;
    }

    // ── Data ─────────────────────────────────────────────────────────────────
    if (!['activities', 'dailies', 'sleeps', 'hrv'].includes(kind)) {
      console.log(`[garmin-webhook] ignoring ${list.length} ${kind} (not subscribed)`);
      continue;
    }

    for (const [garminUserId, records] of groupByUser(list)) {
      const userId = await liveUser(supabase, garminUserId, users);
      if (!userId) continue;
      try {
        if (kind === 'activities') {
          const kept = [];
          for (const a of records) {
            const why = garminActivitySkipReason(a);
            if (why) console.log(`[garmin-webhook] not crediting activity ${a?.summaryId ?? '?'}: ${why}`);
            else kept.push(garminActivityToRecord(a));
          }
          if (kept.length) await handleActivity(supabase, enginePayload(userId, kept));
          await stampFresh(supabase, userId, garminDeviceName(records));
        } else if (kind === 'dailies') {
          const days = records.map(garminDailyToRecord).filter(Boolean);
          if (days.length) await handleDaily(supabase, enginePayload(userId, days));
          await stampFresh(supabase, userId, null);
        } else if (kind === 'sleeps') {
          const nights = [];
          for (const s of records) {
            const why = garminSleepSkipReason(s);
            if (why) console.log(`[garmin-webhook] not crediting sleep ${s?.summaryId ?? '?'}: ${why}`);
            else nights.push(garminSleepToRecord(s));
          }
          if (nights.length) await handleSleep(supabase, enginePayload(userId, nights));
          await stampFresh(supabase, userId, null);
        } else if (kind === 'hrv') {
          const days = records.map(garminHrvToRecord).filter(Boolean);
          if (days.length) await handleDaily(supabase, enginePayload(userId, days));
        }
      } catch (e) {
        // One user's bad record must not cost the rest of the batch.
        console.error(`[garmin-webhook] ${kind} for user ${userId} failed:`, e?.message ?? e);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // The key rides in the path (…/garmin-webhook/<key>) — Garmin's endpoint
  // tool drops query strings on save — or, equivalently, as ?k=<key>.
  const url = new URL(req.url);
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const key = url.searchParams.get('k') ?? (last !== 'garmin-webhook' ? last : '');
  if (!WEBHOOK_KEY || !constantTimeEqual(key, WEBHOOK_KEY)) return json({ error: 'Unauthorized' }, 401);
  // Garmin names our app on every push; a different client id is not ours.
  const clientHeader = req.headers.get('garmin-client-id');
  if (clientHeader && CLIENT_ID && clientHeader !== CLIENT_ID) return json({ error: 'Unauthorized' }, 401);

  let payload;
  try { payload = JSON.parse(await req.text()); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'Invalid body' }, 400);

  const work = ingest(payload).catch((e) => console.error('[garmin-webhook] handler error:', e?.message ?? e));
  // Answer first, credit after: Garmin times out at 30 s and retries anything
  // that isn't a 200.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return json({ received: true });
});
