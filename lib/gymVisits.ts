// Client half of the gym visit beacon.
//
// The device tells the server when a visit opens (it is provably awake then — it
// has just fired "You're in"), and the server holds the timers. At each threshold
// the server sends a SILENT push to wake this device, which then takes a fresh fix
// and decides for itself whether it is still inside the gym (see runVisitCheck in
// GeofenceContext). The server never credits on a timer — it can only ask.
//
// Every call here is best-effort and must never break the geofence flow: a visit
// beacon failing is a lost nudge, not a lost session. The existing exit path and
// pending-claim queue remain the backstop.

import { AppState, Platform } from 'react-native';
import { callWithAuthRetry } from '@/lib/authFresh';
import type { BgResult } from '@/lib/backgroundRest';
import { bgRpc, isTicketRejection, readBackgroundAuth, readDeviceTicket, ticketRpc } from '@/lib/backgroundRest';
import { withNetworkTimeout } from '@/lib/networkTimeout';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Nonce-authenticated wake path (2026-08-05).
//
// The beacon's nudge carries a short-lived, visit-scoped ticket; the RPCs below
// authenticate with THAT over a raw fetch + anon key, never the supabase
// client. Rationale: in a screen-off background process, any path through the
// client's auth machinery (getSession → lazy refresh → Keystore persistence)
// can freeze the wake forever — field-proven twice on 2026-08-05, server 200 in
// 276 ms while the client promise never settled. The wake fits ONE round-trip;
// the ticket makes the confirm that round-trip.
// ---------------------------------------------------------------------------

async function nonceRpc(fn: string, body: Record<string, unknown>, label: string): Promise<unknown> {
  const res = await withNetworkTimeout(fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  }), label);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text().catch(() => '');
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** Ticketed twin of logGymWakeReceived — same contract: fire-and-forget. */
export async function logGymWakeReceivedViaNonce(
  visitId: string,
  nonce: string,
  stage: 'dwell' | 'upgrade',
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await nonceRpc('log_gym_wake_received_v2', {
      p_visit_id: visitId, p_nonce: nonce, p_stage: stage, p_detail: detail,
    }, 'log_gym_wake_received_v2');
  } catch (err) {
    console.warn('[GymVisit] logGymWakeReceivedViaNonce failed:', err);
  }
}

/** Ticketed twin of confirmGymVisit: identical semantics and return shape,
 *  zero auth work. Server-side it delegates into confirm_gym_visit_v2's own
 *  logic, so every credit rule and idempotency guard is the same code. */
