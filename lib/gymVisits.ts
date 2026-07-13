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
import { supabase } from '@/lib/supabase';

/** Opens (or re-uses) the server-side visit record. Returns the visit id to store
 *  alongside the active geofence so later stages can reference it. */
export async function openGymVisit(
  partnerId: string,
  regionId: string | undefined,
  startedAtMs: number,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('open_gym_visit', {
      p_partner_id: partnerId,
      p_region_id:  regionId ?? null,
      p_started_at: new Date(startedAtMs).toISOString(),
      p_platform:   Platform.OS,
    });
    if (error) throw error;
    return (data as string) ?? null;
  } catch (err) {
    console.warn('[GymVisit] openGymVisit failed:', err);
    return null;
  }
}

/** Reports what the device actually SAW when the server woke it. `inside` is the
 *  device's verdict from a real GPS fix — the only thing that can unlock a credit. */
export async function confirmGymVisit(
  visitId: string,
  inside: boolean,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase.rpc('confirm_gym_visit', {
      p_visit_id: visitId,
      p_inside:   inside,
      p_detail:   detail,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] confirmGymVisit failed:', err);
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
    const { error } = await supabase.rpc('mark_gym_visit_progress', {
      p_visit_id:   visitId,
      p_stage:      stage,
      p_session_id: sessionId ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] markGymVisitProgress failed:', err);
  }
}

/** Closes the visit so the server stops nudging a device that has left. */
export async function closeGymVisit(visitId: string, endedAtMs?: number): Promise<void> {
  try {
    const { error } = await supabase.rpc('close_gym_visit', {
      p_visit_id: visitId,
      p_ended_at: endedAtMs ? new Date(endedAtMs).toISOString() : null,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[GymVisit] closeGymVisit failed:', err);
  }
}
