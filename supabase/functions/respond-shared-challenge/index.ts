// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// The invitee/participant side of a shared challenge:
//   accept  — commit to it (enforces the concurrency cap). When the last invite
//             lands, the clock starts (tryStartForming).
//   decline — drop a pending invite. May resolve the forming challenge (start
//             with whoever's left, or cancel).
//   leave   — drop a challenge you'd accepted; frees a slot. Cancels the
//             challenge if it falls below 2 live members.
import { createClient } from '@supabase/supabase-js';
import { tryStartForming } from '../_shared/sharedChallengeLifecycle.ts';
import { notifyPush } from '../_shared/notify.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Action = 'accept' | 'decline' | 'leave';

/** How many live, unfinished challenges already occupy a slot for this user. */
async function openCount(supabase: any, userId: string): Promise<number> {
  const { data } = await supabase
    .from('shared_challenge_participants')
    .select('challenge_id, shared_challenges!inner(status)')
    .eq('user_id', userId)
    .eq('state', 'accepted')
    .eq('completed', false)
    .in('shared_challenges.status', ['forming', 'active']);
  return data?.length ?? 0;
}

/**
 * Tell everyone already in (creator + accepted members) that a friend just
 * accepted. Only called while the challenge is still FORMING — once it starts,
 * challenge_started reaches all of them and would otherwise double up.
 */
async function notifyAccepted(supabase: any, challengeId: string, accepterId: string) {
  const { data: ch } = await supabase
    .from('shared_challenges').select('template').eq('id', challengeId).maybeSingle();
  const title = ch?.template?.title ?? 'your challenge';

  const { data: parts } = await supabase
    .from('shared_challenge_participants')
    .select('user_id, state')
    .eq('challenge_id', challengeId);
  const live = (parts ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left');
  const accepted = live.filter((p: any) => p.state === 'accepted' || p.state === 'completed');

  const { data: prof } = await supabase
    .from('profiles').select('username, display_name').eq('id', accepterId).maybeSingle();
  const name = prof?.display_name || prof?.username || 'A friend';

  for (const p of accepted) {
    if (p.user_id === accepterId) continue; // don't ping the person who just accepted
    await notifyPush(p.user_id, 'challenge_accepted', {
      challenge_id: challengeId,
      from_name: name,
      title,
      accepted_count: accepted.length,
      total_count: live.length,
    });
  }
}

/** If a forming challenge dropped below 2 live members, cancel it. */
async function cancelIfTooThin(supabase: any, challengeId: string) {
  const { data: parts } = await supabase
    .from('shared_challenge_participants')
    .select('state')
    .eq('challenge_id', challengeId);
  const live = (parts ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left');
  if (live.length < 2) {
    await supabase.from('shared_challenges').update({ status: 'cancelled' })
      .eq('id', challengeId).in('status', ['forming', 'active']);
  }
}

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

  let body: { challenge_id: string; action: Action };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const { challenge_id, action } = body;
  if (!challenge_id || !action) return json({ error: 'Missing challenge_id or action' }, 400);

  const { data: challenge } = await supabase
    .from('shared_challenges').select('id, status').eq('id', challenge_id).maybeSingle();
  if (!challenge) return json({ error: 'Challenge not found' }, 404);

  const { data: me } = await supabase
    .from('shared_challenge_participants')
    .select('state')
    .eq('challenge_id', challenge_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!me) return json({ error: 'Not a participant' }, 403);

  switch (action) {
    case 'accept': {
      if (me.state !== 'invited') return json({ ok: true, state: me.state }); // already answered
      const cap = await capFromConfig(supabase);
      if (await openCount(supabase, user.id) >= cap) {
        return json({ error: 'Challenge slots full — finish or drop one first', code: 'AT_CAP' }, 409);
      }
      await supabase.from('shared_challenge_participants')
        .update({ state: 'accepted', joined_at: new Date().toISOString() })
        .eq('challenge_id', challenge_id).eq('user_id', user.id);
      const outcome = await tryStartForming(supabase, challenge_id);
      // If it didn't start (still waiting on other invitees), let everyone
      // already in know this person joined. When it DID start, the
      // challenge_started push already reached them — don't double up.
      if (outcome === 'waiting') await notifyAccepted(supabase, challenge_id, user.id);
      return json({ ok: true, state: 'accepted', challenge: outcome });
    }

    case 'decline': {
      if (me.state !== 'invited') return json({ ok: true, state: me.state });
      await supabase.from('shared_challenge_participants')
        .update({ state: 'declined' })
        .eq('challenge_id', challenge_id).eq('user_id', user.id);
      // Resolve the forming challenge with whoever's left.
      const outcome = await tryStartForming(supabase, challenge_id);
      return json({ ok: true, state: 'declined', challenge: outcome });
    }

    case 'leave': {
      if (me.state === 'declined' || me.state === 'left') return json({ ok: true, state: me.state });
      await supabase.from('shared_challenge_participants')
        .update({ state: 'left' })
        .eq('challenge_id', challenge_id).eq('user_id', user.id);
      if (challenge.status === 'forming') {
        await tryStartForming(supabase, challenge_id);
      } else {
        await cancelIfTooThin(supabase, challenge_id);
      }
      return json({ ok: true, state: 'left' });
    }

    default:
      return json({ error: 'Unknown action' }, 400);
  }
});

async function capFromConfig(supabase: any): Promise<number> {
  const { data } = await supabase.from('shared_challenge_config').select('challenge_cap').eq('id', 1).maybeSingle();
  return data?.challenge_cap ?? 3;
}