export async function confirmGymVisitViaNonce(
  visitId: string,
  nonce: string,
  inside: boolean,
  detail: Record<string, unknown> = {},
  requestCredit = false,
  entryAtMs?: number,
): Promise<{ ok: boolean; triggered?: string | null }> {
  try {
    const data = await nonceRpc('confirm_gym_visit_v3', {
      p_visit_id:       visitId,
      p_nonce:          nonce,
      p_inside:         inside,
      p_detail:         detail,
      p_request_credit: requestCredit,
      p_entry_at:       entryAtMs ? new Date(entryAtMs).toISOString() : null,
    }, 'confirm_gym_visit_v3');
    return { ok: true, triggered: noteConfirmOutcome(data, 'nonce confirm') };
  } catch (err) {
    console.error('[GymVisit] confirmGymVisitViaNonce FAILED — wake answered nothing:', err);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// The wake path's credential ladder (2026-08-07).
//
// Three transports, tried in order of how well each survives a screen-off,
// possibly-locked background process:
//
//   1. THE DEVICE TICKET. AsyncStorage, no keychain, no expiry inside a month,
//      no auth machinery. Minted in the foreground and bound to this
//      (user, device). This is the only one of the three that works on a phone
//      pocketed for an hour or locked in a pocket — which is every gym visit.
//   2. THE PERSISTED ACCESS TOKEN. Works, right up until it doesn't: one hour
//      of pocket time, or a locked keychain, and it is gone.
//   3. NOTHING — the caller falls through to supabase-js, whose auth machinery
//      is the freeze this whole file exists to route around. Reached only by an
//      install that has never had a foreground pass since the ticket shipped.
//
// A ticket the server REFUSES (expired, revoked, minted for a device that has
// since changed hands) falls through to 2 rather than failing the call, so a
// stale ticket is never worse than no ticket.
// ---------------------------------------------------------------------------
async function wakeRpc<T>(fn: string, args: Record<string, unknown>): Promise<BgResult<T> | null> {
  const ticket = await readDeviceTicket();
  if (ticket) {
    const res = await ticketRpc<T>(`${fn}_by_ticket`, args, ticket);
    if (!isTicketRejection(res.error)) return res;
    console.warn(`[GymVisit] ${fn}: the server refused this device's ticket — falling back to the persisted token.`);
  }

  const auth = await readBackgroundAuth();
  if (auth) return bgRpc<T>(fn, args, auth);

  return null;
}

// The four RPCs that carry real state (open/confirm/progress/close) run through
// callWithAuthRetry: fresh-session-first, one retry if auth-rejected. Elliot's
// 2026-08-05 visit died exactly here — ENTER detected, token family revoked the
// same second, open_gym_visit swallowed a 401 and the whole session vanished.
// The telemetry helpers stay bare fire-and-forget: they ride on the freshness
// the entry points establish, and must never spend the wake's budget.

/** Opens (or re-uses) the server-side visit record. Returns the visit id to store
 *  alongside the active geofence so later stages can reference it. */
export async function openGymVisit(
  partnerId: string,
  regionId: string | undefined,
  startedAtMs: number,
): Promise<string | null> {
  const args = {
    p_partner_id: partnerId,
    p_region_id:  regionId ?? null,
    p_started_at: new Date(startedAtMs).toISOString(),
    p_platform:   Platform.OS,
  };

  // THE call that must survive a screen-off wake. Everything downstream — every
  // nudge, every nonce, the server-side claim — hangs off this visit existing,
  // so when it freezes the whole session is lost with no second chance (that is
  // exactly what happened on 2026-08-06: entry detected and announced locally,
  // the app froze inside the auth resync, and no server visit was ever born).
  // Backgrounded, present the persisted token directly and skip auth entirely.
  //
  // A failure here does NOT fall through to the client path: the raw fetch is
  // the more reliable transport of the two, so a failure means the network is
  // genuinely unreachable, and retrying it through the freeze-prone path buys
  // nothing. The late-open retry in runVisitCheck covers the next wake.
  if (AppState.currentState !== 'active') {
    const res = await wakeRpc<string | null>('open_gym_visit', args);
    if (res) {
      if (res.error) {
        console.warn('[GymVisit] openGymVisit (background) failed:', res.error.message);
        return null;
      }
      return (res.data as string) ?? null;
    }
  }

  try {
    const { data, error } = await callWithAuthRetry(
      () => supabase.rpc('open_gym_visit', args), 'open_gym_visit',
    );
    if (error) throw error;
    return (data as string) ?? null;
  } catch (err) {
    console.warn('[GymVisit] openGymVisit failed:', err);
    return null;
  }
}

/** Records that a silent wake actually reached JS, BEFORE any GPS work.
 *
 *  Without this the only evidence of a wake was confirmed_inside/confirmed_outside —
 *  written by the very RPC being observed, and only after runVisitCheck has taken a
 *  fix. So "the task never ran" and "the task ran and the round-trip failed" were
 *  indistinguishable, which is how a dead iOS wake path survived 17 days and 175
 *  pushes. `wake_received` present + `confirmed_*` absent now means the round-trip
 *  failed; both absent means the push never woke us.
 *
 *  ⚠ Do NOT read `detail->>'via' = 'relay'` as a wake marker — claim-points stamps
 *  that on any x-resolve-token call, including the ordinary client dwell machine.
 *
 *  Fire-and-forget by contract: the wake has ~10 s mid-Doze and one guaranteed
 *  round-trip, and that round-trip belongs to confirmGymVisit, not to telemetry. */
export async function logGymWakeReceived(
  visitId: string,
  stage: 'dwell' | 'upgrade',
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await withNetworkTimeout(supabase.rpc('log_gym_wake_received', {
      p_visit_id: visitId,
      p_stage:    stage,
      p_detail:   detail,
    }), 'log_gym_wake_received');
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] logGymWakeReceived failed:', err);
  }
}

