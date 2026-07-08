import { getSessionUser, supabase } from '@/lib/supabase';
import { buildGymRequestPayload, type GymRequestInput } from '@/lib/onboarding/gym';

/**
 * Creates a "please add my gym" request tied to the current user. Admins triage
 * these (status pending → added/rejected) alongside partner management. The row
 * is intentionally lightweight — just enough to find and add the gym.
 */
export async function createGymRequest(input: GymRequestInput): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };

    const built = buildGymRequestPayload(input, user.id);
    if (!built.row) return { error: built.error };

    const { error } = await supabase.from('gym_requests').insert(built.row);
    return { error: error?.message ?? null };
}
