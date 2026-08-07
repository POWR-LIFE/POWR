import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMAIL_CONFIRM_REDIRECT, supabase } from '@/lib/supabase';
import { claimDevice, confirmDeviceTransfer } from '@/lib/deviceLock';
import { reportLocationPermission } from '@/lib/locationPermission';
import TransferDeviceSheet from '@/components/TransferDeviceSheet';

type AuthContextType = {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<{ error: string | null }>;
    signInWithApple: () => Promise<{ error: string | null }>;
    signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
    signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation?: boolean; alreadyRegistered?: boolean }>;
    signOut: () => Promise<void>;
    markOnboardingComplete: () => Promise<{ error: string | null }>;
    updateUserMetadata: (data: Record<string, any>) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** How long the launch session read gets before the app gives up and renders
 *  the signed-out state. Sits in front of FIRST PAINT, so it is deliberately
 *  far tighter than lib/networkTimeout's 30 s background bound: a warm keychain
 *  read is single-digit milliseconds, and anything past a few seconds is a wedge
 *  rather than a slow device. INITIAL_SESSION still delivers a late session. */
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

/**
 * Decode the session_id claim from a Supabase JWT without external deps.
 * The session_id uniquely identifies the auth.sessions row for this login.
 */
function getJwtSessionId(accessToken: string): string | null {
    try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        return (payload as { session_id?: string }).session_id ?? null;
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    // Device-transfer confirmation sheet: shown when claim_device reports
    // 'transfer_available' (account is on another recently-seen device). Null =
    // hidden. The pending session is held signed-in behind the sheet until the
    // user chooses; "Not now" then signs it out locally.
    const [transferPrompt, setTransferPrompt] = useState<
        { fromPlatform?: string | null; fromLastSeen?: string | null } | null
    >(null);
    const [transferBusy, setTransferBusy] = useState(false);

    // Refs for the Realtime channel and the session_id this device owns.
    // Using refs (not state) avoids re-renders and stale-closure issues.
    const sessionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const currentSessionIdRef = useRef<string | null>(null);
    const registeringRef = useRef(false); // prevents concurrent registerAndWatchSession calls
    const forcedSignOutRef = useRef(false); // set when another device kicked us, so we can explain why
    const deviceLockedRef = useRef(false); // set when this device is already bound to a different account
    const deviceLockReasonRef = useRef<'locked' | 'rate_limited'>('locked'); // why we blocked, for the SIGNED_OUT copy
    const deviceCheckedSessionRef = useRef<string | null>(null); // session we've already run the device-lock check for
    const sessionUserRef = useRef<string | null>(null); // current user id for listeners that outlive the auth closure

    /**
     * Upserts this device's session_id into user_active_sessions, overwriting any
     * previous entry, then subscribes to Realtime on that row.  If another device
     * later overwrites the row (i.e. a new login), we detect the changed session_id
     * and immediately force a local sign-out.
     */
    const registerAndWatchSession = async (activeSession: Session) => {
        const sessionId = getJwtSessionId(activeSession.access_token);
        if (!sessionId) return;

        // Already tracking this exact session, or a registration is already in progress — nothing to do
        if (currentSessionIdRef.current === sessionId) return;
        if (registeringRef.current) return;
        registeringRef.current = true;
        currentSessionIdRef.current = sessionId;

        // Stamp this session as the single active one for the user
        await supabase
            .from('user_active_sessions')
            .upsert(
                { user_id: activeSession.user.id, session_id: sessionId, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' },
            );

        // Replace any stale subscription before creating a new one.
        // Await removal so Supabase fully clears the internal channel cache before
        // we create a new one — prevents "cannot add listeners after subscribe()" errors.
        if (sessionChannelRef.current) {
            await supabase.removeChannel(sessionChannelRef.current);
            sessionChannelRef.current = null;
        }

        // Unique channel name per registration so Supabase never returns a cached
        // already-subscribed instance when TOKEN_REFRESHED fires a new session ID.
        sessionChannelRef.current = supabase
            .channel(`single-device:${activeSession.user.id}:${sessionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_active_sessions',
                    filter: `user_id=eq.${activeSession.user.id}`,
                },
                (payload) => {
                    const incomingId = (payload.new as { session_id?: string })?.session_id;
                    // A different session_id means another device signed in — kick this one out now.
                    // Local scope only: the default 'global' would revoke EVERY session for the
                    // user — including the new device that just signed in — so the device the
                    // user is actively using would silently log out at its next token refresh.
                    // Server-side revocation of old sessions is enforceOneSession's job.
                    if (incomingId && incomingId !== currentSessionIdRef.current) {
                        currentSessionIdRef.current = null;
                        forcedSignOutRef.current = true;
                        supabase.auth.signOut({ scope: 'local' });
                    }
                },
            )
            .subscribe();
        registeringRef.current = false;
    };

    /**
     * One-account-per-device. Bind this physical device to the signed-in user;
     * if it's already locked to a DIFFERENT account, sign this session straight
     * back out (the SIGNED_OUT branch shows the explanation). Runs once per
     * distinct session — not on every token refresh — and fails open, so a
     * transient RPC/network error can never lock a user out of their own account.
     */
    const enforceDeviceLock = async (activeSession: Session) => {
        const sessionKey = getJwtSessionId(activeSession.access_token) ?? activeSession.access_token;
        if (deviceCheckedSessionRef.current === sessionKey) return;
        deviceCheckedSessionRef.current = sessionKey;

        const res = await claimDevice();

        // 'transfer_available' — the account is on another recently-used device.
        // Don't sign out; hold the session and let the user confirm the move.
        if (res.status === 'transfer_available') {
            setTransferPrompt({ fromPlatform: res.from_platform, fromLastSeen: res.from_last_seen });
            return;
        }

        // 'rate_limited' — a transfer is warranted but the account is over its
        // self-transfer cap. Treat like locked (sign out + support message).
        if (res.status === 'locked' || res.status === 'rate_limited') {
            deviceLockedRef.current = true;
            deviceLockReasonRef.current = res.status;
            // Local scope: only this device is refused — signing in on a locked phone
            // must not revoke the user's legitimate sessions on their own devices.
            await supabase.auth.signOut({ scope: 'local' });
        }
    };

    /**
     * The user tapped "Move to this device" on the transfer sheet. Migrate the
     * binding to this device (server signs the old one out) and keep the session.
     * On a non-'ok' result (raced into 'locked', or over the cap) fall back to the
     * sign-out + explanation path.
     */
    const handleConfirmTransfer = async () => {
        if (transferBusy) return;
        setTransferBusy(true);
        try {
            const res = await confirmDeviceTransfer();
            if (res.status === 'ok') {
                setTransferPrompt(null);
                // Server revoked the old device's sessions; this one wins. Re-stamp
                // single-device ownership so our watcher tracks the right row.
                if (session) await enforceOneSession();
                return;
            }
            // Couldn't take the device — explain and sign this session out.
            deviceLockedRef.current = true;
            deviceLockReasonRef.current = res.status === 'rate_limited' ? 'rate_limited' : 'locked';
            setTransferPrompt(null);
            await supabase.auth.signOut({ scope: 'local' });
        } finally {
            setTransferBusy(false);
        }
    };

    /** "Not now" on the transfer sheet — back out to the login screen. */
    const handleCancelTransfer = async () => {
        setTransferPrompt(null);
        forcedSignOutRef.current = false; // this is a user choice, not a kick — no alert
        await supabase.auth.signOut({ scope: 'local' });
    };

    const cleanupSessionWatch = () => {
        currentSessionIdRef.current = null;
        if (sessionChannelRef.current) {
            supabase.removeChannel(sessionChannelRef.current);
            sessionChannelRef.current = null;
        }
    };

    useEffect(() => {
        // THE AUTH BOOTSTRAP MUST ALWAYS SETTLE. This `setLoading(false)` is the
        // ONLY one in the app, and app/index.tsx renders a bare ActivityIndicator
        // until it runs — so any path that skips it strands the user on a spinner
        // with no error, no timeout and no recovery short of force-quitting.
        //
        // It did exactly that (root-caused 2026-08-07). The call was a lone
        // .then() with no catch, no finally and no timeout, and it can fail two
        // ways that both look identical from here:
        //
        //  1. REJECTION — the keychain read throws on a locked device and
        //     supabase-js propagates it (see the long note in lib/supabase.ts).
        //     Fixed at the source there; this catch is the second line of
        //     defence, because a bootstrap that can only succeed is a bug
        //     regardless of which dependency happens to break next.
        //  2. NEVER SETTLING — getSession() awaits initializePromise and then
        //     _acquireLock. On React Native there is no navigator.locks, so
        //     auth-js falls back to lockNoOp and `lockAcquireTimeout` is dead
        //     code; the re-entrancy queue still makes every caller `await` the
        //     previous in-lock operation with NO bound. One frozen background
        //     auth call — the RN delivered-request/never-settled-response class
        //     documented in lib/networkTimeout.ts — therefore jams every
        //     subsequent auth call in the runtime, permanently.
        //
        // A timeout is what covers case 2, since there is nothing to catch.
        // Deliberately NOT withNetworkTimeout: that helper is the 30 s bound for
        // background writes, which is an eternity in front of first paint.
        //
        // Fails OPEN, to signed-out. onAuthStateChange's INITIAL_SESSION fires
        // independently and calls setSession itself, so a session that was
        // merely slow still lands and self-corrects — whereas failing shut would
        // reinstate the very hang this replaces.
        let settled = false;
        const settle = (nextSession: Session | null) => {
            if (settled) return;
            settled = true;
            setSession(nextSession);
            setLoading(false);
            // Registration is handled by INITIAL_SESSION in onAuthStateChange below — no duplicate call needed
        };
        const bootstrapTimeout = setTimeout(() => {
            if (settled) return;
            console.warn('[Auth] getSession() did not settle in 8s — starting signed out; INITIAL_SESSION will correct it if a session exists.');
            settle(null);
        }, AUTH_BOOTSTRAP_TIMEOUT_MS);
        supabase.auth.getSession()
            .then(({ data: { session } }) => settle(session))
            .catch((err) => {
                console.error('[Auth] getSession() rejected during bootstrap — starting signed out:', err);
                settle(null);
            })
            .finally(() => clearTimeout(bootstrapTimeout));

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            // Captured BEFORE sessionUserRef is overwritten below: by the time the
            // SIGNED_OUT branch runs, `session` is null and the departing user's id
            // is otherwise unrecoverable — and the geofence cleanup needs it to
            // stamp ownership on their unclaimed sessions.
            const departingUserId = sessionUserRef.current;
            setSession(session);
            sessionUserRef.current = session?.user?.id ?? null;
            if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
                registerAndWatchSession(session);
            }
            // Device-lock check on a fresh session only (a token refresh keeps the
            // same binding, so re-checking every hour would be wasted work).
            if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
                enforceDeviceLock(session);
                reportLocationPermission(session.user.id);
            }
            if (!session) {
                cleanupSessionWatch();
            }
            // SIGNED_OUT fires on manual sign-out, a token-refresh failure, or when the
            // single-device watcher revokes this device. In every case the user must leave
            // the authenticated stack — otherwise they're stranded on a now-userless screen
            // rendering placeholders ("?" avatar, "You" name). Send them back to the login
            // screen, and if another device kicked them out, say so.
            if (event === 'SIGNED_OUT') {
                // Geofence state is per-account and used to survive a sign-out: the
                // active session and the exit-claim outbox both carried no owner, so
                // the next account to sign in on this device inherited them. Fire
                // and forget — nothing here may delay the navigation below.
                import('@/context/GeofenceContext')
                    .then(({ clearGeofenceStateOnSignOut }) => clearGeofenceStateOnSignOut(departingUserId ?? undefined))
                    .catch(() => { /* non-fatal */ });

                const wasForced = forcedSignOutRef.current;
                const wasDeviceLocked = deviceLockedRef.current;
                const lockReason = deviceLockReasonRef.current;
                forcedSignOutRef.current = false;
                deviceLockedRef.current = false;
                deviceLockReasonRef.current = 'locked';
                deviceCheckedSessionRef.current = null;
                router.replace('/onboarding');
                if (wasDeviceLocked && lockReason === 'rate_limited') {
                    Alert.alert(
                        'Too many device changes',
                        'You’ve moved your POWR account between devices several times recently. To move it again, contact support and we’ll help you switch.',
                    );
                } else if (wasDeviceLocked) {
                    Alert.alert(
                        'This device is linked to another account',
                        'This phone is already tied to a different POWR account. Sign in with that account to continue. If you need to move this device to a new account, contact support.',
                    );
                } else if (wasForced) {
                    Alert.alert(
                        'Signed out',
                        'You signed in on another device. POWR allows one device at a time, so you were signed out here. Sign in again to keep using this device.',
                    );
                }
            }
        });

        // On Android, Chrome Custom Tabs can't navigate to custom schemes (powr://),
        // so the tab fires the system deep link intent instead of closing with a URL.
        // openAuthSessionAsync therefore returns 'cancel' and never exchanges the code.
        // This listener catches the incoming deep link and exchanges the code directly.
        const captureRef = (url: string) => {
            const m = url.match(/[?&]ref=([A-Z0-9]{6,10})/i);
            if (m) AsyncStorage.setItem('pending_referral_code', m[1].toUpperCase()).catch(() => {});
        };

        // Extract OAuth code using string slicing — new URL() can't parse custom schemes in RN.
        const extractCode = (url: string): string | null => {
            const m = url.match(/[?&]code=([^&#]+)/);
            return m ? decodeURIComponent(m[1]) : null;
        };

        // Guard against handling the same OAuth code twice — on Android both
        // getInitialURL() and the 'url' listener can deliver the launch URL, and a
        // cold-start deep link can re-deliver it. Re-exchanging would needlessly
        // re-run signOut(scope:others) and kick this user's other devices again,
        // which is a big contributor to the "logged out for no reason" reports.
        const handledCodes = new Set<string>();
        const tryExchangeCode = async (url: string) => {
            const code = extractCode(url);
            if (!code || handledCodes.has(code)) return;
            handledCodes.add(code);
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error) await supabase.auth.signOut({ scope: 'others' });
        };

        // On Android, the app may be cold-started by the deep link intent (e.g. low-memory kill).
        // In that case getInitialURL() delivers the URL, not addEventListener.
        Linking.getInitialURL().then(url => {
            if (url) {
                captureRef(url);
                tryExchangeCode(url);
            }
        }).catch(() => {});

        // On Android (warm resume), Chrome Custom Tabs fire the deep link as a system intent.
        // openAuthSessionAsync returns 'cancel'; this listener catches the URL and exchanges it.
        const linkingSubscription = Linking.addEventListener('url', async ({ url }) => {
            captureRef(url);
            await tryExchangeCode(url);
        });

        // Location permission changes happen in system Settings, so re-snapshot
        // when the app returns to the foreground — the report itself dedupes.
        const appStateSubscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' && sessionUserRef.current) {
                reportLocationPermission(sessionUserRef.current);
            }
        });

        return () => {
            clearTimeout(bootstrapTimeout);
            subscription.unsubscribe();
            linkingSubscription.remove();
            appStateSubscription.remove();
            cleanupSessionWatch();
        };
    }, []);

    /**
     * After any successful sign-in, invalidate all other sessions for this user.
     * This enforces single-device access: the new login wins, old sessions are
     * revoked server-side (their refresh tokens stop working).
     */
    const enforceOneSession = async () => {
        await supabase.auth.signOut({ scope: 'others' });
    };

    const signInWithApple = async (): Promise<{ error: string | null }> => {
        try {
            const credential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
            });
            if (!credential.identityToken) return { error: 'No identity token returned from Apple' };
            const { error } = await supabase.auth.signInWithIdToken({
                provider: 'apple',
                token: credential.identityToken,
            });
            if (error) return { error: error.message };
            await enforceOneSession();
            return { error: null };
        } catch (e: unknown) {
            // ERR_REQUEST_CANCELED = user dismissed the sheet — not an error
            if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { error: null };
            return { error: e instanceof Error ? e.message : 'Unknown error' };
        }
    };

    const signInWithGoogle = async (): Promise<{ error: string | null }> => {
        try {
            // Use the explicit custom scheme so the redirectTo is always powr:///
            // regardless of whether this is Expo Go, an EAS dev build, or production.
            // Supabase must have powr:// in its Additional Redirect URLs allowlist.
            const redirectTo = 'powr://auth-callback';
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo, skipBrowserRedirect: true },
            });
            if (error) return { error: error.message };
            if (!data.url) return { error: 'No OAuth URL returned' };

            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
            if (result.type === 'success') {
                // Extract just the code — GoTrue expects a raw code string, not a full URL.
                // Use string matching rather than new URL() which can't parse custom schemes in RN.
                const code = result.url.match(/[?&]code=([^&#]+)/)?.[1];
                if (code) {
                    const { error: sessionError } = await supabase.auth.exchangeCodeForSession(decodeURIComponent(code));
                    if (sessionError) return { error: sessionError.message };
                }
                await enforceOneSession();
            }
            // result.type === 'cancel' means user closed browser — not an error
            return { error: null };
        } catch (e: unknown) {
            return { error: e instanceof Error ? e.message : 'Unknown error' };
        }
    };

    const signInWithEmail = async (email: string, password: string): Promise<{ error: string | null }> => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) await enforceOneSession();
        return { error: error?.message ?? null };
    };

    const signUpWithEmail = async (
        email: string,
        password: string
    ): Promise<{ error: string | null; needsConfirmation?: boolean; alreadyRegistered?: boolean }> => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: EMAIL_CONFIRM_REDIRECT },
        });
        if (error) return { error: error.message };

        // Signing up with an address that already has an account (commonly one
        // created via Google/Apple) does NOT error — GoTrue returns a decoy user
        // with an empty `identities` array and sends no email, so the response
        // can't be used to enumerate accounts. Left untreated that looks exactly
        // like "confirmation required" and strands the user on a check-your-inbox
        // screen waiting for mail that will never arrive.
        // Guarded on the absent session too: a real signup that somehow reported
        // no identities would still be a real signup, and must not be diverted.
        if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
            return { error: null, alreadyRegistered: true };
        }

        // Supabase returns a session immediately if email confirmation is disabled,
        // or a user with no session if confirmation is required.
        const needsConfirmation = !data.session;
        return { error: null, needsConfirmation };
    };

    const signOut = async () => {
        // Navigation is handled centrally by the SIGNED_OUT branch in onAuthStateChange.
        await supabase.auth.signOut();
    };

    const markOnboardingComplete = async (): Promise<{ error: string | null }> => {
        const { error } = await supabase.auth.updateUser({ data: { onboarding_complete: true } });
        return { error: error?.message ?? null };
    };

    const updateUserMetadata = async (data: Record<string, any>): Promise<{ error: string | null }> => {
        const { error } = await supabase.auth.updateUser({ data });
        return { error: error?.message ?? null };
    };

    return (
        <AuthContext.Provider value={{
            session,
            user: session?.user ?? null,
            loading,
            signInWithGoogle,
            signInWithApple,
            signInWithEmail,
            signUpWithEmail,
            signOut,
            markOnboardingComplete,
            updateUserMetadata,
        }}>
            {children}
            <TransferDeviceSheet
                visible={transferPrompt !== null}
                fromPlatform={transferPrompt?.fromPlatform}
                fromLastSeen={transferPrompt?.fromLastSeen}
                busy={transferBusy}
                onConfirm={handleConfirmTransfer}
                onCancel={handleCancelTransfer}
            />
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
