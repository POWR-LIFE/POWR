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
 * When a challenge's qualifying window opens, decided at the moment it starts.
 *
 * INVITED challenges backdate to creation: participants were doing real
 * activity while a ghosted invite parked the challenge, and all of it silently
 * counted for nothing.
 *
 * OPEN-BOARD challenges do NOT. An open post can sit on the shelf for days
 * before a stranger takes it, and backdating there would hand the creator every
 * session they logged while waiting — a head start the taker can never match,
 * and an obvious exploit: post it, do the work, wait to be taken. A board race
 * starts when it is taken, level for both sides.
 */
export function challengeStartsAt(
  challenge: { is_open?: boolean | null; created_at?: string | null },
  now: Date,
): string {
  if (challenge.is_open) return now.toISOString();
  return challenge.created_at ?? now.toISOString();
}

/**
 * Is a forming challenge with nobody else in still legitimately waiting?
 *
 * The cron sweeps EVERY forming row, not just deadline-elapsed ones, so this
 * decides what survives a sweep. Two things can be waited on:
 *   · outstanding invitees who haven't answered yet, and
 *   · an OPEN-BOARD post, which has no invitees at all — it is waiting on the
 *     shelf for a stranger to take it. Without this clause the first cron run
 *     after a post would cancel it, emptying the board before anyone saw it.
 *
 * Once the accept window elapses, neither is waiting any more: an unanswered
 * invite counts as a no, and an untaken post is one nobody wanted.
 */
export function shouldKeepForming(
  challenge: { isOpen: boolean; invitedLeft: number },
  deadlineElapsed: boolean,
): boolean {
  if (deadlineElapsed) return false;
  return challenge.isOpen || challenge.invitedLeft > 0;
}

/**
 * An open-board post whose window ran out with nobody taking it.
 *
 * Cancelling it was the wrong ending. At launch scale most posts WILL go
 * untaken, so "cancelled" would be the modal last word the board ever says to
 * the first-time user it exists to activate — and it reads as "you failed" or
 * "this is broken". The post becomes a solo run instead: the challenge is still
 * theirs, the base points are still on the table, and the effort isn't binned.
 *
 * It stays ON the board (is_open is left alone) so a late taker can still pick
 * it up mid-run, exactly like any other late joiner; solo_start relaxes the
 * too-thin cancel rule so it survives at one head either way.
 */
export function unclaimedOpenPostGoesSolo(
  challenge: { is_open?: boolean | null },
  deadlineElapsed: boolean,
): boolean {
  return !!challenge.is_open && deadlineElapsed;
}

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
    .select('id, status, duration_hours, template, created_at, is_open')
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
    const startsAt = challengeStartsAt(ch, now);
    const { data: started } = await supabase
      .from('shared_challenges')
      .update({ status: 'active', starts_at: startsAt, ends_at: ends.toISOString(), accept_by: null })
      .eq('id', challengeId)
      .eq('status', 'forming')
      .select('id')
      .maybeSingle();
    if (started) {
      const title = ch.template?.title ?? 'your challenge';
      // The counts ride along because a challenge starts at TWO accepted, not a
      // full roster — the copy used to say "everyone's in" on the first accept
      // while 4 people were still deciding, which simply wasn't true.
      for (const p of live.filter((p: any) => p.state !== 'invited')) {
        await notifyPush(p.user_id, 'challenge_started', {
          challenge_id: challengeId,
          title,
          accepted_count: accepted,
          total_count: accepted + invitedLeft,
        });
      }
    }
    return 'started';
  }

  // Nobody else in yet — but is this challenge still legitimately waiting?
  if (shouldKeepForming({ isOpen: !!ch.is_open, invitedLeft }, deadlineElapsed)) return 'waiting';

  // An untaken board post converts to a solo run rather than dying, and the
  // creator is told so — 'challenge_open_unclaimed' is a receipt-class type, so
  // it is never rationed by the nudge budget.
  if (unclaimedOpenPostGoesSolo(ch, deadlineElapsed)) {
    const now = new Date();
    const ends = new Date(now.getTime() + (ch.duration_hours || 72) * HOUR_MS);
    const { data: soloed } = await supabase
      .from('shared_challenges')
      .update({
        status: 'active',
        solo_start: true,
        starts_at: now.toISOString(),
        ends_at: ends.toISOString(),
        accept_by: null,
      })
      .eq('id', challengeId)
      .eq('status', 'forming')
      .select('id')
      .maybeSingle();
    if (soloed) {
      const title = ch.template?.title ?? 'your challenge';
      // ⚠ The push MUST stay inside this `if (soloed)`. `soloed` is the result
      // of a CONDITIONAL update (.eq('status','forming')), and that condition is
      // the only thing making this fire once: the cron re-sweeps every forming
      // row every 15 minutes. Move this out, or relax the status filter, and the
      // creator gets the same push every quarter of an hour forever — there is
      // no `expiring_notified`-style column backing it up.
      // The creator only — by definition nobody else ever joined.
      for (const p of live.filter((p: any) => p.state !== 'invited')) {
        await notifyPush(p.user_id, 'challenge_open_unclaimed', {
          challenge_id: challengeId, title,
        });
      }
      return 'started';
    }
  }

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
