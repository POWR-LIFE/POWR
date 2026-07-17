// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Vault release sweep. Invoked by the `vault-release-sweep` pg_cron job every
// 15 minutes (see 20260718000001_points_vault.sql), guarded by the x-vault-token
// shared secret which lives only in the cron job's headers. All the crediting
// logic is in the release_due_vault_deposits() RPC — one atomic ledger row per
// user, deposits stamped released — so this function is just the trigger pull
// plus the per-user "vault unlocked" push.
import { createClient } from '@supabase/supabase-js';

const VAULT_TOKEN = 'bcd9d7154baa751cd283705ad2a4ca507b4e8b81e281fb83';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (req.headers.get('x-vault-token') !== VAULT_TOKEN) return new Response('forbidden', { status: 403 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: released, error } = await supabase.rpc('release_due_vault_deposits');
  if (error) {
    console.error('[release-vault-deposits] release RPC failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Push per user, after the credit is already committed — a push failure must
  // never affect the points.
  let pushed = 0;
  for (const row of released ?? []) {
    try {
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          target_user_id: row.user_id,
          type: 'vault_unlocked',
          payload: { points: row.points, deposits: row.deposits },
        }),
      });
      if (res.ok) pushed++;
    } catch (err) {
      console.warn(`[release-vault-deposits] push failed for ${row.user_id}:`, err);
    }
  }

  const users = (released ?? []).length;
  const points = (released ?? []).reduce((s, r) => s + (r.points ?? 0), 0);
  if (users > 0) console.log(`[release-vault-deposits] released ${points} pts across ${users} users (${pushed} pushed)`);

  return new Response(JSON.stringify({ ok: true, users, points, pushed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