/** Records that a native region crossing reached JS — the check-in path's
 *  equivalent of logGymWakeReceived, and for the same reason.
 *
 *  The ENTER branch of the geofence task made no server calls at all, so when a
 *  backgrounded device failed to check in (2026-08-03: BOTH platforms, after a
 *  walk-out/walk-back-in) there was no way to tell "the OS never delivered the
 *  region ENTER" from "ENTER fired and the approach stream never produced an
 *  inside fix". Those need completely different fixes, so guessing was not an
 *  option. Fire-and-forget by contract: a region wake is a tight window, and
 *  telemetry must never spend the budget the check-in needs. */
export async function logGeofenceRegionEvent(
  regionId: string,
  event: 'enter' | 'exit' | 'approach_stream_on' | 'checked_in' | 'stream_start_failed'
    | 'armed' | 'sentinel_exit' | 'rearm_skipped' | 'auth_stale' | 'stream_switch_deferred'
    | 'sweep' | 'visit_stamp_relaxed' | 'visit_stamp_skipped' | 'coarse_rejected' | 'enter_scan'
    | 'location_revoked' | 'active_patch_refused' | 'exit_refuted' | 'wake_received',
  detail: Record<string, unknown> = {},
): Promise<void> {
  const args = {
    p_region_id: regionId,
    p_event:     event,
    p_platform:  Platform.OS,
    p_detail:    detail,
  };

  // Telemetry has to survive the same background conditions as the work it
  // describes, or the record goes blank exactly when something is going wrong.
  // Field, 2026-08-07: every one of these timed out at 30 s on a backgrounded
  // Android device — a dozen `log_geofence_region_event timed out after 30s`
  // warnings per wake — so the region-event trail simply stopped at 09:20 while
  // the device was checking in, claiming and confirming perfectly well over the
  // raw transport beside it. We were blind to a working system.
  if (AppState.currentState !== 'active') {
    const res = await wakeRpc('log_geofence_region_event', args);
    if (res) {
      if (res.error) console.warn('[GymVisit] logGeofenceRegionEvent (background) failed:', res.error.message);
      return;
    }
  }

  try {
    const { error } = await withNetworkTimeout(
      supabase.rpc('log_geofence_region_event', args), 'log_geofence_region_event',
    );
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] logGeofenceRegionEvent failed:', err);
  }
}

/** Logs the server's credit verdict from a confirm round-trip and returns the
 *  trigger, whichever transport carried the call. A decline is not an error: the
 *  session was already credited by another path, and the server advances the
 *  visit anyway so the beacon stops nudging a resolved visit. */
function noteConfirmOutcome(data: unknown, source: string): string | null | undefined {
  const triggered = (data as { triggered?: string | null } | null)?.triggered;
  const declined = (data as { declined?: string | null } | null)?.declined;
  if (triggered) {
    console.log(`[GymVisit] Server credit trigger fired from ${source}: ${triggered}.`);
  } else if (declined) {
    console.log(`[GymVisit] Server declined credit (${declined}) — visit resolved.`);
  }
  return triggered;
}

/** Reports what the device actually SAW when the server woke it. `inside` is the
 *  device's verdict from a real GPS fix — the only thing that can unlock a credit.
 *
 *  Returns whether the round-trip landed. It still never throws — a wake must not
 *  be able to crash the task — but the caller can no longer confuse "confirmed" with
 *  "swallowed an error", which was the second half of the blind spot above. */
