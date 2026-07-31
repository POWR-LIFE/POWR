// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// The invitee/participant side of a shared challenge:
//   accept  — commit to it (enforces the concurrency cap). The FIRST accept
//             starts the challenge (creator + one = enough; tryStartForming);
//             later accepts join the running clock.
//   decline — drop a pending invite. May resolve the forming challenge (start
//             with whoever's left, or cancel).
//   leave   — drop a challenge you'd accepted; frees a slot. Cancels the
//             challenge if it falls below 2 live members.
//   cancel  — CREATOR-ONLY: end it for everyone, now. Distinct from `leave`,
//             which only ever moved the caller's own row: the app's "Cancel
//             challenge" button promised "this ends it for everyone" but sent
//             `leave`, so with 3+ members live the creator silently dropped out
//             and everyone else carried on.
//   invite  — CREATOR-ONLY: pull more of the creator's friends into an existing
//             challenge (forming OR active). Late joiners inherit the running
//             clock as-is — no personal extension. The clock is untouched.
//   dismiss — clear a FINISHED challenge off your own Home surface (per-user
//             display flag; the challenge itself is untouched). Live challenges
//             can't be dismissed — leave/cancel covers wanting out of those.
//   join    — enter via an invite LINK (powr.life/c/<token>), no prior invite
//             row needed. The token is the credential: whoever holds it may
//             join while the challenge is forming/active (group + slot caps
//             still apply) and is auto-friended with the creator — this is the
//             share-link recruitment loop. Runs BEFORE the participant check,
//             because a link-joiner isn't a participant yet.
import { createClient } from '@supabase/supabase-js';
import { tryStartForming } from '../_shared/sharedChallengeLifecycle.ts';
import { notifyPush } from '../_shared/notify.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_GROUP = 6; // creator + up to 5 others (mirrors create-shared-challenge)

type Action = 'accept' | 'decline' | 'leave' | 'invite' | 'dismiss' | 'cancel' | 'join';

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

