// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Vault grant announcer. Invoked by admin_grant_vault_deposit() via pg_net
// with { batch_id } whenever an admin banks POWR with notify on.
//
// Security: verify_jwt=false (pg_net is not a Supabase user); gated by the
// x-resolve-token shared secret via verify_resolve_token, the same pattern as
// send-level-up-email and the cron functions.
//
// The batch is read back from vault_deposits rather than passed inline so the
// pg_net body stays constant-size however large the audience is. Fan-out goes
// through send-push-notification (not the broadcast core) so a grant gets the
// same treatment as its vault siblings: notification_config kill-switch and
// copy overrides, the points_milestone preference gate, push_send_log rows,
// and a rewards-category activity-feed entry.
import { createClient } from '@supabase/supabase-js';

const CONCURRENCY = 5; // polite fan-out; batches are tens of users, not thousands

async function sendPush(userId: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ target_user_id: userId, type: 'vault_granted', payload }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[notify-vault-grant] push failed for ${userId}:`, err);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = token
    ? await admin.rpc('verify_resolve_token', { p_token: token })
    : { data: false };
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const batchId = typeof body?.batch_id === 'string' ? body.batch_id : null;
  if (!batchId) {
    return new Response(JSON.stringify({ error: 'batch_id required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Claim the batch atomically: stamp grant_notified_at and work from the rows
  // the stamp returns. A replayed {batch_id} — a pg_net retry, a double-submit
  // — then finds nothing left to claim and no-ops instead of re-pushing the
  // whole audience. Stamp-first is the same policy as the maturity sweep: a
  // push that fails after stamping is not retried, because a missed
  // notification is a far smaller failure than a duplicate blast.
  const { data: rows, error } = await admin
    .from('vault_deposits')
    .update({ grant_notified_at: new Date().toISOString() })
    .eq('grant_batch', batchId)
    .is('grant_notified_at', null)
    .select('user_id, amount, vests_at, description');
  if (error) {
    console.error('[notify-vault-grant] batch claim failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, recipients: 0, pushed: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Every row in a batch shares amount / vests_at / description.
  const { amount, vests_at, description } = rows[0];
  // A grant vested to 0 days is claimable the moment it lands, so it gets the
  // press-and-hold call to action; anything still vesting gets the date.
  const ready = new Date(vests_at).getTime() <= Date.now();
  const payload = {
    points: amount,
    ready,
    vests_at,
    // 'POWR drop' is the RPC's placeholder for "admin left the note blank" —
    // no point echoing it back as if it were a message.
    note: description && description !== 'POWR drop' ? description : null,
  };

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  let pushed = 0;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const results = await Promise.all(
      userIds.slice(i, i + CONCURRENCY).map((id) => sendPush(id, payload)),
    );
    pushed += results.filter(Boolean).length;
  }

  console.log(`[notify-vault-grant] batch ${batchId}: ${amount} POWR ×${userIds.length} users (${pushed} pushed, ready=${ready})`);

  return new Response(JSON.stringify({ ok: true, recipients: userIds.length, pushed, ready }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
