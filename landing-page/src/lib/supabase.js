import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!window._supabase) {
    console.log('--- Initializing Supabase Singleton ---');
    window._supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = window._supabase;