export async function confirmGymVisit(
  visitId: string,
  inside: boolean,
  detail: Record<string, unknown> = {},
  requestCredit = false,
  /** The DEVICE's own entry time. The server otherwise derives the dwell decision
   *  solely from the visit row's started_at, so a device bound to a row that began
   *  long before its real check-in could credit immediately. Both clocks must now
   *  agree (`least()` server-side); omitting it keeps the old behaviour exactly. */
  entryAtMs?: number,
): Promise<{ ok: boolean; triggered?: string | null }> {
  const args = {
    p_visit_id:       visitId,
    p_inside:         inside,
    p_detail:         detail,
    p_request_credit: requestCredit,
    p_entry_at:       entryAtMs ? new Date(entryAtMs).toISOString() : null,
  };

  // This was the last state-carrying RPC still entering the auth machinery from
  // a wake: every ticketless background confirm (the presence sweep, a legacy
  // nudge, the exit backstop) went through callWithAuthRetry → getSession, and
  // field 2026-08-11 logged two of them timing out at 30 s behind a wedged auth
  // lock (auth_stale, reason confirm_gym_visit) while the stored token was
  // valid the whole time. Present the persisted token directly instead.
  //
  // ⚠ NOT wakeRpc: the DEVICE TICKET is deliberately excluded from confirms.
  // A confirm can carry the credit trigger, and the ticket's five-verbs-never-
  // a-point boundary (see lib/backgroundRest.ts) must hold. The persisted USER
  // token is the same identity supabase-js would present — only the transport
  // changes. A spent token falls through to the authed path, which remains the
  // only legitimate rotator; a transport failure does NOT fall through, because
  // the raw fetch is the more reliable of the two (openGymVisit's reasoning).
  if (AppState.currentState !== 'active') {
    const auth = await readBackgroundAuth();
    if (auth) {
      const { data, error } = await bgRpc('confirm_gym_visit_v2', args, auth);
      if (error) {
        console.error('[GymVisit] confirmGymVisit (background) FAILED — wake answered nothing:', error.message);
        return { ok: false };
      }
      return { ok: true, triggered: noteConfirmOutcome(data, 'confirm') };
    }
  }

  try {
    // v2 lets this single round-trip ALSO ask the server to credit the visit
    // (claim or upgrade, decided server-side from visit status + elapsed +
    // system_config). The FCM wake window fits ~one round-trip, and this is it —
    // the local claim chain behind it starved every time (field 2026-07-14).
    // Credit only ever follows p_inside=true, so "no fix, no credit" holds.
    const { data, error } = await callWithAuthRetry(() => supabase.rpc('confirm_gym_visit_v2', args), 'confirm_gym_visit');
    if (error) throw error;
    return { ok: true, triggered: noteConfirmOutcome(data, 'confirm') };
  } catch (err) {
    // Loud: a wake that reached JS but failed its one round-trip used to be
    // indistinguishable from a wake that never arrived. Pair with wake_received.
    console.error('[GymVisit] confirmGymVisit FAILED — wake answered nothing:', err);
    return { ok: false };
  }
}

/** Heartbeat: the in-gym location stream delivered a fix to JS. Deliberately NOT
 *  confirmGymVisit — that means location-PROVEN presence and bounds a late exit,
 *  and an indoor fix is usually too coarse to prove anything. This records only
 *  that the stream is alive, which is the one thing the server cannot otherwise
 *  see and the question behind every background-claim failure. */
export async function logGymVisitTick(
  visitId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const args = { p_visit_id: visitId, p_detail: detail };

  // Same reasoning as logGeofenceRegionEvent: a tick that only records itself
  // in the foreground is not a tick, it is a lie of omission.
  if (AppState.currentState !== 'active') {
    const res = await wakeRpc('log_gym_visit_tick', args);
    if (res) {
      if (res.error) console.warn('[GymVisit] logGymVisitTick (background) failed:', res.error.message);
      return;
    }
  }

  try {
    const { error } = await withNetworkTimeout(
      supabase.rpc('log_gym_visit_tick', args), 'log_gym_visit_tick',
    );
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] logGymVisitTick failed:', err);
  }
}

