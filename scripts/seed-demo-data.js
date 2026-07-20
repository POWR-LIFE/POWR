#!/usr/bin/env node
/**
 * Seeds demo activity_sessions + point_transactions for a given user
 * Uses the service role key to bypass RLS.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wjvvujnicwkruaeibttt.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required.');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>');
  process.exit(1);
}

const USER_ID = process.env.SEED_USER_ID || '234d49f3-d189-44b1-a874-063e724e4380';

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

/** Build an ISO timestamp for a given date offset (days ago) at a specific hour */
function ts(daysAgo, hour = 8, minute = 0) {
  const d = new Date('2026-04-21T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// Sessions to insert: [type, daysAgo, startHour, durationMin, distanceM, steps, points, verification]
// Unique constraint: (user_id, type, trust_score, date(started_at))
const SESSIONS = [
  // Week of Apr 7–13
  ['gym',      14, 7,  60, null,  null,   4, 'health'],
  ['running',  13, 7,  32, 3800,  null,   3, 'health'],
  ['walking',  12, 8,  45, 4200,  5200,   2, 'manual'],
  ['hiit',     11, 6,  40, null,  null,   5, 'manual'],
  ['cycling',  10, 7,  58, 15000, null,   5, 'health'],
  ['yoga',      9, 8,  50, null,  null,   3, 'manual'],
  ['running',   9, 6,  35, 4100,  null,   4, 'health'],
  // Week of Apr 14–20
  ['gym',       7, 7,  55, null,  null,   4, 'health'],
  ['hiit',      6, 6,  38, null,  null,   5, 'manual'],
  ['cycling',   5, 7,  48, 12500, null,   4, 'health'],
  ['running',   4, 7,  33, 3600,  null,   3, 'health'],
  ['gym',       3, 7,  62, null,  null,   4, 'health'],
  ['sports',    2, 16, 65, null,  null,   4, 'manual'],
  ['yoga',      1, 9,  45, null,  null,   3, 'manual'],
  ['walking',   1, 7,  52, 5100,  8200,   4, 'health'],
  // Today (Apr 21)
  ['running',   0, 7,  36, 4300,  null,   4, 'health'],
  ['gym',       0, 7,  55, null,  null,   4, 'health'],  // different trust_score handles dupe
];

// Deduplicate: one entry per (type, daysAgo, trust_score)
// gym on day 0 has wearable (0.85), so it's fine paired with running on day 0 wearable too
// Actually both running+gym on day 0 share trust_score 0.85 — we need to remove the gym duplicate
// Let's keep running on day 0 only and remove the gym duplicate
const DEDUPED_SESSIONS = [
  ['gym',      14, 7,  60, null,  null,   4, 'health'],
  ['running',  13, 7,  32, 3800,  null,   3, 'health'],
  ['walking',  12, 8,  45, 4200,  5200,   2, 'manual'],
  ['hiit',     11, 6,  40, null,  null,   5, 'manual'],
  ['cycling',  10, 7,  58, 15000, null,   5, 'health'],
  ['yoga',      9, 8,  50, null,  null,   3, 'manual'],
  ['running',   9, 6,  35, 4100,  null,   4, 'health'],
  ['gym',       7, 7,  55, null,  null,   4, 'health'],
  ['hiit',      6, 6,  38, null,  null,   5, 'manual'],
  ['cycling',   5, 7,  48, 12500, null,   4, 'health'],
  ['running',   4, 7,  33, 3600,  null,   3, 'health'],
  ['gym',       3, 7,  62, null,  null,   4, 'health'],
  ['sports',    2, 16, 65, null,  null,   4, 'manual'],
  ['yoga',      1, 9,  45, null,  null,   3, 'manual'],
  ['walking',   1, 7,  52, 5100,  8200,   4, 'health'],
  ['running',   0, 7,  36, 4300,  null,   4, 'health'],
];

async function post(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const [type, daysAgo, startHour, durationMin, distanceM, steps, points, verification] of DEDUPED_SESSIONS) {
    const trust_score = (verification === 'wearable' || verification === 'health') ? 0.85 : 0.55;
    const started_at = ts(daysAgo, startHour, 0);
    const ended_at   = ts(daysAgo, startHour, durationMin);
    const duration_sec = durationMin * 60;

    let sessionId;
    try {
      const [session] = await post('activity_sessions', {
        user_id: USER_ID,
        type,
        started_at,
        ended_at,
        duration_sec,
        distance_m: distanceM,
        steps,
        verification,
        trust_score,
      });
      sessionId = session.id;
      console.log(`  ✓ ${type} ${daysAgo}d ago → ${sessionId}`);
      inserted++;
    } catch (err) {
      if (err.message.includes('23505')) {
        console.log(`  ↷ ${type} ${daysAgo}d ago — already exists, skipping`);
        skipped++;
        continue;
      }
      console.error(`  ✗ ${type} ${daysAgo}d ago — ${err.message}`);
      continue;
    }

    // Insert matching point transaction
    try {
      await post('point_transactions', {
        user_id: USER_ID,
        session_id: sessionId,
        amount: points,
        type: 'earn',
        source: 'manual_log',
        multiplier: 1.0,
      });
      console.log(`    + ${points} pts`);
    } catch (err) {
      console.error(`    pts error: ${err.message}`);
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
}

main().catch(console.error);
