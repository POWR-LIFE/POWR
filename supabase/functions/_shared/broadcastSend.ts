// @ts-nocheck — Deno runtime, not Node.
// Shared broadcast send core. Used by BOTH:
//   • admin-broadcast-push   — immediate, admin-gated "send now"
//   • dispatch-scheduled-broadcasts — cron fan-out of scheduled rows
// so the audience resolution + Expo batching + dead-token pruning +
// in-app activity-feed write stay identical and proven in one place.
//
// The caller passes an already-constructed service-role Supabase client;
// this module never creates one (keeps the import map in each function).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH = 100; // Expo accepts up to 100 messages per request.
const PAGE = 1000; // PostgREST caps a select at 1000 rows.

export const DEFAULT_TZ = 'Europe/London';

export interface Audience {
  mode?: 'all' | 'segment' | 'users';
  user_ids?: string[];
  user_type?: 'all' | 'pro' | 'normal'; // is_pro
  activities?: string[];                // matches profiles.activity_preferences (ANY of)
  // Device-level filters — applied per token row, not per user, so someone with
  // both an iPhone and an Android phone is only pushed on the targeted device.
  platforms?: string[];                 // ('ios' | 'android')[]; empty/missing = both
  below_version?: string;               // 'x.y.z' — only devices on an older app_version.
  //                                       NULL app_version (pre-telemetry build) counts as older.
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// '1.4.11' or '1.4.11 (Expo Go)' → [1, 4, 11]; null when unparseable.
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = String(v ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionBelow(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false; // equal is not below
}

// User ids whose stored profiles.timezone falls in `tz`'s bucket. NULL/''
// timezones bucket into DEFAULT_TZ, so a default-bucket send also reaches
// every user the app hasn't yet reported a timezone for.
async function timezoneUserIds(admin, tz: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('profiles').select('id').range(from, from + PAGE - 1);
    if (tz === DEFAULT_TZ) q = q.or(`timezone.eq.${tz},timezone.is.null,timezone.eq.`);
    else q = q.eq('timezone', tz);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    data.forEach((r) => ids.add(r.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

// Resolve the audience spec to the user-id set it targets. `null` means
// "everyone with a token" (mode 'all', no timezone filter).
async function audienceUserIds(admin, audience: Audience): Promise<Set<string> | null> {
  const mode = audience.mode ?? 'all';

  if (mode === 'users') {
    return new Set((audience.user_ids ?? []).filter(Boolean));
  }

  if (mode === 'segment') {
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      let q = admin.from('profiles').select('id').range(from, from + PAGE - 1);
      if (audience.user_type === 'pro') q = q.eq('is_pro', true);
      else if (audience.user_type === 'normal') q = q.not('is_pro', 'is', true);
      const acts = (audience.activities ?? []).filter(Boolean);
      if (acts.length > 0) q = q.overlaps('activity_preferences', acts);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      data.forEach((r) => ids.add(r.id));
      if (data.length < PAGE) break;
    }
    return ids;
  }

  return null; // 'all'
}

// Final recipient device list: tokens whose owner is in-target, in the
// timezone bucket (when given), hasn't opted out of announcements, deduped.
export async function resolveRecipients(
  admin,
  audience: Audience,
  timezone?: string,
): Promise<{ user_id: string; expo_push_token: string }[]> {
  let targetIds = await audienceUserIds(admin, audience);

  if (timezone) {
    const tzIds = await timezoneUserIds(admin, timezone);
    targetIds = targetIds === null
      ? tzIds
      : new Set([...targetIds].filter((id) => tzIds.has(id)));
  }

  if (targetIds !== null && targetIds.size === 0) return [];

  // announcements defaults true; a missing row counts as opted-in, so we
  // only need the explicit opt-OUT set.
  const { data: optedOut, error: optErr } = await admin
    .from('notification_preferences')
    .select('user_id')
    .eq('announcements', false);
  if (optErr) throw new Error(optErr.message);
  const excluded = new Set((optedOut ?? []).map((r) => r.user_id));

  const allTokens: { user_id: string; expo_push_token: string; platform: string; app_version: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('user_push_tokens')
      .select('user_id, expo_push_token, platform, app_version')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allTokens.push(...data);
    if (data.length < PAGE) break;
  }

  // Device-level filters. Unknown platform values simply match nothing — a
  // malformed spec fails closed (0 recipients), never falls open to everyone.
  const platforms = new Set((audience.platforms ?? []).filter(Boolean));
  const belowV = parseVersion(audience.below_version);

  const seen = new Set<string>();
  return allTokens.filter((t) => {
    if (targetIds !== null && !targetIds.has(t.user_id)) return false;
    if (excluded.has(t.user_id)) return false;
    if (platforms.size > 0 && !platforms.has(t.platform)) return false;
    if (belowV) {
      const v = parseVersion(t.app_version);
      // Unparseable/NULL = last written by a pre-telemetry build — always "older".
      if (v && !versionBelow(v, belowV)) return false;
    }
    if (seen.has(t.expo_push_token)) return false;
    seen.add(t.expo_push_token);
    return true;
  });
}

export async function countRecipients(admin, audience: Audience, timezone?: string): Promise<number> {
  return (await resolveRecipients(admin, audience, timezone)).length;
}

export interface SendResult {
  recipients: number;
  queued: number;
  delivered: number;
  failed: number;
  pending: number;
  pruned: number;
}

// Send `title`/`body` to a pre-resolved recipient list. Writes one in-app
// activity-feed row per user up-front (so the announcement shows even if the
// device push later fails), fans out to Expo in 100s, polls receipts (bounded)
// to confirm delivery + catch DeviceNotRegistered, and prunes dead tokens.
export async function sendToRecipients(
  admin,
  recipients: { user_id: string; expo_push_token: string }[],
  opts: { title: string; body: string; route?: string; source: string; writeFeed?: boolean },
): Promise<SendResult> {
  const { title, body, route, source } = opts;
  const writeFeed = opts.writeFeed !== false;

  if (writeFeed && recipients.length > 0) {
    try {
      const feedUserIds = [...new Set(recipients.map((r) => r.user_id))];
      const feedRows = feedUserIds.map((uid) => ({
        user_id: uid,
        type: 'announcement',
        category: 'system',
        title,
        body,
        route: route ?? null,
        data: { broadcast: true, ...(route ? { route } : {}) },
      }));
      for (const group of chunk(feedRows, 500)) {
        await admin.from('user_activity').insert(group);
      }
    } catch (feedErr) {
      console.error('[broadcastSend] activity-feed write failed', feedErr);
    }
  }

  const pushData = { type: source, ...(route ? { route } : {}) };
  let queued = 0;
  let failed = 0;
  const deadTokens = new Set<string>();
  const ticketToToken: Record<string, string> = {};

  for (const group of chunk(recipients, BATCH)) {
    const messages = group.map((t) => ({
      to: t.expo_push_token,
      title,
      body,
      data: pushData,
      sound: 'default',
      channelId: 'powr_default_v2',
      priority: 'high',
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      const result = await res.json();
      const tickets = (result?.data ?? []) as Array<{ id?: string; status?: string; details?: { error?: string } }>;
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok') {
          queued++;
          if (ticket.id) ticketToToken[ticket.id] = group[i].expo_push_token;
          return;
        }
        failed++;
        if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.add(group[i].expo_push_token);
      });
    } catch (err) {
      failed += group.length;
      console.error('[broadcastSend] batch failed', err);
    }
  }

  // Poll receipts (bounded ~3 attempts): status:ok ticket only means QUEUED;
  // real delivery + most DeviceNotRegistered surface later, keyed by ticket id.
  let delivered = 0;
  const pending = new Set(Object.keys(ticketToToken));
  for (let attempt = 0; attempt < 3 && pending.size > 0; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const idChunk of chunk([...pending], 1000)) {
      try {
        const rRes = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: idChunk }),
        });
        const rJson = await rRes.json();
        const receipts = (rJson?.data ?? {}) as Record<string, { status?: string; details?: { error?: string } }>;
        for (const id of Object.keys(receipts)) {
          const rec = receipts[id];
          if (rec?.status === 'ok') delivered++;
          else {
            failed++;
            if (rec?.details?.error === 'DeviceNotRegistered') deadTokens.add(ticketToToken[id]);
          }
          pending.delete(id);
        }
      } catch (err) {
        console.error('[broadcastSend] receipt poll failed', err);
      }
    }
  }

  const pruned = [...deadTokens];
  if (pruned.length > 0) {
    await admin.from('user_push_tokens').delete().in('expo_push_token', pruned);
  }

  return { recipients: recipients.length, queued, delivered, failed, pending: pending.size, pruned: pruned.length };
}

// Convenience: resolve + send in one call.
export async function sendBroadcast(
  admin,
  opts: { title: string; body: string; route?: string; audience: Audience; timezone?: string; source: string; writeFeed?: boolean },
): Promise<SendResult> {
  const recipients = await resolveRecipients(admin, opts.audience, opts.timezone);
  return sendToRecipients(admin, recipients, opts);
}
