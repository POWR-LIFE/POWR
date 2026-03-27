import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!window._supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('Supabase env vars not set — skipping client initialization');
    } else {
        console.log('--- Initializing Supabase Singleton ---');
        window._supabase = createClient(supabaseUrl, supabaseAnonKey);
    }
}

export const supabase = window._supabase;
