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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
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
    .select('id, rule, template, base_points, status, starts_at, ends_at')
    .eq('id', challenge_id)
    .maybeSingle();
  if (!challenge) return json({ error: 'Challenge not found' }, 404);

  const result = await evaluateParticipant(supabase, challenge, user.id, utc_offset_minutes);
  return json({
    ok: true,
    completed: result.met,
    newly_completed: result.newlyCompleted,
    progress: result.progress,
    points_awarded: result.newlyCompleted ? challenge.base_points : 0,
  });
});
