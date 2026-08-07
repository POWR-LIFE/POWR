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
 * AFTER_FIRST_UNLOCK, not the default.
 *
 * expo-secure-store defaults to WHEN_UNLOCKED (kSecAttrAccessibleWhenUnlocked),
 * which means the token is READABLE ONLY WHILE THE PHONE IS UNLOCKED. Every
 * background wake on a locked device therefore failed to read the session with
 * iOS Keychain errSecInteractionNotAllowed — surfacing as:
 *
 *   Calling the 'getValueWithKeyAsync' function has failed
 *   → Caused by: User interaction is not allowed.
 *
 * Captured on a real device 2026-08-07 at the 30- and 40-minute dwell marks,
 * with the phone locked in a pocket. It is the cause of the long-standing
 * "locked iOS can miss check-in", it is why ensureFreshSession kept failing on
 * wakes, and — via the breadcrumb it left behind — it was the trigger for the
 * SIGABRT (see lib/authFresh.ts's import comment).
 *
 * AFTER_FIRST_UNLOCK stays readable in the background once the user has
 * unlocked the device at least once since boot, which is what a
 * geofencing app needs and is the standard setting for one.
 */
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } as const;

/** Set once the stored token has been rewritten under the new accessibility.
 *  Per launch, not persisted: the flag costs one Keychain write on the first
 *  successful read of each launch, and being wrong about it is far cheaper than
 *  a stale flag leaving a device permanently unable to work in the background. */
let accessibilityUpgraded = false;

/**
 * Adapter that stores auth tokens in the device's encrypted keychain/keystore
 * instead of unencrypted AsyncStorage. Prevents token extraction on
 * rooted/jailbroken devices.
 */
const secureStoreAdapter = {
    getItem: async (key: string) => {
        // A LOCKED KEYCHAIN MUST READ AS "SIGNED OUT", NEVER AS A THROW.
        //
        // This is the root of the iOS load hang (root-caused 2026-08-07). The
        // read throws errSecInteractionNotAllowed ("User interaction is not
        // allowed") whenever the item is unreadable — always before the first
        // unlock since boot, and on any install whose token was last written
        // under the old WHEN_UNLOCKED attribute (the heal below only runs after
        // a SUCCESSFUL read, so those devices never get there on their own).
        //
        // Nothing downstream catches it. supabase-js's getItemAsync
        // (auth-js/dist/main/lib/helpers.js) is a bare `await storage.getItem`,
        // and __loadSession / _useSession / getSession are all try/FINALLY with
        // no catch — so the throw propagates out of supabase.auth.getSession()
        // to whichever caller is unlucky enough to have no .catch(). That was
        // AuthContext's bootstrap, and a rejection there pinned `loading` true
        // for the life of the JS runtime.
        //
        // The trigger is UIBackgroundModes: remote-notification. A push launches
        // the app into the background while the phone is locked in a pocket; RN
        // boots the bundle and mounts the React tree invisibly; this read throws;
        // the runtime is wedged. The user then unlocks, taps the notification,
        // and foregrounds INTO that already-wedged runtime — which is exactly
        // why it looks like "the notification broke it" and why force-quitting
        // (a fresh runtime, device now unlocked) is what clears it.
        //
        // Returning null degrades to the signed-out state, which onAuthStateChange
        // corrects the moment auth is readable again. Failing open here is
        // strictly better than failing shut: the caller sees "no session yet",
        // not an exception it was never written to handle.
        let value: string | null = null;
        try {
            value = await SecureStore.getItemAsync(key, KEYCHAIN);
        } catch (err) {
            console.warn(`[supabase] keychain read for ${key} failed — treating as signed out:`, err);
            return null;
        }

        // HEAL EXISTING INSTALLS. iOS applies the accessibility attribute when
        // the item is WRITTEN, so setting the option above only helps tokens
        // saved from now on — every device already signed in would keep its
        // WHEN_UNLOCKED item and stay broken in the background forever. A read
        // that returned a value proves the device is unlocked right now, which
        // is exactly the moment the value can be rewritten. Fire-and-forget so
        // it never delays a sign-in, and reset the flag on failure so the next
        // read tries again.
        if (value != null && !accessibilityUpgraded) {
            accessibilityUpgraded = true;
            void SecureStore.setItemAsync(key, value, KEYCHAIN).catch(() => {
                accessibilityUpgraded = false;
            });
        }
        return value;
    },
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, KEYCHAIN),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key, KEYCHAIN),
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

/** For the nonce-authenticated wake path (lib/gymVisits.ts): raw fetch with the
 *  ANON key only, deliberately bypassing this client so a background wake can
 *  never touch auth machinery (lazy refresh + Keystore persistence — both
 *  freeze-prone in screen-off background processes, field-proven 2026-08-05).
 *  The anon key is public by design; the wake's authority is its nonce. */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

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
