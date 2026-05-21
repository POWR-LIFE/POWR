import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

type AuthContextType = {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<{ error: string | null }>;
    signInWithApple: () => Promise<{ error: string | null }>;
    signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
    signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
    signOut: () => Promise<void>;
    markOnboardingComplete: () => Promise<{ error: string | null }>;
    updateUserMetadata: (data: Record<string, any>) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

    // Refs for the Realtime channel and the session_id this device owns.
    // Using refs (not state) avoids re-renders and stale-closure issues.
    const sessionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const currentSessionIdRef = useRef<string | null>(null);
    const registeringRef = useRef(false); // prevents concurrent registerAndWatchSession calls

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
                    // A different session_id means another device signed in — kick this one out now
                    if (incomingId && incomingId !== currentSessionIdRef.current) {
                        currentSessionIdRef.current = null;
                        supabase.auth.signOut();
                    }
                },
            )
            .subscribe();
        registeringRef.current = false;
    };

    const cleanupSessionWatch = () => {
        currentSessionIdRef.current = null;
        if (sessionChannelRef.current) {
            supabase.removeChannel(sessionChannelRef.current);
            sessionChannelRef.current = null;
        }
    };

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
            // Registration is handled by INITIAL_SESSION in onAuthStateChange below — no duplicate call needed
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            setSession(session);
            if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
                registerAndWatchSession(session);
            }
            if (!session) {
                cleanupSessionWatch();
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

        const tryExchangeCode = async (url: string) => {
            const code = extractCode(url);
            if (!code) return;
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

        return () => {
            subscription.unsubscribe();
            linkingSubscription.remove();
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
    ): Promise<{ error: string | null; needsConfirmation?: boolean }> => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { error: error.message };
        // Supabase returns a session immediately if email confirmation is disabled,
        // or a user with no session if confirmation is required.
        const needsConfirmation = !data.session;
        return { error: null, needsConfirmation };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
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
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