/** Records that a claim/upgrade actually landed. Called AFTER claim-points or
 *  upgrade-gym-tier succeeded — this cannot award anything itself. */
export async function markGymVisitProgress(
  visitId: string,
  stage: 'claimed' | 'upgraded',
  sessionId?: string,
): Promise<void> {
  const args = {
    p_visit_id:   visitId,
    p_stage:      stage,
    p_session_id: sessionId ?? null,
  };

  // Same background exposure as the close: this is called straight after a
  // claim lands, which on the dwell path happens on a wake. Freezing here tells
  // the beacon nothing landed, so it keeps nudging a visit that is already paid.
  //
  // A MARKER, NOT A CREDIT — it records a claim that some other path already
  // made, and can no more award a point over the ticket than it can over a JWT.
  if (AppState.currentState !== 'active') {
    const res = await wakeRpc('mark_gym_visit_progress', args);
    if (res) {
      if (res.error) console.warn('[GymVisit] markGymVisitProgress (background) failed:', res.error.message);
      return;
    }
  }

  try {
    const { error } = await callWithAuthRetry(
      () => supabase.rpc('mark_gym_visit_progress', args), 'mark_gym_visit_progress',
    );
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] markGymVisitProgress failed:', err);
  }
}

/** Closes the visit so the server stops nudging a device that has left. */
/** Returns TRUE only when the server has actually accepted the close.
 *
 *  It used to return void, so every failure — a ticket RPC error, a timed-out
 *  supabase-js fallback, a thrown network — was indistinguishable from success to
 *  the caller. finalizeActiveGeofence had already deleted ACTIVE_GEOFENCE_KEY by
 *  the time it called this, so a silent failure orphaned the visit permanently:
 *  server open, client with no record it ever existed, nothing left that could
 *  close it but the 12h abandon cron. Field 2026-08-07: a visit sat `upgraded`
 *  with ended_at null while the user stood 400 m away; opening the app did not
 *  help, because there was no local session left to finalize. The boolean is what
 *  lets the caller queue a retry instead of losing the visit. */
export async function closeGymVisit(visitId: string, endedAtMs?: number): Promise<boolean> {
  const args = {
    p_visit_id: visitId,
    p_ended_at: endedAtMs ? new Date(endedAtMs).toISOString() : null,
  };

  // The exit is a background event BY DEFINITION — the user has walked off with
  // the phone in a pocket, screen off — so this call meets exactly the frozen
  // auth resync that killed the entry open on 2026-08-06. A frozen close is not
  // cosmetic: the visit stays open forever, the beacon keeps nudging it, and the
  // server's "Session complete" push never fires because nothing ever closed it.
  //
  // It is also the call the expired-token gap hits hardest: an exit comes at the
  // END of a session, so by definition the phone has been pocketed for the whole
  // of it — an hour or more, which is exactly when the persisted token is spent.
  // Field 2026-08-07: every walk-out close that morning fell back to supabase-js
  // and timed out. This is what the ticket is for.
  if (AppState.currentState !== 'active') {
    const res = await wakeRpc('close_gym_visit', args);
    if (res) {
      if (res.error) {
        console.warn('[GymVisit] closeGymVisit (background) failed:', res.error.message);
        return false;
      }
      return true;
    }
    // res == null means "no ticket available", not "closed" — fall through to the
    // authed path rather than reporting a close that never happened.
  }

  try {
    const { error } = await callWithAuthRetry(
      () => supabase.rpc('close_gym_visit', args), 'close_gym_visit',
    );
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[GymVisit] closeGymVisit failed:', err);
    return false;
  }
}
