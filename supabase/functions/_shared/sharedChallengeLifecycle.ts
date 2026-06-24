// @ts-nocheck — Deno runtime, not Node.
//
// Forming → active / cancelled resolution for shared challenges. Kept separate
// from sharedChallengeEval (which pulls in the whole rule engine) so the
// respond-shared-challenge function — which only needs this — stays a small
// bundle. A forming challenge starts the moment NO invitee is still outstanding:
// it goes active with ≥2 in (clock = now + duration) or cancels with <2. Called
// after every accept/decline AND when the accept window elapses (cron). The
// forming→active flip is a conditional update so two near-simultaneous accepts
// can't double-start.
import { notifyPush } from './notify.ts';

const HOUR_MS = 3_600_000;

export async function tryStartForming(
  supabase: any,
  challengeId: string,
): Promise<'started' | 'cancelled' | 'waiting'> {
  const { data: ch } = await supabase
    .from('shared_challenges')
    .select('id, status, duration_hours, template')
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

  if (invitedLeft > 0) return 'waiting';

  if (accepted >= 2) {
    const now = new Date();
    const ends = new Date(now.getTime() + (ch.duration_hours || 72) * HOUR_MS);
    const { data: started } = await supabase
      .from('shared_challenges')
      .update({ status: 'active', starts_at: now.toISOString(), ends_at: ends.toISOString(), accept_by: null })
      .eq('id', challengeId)
      .eq('status', 'forming')
      .select('id')
      .maybeSingle();
    if (started) {
      const title = ch.template?.title ?? 'your challenge';
      for (const p of live) {
        await notifyPush(p.user_id, 'challenge_started', { challenge_id: challengeId, title });
      }
    }
    return 'started';
  }

  // Too few in — don't let it hang.
  await supabase.from('shared_challenges').update({ status: 'cancelled' }).eq('id', challengeId).eq('status', 'forming');
  return 'cancelled';
}
