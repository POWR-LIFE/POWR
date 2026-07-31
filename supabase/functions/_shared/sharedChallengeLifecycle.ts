// @ts-nocheck — Deno runtime, not Node.
//
// Forming → active / cancelled resolution for shared challenges. Kept separate
// from sharedChallengeEval (which pulls in the whole rule engine) so the
// respond-shared-challenge function — which only needs this — stays a small
// bundle. A forming challenge starts the moment a SECOND person is in (creator
// + one accept) — it does NOT wait for the full roster, because participants
// were doing real activity while a ghosted invite parked the challenge and all
// of it silently counted for nothing. The clock runs ends_at = now + duration,
// but starts_at = the challenge's created_at, so everything anyone did since
// the moment it was created counts (walking day-buckets make the creation day
// count in full anyway — see challengeSessionWindow). Outstanding invitees keep
// their Accept card and join mid-race. Cancellation only happens at the accept
// deadline with nobody else in. Called after every accept/decline AND from the
// cron. The forming→active flip is a conditional update so two near-simultaneous
// accepts can't double-start.
import { notifyPush } from './notify.ts';

const HOUR_MS = 3_600_000;

/**
 * @param deadlineElapsed the accept window has passed. With nobody else in,
 *   outstanding invites count as non-answers and the challenge cancels instead
 *   of holding one of the creator's three slots in 'forming' forever.
 */
export async function tryStartForming(
  supabase: any,
  challengeId: string,
  deadlineElapsed = false,
): Promise<'started' | 'cancelled' | 'waiting'> {
  const { data: ch } = await supabase
    .from('shared_challenges')
    .select('id, status, duration_hours, template, created_at')
    .eq('id', challengeId)
    .maybeSingle();
  if (!ch || ch.status !== 'forming') return 'waiting';

  const { data: parts } = await supabase
    .from('shared_challenge_participants')
    .select('user_id, state')
    .eq('challenge_id', challengeId);
  const live = (parts ?? []).filter((p: any) => p.state !== 'declined' && p.state !== 'left');
  const invitedLeft = live.filter((p: any) => p.state === 'invited').length;
  const accepted = live.filter((p: any) => p.state === 'accepted' || p.state === 'completed').length;

  if (accepted >= 2) {
    const now = new Date();
    const ends = new Date(now.getTime() + (ch.duration_hours || 72) * HOUR_MS);
    // starts_at = creation, not activation: the qualifying window opens the
    // moment the challenge was made, so nothing done while invites were pending
    // is lost. The duration still runs in full from activation.
    const startsAt = ch.created_at ?? now.toISOString();
    const { data: started } = await supabase
      .from('shared_challenges')
      .update({ status: 'active', starts_at: startsAt, ends_at: ends.toISOString(), accept_by: null })
      .eq('id', challengeId)
      .eq('status', 'forming')
      .select('id')
      .maybeSingle();
    if (started) {
      const title = ch.template?.title ?? 'your challenge';
      // Only those actually in — a ghosted invitee isn't a participant.
      for (const p of live.filter((p: any) => p.state !== 'invited')) {
        await notifyPush(p.user_id, 'challenge_started', { challenge_id: challengeId, title });
      }
    }
    return 'started';
  }

  // Nobody else in yet, but answers are still outstanding and the window is
  // open — keep forming. Cancellation waits for the deadline.
  if (invitedLeft > 0 && !deadlineElapsed) return 'waiting';

  // Too few in — don't let it hang. settled_at is stamped so the challenge
  // stays visible for the same 3 days a win gets, instead of vanishing from
  // Home the moment it dies.
  const { data: cancelled } = await supabase
    .from('shared_challenges')
    .update({ status: 'cancelled', settled_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('status', 'forming')
    .select('id')
    .maybeSingle();
  if (cancelled) {
    const title = ch.template?.title ?? 'your challenge';
    for (const p of live.filter((p: any) => p.state !== 'invited')) {
      await notifyPush(p.user_id, 'challenge_ended', {
        challenge_id: challengeId, title, outcome: 'cancelled',
      });
    }
  }
  return 'cancelled';
}
