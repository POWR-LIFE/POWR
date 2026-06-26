// @ts-nocheck — Deno runtime, not Node.
// Admin-only broadcast: send a free-form push to every installed device whose
// owner hasn't opted out of announcements. Because pushes are addressed by the
// device's stored expo_push_token (not the app binary), this reaches users on
// ANY app version — the same reason a server-sent push lands on old builds.
//
// Auth mirrors admin-manage-user (caller must be in admin_roles). Unlike the
// transactional send-push-notification, this takes arbitrary title/body, fans
// out to many devices in batches of 100 (Expo's per-request cap), prunes tokens
// Expo reports as DeviceNotRegistered, and writes a broadcast_log audit row.
import { createClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts up to 100 messages per request.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Auth: caller must be a logged-in admin ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: adminRow } = await admin
    .from('admin_roles').select('user_id').eq('user_id', user.id).single();
  if (!adminRow) return json({ error: 'Forbidden: admin access required' }, 403);

  // ── Parse body ──────────────────────────────────────────────────────────
  interface Audience {
    mode?: 'all' | 'segment' | 'users';
    user_ids?: string[];
    user_type?: 'all' | 'pro' | 'normal'; // is_pro
    activities?: string[];                // matches profiles.activity_preferences (ANY of)
  }
  let body: { title?: string; body?: string; route?: string; dry_run?: boolean; audience?: Audience };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const title = String(body.title ?? '').trim();
  const message = String(body.body ?? '').trim();
  const route = body.route ? String(body.route).trim() : undefined;
  const dryRun = body.dry_run === true;
  const audience: Audience = body.audience ?? { mode: 'all' };
  const mode = audience.mode ?? 'all';

  // dry_run only needs the audience count; a real send needs copy.
  if (!dryRun && (!title || !message)) {
    return json({ error: 'title and body are required' }, 400);
  }

  const PAGE = 1000;

  // ── Resolve the target user set. `null` means "everyone with a token". ────
  let targetIds: Set<string> | null = null;

  if (mode === 'users') {
    targetIds = new Set((audience.user_ids ?? []).filter(Boolean));
    if (targetIds.size === 0) return json({ error: 'No users selected' }, 400);
  } else if (mode === 'segment') {
    // Build the profile filter from user_type (is_pro) + activity preferences.
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      let q = admin.from('profiles').select('id').range(from, from + PAGE - 1);
      if (audience.user_type === 'pro') q = q.eq('is_pro', true);
      else if (audience.user_type === 'normal') q = q.not('is_pro', 'is', true);
      const acts = (audience.activities ?? []).filter(Boolean);
      if (acts.length > 0) q = q.overlaps('activity_preferences', acts);

      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) break;
      data.forEach((r: { id: string }) => ids.add(r.id));
      if (data.length < PAGE) break;
    }
    targetIds = ids;
    if (targetIds.size === 0) return json({ dry_run: dryRun, recipients: 0, ...(dryRun ? {} : { ok: true, sent: 0, errored: 0, pruned: 0 }) });
  }

  // ── Audience: device tokens whose owner is in-target and hasn't opted out. ─
  // notification_preferences.announcements defaults true and a missing row is
  // treated as opted-in, so we only need the explicit opt-OUT set.
  const { data: optedOut, error: optErr } = await admin
    .from('notification_preferences')
    .select('user_id')
    .eq('announcements', false);
  if (optErr) return json({ error: optErr.message }, 500);
  const excluded = new Set((optedOut ?? []).map((r: { user_id: string }) => r.user_id));

  // Paginate tokens — a single PostgREST select caps at 1000 rows. At current
  // scale fetching all and filtering in-memory is cheap; revisit if tokens grow
  // into the tens of thousands.
  const allTokens: { user_id: string; expo_push_token: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('user_push_tokens')
      .select('user_id, expo_push_token')
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    if (!data || data.length === 0) break;
    allTokens.push(...data);
    if (data.length < PAGE) break;
  }

  // Apply target set + opt-out, and de-dupe tokens (a user can have multiple
  // devices, but the same token should never be hit twice).
  const seen = new Set<string>();
  const recipients = allTokens.filter((t) => {
    if (targetIds !== null && !targetIds.has(t.user_id)) return false;
    if (excluded.has(t.user_id)) return false;
    if (seen.has(t.expo_push_token)) return false;
    seen.add(t.expo_push_token);
    return true;
  });

  if (dryRun) return json({ dry_run: true, recipients: recipients.length });

  // ── Send in batches of 100. ─────────────────────────────────────────────
  const pushData = { type: 'admin_broadcast', ...(route ? { route } : {}) };
  let ok = 0;
  let errored = 0;
  const deadTokens: string[] = [];

  for (const group of chunk(recipients, BATCH)) {
    const messages = group.map((t) => ({
      to: t.expo_push_token,
      title,
      body: message,
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
      const tickets = (result?.data ?? []) as Array<{
        status?: string;
        details?: { error?: string };
      }>;
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok') {
          ok++;
          return;
        }
        errored++;
        // Permanently-unreachable token: the device uninstalled or token rotated.
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          deadTokens.push(group[i].expo_push_token);
        }
      });
    } catch (err) {
      errored += group.length;
      console.error('[admin-broadcast-push] batch failed', err);
    }
  }

  // Prune dead tokens so they don't bloat future broadcasts.
  if (deadTokens.length > 0) {
    await admin.from('user_push_tokens').delete().in('expo_push_token', deadTokens);
  }

  // Audit.
  await admin.from('broadcast_log').insert({
    admin_id: user.id,
    title,
    body: message,
    route: route ?? null,
    audience,
    recipients: recipients.length,
    tickets_ok: ok,
    tickets_error: errored,
  });
  await admin.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'broadcast_push',
    target_type: 'broadcast',
    metadata: { title, audience, recipients: recipients.length, ok, errored, pruned: deadTokens.length },
  });

  return json({
    ok: true,
    recipients: recipients.length,
    sent: ok,
    errored,
    pruned: deadTokens.length,
  });
});
