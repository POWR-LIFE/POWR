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

import { Platform } from 'react-native';
import { withNetworkTimeout } from '@/lib/networkTimeout';
import { supabase } from '@/lib/supabase';

/** Opens (or re-uses) the server-side visit record. Returns the visit id to store
 *  alongside the active geofence so later stages can reference it. */
export async function openGymVisit(
  partnerId: string,
  regionId: string | undefined,
  startedAtMs: number,
): Promise<string | null> {
  try {
    const { data, error } = await withNetworkTimeout(supabase.rpc('open_gym_visit', {
      p_partner_id: partnerId,
      p_region_id:  regionId ?? null,
      p_started_at: new Date(startedAtMs).toISOString(),
      p_platform:   Platform.OS,
    }), 'open_gym_visit');
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
  try {
    // v2 lets this single round-trip ALSO ask the server to credit the visit
    // (claim or upgrade, decided server-side from visit status + elapsed +
    // system_config). The FCM wake window fits ~one round-trip, and this is it —
    // the local claim chain behind it starved every time (field 2026-07-14).
    // Credit only ever follows p_inside=true, so "no fix, no credit" holds.
    const { data, error } = await withNetworkTimeout(supabase.rpc('confirm_gym_visit_v2', {
      p_visit_id:       visitId,
      p_inside:         inside,
      p_detail:         detail,
      p_request_credit: requestCredit,
      p_entry_at:       entryAtMs ? new Date(entryAtMs).toISOString() : null,
    }), 'confirm_gym_visit');
    if (error) throw error;
    const triggered = (data as { triggered?: string | null } | null)?.triggered;
    const declined = (data as { declined?: string | null } | null)?.declined;
    if (triggered) {
      console.log(`[GymVisit] Server credit trigger fired from confirm: ${triggered}.`);
    } else if (declined) {
      // Not an error: the session was already credited by another path. The server
      // now advances the visit anyway so the beacon stops nudging a resolved visit.
      console.log(`[GymVisit] Server declined credit (${declined}) — visit resolved.`);
    }
    return { ok: true, triggered };
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
  try {
    const { error } = await withNetworkTimeout(supabase.rpc('log_gym_visit_tick', {
      p_visit_id: visitId,
      p_detail:   detail,
    }), 'log_gym_visit_tick');
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
  try {
    const { error } = await withNetworkTimeout(supabase.rpc('mark_gym_visit_progress', {
      p_visit_id:   visitId,
      p_stage:      stage,
      p_session_id: sessionId ?? null,
    }), 'mark_gym_visit_progress');
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] markGymVisitProgress failed:', err);
  }
}

/** Closes the visit so the server stops nudging a device that has left. */
export async function closeGymVisit(visitId: string, endedAtMs?: number): Promise<void> {
  try {
    const { error } = await withNetworkTimeout(supabase.rpc('close_gym_visit', {
      p_visit_id: visitId,
      p_ended_at: endedAtMs ? new Date(endedAtMs).toISOString() : null,
    }), 'close_gym_visit');
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] closeGymVisit failed:', err);
  }
}
