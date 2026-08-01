// Device freshness extraction, shared by the terra-webhook edge function and the
// Jest unit tests. Pure + dependency-free — no Deno or React Native APIs — so
// both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/deviceFreshness.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/deviceFreshness'
//
// Feeds terra_connections.last_upload_at, the USER-FACING freshness clock behind
// the home wearable chip and the stale-wearable banner. Deliberately separate
// from last_event_at, which is terra-poll scheduling state and excludes 'daily'
// payloads on purpose.

/** Data payload types — anything carrying real health records (vs lifecycle events). */
export const DATA_TYPES = new Set(['activity', 'sleep', 'daily', 'body']);

export type DeviceFreshness = { last_upload_at: string; device_name: string | null };

/**
 * Pull the freshest device_data off a data payload.
 *
 * Terra attaches device_data to each record in `payload.data`; we take the
 * latest `last_upload_date` across the batch — i.e. when the watch itself last
 * uploaded, which is the closest thing Terra exposes to "is this device still
 * alive" (there is no battery field on any Terra model). Providers that omit
 * device_data entirely (Strava) fall back to `now`: we still know data arrived,
 * just not when the device uploaded it.
 */
export function extractDeviceFreshness(payload: any, now: number = Date.now()): DeviceFreshness {
  const records = Array.isArray(payload?.data) ? payload.data : [];
  let latest: number | null = null;
  let name: string | null = null;

  for (const r of records) {
    const dd = r?.device_data;
    if (!dd) continue;
    if (!name && typeof dd.name === 'string' && dd.name.trim()) name = dd.name.trim();
    const ts = Date.parse(dd.last_upload_date ?? '');
    if (!Number.isNaN(ts) && (latest === null || ts > latest)) latest = ts;
  }

  // Guard against a provider clock running ahead of ours — a future timestamp
  // would render as "synced in 3 hours" and could never go stale.
  const stamp = latest !== null && latest <= now ? latest : now;
  return { last_upload_at: new Date(stamp).toISOString(), device_name: name };
}

/**
 * The column patch to write. device_name is omitted (not nulled) when this
 * payload carried no name, so a device_data-less delivery can't wipe a name we
 * already learned from an earlier one.
 */
export function freshnessPatch(f: DeviceFreshness): Partial<DeviceFreshness> {
  return f.device_name
    ? { last_upload_at: f.last_upload_at, device_name: f.device_name }
    : { last_upload_at: f.last_upload_at };
}
