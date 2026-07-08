import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Shared query cache. Screens render instantly from cache when revisited and
 * refresh in the background once data is older than staleTime — this is what
 * makes tab-to-tab navigation feel instant instead of showing a spinner on
 * every visit.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000,
            gcTime: 15 * 60_000,
            retry: 1,
        },
    },
});

// Map React Query's "window focus" to RN app foregrounding so stale data
// refreshes when the user returns to the app.
AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
    }
});

// A signed-out (or kicked) device must never show the previous account's
// cached numbers.
supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
        queryClient.clear();
    }
});
