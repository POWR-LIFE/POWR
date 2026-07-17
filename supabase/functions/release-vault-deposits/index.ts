// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Vault cron tick. Invoked by the `vault-release-sweep` pg_cron job every
// 15 minutes (see 20260718000001_points_vault.sql), guarded by the
// x-vault-token shared secret which lives only in the cron job's headers.
//
// Two phases, both idempotent:
//   1. Admin unlock events — process_vault_unlock_events() pulls targeted
//      pending deposits to READY and returns the newly-ready users; notify
//      events get a "your Vault is ready" push (the press-and-hold moment
//      is theirs to take).
//   2. Release sweep — release_due_vault_deposits() auto-credits deposits
//      overdue by the grace window (users who never claimed), with the
//      vault_unlocked push.
import { createClient } from '@supabase/supabase-js';

const VAULT_TOKEN = 'bcd9d7154baa751cd283705ad2a4ca507b4e8b81e281fb83';

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
  if (req.headers.get('x-vault-token') !== VAULT_TOKEN) return new Response('forbidden', { status: 403 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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

  // ── Phase 2: grace-window release sweep ──
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
  if (users > 0 || readyUsers > 0) {
    console.log(`[release-vault-deposits] events: ${readyUsers} users made ready (${readyPushed} pushed); sweep: ${points} pts across ${users} users (${pushed} pushed)`);
  }

  return new Response(JSON.stringify({ ok: true, ready_users: readyUsers, ready_pushed: readyPushed, users, points, pushed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
