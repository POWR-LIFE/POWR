import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

const FALLBACK_SUPABASE_URL = 'https://wjvvujnicwkruaeibttt.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_kh2lOAPJRrdykLLOR1QVxA_jj3H4CAL';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || FALLBACK_SUPABASE_ANON_KEY;

if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('[supabase] Missing EXPO_PUBLIC_SUPABASE_* env vars; using bundled fallback values. Configure EAS env for production builds.');
}

/**
 * Adapter that stores auth tokens in the device's encrypted keychain/keystore
 * instead of unencrypted AsyncStorage. Prevents token extraction on
 * rooted/jailbroken devices.
 */
const secureStoreAdapter = {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: secureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
    },
});

// Tells Supabase Auth to continuously refresh the session automatically if
// the app is in the foreground. When this is added, you will continue to receive
// `onAuthStateChange` events with the `TOKEN_REFRESHED` or `SIGNED_OUT` event
// if the user's session is terminated. This should only be registered once.
AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        supabase.auth.startAutoRefresh();
    } else {
        supabase.auth.stopAutoRefresh();
    }
});
