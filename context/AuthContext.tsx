import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
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
