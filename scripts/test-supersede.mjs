#!/usr/bin/env node
// End-to-end test for geofence > wearable supersession in the DEPLOYED
// claim-points edge function. Seeds a throwaway user with a geofence gym
// check-in (unclaimed) and an OVERLAPPING wearable *cycling* session (the gym
// bike / spin class — a different type), then claims the check-in and asserts
// the cycling session is superseded (removed + points reversed).
//
// The cycling/gym type mismatch is the case the old same-type-only filter
// missed. Against the fixed function this PASSES; against the old one the
// wearable survives (FAIL) — so it's a true before/after.
//
// Uses a throwaway user that is fully deleted at the end — no real user
// (Emily etc.) is touched.
//
// Run:  node --env-file=.env scripts/test-supersede.mjs

import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Missing env. Run with: node --env-file=.env scripts/test-supersede.mjs');
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const isoFrom = (ms) => new Date(ms).toISOString();
const now = Date.now();
const gymStart = now - 2 * 60 * 60 * 1000;        // 2h ago
const gymEnd = gymStart + 54 * 60 * 1000;         // 54-min check-in
const cyclingStart = gymStart + 5 * 60 * 1000;    // starts 5m into the gym visit
const cyclingEnd = cyclingStart + 99 * 60 * 1000; // 99-min wearable cycling (overlaps)

async function printState(userId) {
  const { data: sessions } = await admin
    .from('activity_sessions')
    .select('type, verification, trust_score')
    .eq('user_id', userId)
    .order('started_at');
  for (const s of sessions ?? []) {
    console.log(`  session  ${String(s.type).padEnd(8)} ${String(s.verification).padEnd(9)} trust ${s.trust_score}`);
  }
  const { data: tx } = await admin
    .from('point_transactions')
    .select('type, amount, description')
    .eq('user_id', userId)
    .order('created_at');
  for (const t of tx ?? []) {
    console.log(`  txn      ${String(t.type).padEnd(8)} ${t.amount >= 0 ? '+' : ''}${t.amount}  ${t.description ?? ''}`);
  }
}

const email = `supersede-test+${now}@powr.life`;
const password = `T-${Math.random().toString(36).slice(2)}-${now}`;
let userId;

try {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr) throw cErr;
  userId = created.user.id;
  console.log(`Throwaway user: ${email}\n`);

  const { data: gym, error: gErr } = await admin
    .from('activity_sessions')
    .insert({
      user_id: userId, type: 'gym', verification: 'geofence', trust_score: 0.94,
      started_at: isoFrom(gymStart), ended_at: isoFrom(gymEnd), duration_sec: 54 * 60,
    })
    .select('id').single();
  if (gErr) throw gErr;

  const { data: cycling, error: cyErr } = await admin
    .from('activity_sessions')
    .insert({
      user_id: userId, type: 'cycling', verification: 'wearable', trust_score: 0.85,
      started_at: isoFrom(cyclingStart), ended_at: isoFrom(cyclingEnd), duration_sec: 99 * 60,
    })
    .select('id').single();
  if (cyErr) throw cyErr;

  await admin.from('point_transactions').insert({
    user_id: userId, session_id: cycling.id, amount: 10, type: 'earn', description: 'cycling session',
  });

  console.log('BEFORE claim:');
  await printState(userId);

  // Real user JWT → exercises the deployed function exactly as the app would.
  const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;

  const res = await fetch(`${URL}/functions/v1/claim-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.session.access_token}` },
    body: JSON.stringify({ session_id: gym.id }),
  });
  console.log(`\nclaim-points (geofence gym) → ${res.status}: ${JSON.stringify(await res.json())}\n`);

  console.log('AFTER claim:');
  await printState(userId);

  const { count: cyclingLeft } = await admin
    .from('activity_sessions').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('type', 'cycling');
  const { data: penalties } = await admin
    .from('point_transactions').select('amount').eq('user_id', userId).eq('type', 'penalty');
  const { data: gymEarn } = await admin
    .from('point_transactions').select('amount').eq('user_id', userId).eq('session_id', gym.id).eq('type', 'earn');

  const cyclingGone = (cyclingLeft ?? 0) === 0;
  const penaltyOk = (penalties ?? []).some((p) => p.amount < 0);
  const gymClaimed = (gymEarn ?? []).length > 0;

  console.log('\n── RESULT ──');
  console.log(`${cyclingGone ? '✓' : '✗'} overlapping wearable cycling superseded (removed)`);
  console.log(`${penaltyOk ? '✓' : '✗'} cycling points reversed via penalty row`);
  console.log(`${gymClaimed ? '✓' : '✗'} geofence gym check-in claimed`);
  console.log(
    cyclingGone && penaltyOk && gymClaimed
      ? '\nPASS — geofence took priority over the wearable.'
      : '\nFAIL — wearable survived (same-type-only logic still live; deploy the fix).',
  );
} catch (e) {
  console.error('Error:', e?.message ?? e);
} finally {
  if (userId) {
    await admin.from('point_transactions').delete().eq('user_id', userId);
    await admin.from('activity_sessions').delete().eq('user_id', userId);
    await admin.auth.admin.deleteUser(userId);
    console.log(`\nCleaned up throwaway user.`);
  }
}
