// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// The signed-in user's optimistic completion check for a shared challenge —
// the counterpart to complete-weekly-challenge, but scoped to a single shared
// instance. Re-evaluates THIS user's sensor-verified sessions over the
// challenge's own clock window and awards BASE points on first meet. The group
// BONUS is settled later, at challenge end, by resolve-shared-challenges.
// All the maths lives in evaluateParticipant (shared with the cron backstop).
import { createClient } from '@supabase/supabase-js';
import { evaluateParticipant } from '../_shared/sharedChallengeEval.ts';
import { evaluatePooledChallenge } from '../_shared/sharedChallengePooled.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const handler = async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { challenge_id: string; utc_offset_minutes: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const { challenge_id, utc_offset_minutes } = body;
  if (!challenge_id || utc_offset_minutes === undefined) {
    return json({ error: 'Missing challenge_id or utc_offset_minutes' }, 400);
  }

  const { data: challenge } = await supabase
    .from('shared_challenges')
    .select('id, kind, rule, template, base_points, status, starts_at, ends_at, utc_offset_minutes, bonus_per_head, bonus_max, pool_milestone_notified')
    .eq('id', challenge_id)
    .maybeSingle();
  if (!challenge) return json({ error: 'Challenge not found' }, 404);

  // Pooled challenges complete as a GROUP (sum >= target), so the calling user
  // just triggers a whole-pool re-evaluation; parallel evaluates this user only.
  if (challenge.kind === 'pooled') {
    const r = await evaluatePooledChallenge(supabase, challenge);
    return json({
      ok: true,
      completed: r.completed,
      newly_completed: r.newlyCompleted,
      progress: r.target > 0 ? Math.min(1, r.poolTotal / r.target) : 0,
      pool_total: r.poolTotal,
      pool_target: r.target,
      points_awarded: r.newlyCompleted ? challenge.base_points : 0,
    });
  }

  const result = await evaluateParticipant(supabase, challenge, user.id, utc_offset_minutes);
  return json({
    ok: true,
    completed: result.met,
    newly_completed: result.newlyCompleted,
    progress: result.progress,
    points_awarded: result.newlyCompleted ? challenge.base_points : 0,
  });
};

// CORS wrapper — native apps never preflight, but expo web does: without an
// OPTIONS branch and ACAO on every response the browser can neither send the
// call nor read its result. Mirrors the admin-* functions' pattern.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const res = await handler(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});
