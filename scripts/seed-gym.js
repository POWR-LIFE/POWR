const SUPABASE_URL = 'https://wjvvujnicwkruaeibttt.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdnZ1am5pY3drcnVhZWlidHR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjE5NzU3NSwiZXhwIjoyMDg3NzczNTc1fQ.izEGydd3tqKmy2CBzWxe4jwrlGQ2kbEO9G_RqAfXu1U';
const USER_ID = '234d49f3-d189-44b1-a874-063e724e4380';

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

function ts(daysAgo, hour, minute) {
  const d = new Date('2026-04-21T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute || 0, 0, 0);
  return d.toISOString();
}

// [daysAgo, durationMin, points, verification, trust_score]
const NEW_GYM = [
  [15, 58, 4, 'wearable', 0.85],
  [13, 52, 4, 'wearable', 0.85],
  [11, 65, 5, 'wearable', 0.85],
  [ 8, 60, 4, 'wearable', 0.85],
  [ 6, 55, 4, 'wearable', 0.85],
  [ 1, 62, 4, 'wearable', 0.85],
  [ 0, 58, 4, 'manual',   0.55],
];

async function post(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  for (const [daysAgo, durationMin, points, verification, trust_score] of NEW_GYM) {
    const started_at = ts(daysAgo, 7, 0);
    const ended_at   = ts(daysAgo, 7, durationMin);
    try {
      const [session] = await post('activity_sessions', {
        user_id: USER_ID,
        type: 'gym',
        started_at,
        ended_at,
        duration_sec: durationMin * 60,
        distance_m: null,
        steps: null,
        verification,
        trust_score,
      });
      await post('point_transactions', {
        user_id: USER_ID,
        session_id: session.id,
        amount: points,
        type: 'earn',
        source: 'manual_log',
        multiplier: 1.0,
      });
      console.log('OK gym ' + daysAgo + 'd ago (' + started_at.slice(0, 10) + ') +' + points + 'pts');
    } catch (err) {
      if (err.message.includes('23505')) {
        console.log('SKIP gym ' + daysAgo + 'd ago already exists');
        continue;
      }
      console.error('ERR gym ' + daysAgo + 'd ago ' + err.message);
    }
  }
  console.log('Done.');
}

main().catch(console.error);
