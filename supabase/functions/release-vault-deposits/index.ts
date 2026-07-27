// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Vault cron tick. Invoked by the `vault-release-sweep` pg_cron job every
// 15 minutes (see 20260718000001_points_vault.sql), gated by the shared
// x-resolve-token cron secret via the verify_resolve_token RPC (Vault) — the
// same gate every other cron-invoked function uses. It previously used a
// bespoke x-vault-token hardcoded both here and in the cron job; that literal
// leaked to the public repo (GitGuardian 34903903), and anyone holding it
// could force the sweep on demand — crediting deposits ahead of the grace
// window and firing real vault_ready / vault_unlocked pushes. Vault-backed
// tokens rotate with `vault.update_secret` alone: no redeploy, no 403 window.
//
// Three phases, all idempotent:
//   1. Admin unlock events — process_vault_unlock_events() pulls targeted
//      pending deposits to READY and returns the newly-ready users; notify
//      events get a "your Vault is ready" push (the press-and-hold moment
//      is theirs to take).
//   2. Natural maturity — notify_matured_vault_deposits() finds deposits that
//      simply ran their vest window out without the user ever being told, and
//      sends the same vault_ready push. This phase closes the one path that
//      used to be silent: before it, ordinary vesting completed unannounced
//      and the user's first word of it was the vault_unlocked push in phase 3,
//      days later, telling them it had already been credited.
//   3. Release sweep — release_due_vault_deposits() auto-credits deposits
//      overdue by the grace window (users who never claimed), with the
//      vault_unlocked push.
//
// Ordering matters: phase 1 stamps the rows it pulls forward, so phase 2 sees
// them as already announced and cannot double-push the same maturity.
import { createClient } from '@supabase/supabase-js';

async function sendPush(userId: string, type: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ target_user_id: userId, type, payload }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[release-vault-deposits] ${type} push failed for ${userId}:`, err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  // ── Phase 1: admin unlock events ──
  let readyUsers = 0;
  let readyPushed = 0;
  const { data: eventRows, error: eventErr } = await supabase.rpc('process_vault_unlock_events');
  if (eventErr) {
    console.error('[release-vault-deposits] unlock events RPC failed:', eventErr);
  } else if ((eventRows ?? []).length > 0) {
    // Dedupe (a user can be hit by two events in one tick); notify wins if
    // any of their events wants it.
    const users = new Map<string, boolean>();
    for (const row of eventRows) {
      users.set(row.user_id, (users.get(row.user_id) ?? false) || row.notify === true);
    }
    readyUsers = users.size;

    const notifyIds = [...users.entries()].filter(([, n]) => n).map(([id]) => id);
    if (notifyIds.length > 0) {
      // Current total READY per user for accurate push copy.
      const { data: dueRows } = await supabase
        .from('vault_deposits')
        .select('user_id, amount')
        .in('user_id', notifyIds)
        .is('released_at', null)
        .lte('vests_at', new Date().toISOString());
      const dueByUser = new Map<string, number>();
      for (const d of dueRows ?? []) {
        dueByUser.set(d.user_id, (dueByUser.get(d.user_id) ?? 0) + (d.amount ?? 0));
      }
      for (const id of notifyIds) {
        const ok = await sendPush(id, 'vault_ready', { points: dueByUser.get(id) ?? 0 });
        if (ok) readyPushed++;
      }
    }
  }

  // ── Phase 2: natural maturity ──
  // Deposits whose vest window ran out on its own. The RPC stamps the rows it
  // returns, so a push that fails here is not retried on the next tick — the
  // alternative (stamping only on success) risks re-pushing the same maturity
  // every 15 minutes if send-push is the thing that is down, and a missed
  // notification is a far smaller failure than a loop of duplicates.
  let maturedUsers = 0;
  let maturedPushed = 0;
  const { data: matured, error: maturedErr } = await supabase.rpc('notify_matured_vault_deposits');
  if (maturedErr) {
    console.error('[release-vault-deposits] maturity RPC failed:', maturedErr);
  } else {
    maturedUsers = (matured ?? []).length;
    for (const row of matured ?? []) {
      const ok = await sendPush(row.user_id, 'vault_ready', { points: row.points });
      if (ok) maturedPushed++;
    }
  }

  // ── Phase 3: grace-window release sweep ──
  const { data: released, error } = await supabase.rpc('release_due_vault_deposits');
  if (error) {
    console.error('[release-vault-deposits] release RPC failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let pushed = 0;
  for (const row of released ?? []) {
    const ok = await sendPush(row.user_id, 'vault_unlocked', { points: row.points, deposits: row.deposits });
    if (ok) pushed++;
  }

  const users = (released ?? []).length;
  const points = (released ?? []).reduce((s, r) => s + (r.points ?? 0), 0);
  if (users > 0 || readyUsers > 0 || maturedUsers > 0) {
    console.log(`[release-vault-deposits] events: ${readyUsers} users made ready (${readyPushed} pushed); matured: ${maturedUsers} users (${maturedPushed} pushed); sweep: ${points} pts across ${users} users (${pushed} pushed)`);
  }

  return new Response(JSON.stringify({
    ok: true,
    ready_users: readyUsers, ready_pushed: readyPushed,
    matured_users: maturedUsers, matured_pushed: maturedPushed,
    users, points, pushed,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
