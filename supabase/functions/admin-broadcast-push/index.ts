// @ts-nocheck — Deno runtime, not Node.
// Admin-only broadcast: send a free-form push to every installed device whose
// owner hasn't opted out of announcements. Because pushes are addressed by the
// device's stored expo_push_token (not the app binary), this reaches users on
// ANY app version — the same reason a server-sent push lands on old builds.
//
// Auth mirrors admin-manage-user (caller must be in admin_roles). The audience
// resolution + Expo fan-out + token pruning + activity-feed write live in the
// shared core (_shared/broadcastSend.ts) so the scheduled dispatcher runs the
// exact same code. This function adds the admin gate, the dry_run count, and
// the broadcast_log / admin_audit_log audit rows.
import { createClient } from '@supabase/supabase-js';
import { countRecipients, resolveRecipients, sendToRecipients } from '../_shared/broadcastSend.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
  let body: { title?: string; body?: string; route?: string; dry_run?: boolean; audience?: any };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const title = String(body.title ?? '').trim();
  const message = String(body.body ?? '').trim();
  const route = body.route ? String(body.route).trim() : undefined;
  const dryRun = body.dry_run === true;
  const audience = body.audience ?? { mode: 'all' };

  if (audience.mode === 'users' && (audience.user_ids ?? []).filter(Boolean).length === 0) {
    return json({ error: 'No users selected' }, 400);
  }
  if (audience.below_version != null && !/^\d+\.\d+\.\d+$/.test(String(audience.below_version).trim())) {
    return json({ error: 'below_version must look like 1.4.11' }, 400);
  }
  if ((audience.platforms ?? []).some((p: string) => p !== 'ios' && p !== 'android')) {
    return json({ error: 'platforms may only contain ios/android' }, 400);
  }
  // dry_run only needs the audience count; a real send needs copy.
  if (!dryRun && (!title || !message)) {
    return json({ error: 'title and body are required' }, 400);
  }

  try {
    if (dryRun) {
      const recipients = await countRecipients(admin, audience);
      return json({ dry_run: true, recipients });
    }

    const recipients = await resolveRecipients(admin, audience);
    const stats = await sendToRecipients(admin, recipients, {
      title, body: message, route, source: 'admin_broadcast',
    });

    // Audit. tickets_ok = reached-or-pending (everything minus confirmed
    // failures) since "ok" receipts often aren't ready inside our poll window.
    await admin.from('broadcast_log').insert({
      admin_id: user.id,
      title,
      body: message,
      route: route ?? null,
      audience,
      recipients: stats.recipients,
      tickets_ok: stats.delivered + stats.pending,
      tickets_error: stats.failed,
    });
    await admin.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'broadcast_push',
      target_type: 'broadcast',
      metadata: { title, audience, ...stats },
    });

    return json({ ok: true, ...stats });
  } catch (err) {
    console.error('[admin-broadcast-push] failed', err);
    return json({ error: err?.message ?? 'Broadcast failed' }, 500);
  }
});
