// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Scheduled-broadcast dispatcher (pg_cron, ~every 15 min). Token-gated by the
// same x-resolve-token cron secret as resolve-shared-challenges (verified in
// Vault), so it's safe to expose without user auth.
//
// PER-USER LOCAL TIME delivery: a scheduled row's (send_date + send_local_time)
// is a wall-clock target. due_broadcast_dispatches() returns the (message, zone)
// pairs whose local target has now passed and that haven't been sent yet. For
// each pair we CLAIM it (insert the dispatch row — the unique constraint makes
// this idempotent against overlapping cron runs), then send to that message's
// audience intersected with the zone's users, then record the result. A row
// flips to 'sent' once every zone in the user base has a dispatch row.
import { createClient } from '@supabase/supabase-js';
import { resolveRecipients, sendToRecipients } from '../_shared/broadcastSend.ts';

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Token-gated (no user JWT — invoked by pg_cron). Reuses the shared cron
  // secret; verify_resolve_token compares against the Vault value.
  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const stats = { pairs: 0, sent: 0, recipients: 0, delivered: 0, failed: 0, pruned: 0, completed: 0 };

  // Zones currently present in the user base — used to decide completion.
  const { data: zoneCount } = await admin.rpc('broadcast_zone_count');
  const totalZones = Number(zoneCount ?? 1);

  // Due (message, timezone) pairs.
  const { data: due, error: dueErr } = await admin.rpc('due_broadcast_dispatches');
  if (dueErr) {
    console.error('[dispatch] due rpc failed', dueErr);
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500 });
  }

  // Cache message rows we touch so we only fetch each once.
  const msgCache: Record<string, any> = {};
  const touched = new Set<string>();

  for (const pair of due ?? []) {
    const msgId = pair.scheduled_broadcast_id;
    const tz = pair.timezone;
    stats.pairs++;

    // CLAIM this zone first. If the row already exists (a concurrent run or a
    // prior partial run already took it), the unique constraint rejects us and
    // we skip — guaranteeing each zone sends at most once.
    const { data: claim, error: claimErr } = await admin
      .from('scheduled_broadcast_dispatches')
      .insert({ scheduled_broadcast_id: msgId, timezone: tz })
      .select('id')
      .single();
    if (claimErr || !claim) continue;

    // Load (and cache) the message.
    let msg = msgCache[msgId];
    if (!msg) {
      const { data } = await admin
        .from('scheduled_broadcasts')
        .select('id, title, body, route, audience, status, campaign_id')
        .eq('id', msgId).single();
      msg = data;
      msgCache[msgId] = data;
    }
    if (!msg || msg.status === 'cancelled' || msg.status === 'sent') continue;

    // First zone for this message → mark it 'sending'.
    if (msg.status === 'scheduled') {
      await admin.from('scheduled_broadcasts')
        .update({ status: 'sending', updated_at: new Date().toISOString() })
        .eq('id', msgId);
      msg.status = 'sending';
    }
    touched.add(msgId);

    // Send to this zone's slice of the audience.
    try {
      const recipients = await resolveRecipients(admin, msg.audience ?? { mode: 'all' }, tz);
      let result = { recipients: 0, delivered: 0, failed: 0, pruned: 0, pending: 0, queued: 0 };
      if (recipients.length > 0) {
        result = await sendToRecipients(admin, recipients, {
          title: msg.title, body: msg.body, route: msg.route ?? undefined,
          source: 'scheduled_broadcast',
        });
      }
      await admin.from('scheduled_broadcast_dispatches')
        .update({
          recipients: result.recipients,
          delivered: result.delivered,
          failed: result.failed,
          pruned: result.pruned,
        })
        .eq('id', claim.id);

      stats.sent++;
      stats.recipients += result.recipients;
      stats.delivered += result.delivered;
      stats.failed += result.failed;
      stats.pruned += result.pruned;
    } catch (err) {
      console.error('[dispatch] send failed', msgId, tz, err);
    }
  }

  // Completion: a message is fully sent once it has a dispatch row for every
  // zone in the user base (the westernmost zone has finally fired).
  for (const msgId of touched) {
    const { data: rows } = await admin
      .from('scheduled_broadcast_dispatches')
      .select('recipients, delivered, failed, pruned')
      .eq('scheduled_broadcast_id', msgId);
    const dispatched = rows?.length ?? 0;
    if (dispatched >= totalZones) {
      const agg = (rows ?? []).reduce((a, r) => ({
        recipients: a.recipients + (r.recipients ?? 0),
        delivered: a.delivered + (r.delivered ?? 0),
        failed: a.failed + (r.failed ?? 0),
        pruned: a.pruned + (r.pruned ?? 0),
      }), { recipients: 0, delivered: 0, failed: 0, pruned: 0 });
      await admin.from('scheduled_broadcasts')
        .update({ status: 'sent', sent_at: new Date().toISOString(), stats: agg, updated_at: new Date().toISOString() })
        .eq('id', msgId);
      stats.completed++;
    }
  }

  return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } });
});
