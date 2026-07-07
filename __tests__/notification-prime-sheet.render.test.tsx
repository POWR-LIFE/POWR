/**
 * Render tests for components/NotificationPrimeSheet.tsx — the primed
 * notification re-ask shown on Home at the first value moment. Verifies the
 * self-gating (permission / pacing / session / live-session deferral), both
 * modes (ask vs denied→Settings) and the record-keeping on each outcome.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Animated, Linking, Platform } from 'react-native';

// Same jest+RN Easing workaround as onboarding-permissions.render.test.tsx:
// neutralise the Animated composers (the mock's pointing hand starts a loop).
const noopAnimation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any;
beforeAll(() => {
    jest.spyOn(Animated, 'timing').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'sequence').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'loop').mockReturnValue(noopAnimation);
});

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = (props: any) => React.createElement(Text, null, props.name);
    return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
    notificationAsync: jest.fn().mockResolvedValue(undefined),
    NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));

const mockRequestPermissions = jest.fn();
jest.mock('@/context/NotificationsContext', () => ({
    useNotifications: () => ({ requestPermissions: mockRequestPermissions }),
}));

let mockActiveGeofence: object | null = null;
jest.mock('@/hooks/useActiveGeofence', () => ({
    useActiveGeofence: () => ({ activeGeofence: mockActiveGeofence }),
}));

jest.mock('@/lib/notificationPrompt', () => ({
    getNotificationPromptState: jest.fn(),
    hasAnyCompletedSession: jest.fn(),
    recordPromptDismissed: jest.fn().mockResolvedValue(undefined),
    recordPromptShown: jest.fn().mockResolvedValue(undefined),
    shouldShowNotificationPrompt: jest.fn(),
}));

import * as Notifications from 'expo-notifications';
import {
    getNotificationPromptState,
    hasAnyCompletedSession,
    recordPromptDismissed,
    recordPromptShown,
    shouldShowNotificationPrompt,
} from '@/lib/notificationPrompt';
import NotificationPrimeSheet from '@/components/NotificationPrimeSheet';

const asMock = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockActiveGeofence = null;
    asMock(Notifications.getPermissionsAsync).mockResolvedValue({
        status: 'undetermined',
        canAskAgain: true,
    });
    asMock(getNotificationPromptState).mockResolvedValue({
        lastPromptAt: null,
        dismissCount: 0,
        onboardingDeclinedAt: null,
    });
    asMock(shouldShowNotificationPrompt).mockReturnValue(true);
    asMock(hasAnyCompletedSession).mockResolvedValue(true);
    mockRequestPermissions.mockResolvedValue(true);
});

describe('NotificationPrimeSheet gating', () => {
    it('shows the primed ask at the value moment and records the showing', async () => {
        render(<NotificationPrimeSheet />);
        expect(await screen.findByText('ENABLE ALERTS')).toBeTruthy();
        expect(screen.getByText('silence.')).toBeTruthy();
        // Shows the branded preview of what alerts look like
        expect(screen.getByText('Session recorded')).toBeTruthy();
        expect(recordPromptShown).toHaveBeenCalled();
    });

    it('stays hidden when permission is already granted', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted',
            canAskAgain: false,
        });
        render(<NotificationPrimeSheet />);
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
        expect(recordPromptShown).not.toHaveBeenCalled();
    });

    it('stays hidden when pacing says no', async () => {
        asMock(shouldShowNotificationPrompt).mockReturnValue(false);
        render(<NotificationPrimeSheet />);
        await waitFor(() => expect(shouldShowNotificationPrompt).toHaveBeenCalled());
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
    });

    it('stays hidden before the first completed session', async () => {
        asMock(hasAnyCompletedSession).mockResolvedValue(false);
        render(<NotificationPrimeSheet />);
        await waitFor(() => expect(hasAnyCompletedSession).toHaveBeenCalledWith('user-1'));
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
        expect(recordPromptShown).not.toHaveBeenCalled();
    });

    it('defers while a gym session is live', async () => {
        mockActiveGeofence = { partnerName: 'PureGym' };
        render(<NotificationPrimeSheet />);
        // Permission is never even checked — the live session owns the screen.
        await waitFor(() => expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled());
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
    });
});

describe('NotificationPrimeSheet ask mode', () => {
    it('fires the real dialog from the CTA and hides on grant without counting a dismissal', async () => {
        render(<NotificationPrimeSheet />);
        fireEvent.press(await screen.findByText('ENABLE ALERTS'));

        await waitFor(() => expect(mockRequestPermissions).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('ENABLE ALERTS')).toBeNull());
        expect(recordPromptDismissed).not.toHaveBeenCalled();
    });

    it('counts a real-dialog deny as a dismissal and hides', async () => {
        mockRequestPermissions.mockResolvedValue(false);
        render(<NotificationPrimeSheet />);
        fireEvent.press(await screen.findByText('ENABLE ALERTS'));

        await waitFor(() => expect(recordPromptDismissed).toHaveBeenCalled());
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
    });

    it('records a dismissal on "Not now"', async () => {
        render(<NotificationPrimeSheet />);
        fireEvent.press(await screen.findByText('Not now'));

        await waitFor(() => expect(recordPromptDismissed).toHaveBeenCalled());
        expect(screen.queryByText('ENABLE ALERTS')).toBeNull();
    });
});

describe('NotificationPrimeSheet denied mode', () => {
    it('switches the CTA to Settings when the OS dialog is burned', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

        render(<NotificationPrimeSheet />);
        const cta = await screen.findByText('OPEN SETTINGS');
        expect(screen.getByText('Settings › POWR › Notifications')).toBeTruthy();

        fireEvent.press(cta);
        await waitFor(() => expect(openSettings).toHaveBeenCalled());
        // Never tries the dead OS dialog
        expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it('names the Android path to the toggle on Android', async () => {
        const osSpy = jest.replaceProperty(Platform, 'OS', 'android');
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });

        render(<NotificationPrimeSheet />);
        await screen.findByText('OPEN SETTINGS');
        expect(screen.getByText('App info › Notifications')).toBeTruthy();
        osSpy.restore();
    });
});
