/**
 * Challenge invite links — client side of the share-link recruitment loop.
 * The URL wraps an unguessable per-challenge token; powr.life/c/<token> unfurls
 * as an OG card in chat apps and smart-links into powr://join-challenge, where
 * respond-shared-challenge's `join` action adds the holder to the challenge and
 * auto-friends them with the creator.
 */

import { supabase } from '@/lib/supabase';

/** Where a link tapped before sign-in parks its token until there's a session. */
export const PENDING_JOIN_KEY = '@powr/pending_challenge_join';

export function challengeInviteUrl(token: string): string {
  return `https://powr.life/c/${token}`;
}

/** Creator-only (the RPC enforces it): the shareable URL for a live challenge. */
export async function fetchChallengeInviteUrl(challengeId: string): Promise<string | null> {
  try {
    const { data } = await supabase.rpc('get_challenge_invite_token', { p_challenge_id: challengeId });
    return data ? challengeInviteUrl(String(data)) : null;
  } catch {
    return null;
  }
}
