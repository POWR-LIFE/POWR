import { supabase } from '@/lib/supabase';

/**
 * Triggers the value-led welcome email for the signed-in user.
 *
 * Fire-and-forget: call once onboarding completes. The edge function gathers
 * the user's name, referral code and signup-journey actions (location,
 * wearable) server-side, and is idempotent — it only ever sends once per user.
 */
export async function sendWelcomeEmail(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase.functions.invoke('send-welcome-email', {
        headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw error;
}
