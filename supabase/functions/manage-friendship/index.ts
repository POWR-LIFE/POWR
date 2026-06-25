// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Friend-graph mutations (scope §4). All friendship writes funnel through here so
// the canonical low/high pair invariant + status transitions live in one place,
// and so request/accept fire a push reliably (server-side). Reads stay client-
// side via RLS + get_my_friendships.
//
//   request  A→B : create/realise a pending edge (A requested). If B already
//                  requested A, this accepts instead (mutual intent).
//   accept   B   : B accepts A's pending request.
//   decline  B   : B drops A's pending request.
//   remove       : either side removes an accepted friendship.
//   block        : either side blocks the other (hides them, stops requests).
//   unblock      : the blocker clears a block, fully resetting the pair so they
//                  can be re-discovered + re-friended (otherwise block is a
//                  permanent one-way door).
import { createClient } from '@supabase/supabase-js';
import { notifyPush } from '../_shared/notify.ts';

type Action = 'request' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Canonical pair: low id is always user_id (matches the friendships_canonical_order check). */
function pair(a: string, b: string): { low: string; high: string } {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? { low: x, high: y } : { low: y, high: x };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const supabase = createClient(
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

  let body: { action: Action; target_user_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = body.action;
  const targetId = (body.target_user_id || '').toLowerCase();
  if (!action || !targetId) return json({ error: 'Missing action or target_user_id' }, 400);
  if (targetId === user.id.toLowerCase()) return json({ error: 'Cannot friend yourself' }, 400);

  const { low, high } = pair(user.id, targetId);

  // Current edge (if any).
  const { data: existing } = await supabase
    .from('friendships')
    .select('user_id, friend_id, status, requested_by')
    .eq('user_id', low)
    .eq('friend_id', high)
    .maybeSingle();

  // Who am I, for the notification copy ("<name> wants to be your friend").
  const { data: me } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', user.id)
    .maybeSingle();
  const fromName = me?.display_name || me?.username || 'Someone';

  const touch = { updated_at: new Date().toISOString() };

  switch (action) {
    case 'request': {
      if (existing?.status === 'blocked') return json({ error: 'Blocked' }, 403);
      if (existing?.status === 'accepted') return json({ ok: true, status: 'accepted' });

      // They already requested me → realise it as an accept (mutual intent).
      if (existing?.status === 'pending' && existing.requested_by !== user.id) {
        await supabase.from('friendships').update({ status: 'accepted', ...touch })
          .eq('user_id', low).eq('friend_id', high);
        await notifyPush(targetId, 'friend_accepted', { from_user_id: user.id, from_name: fromName });
        return json({ ok: true, status: 'accepted' });
      }
      if (existing?.status === 'pending') return json({ ok: true, status: 'pending' }); // already sent

      await supabase.from('friendships').insert({
        user_id: low, friend_id: high, status: 'pending', requested_by: user.id,
      });
      await notifyPush(targetId, 'friend_request', { from_user_id: user.id, from_name: fromName });
      return json({ ok: true, status: 'pending' });
    }

    case 'accept': {
      if (!existing || existing.status !== 'pending' || existing.requested_by === user.id) {
        return json({ error: 'No incoming request to accept' }, 409);
      }
      await supabase.from('friendships').update({ status: 'accepted', ...touch })
        .eq('user_id', low).eq('friend_id', high);
      await notifyPush(existing.requested_by, 'friend_accepted', { from_user_id: user.id, from_name: fromName });
      return json({ ok: true, status: 'accepted' });
    }

    case 'decline': {
      if (!existing || existing.status !== 'pending') return json({ ok: true });
      await supabase.from('friendships').delete().eq('user_id', low).eq('friend_id', high);
      return json({ ok: true, status: 'declined' });
    }

    case 'remove': {
      if (!existing) return json({ ok: true });
      if (existing.status === 'blocked') return json({ error: 'Blocked' }, 403);
      await supabase.from('friendships').delete().eq('user_id', low).eq('friend_id', high);
      return json({ ok: true, status: 'removed' });
    }

    case 'block': {
      // The blocker becomes requested_by so we know who to keep blocked.
      await supabase.from('friendships').upsert({
        user_id: low, friend_id: high, status: 'blocked', requested_by: user.id, ...touch,
      });
      return json({ ok: true, status: 'blocked' });
    }

    case 'unblock': {
      // Only the user who placed the block can lift it. Clearing the row fully
      // resets the pair (they reappear in search and can be re-friended).
      if (!existing || existing.status !== 'blocked') return json({ ok: true });
      if (existing.requested_by !== user.id) return json({ error: 'Only the blocker can unblock' }, 403);
      await supabase.from('friendships').delete().eq('user_id', low).eq('friend_id', high);
      return json({ ok: true, status: 'unblocked' });
    }

    default:
      return json({ error: 'Unknown action' }, 400);
  }
});
