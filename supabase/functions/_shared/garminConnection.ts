// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Garmin connection bookkeeping shared by garmin-auth and garmin-webhook:
// a valid access token on demand, and the one way a connection ends.

import { profileAfterDeauth } from './terraDeauth.ts';
import { expiriesFrom, needsRefresh, refreshTokens } from './garminApi.ts';

const CLIENT_ID = Deno.env.get('GARMIN_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GARMIN_CLIENT_SECRET') ?? '';

/**
 * A usable access token for the user, refreshing (and storing the rotated
 * refresh token) when it is within Garmin's 10-minute margin of expiry.
 * Null when we hold no tokens or the refresh is refused — the user has to
 * sign in to Garmin again.
 */
export async function accessTokenFor(supabase, userId: string): Promise<string | null> {
  const { data: tok, error } = await supabase
    .from('garmin_tokens')
    .select('access_token, refresh_token, access_expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !tok) return null;
  if (!needsRefresh(tok.access_expires_at)) return tok.access_token;

  try {
    const fresh = await refreshTokens({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: tok.refresh_token,
    });
    const { error: saveErr } = await supabase.from('garmin_tokens').update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      ...expiriesFrom(fresh),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    if (saveErr) console.error('[garmin] token save failed:', saveErr.message);
    return fresh.access_token;
  } catch (e) {
    console.warn('[garmin] token refresh refused:', e?.message ?? e);
    return null;
  }
}

/**
 * Record that a user's Garmin link has ended — they disconnected in POWR, in
 * Garmin Connect, or deleted their account. Keeps the connection row (with
 * deregistered_at) for history, deletes the tokens, and takes Garmin off the
 * profile so the phone's health store becomes the source again.
 *
 * `garminUserId`, when given, guards the profile edit: a deregistration for an
 * OLD Garmin account must not remove a newer link the user has since made.
 */
export async function endGarminConnection(supabase, userId: string, garminUserId?: string): Promise<void> {
  const now = new Date().toISOString();
  let q = supabase.from('garmin_connections')
    .update({ deregistered_at: now, updated_at: now })
    .eq('user_id', userId)
    .is('deregistered_at', null);
  if (garminUserId) q = q.eq('garmin_user_id', garminUserId);
  const { error: connErr } = await q;
  if (connErr) console.error('[garmin] connection end failed:', connErr.message);

  await supabase.from('garmin_tokens').delete().eq('user_id', userId);

  const { data: prof } = await supabase
    .from('profiles')
    .select('health_provider_connections, active_health_provider')
    .eq('id', userId)
    .maybeSingle();
  if (!prof) return;
  const entry = prof.health_provider_connections?.garmin;
  if (!entry) return;
  if (garminUserId && entry.garmin_user_id && entry.garmin_user_id !== garminUserId) return;
  const next = profileAfterDeauth(
    prof.health_provider_connections ?? {}, prof.active_health_provider ?? null, 'garmin',
  );
  const { error } = await supabase.from('profiles').update(next).eq('id', userId);
  if (error) console.error('[garmin] profile update failed:', error.message);
}