/** The set of a user's accepted-friend ids (lowercased), for invite validation. */
async function acceptedFriendIds(supabase: any, userId: string): Promise<Set<string>> {
  const { data: edges } = await supabase
    .from('friendships')
    .select('user_id, friend_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  const set = new Set<string>();
  for (const e of edges ?? []) {
    set.add((e.user_id === userId ? e.friend_id : e.user_id).toLowerCase());
  }
  return set;
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

/**
 * Join via invite link. The token IS the credential — it only ever leaves the
 * server through get_challenge_invite_token (creator-only), so holding it
 * means the creator shared it with you. Joining also seeds the friend graph:
 * the whole point of the link is recruiting people who aren't friends (or
 * users) yet, and a challenge-mate you can't rematch afterwards is a dead end.
 */
async function joinByToken(supabase: any, user: any, token?: string) {
  if (!token || typeof token !== 'string') return json({ error: 'Missing invite token' }, 400);

  const { data: challenge } = await supabase
    .from('shared_challenges')
    .select('id, status, creator_id, template')
    .eq('invite_token', token)
    .maybeSingle();
  if (!challenge) return json({ error: 'Invite link not recognised', code: 'BAD_TOKEN' }, 404);
  if (challenge.status !== 'forming' && challenge.status !== 'active') {
    return json({ error: 'This challenge has already finished', code: 'NOT_LIVE' }, 409);
  }
  if (challenge.creator_id === user.id) {
    return json({ ok: true, challenge_id: challenge.id, state: 'creator' });
  }

  // A block in either direction kills the link (rows are canonical low<high).
  const [lo, hi] = [user.id, challenge.creator_id].sort();
  const { data: edge } = await supabase
    .from('friendships')
    .select('status')
    .eq('user_id', lo)
    .eq('friend_id', hi)
    .maybeSingle();
  if (edge?.status === 'blocked') {
    return json({ error: 'You can’t join this challenge', code: 'BLOCKED' }, 403);
  }

  const { data: roster } = await supabase
    .from('shared_challenge_participants')
    .select('user_id, state')
    .eq('challenge_id', challenge.id);
  const mine = (roster ?? []).find((p: any) => p.user_id === user.id);
  if (mine && (mine.state === 'accepted' || mine.state === 'completed')) {
    return json({ ok: true, challenge_id: challenge.id, state: mine.state }); // already in
  }

  // Group cap counts this joiner only if they aren't already a live head.
  const liveCount = (roster ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left').length;
  const newHead = !mine || mine.state === 'declined' || mine.state === 'left';
  if (newHead && liveCount >= MAX_GROUP) {
    return json({ error: `Groups are capped at ${MAX_GROUP}`, code: 'GROUP_FULL' }, 409);
  }
  const cap = await capFromConfig(supabase);
  if (await openCount(supabase, user.id) >= cap) {
    return json({ error: 'Challenge slots full — finish or drop one first', code: 'AT_CAP' }, 409);
  }

  if (!edge) {
    const { error: fErr } = await supabase.from('friendships').insert({
      user_id: lo, friend_id: hi, status: 'accepted', requested_by: challenge.creator_id,
    });
    // 23505 = a concurrent request/join already created the edge — fine.
    if (fErr && fErr.code !== '23505') console.error('[respond-shared-challenge] join friendship insert failed:', fErr);
  } else if (edge.status === 'pending') {
    await supabase.from('friendships').update({ status: 'accepted' })
      .eq('user_id', lo).eq('friend_id', hi);
  }

  const nowIso = new Date().toISOString();
  if (mine) {
    // invited/declined/left → straight to accepted, cleared of any prior stint
    // (same reset the re-invite path applies).
    await supabase.from('shared_challenge_participants')
      .update({
        state: 'accepted', invited_by: challenge.creator_id, joined_at: nowIso,
        completed: false, completed_at: null, progress: 0,
        base_awarded: false, bonus_awarded: 0,
      })
      .eq('challenge_id', challenge.id).eq('user_id', user.id);
  } else {
    const { error: insErr } = await supabase.from('shared_challenge_participants').insert({
      challenge_id: challenge.id, user_id: user.id, state: 'accepted',
      invited_by: challenge.creator_id, joined_at: nowIso,
    });
    if (insErr && insErr.code !== '23505') {
      console.error('[respond-shared-challenge] join insert failed:', insErr);
      return json({ error: 'Failed to join' }, 500);
    }
  }

  const outcome = await tryStartForming(supabase, challenge.id);
  // 'waiting' = already active (late join) — tell the group someone came in.
  if (outcome === 'waiting') await notifyAccepted(supabase, challenge.id, user.id);
  return json({ ok: true, challenge_id: challenge.id, state: 'accepted', challenge: outcome });
}

/** If a forming challenge dropped below 2 live members, cancel it. */
/**
 * Flip a live challenge to cancelled and tell everyone still in it. Stamps
 * settled_at so it lingers on Home for the same 3 days a win does, rather than
 * vanishing the instant it dies.
 */
async function cancelChallenge(
  supabase: any,
  challengeId: string,
  live: { user_id: string; state: string }[],
  title: string,
  /** The person who caused it — they just tapped the button, so don't push at
   *  them about their own action. */
  actorId?: string,
) {
  const { data: cancelled } = await supabase
    .from('shared_challenges')
    .update({ status: 'cancelled', settled_at: new Date().toISOString() })
    .eq('id', challengeId)
    .in('status', ['forming', 'active'])
    .select('id')
    .maybeSingle();
  if (!cancelled) return false;
  // Committed heads only, and never the actor. A ghosted invitee never joined,
  // so "your challenge was cancelled" is noise about something they were never
  // in — same exclusion tryStartForming already applies on its cancel path.
  for (const p of live.filter((p) => p.state !== 'invited' && p.user_id !== actorId)) {
    await notifyPush(p.user_id, 'challenge_ended', {
      challenge_id: challengeId, title, outcome: 'cancelled',
    });
  }
  return true;
}

async function cancelIfTooThin(supabase: any, challengeId: string, title: string) {
  const { data: parts } = await supabase
    .from('shared_challenge_participants')
    .select('user_id, state')
    .eq('challenge_id', challengeId);
  const live = (parts ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left');
  // Only COMMITTED heads count toward "is there still a group here?". Since a
  // challenge can start with unanswered invites on the roster, counting those
  // as live would keep a one-person challenge running on the strength of
  // someone who never replied.
  const committed = live.filter((p: any) => p.state !== 'invited');
  // A solo-start run was viable at one from day one, so it only dies when
  // EVERYONE is gone (the creator leaving). Without this, inviting a friend
  // into your live solo run and having them later leave would cancel a
  // challenge that was never below its starting strength.
  const { data: ch } = await supabase
    .from('shared_challenges').select('solo_start').eq('id', challengeId).maybeSingle();
  const minCommitted = ch?.solo_start ? 1 : 2;
  if (committed.length < minCommitted) {
    await cancelChallenge(supabase, challengeId, live, title);
  }
}

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

  let body: { challenge_id?: string; action: Action; target_user_ids?: string[]; invite_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const { challenge_id, action } = body;
  if (!action) return json({ error: 'Missing action' }, 400);

  // Link-join is addressed by token, not challenge_id, and the caller is not a
  // participant yet — so it cannot flow through the lookup below.
  if (action === 'join') return joinByToken(supabase, user, body.invite_token);

  if (!challenge_id) return json({ error: 'Missing challenge_id or action' }, 400);

  const { data: challenge } = await supabase
    .from('shared_challenges').select('id, status, creator_id, template').eq('id', challenge_id).maybeSingle();
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
      // You can't join something that's already over. Previously unreachable
      // from the UI because the list RPC dropped terminal challenges on sight;
      // now that losses linger for 3 days, a stale invite card is a real path
      // here — and tryStartForming would no-op, leaving the row 'accepted' on a
      // dead challenge.
      if (challenge.status !== 'forming' && challenge.status !== 'active') {
        return json({ error: 'This challenge has already finished', code: 'NOT_LIVE' }, 409);
      }
      const cap = await capFromConfig(supabase);
      if (await openCount(supabase, user.id) >= cap) {
        return json({ error: 'Challenge slots full — finish or drop one first', code: 'AT_CAP' }, 409);
      }
      await supabase.from('shared_challenge_participants')
        .update({ state: 'accepted', joined_at: new Date().toISOString() })
        .eq('challenge_id', challenge_id).eq('user_id', user.id);
      const outcome = await tryStartForming(supabase, challenge_id);
      // 'waiting' here means the challenge was ALREADY active (late joiner) —
      // a first accept on a forming challenge always starts it now. Let everyone
      // in know this person joined. When this accept DID start it, the
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
        await cancelIfTooThin(supabase, challenge_id, challenge.template?.title ?? 'your challenge');
      }
      return json({ ok: true, state: 'left' });
    }

    case 'cancel': {
      if (challenge.creator_id !== user.id) {
        return json({ error: 'Only the creator can cancel this challenge', code: 'NOT_CREATOR' }, 403);
      }
      if (challenge.status !== 'forming' && challenge.status !== 'active') {
        return json({ error: 'This challenge has already finished', code: 'NOT_LIVE' }, 409);
      }
      const { data: parts } = await supabase
        .from('shared_challenge_participants')
        .select('user_id, state')
        .eq('challenge_id', challenge_id);
      const live = (parts ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left');
      const done = await cancelChallenge(
        supabase, challenge_id, live, challenge.template?.title ?? 'your challenge', user.id,
      );
      return json({ ok: true, state: me.state, cancelled: done });
    }

    case 'dismiss': {
      // Per-user display flag: hides the settled card from YOUR Home. Only
      // finished challenges — a live one is either still yours to do (leave
      // covers exiting) or still settling.
      if (challenge.status === 'forming' || challenge.status === 'active') {
        return json({ error: 'You can only dismiss a finished challenge', code: 'STILL_LIVE' }, 409);
      }
      await supabase.from('shared_challenge_participants')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('challenge_id', challenge_id).eq('user_id', user.id);
      return json({ ok: true, state: me.state, dismissed: true });
    }

    case 'invite': {
      // Creator-only: only the person who started it can grow the group.
      if (challenge.creator_id !== user.id) {
        return json({ error: 'Only the challenge creator can invite people', code: 'NOT_CREATOR' }, 403);
      }
      // Can't grow a finished/cancelled challenge; forming + active are fair game.
      if (challenge.status !== 'forming' && challenge.status !== 'active') {
        return json({ error: 'This challenge is no longer open to new people', code: 'NOT_OPEN' }, 409);
      }

      const targets = [...new Set((body.target_user_ids || []).map((s) => String(s).toLowerCase()))]
        .filter((id) => id && id !== user.id.toLowerCase());
      if (targets.length === 0) return json({ error: 'No one to invite' }, 400);

      // Only the creator's accepted friends are invitable.
      const friends = await acceptedFriendIds(supabase, user.id);
      const notFriends = targets.filter((id) => !friends.has(id));
      if (notFriends.length) return json({ error: 'Some invitees are not your friends' }, 400);

      // A friend who's turned Together off can't be invited — they'd never see
      // it. The client greys them out; this is the server backstop.
      for (const fid of targets) {
        const { data: u } = await supabase.auth.admin.getUserById(fid);
        if (u?.user?.user_metadata?.together_enabled === false) {
          return json({ error: 'A selected friend isn’t on Together', code: 'INVITEE_OPTED_OUT' }, 400);
        }
      }

      // Current roster. Live members (invited/accepted/completed) can't be
      // re-invited; a declined/left row is flipped back to 'invited' instead of
      // inserting a duplicate (the (challenge_id, user_id) pair is unique).
      const { data: existing } = await supabase
        .from('shared_challenge_participants')
        .select('user_id, state')
        .eq('challenge_id', challenge_id);
      const stateByUser = new Map<string, string>();
      for (const p of existing ?? []) stateByUser.set(String(p.user_id).toLowerCase(), p.state);
      const liveCount = (existing ?? []).filter(
        (p: any) => p.state !== 'declined' && p.state !== 'left',
      ).length;

      const toReinvite = targets.filter((id) => {
        const s = stateByUser.get(id);
        return s === 'declined' || s === 'left';
      });
      const toInsert = targets.filter((id) => !stateByUser.has(id));
      const alreadyIn = targets.filter((id) => {
        const s = stateByUser.get(id);
        return s === 'invited' || s === 'accepted' || s === 'completed';
      });

      const newlyInvited = [...toReinvite, ...toInsert];
      if (newlyInvited.length === 0) {
        // Everyone requested is already in — treat as a no-op success.
        return json({ ok: true, invited: 0, already_in: alreadyIn.length });
      }

      // Group-size cap: live roster + the people we're about to (re)invite.
      if (liveCount + newlyInvited.length > MAX_GROUP) {
        return json({ error: `Groups are capped at ${MAX_GROUP}`, code: 'GROUP_FULL' }, 409);
      }

      if (toReinvite.length) {
        // Reset to a clean invite — clear any award/progress state left over from
        // a prior stint so a re-joiner starts fresh (matches a first-time invite).
        await supabase.from('shared_challenge_participants')
          .update({
            state: 'invited', invited_by: user.id, joined_at: null,
            completed: false, completed_at: null, progress: 0,
            base_awarded: false, bonus_awarded: 0,
          })
          .eq('challenge_id', challenge_id)
          .in('user_id', toReinvite);
      }
      if (toInsert.length) {
        const rows = toInsert.map((fid) => ({
          challenge_id, user_id: fid, state: 'invited', invited_by: user.id,
        }));
        const { error: insErr } = await supabase.from('shared_challenge_participants').insert(rows);
        if (insErr) {
          console.error('[respond-shared-challenge] invite insert failed:', insErr);
          return json({ error: 'Failed to add invitees' }, 500);
        }
      }

      // Invite pushes. Same payload shape as create-shared-challenge.
      const { data: prof } = await supabase
        .from('profiles').select('username, display_name').eq('id', user.id).maybeSingle();
      const fromName = prof?.display_name || prof?.username || 'A friend';
      const title = challenge.template?.title ?? 'a challenge';
      for (const fid of newlyInvited) {
        await notifyPush(fid, 'challenge_invite', { challenge_id, from_name: fromName, title });
      }

      return json({ ok: true, invited: newlyInvited.length, already_in: alreadyIn.length });
    }

    default:
      return json({ error: 'Unknown action' }, 400);
  }
};

// CORS wrapper — native apps never preflight, but expo web does: without an
// OPTIONS branch and ACAO on every response the browser can neither send the
// call nor read its result. Mirrors the admin-* functions' pattern.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const res = await handler(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

async function capFromConfig(supabase: any): Promise<number> {
  const { data } = await supabase.from('shared_challenge_config').select('challenge_cap').eq('id', 1).maybeSingle();
  return data?.challenge_cap ?? 3;
}
