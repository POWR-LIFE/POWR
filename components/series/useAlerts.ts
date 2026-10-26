import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { useNotifications } from '@/context/NotificationsContext';

/**
 * Whether this phone can get the Series pushes (your rival, someone passing
 * you, the round's moments), and a way to turn them on from the Series
 * itself. The automatic registration never asks, and Home's prime sheet only
 * re-asks people who once had a token, so someone who never had one would
 * otherwise never be asked. Here the ask sits next to the race it's for.
 */
export function useAlerts() {
    const { requestPermissions } = useNotifications();
    const [state, setState] = useState<{ granted: boolean; canAsk: boolean } | null>(null);

    const check = useCallback(async () => {
        if (Platform.OS === 'web') { setState({ granted: true, canAsk: false }); return; }
        try {
            const p = await Notifications.getPermissionsAsync();
            // iOS provisional delivery reaches the phone (quietly), so it counts.
            const provisional = p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
            setState({ granted: p.status === 'granted' || provisional, canAsk: p.status === 'undetermined' || p.canAskAgain });
        } catch {
            setState(null);
        }
    }, []);

    useEffect(() => {
        void check();
        // Back from system settings: pick up the new answer. (The notifications
        // provider re-registers a token-less phone on foreground by itself.)
        const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void check(); });
        return () => sub.remove();
    }, [check]);

    const enable = useCallback(async () => {
        if (state && !state.granted && !state.canAsk) {
            // Denied before: only the system settings can turn it back on.
            await Linking.openSettings().catch(() => undefined);
            return;
        }
        const ok = await requestPermissions().catch(() => false);
        if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await check();
    }, [check, requestPermissions, state]);

    return { needed: !!state && !state.granted, enable };
}
