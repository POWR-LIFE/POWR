// @ts-nocheck — Deno runtime, not Node.
// Reliable Expo delivery for the single-recipient / small-batch push paths
// (send-push-notification and anything else that fires a per-user push). Mirrors
// the batching + ticket-check + receipt-poll + dead-token pruning already proven
// in broadcastSend.ts, but takes PRE-BUILT Expo messages (each carrying its own
// `to` token) so the per-type copy/channel/priority stays with the caller.
//
// Latency contract: the initial POST + ticket read happens inline (one Expo
// round-trip, same cost as the old fire-and-forget send) and prunes any token
// Expo already knows is dead. The deeper receipt confirmation — which needs a
// few seconds of polling — is handed to EdgeRuntime.waitUntil so it runs AFTER
// the response is returned and never adds latency to the caller (claim-points
// awaits this before handing points back to the app).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH = 100; // Expo accepts up to 100 messages per request.

interface ExpoMessageLike {
  to: string;
  [k: string]: unknown;
}

// When provided, every message outcome is persisted to push_send_log so an
// individual user's delivery history (ticket + receipt) outlives the 24h edge
// log window and is visible in the admin panel. Logging is strictly
// best-effort: a log failure must never break the push path.
export interface PushLogContext {
  userId: string;
  type: string;
}

async function insertLogRows(admin, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await admin.from('push_send_log').insert(rows);
    if (error) console.error('[expoPush] send log insert failed', error);
  } catch (err) {
    console.error('[expoPush] send log insert failed', err);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pruneTokens(admin, tokens: string[]): Promise<number> {
  const dead = [...new Set(tokens.filter(Boolean))];
  if (dead.length === 0) return 0;
  try {
    await admin.from('user_push_tokens').delete().in('expo_push_token', dead);
    console.log(`[expoPush] pruned ${dead.length} dead token(s).`);
  } catch (err) {
    console.error('[expoPush] token prune failed', err);
    return 0;
  }
  return dead.length;
}

// Poll Expo receipts for the queued tickets and prune any DeviceNotRegistered
// that only surfaces at delivery time. Bounded (≈3 attempts) so it always ends.
// With `logging`, every receipt outcome — not just DeviceNotRegistered — is
// recorded onto the ticket's push_send_log row.
async function pollReceiptsAndPrune(admin, ticketToToken: Record<string, string>, logging = false): Promise<void> {
  const pending = new Set(Object.keys(ticketToToken));
  const dead = new Set<string>();
  for (let attempt = 0; attempt < 3 && pending.size > 0; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const ids of chunk([...pending], 1000)) {
      try {
        const res = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        const receipts = (json?.data ?? {}) as Record<string, { status?: string; message?: string; details?: { error?: string } }>;
        const acceptedIds: string[] = [];
        for (const id of Object.keys(receipts)) {
          const rec = receipts[id];
          // status:ok means delivered to the platform push service. Anything else
          // is a failure; DeviceNotRegistered is the only one we can act on (the
          // token is gone — prune it so it never wastes a send again).
          if (rec?.status === 'ok') {
            acceptedIds.push(id);
          } else {
            if (rec?.details?.error === 'DeviceNotRegistered') dead.add(ticketToToken[id]);
            if (logging) {
              try {
                await admin.from('push_send_log')
                  .update({
                    status: 'rejected',
                    error: rec?.details?.error ?? rec?.message ?? 'unknown_receipt_error',
                    receipt_checked_at: new Date().toISOString(),
                  })
                  .eq('ticket_id', id);
              } catch (err) {
                console.error('[expoPush] receipt log update failed', err);
              }
            }
          }
          pending.delete(id);
        }
        if (logging && acceptedIds.length > 0) {
          try {
            await admin.from('push_send_log')
              .update({ status: 'accepted', receipt_checked_at: new Date().toISOString() })
              .in('ticket_id', acceptedIds);
          } catch (err) {
            console.error('[expoPush] receipt log update failed', err);
          }
        }
      } catch (err) {
        console.error('[expoPush] receipt poll failed', err);
      }
    }
  }
  await pruneTokens(admin, [...dead]);
}

export interface DeliverResult {
  sent: number;    // messages handed to Expo
  queued: number;  // tickets Expo accepted (status:ok)
  failed: number;  // tickets Expo rejected outright
  pruned: number;  // tokens deleted from the ticket-level pass (inline)
}

// POST `messages` to Expo, read tickets, prune ticket-level DeviceNotRegistered
// inline, and schedule the receipt confirmation in the background. Returns the
// immediate (ticket) outcome; late delivery failures are handled out-of-band.
export async function deliverExpoMessages(admin, messages: ExpoMessageLike[], log?: PushLogContext): Promise<DeliverResult> {
  if (!messages || messages.length === 0) return { sent: 0, queued: 0, failed: 0, pruned: 0 };

  let queued = 0;
  let failed = 0;
  const deadNow: string[] = [];
  const ticketToToken: Record<string, string> = {};
  const logRows: Record<string, unknown>[] = [];

  const logRowFor = (msg: ExpoMessageLike) => ({
    user_id: log!.userId,
    type: log!.type,
    title: typeof msg.title === 'string' ? msg.title : null,
    body: typeof msg.body === 'string' ? msg.body : null,
    expo_push_token: msg.to,
  });

  for (const group of chunk(messages, BATCH)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(group),
      });
      const json = await res.json();
      const tickets = (json?.data ?? []) as Array<{ id?: string; status?: string; message?: string; details?: { error?: string } }>;
      tickets.forEach((ticket, i) => {
        const token = group[i]?.to;
        if (ticket?.status === 'ok') {
          queued++;
          if (ticket.id) ticketToToken[ticket.id] = token;
          if (log) logRows.push({ ...logRowFor(group[i]), status: 'queued', ticket_id: ticket.id ?? null });
          return;
        }
        failed++;
        if (ticket?.details?.error === 'DeviceNotRegistered' && token) deadNow.push(token);
        if (log) {
          logRows.push({
            ...logRowFor(group[i]),
            status: 'failed',
            error: ticket?.details?.error ?? ticket?.message ?? 'unknown_ticket_error',
          });
        }
      });
    } catch (err) {
      failed += group.length;
      console.error('[expoPush] send batch failed', err);
      if (log) {
        for (const msg of group) logRows.push({ ...logRowFor(msg), status: 'failed', error: String(err) });
      }
    }
  }

  if (log) await insertLogRows(admin, logRows);

  const prunedNow = await pruneTokens(admin, deadNow);

  // Confirm delivery + catch late DeviceNotRegistered without blocking the
  // caller. EdgeRuntime.waitUntil keeps the instance alive past the response;
  // if it isn't available (e.g. local invoke), fall back to fire-and-forget.
  if (Object.keys(ticketToToken).length > 0) {
    const bg = pollReceiptsAndPrune(admin, ticketToToken, log != null);
    try {
      // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime.
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(bg);
      } else {
        bg.catch(() => {});
      }
    } catch {
      bg.catch(() => {});
    }
  }

  return { sent: messages.length, queued, failed, pruned: prunedNow };
}
