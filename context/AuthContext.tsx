import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

type AuthContextType = {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<{ error: string | null }>;
    signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
    signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
    signOut: () => Promise<void>;
    markOnboardingComplete: () => Promise<void>;
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

        return () => subscription.unsubscribe();
    }, []);

    const signInWithGoogle = async (): Promise<{ error: string | null }> => {
        try {
            const redirectTo = Linking.createURL('/');
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo, skipBrowserRedirect: true },
            });
            if (error) return { error: error.message };
            if (!data.url) return { error: 'No OAuth URL returned' };

            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
            if (result.type === 'success') {
                const { error: sessionError } = await supabase.auth.exchangeCodeForSession(result.url);
                if (sessionError) return { error: sessionError.message };
            }
            // result.type === 'cancel' means user closed browser — not an error
            return { error: null };
        } catch (e: unknown) {
            return { error: e instanceof Error ? e.message : 'Unknown error' };
        }
    };

    const signInWithEmail = async (email: string, password: string): Promise<{ error: string | null }> => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
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

    const markOnboardingComplete = async () => {
        await supabase.auth.updateUser({ data: { onboarding_complete: true } });
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
