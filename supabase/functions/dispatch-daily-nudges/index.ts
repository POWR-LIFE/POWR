// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Daily-nudge dispatcher (pg_cron, */15). Token-gated by the shared
// x-resolve-token cron secret (dispatch-scheduled-broadcasts pattern).
//
// Two nudges, one dispatcher:
//   streak_at_risk — users whose last active day is exactly yesterday-local,
//     pinged in their local 20:00–20:15 window so the warning lands with
//     hours (not minutes) left before their midnight.
//   daily_reminder — the long-declared type that never had a sender: users
//     who set a reminder time in Settings, pinged in the matching local
//     15-min window, only on days they haven't logged anything yet.
//
// Candidate selection is one SQL pass (nudge_dispatch_candidates — all the
// timezone math lives there). This function stays deliberately dumb: it just
// forwards each candidate to send-push-notification, which owns EVERY gate —
// admin kill-switch, the shared nudge budget (one nudge-class push per user
// per local day), user preference, streak recompute + min-streak floor, and
// push_send_log forensics. Duplicate cron overlap is therefore harmless: the
// second attempt logs a budget skip instead of double-pushing.

import { createClient } from '@supabase/supabase-js';

const CONCURRENCY = 10;

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const { data: candidates, error } = await admin.rpc('nudge_dispatch_candidates');
  if (error) {
    console.error('[dispatch-daily-nudges] candidates rpc failed', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const stats: Record<string, number> = { candidates: (candidates ?? []).length, sent: 0, skipped: 0, failed: 0 };
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const queue = [...(candidates ?? [])];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) break;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ target_user_id: c.user_id, type: c.kind, payload: {} }),
        });
        const body = await res.json().catch(() => null);
        if (body?.skipped) stats.skipped++;
        else if (res.ok) stats.sent++;
        else stats.failed++;
      } catch (err) {
        stats.failed++;
        console.warn(`[dispatch-daily-nudges] ${c.kind} → ${c.user_id} failed:`, err);
      }
    }
  });
  await Promise.all(workers);

  console.log('[dispatch-daily-nudges]', JSON.stringify(stats));
  return new Response(JSON.stringify({ ok: true, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
