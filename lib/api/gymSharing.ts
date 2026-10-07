import { supabase } from '@/lib/supabase';

/**
 * "Share with <gym>": the member's own switch for showing their activity, by
 * name, to the gym they picked (its portal's member list, Clash Pro). Activity
 * only — never sleep, heart rate or location. Off unless switched on; tied to
 * that gym (picking another gym stops it). See migration
 * 20260924233000_gym_member_insights.
 */
export type GymSharing = {
  gym_id: string | null;
  gym_name: string | null;
  /** The gym has a POWR portal. No portal: nobody to share with, so no row. */
  portal: boolean;
  sharing: boolean;
  since: string | null;
  /**
   * "Let gyms see my visits": gyms on POWR's portal see the days and times
   * the member was checked in THERE, so staff notice if they stop coming
   * (Retention). On unless switched off (gym_visit_optouts); undefined from a
   * server without migration 20261007120000, and then the row hides.
   */
  visits?: boolean;
};

export async function getGymSharing(): Promise<GymSharing | null> {
  const { data, error } = await supabase.rpc('my_gym_sharing');
  if (error) return null;
  return (data as GymSharing) ?? null;
}

export async function setGymVisitSharing(on: boolean): Promise<GymSharing> {
  const { data, error } = await supabase.rpc('set_gym_visit_sharing', { p_on: on });
  if (error) throw new Error(error.message);
  return data as GymSharing;
}

export async function setGymSharing(on: boolean): Promise<GymSharing> {
  const { data, error } = await supabase.rpc('set_gym_activity_sharing', { p_on: on });
  if (error) throw new Error(error.message);
  return data as GymSharing;
}
