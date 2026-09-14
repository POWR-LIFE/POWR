// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Admin-only edge function: review flagged activity sessions.
//   approve → clears the flag (keeps the session and its points).
//   reject  → reverses the points awarded for the session, then deletes it.
// Accepts one `session_id` or a `session_ids` array (bulk, same action) — the
// queue is 50 rows of the same shape and one-at-a-time made it unworked.
// Caller must be in the admin_roles table. Runs with the service role so the
// writes actually persist (the table has no client UPDATE/DELETE policy).

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MAX_BULK = 100;

// Every ledger row the session earned. `earn` is the base, `streak` the bonus
// claim-points writes alongside it (and upgrade-gym-tier tops up as `earn`).
// Reject used to sum `earn` only, so a rejected session kept its streak bonus
// — 20 rows / 279 pts across the 2026-09-14 queue would have survived.
const EARNED_TYPES = ['earn', 'streak'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Auth: verify caller is a logged-in admin ──────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: adminRow } = await adminClient
    .from('admin_roles')
    .select('user_id')
    .eq('user_id', user.id)
    .single();
  if (!adminRow) return json({ error: 'Forbidden: admin access required' }, 403);

  // ── Parse body ────────────────────────────────────────────────
  let body: { action?: string; session_id?: string; session_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body;
  if (action !== 'approve' && action !== 'reject') return json({ error: 'Unknown action' }, 400);

  const ids = [...new Set([
    ...(body.session_id ? [body.session_id] : []),
    ...(Array.isArray(body.session_ids) ? body.session_ids : []),
  ].filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return json({ error: 'session_id is required' }, 400);
  if (ids.length > MAX_BULK) return json({ error: `At most ${MAX_BULK} sessions per call` }, 400);

  // Load the sessions (service role bypasses RLS)
  const { data: sessions, error: sErr } = await adminClient
    .from('activity_sessions')
    .select('id, user_id, type, flagged, flag_reason, trust_score')
    .in('id', ids);
  if (sErr) return json({ error: sErr.message }, 500);
  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  const missing = ids.filter((id) => !byId.has(id));
  if (ids.length === 1 && missing.length === 1) return json({ error: 'Session not found' }, 404);

  const results: Array<{ session_id: string; ok: boolean; error?: string; reversed_points?: number }> = [];
  let reversedTotal = 0;

  for (const id of ids) {
    const session = byId.get(id);
    if (!session) { results.push({ session_id: id, ok: false, error: 'Session not found' }); continue; }

    // ── Approve: clear the flag AND its reason, keep the session ──
    if (action === 'approve') {
      const { error } = await adminClient
        .from('activity_sessions')
        .update({ flagged: false, flag_reason: null })
        .eq('id', id);
      if (error) { results.push({ session_id: id, ok: false, error: error.message }); continue; }

      await adminClient.from('admin_audit_log').insert({
        admin_id: user.id,
        action: 'session_approved',
        target_type: 'activity_session',
        target_id: id,
        metadata: { user_id: session.user_id, type: session.type, flag_reason: session.flag_reason, trust_score: session.trust_score },
      });
      results.push({ session_id: id, ok: true });
      continue;
    }

    // ── Reject: reverse EVERYTHING it earned, then delete the session ───
    // Sum before deleting — the FK is ON DELETE SET NULL, so after deletion
    // these rows can't be found by session_id.
    const { data: earned } = await adminClient
      .from('point_transactions')
      .select('amount, type')
      .eq('session_id', id)
      .in('type', EARNED_TYPES);
    const reversed = (earned ?? []).reduce((sum, t) => sum + Math.max(0, t.amount ?? 0), 0);

    // Insert a compensating penalty so the balance is clawed back. The ledger is
    // append-only (no client mutations), so we negate rather than delete.
    if (reversed > 0) {
      const { error: txErr } = await adminClient.from('point_transactions').insert({
        user_id: session.user_id,
        amount: -reversed,
        type: 'penalty',
        description: `Reversed rejected session ${id} (${session.type})`,
        multiplier: 1.0,
      });
      if (txErr) { results.push({ session_id: id, ok: false, error: `Failed to reverse points: ${txErr.message}` }); continue; }
    }

    const { error: delErr } = await adminClient
      .from('activity_sessions')
      .delete()
      .eq('id', id);
    if (delErr) { results.push({ session_id: id, ok: false, error: delErr.message }); continue; }

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'session_rejected',
      target_type: 'activity_session',
      target_id: id,
      metadata: {
        user_id: session.user_id, type: session.type, flag_reason: session.flag_reason,
        reversed_points: reversed,
        reversed_breakdown: (earned ?? []).reduce((acc, t) => {
          acc[t.type] = (acc[t.type] ?? 0) + (t.amount ?? 0); return acc;
        }, {}),
      },
    });
    reversedTotal += reversed;
    results.push({ session_id: id, ok: true, reversed_points: reversed });
  }

  const okCount = results.filter((r) => r.ok).length;
  const single = ids.length === 1 ? results[0] : null;
  if (single && !single.ok) return json({ error: single.error }, 500);

  return json({
    ok: okCount === ids.length,
    [action === 'approve' ? 'approved' : 'rejected']: okCount,
    reversed_points: reversedTotal,
    results,
  });
});
