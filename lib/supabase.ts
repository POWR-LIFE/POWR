import * as SecureStore from 'expo-secure-store';
import { createClient, type User } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
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

/**
 * expo-secure-store has no web implementation, so `expo start --web` (used for
 * quick UI passes in a browser) crashed on the first session read. localStorage
 * is the supabase-js default on web; the keychain adapter stays for devices.
 */
const webStorageAdapter = {
    getItem: (key: string) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
    setItem: (key: string, value: string) => { globalThis.localStorage?.setItem(key, value); return Promise.resolve(); },
    removeItem: (key: string) => { globalThis.localStorage?.removeItem(key); return Promise.resolve(); },
};

/**
 * Where password-recovery emails land. We route through the public smart-link
 * page (https://powr.life/app) rather than a raw `powr://` scheme so the link is
 * tappable in every mail client and falls back to the store if the app isn't
 * installed. The page forwards the Supabase `?code=` into powr://reset-password.
 */
export const PASSWORD_RESET_REDIRECT = 'https://powr.life/app?to=reset-password';

/**
 * Where signup confirmation emails land, via the same smart-link page.
 *
 * Only used once "Confirm email" is enabled in Auth settings — until then
 * signup auto-confirms and no email is ever sent. Shipping the redirect (and
 * the /signup-confirmed route) ahead of that flip is deliberate: the setting
 * applies to every installed build the instant it's toggled, so the landing
 * has to already be out in the field before anyone turns it on.
 */
export const EMAIL_CONFIRM_REDIRECT = 'https://powr.life/app?to=signup-confirmed';

/** The storage adapter the auth client persists sessions through — exported so
 *  lib/authFresh.ts can re-read the LATEST persisted token pair. A long-lived JS
 *  runtime (headless geofence/notification contexts) never re-reads rotated
 *  tokens on its own: its in-memory session diverges from storage the moment any
 *  other runtime refreshes, and its next lazy refresh then presents the dead
 *  token — which GoTrue's reuse-detection answers by revoking the whole session
 *  family (field-proven 2026-08-05: token_revoked at the exact second of the
 *  first background wake, every subsequent write a silent 401). */
export const authStorage = Platform.OS === 'web' ? webStorageAdapter : secureStoreAdapter;

/** Pinned explicitly so authFresh's direct storage reads can never drift from
 *  what supabase-js actually uses (its default is derived the same way). */
export const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: authStorage,
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
    },
    global: {
        // Pin every sub-client (functions, postgrest, auth, storage) to RN's
        // native-backed global fetch. Left unset, each supabase-js sub-client
        // resolves a fetch on its own; the functions client's pick was the
        // prime suspect when claim-points invokes from the BACKGROUND never
        // left the device while REST calls on this same client landed fine
        // (three field captures, 2026-07-14).
        // (supabase's Fetch type also admits URL inputs; RN's fetch handles
        // them at runtime but types them out — hence the cast.)
        fetch: (input, init) => fetch(input as RequestInfo, init),
    },
});

/**
 * The signed-in user from the locally cached session — no network round-trip.
 *
 * Use this instead of `supabase.auth.getUser()` whenever you only need the
 * user's id (or to know someone is signed in): getUser() re-validates the JWT
 * against the auth server on every call, which added a serial HTTP hop in
 * front of nearly every data fetch in the app. Keep getUser() only where a
 * server-fresh user object matters (e.g. re-reading email after a change).
 */
export async function getSessionUser(): Promise<User | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
}

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
