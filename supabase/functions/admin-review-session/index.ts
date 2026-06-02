// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Admin-only edge function: review a flagged activity session.
//   approve → clears the flag (keeps the session and its points).
//   reject  → reverses the points awarded for the session, then deletes it.
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
  let body: { action?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, session_id } = body;
  if (!session_id) return json({ error: 'session_id is required' }, 400);

  // Load the session (service role bypasses RLS)
  const { data: session, error: sErr } = await adminClient
    .from('activity_sessions')
    .select('id, user_id, type, flagged, trust_score')
    .eq('id', session_id)
    .single();
  if (sErr || !session) return json({ error: 'Session not found' }, 404);

  // ── Approve: clear the flag, keep the session ─────────────────
  if (action === 'approve') {
    const { error } = await adminClient
      .from('activity_sessions')
      .update({ flagged: false })
      .eq('id', session_id);
    if (error) return json({ error: error.message }, 500);

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'session_approved',
      target_type: 'activity_session',
      target_id: session_id,
      metadata: { user_id: session.user_id, type: session.type, previous_trust: session.trust_score },
    });
    return json({ ok: true, approved: true });
  }

  // ── Reject: reverse awarded points, then delete the session ───
  if (action === 'reject') {
    // Sum the points earned from this session BEFORE deleting it — the FK is
    // ON DELETE SET NULL, so after deletion these rows can't be found by session_id.
    const { data: earns } = await adminClient
      .from('point_transactions')
      .select('amount')
      .eq('session_id', session_id)
      .eq('type', 'earn');
    const reversed = (earns ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);

    // Insert a compensating penalty so the balance is clawed back. The ledger is
    // append-only (no client mutations), so we negate rather than delete the earn.
    if (reversed > 0) {
      const { error: txErr } = await adminClient.from('point_transactions').insert({
        user_id: session.user_id,
        amount: -reversed,
        type: 'penalty',
        description: `Reversed rejected session ${session_id} (${session.type})`,
        multiplier: 1.0,
      });
      if (txErr) return json({ error: `Failed to reverse points: ${txErr.message}` }, 500);
    }

    const { error: delErr } = await adminClient
      .from('activity_sessions')
      .delete()
      .eq('id', session_id);
    if (delErr) return json({ error: delErr.message }, 500);

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'session_rejected',
      target_type: 'activity_session',
      target_id: session_id,
      metadata: { user_id: session.user_id, type: session.type, reversed_points: reversed },
    });
    return json({ ok: true, rejected: true, reversed_points: reversed });
  }

  return json({ error: 'Unknown action' }, 400);
});
