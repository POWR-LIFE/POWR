import type { SharedChallenge } from '@/lib/social/types';

/**
 * A shared challenge has reached an ending — win or lose.
 *
 * The three terminal statuses share one display lifecycle: they linger on Home
 * for 3 days, they carry a verdict instead of a progress track, and they can be
 * dismissed with the (X). Losses were previously dropped from the list RPC the
 * instant they were set, so this predicate is what makes an ending visible at
 * all rather than something the user infers from a card that disappeared.
 *
 * Deliberately dependency-free (no Supabase client) so pure logic can import it
 * without pulling the data layer in behind it.
 */
export function isTerminal(status: SharedChallenge['status']): boolean {
  return status === 'completed' || status === 'expired' || status === 'cancelled';
}
