/**
 * Android-variant render tests for the permission-priming screens. jest-expo
 * runs as iOS by default and the sibling suite asserts the iOS mocks; here
 * Platform.OS is stubbed to 'android' (it's a getter, hence spyOn) to verify
 * Android users get the Android dialog mocks, the settings radio list, the
 * platform CTA labels and the battery-optimization follow-up.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Animated, Platform } from 'react-native';

const noopAnimation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any;
beforeAll(() => {
    jest.spyOn(Animated, 'timing').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'sequence').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'loop').mockReturnValue(noopAnimation);
    // Plain data property in RN 0.81, so replaceProperty (not a getter spy).
    jest.replaceProperty(Platform, 'OS', 'android');
});

// ── Mocks (same surface as the iOS suite) ────────────────────────────────────
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/GeometricBackground', () => {
    const React = require('react');
    const { View } = require('react-native');
    return { __esModule: true, default: () => React.createElement(View) };
});

jest.mock('@/components/MagicRings', () => {
    const React = require('react');
    const { View } = require('react-native');
    return { __esModule: true, default: () => React.createElement(View) };
});

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = (props: any) => React.createElement(Text, null, props.name);
    return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

jest.mock('expo-location', () => ({
    getForegroundPermissionsAsync: jest.fn(),
    getBackgroundPermissionsAsync: jest.fn(),
    requestForegroundPermissionsAsync: jest.fn(),
    requestBackgroundPermissionsAsync: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn(),
}));

jest.mock('@/lib/api/points', () => ({
    awardBonus: jest.fn().mockResolvedValue({ earned: 20 }),
}));

jest.mock('@/lib/batteryOptimization', () => ({
    hasPromptedBatteryOptimization: jest.fn().mockResolvedValue(true),
    markBatteryOptimizationPrompted: jest.fn().mockResolvedValue(undefined),
    requestBatteryOptimizationExemption: jest.fn().mockResolvedValue(undefined),
}));

const mockRequestPermissions = jest.fn();
jest.mock('@/context/NotificationsContext', () => ({
    useNotifications: () => ({ requestPermissions: mockRequestPermissions }),
}));

jest.mock('@/lib/notificationPrompt', () => ({
    recordOnboardingDeclined: jest.fn().mockResolvedValue(undefined),
}));

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
    hasPromptedBatteryOptimization,
    requestBatteryOptimizationExemption,
} from '@/lib/batteryOptimization';
import OnboardingPermissionScreen from '@/app/onboarding-permission';
import OnboardingPermissionBackgroundScreen from '@/app/onboarding-permission-background';
import OnboardingNotificationsScreen from '@/app/onboarding-notifications';

const asMock = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(hasPromptedBatteryOptimization).mockResolvedValue(true);
    mockRequestPermissions.mockResolvedValue(true);
});

describe('foreground location screen on Android', () => {
    it('shows the Android dialog mock with the accuracy selector and coaches "While using the app"', async () => {
        render(<OnboardingPermissionScreen />);
        expect(screen.getByText('Allow POWR to access this device’s location?')).toBeTruthy();
        expect(screen.getByText('While using the app')).toBeTruthy();
        expect(screen.getByText('Only this time')).toBeTruthy();
        expect(screen.getByText('Precise')).toBeTruthy();
        expect(screen.getByText('Approximate')).toBeTruthy();
        expect(screen.getByText('ALLOW LOCATION')).toBeTruthy();
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());
    });

    it('advances to the background page on a precise grant without nagging', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({
            status: 'granted',
            canAskAgain: true,
            android: { accuracy: 'fine' },
        });
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW LOCATION'));
        await waitFor(() =>
            expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-permission-background'),
        );
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('steers an "Approximate" grant back to Precise via a re-shown dialog', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({
            status: 'granted',
            canAskAgain: true,
            android: { accuracy: 'coarse' },
        });
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW LOCATION'));
        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(
                'Turn on Precise location',
                expect.any(String),
                expect.any(Array),
            ),
        );
        // Not advanced yet — the nudge owns the moment
        expect(mockRouter.push).not.toHaveBeenCalled();

        // "Fix it" re-fires the OS dialog (selector re-shown), then advances
        const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
        await buttons.find((b) => b.text === 'Fix it')!.onPress!();
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-permission-background');
        alertSpy.mockRestore();
    });

    it('lets the user continue with Approximate via "Later"', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({
            status: 'granted',
            canAskAgain: false,
            android: { accuracy: 'coarse' },
        });
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW LOCATION'));
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());

        const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
        await buttons.find((b) => b.text === 'Later')!.onPress!();
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-permission-background');
        alertSpy.mockRestore();
    });
});

describe('background location screen on Android', () => {
    it('shows the settings radio-list mock coaching "Allow all the time"', async () => {
        render(<OnboardingPermissionBackgroundScreen />);
        expect(screen.getByText('Location permission')).toBeTruthy();
        expect(screen.getByText('Location access for this app')).toBeTruthy();
        expect(screen.getByText('Allow all the time')).toBeTruthy();
        expect(screen.getByText('Allow only while using the app')).toBeTruthy();
        expect(screen.getByText('ALLOW ALL THE TIME')).toBeTruthy();
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    });

    it('requests background and continues to gym (battery ask already handled)', async () => {
        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW ALL THE TIME'));
        await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym'));
        expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    });

    it('offers the battery-optimization exemption once on its primed page, then continues to gym', async () => {
        asMock(hasPromptedBatteryOptimization).mockResolvedValue(false);

        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW ALL THE TIME'));

        // The primed page takes over — the same surface every other permission
        // in the journey gets, not a system alert.
        expect(await screen.findByText('ALLOW UNRESTRICTED')).toBeTruthy();
        expect(screen.getByText('sleep on it.')).toBeTruthy();
        expect(screen.getByText('Ignore battery optimisations?')).toBeTruthy();
        // It owns the moment — the journey waits for an answer.
        expect(mockRouter.push).not.toHaveBeenCalled();

        fireEvent.press(screen.getByText('ALLOW UNRESTRICTED'));
        await waitFor(() => expect(requestBatteryOptimizationExemption).toHaveBeenCalled());
        await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym'));
    });

    it('continues to gym when the battery page is skipped with "Not now"', async () => {
        asMock(hasPromptedBatteryOptimization).mockResolvedValue(false);

        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW ALL THE TIME'));
        fireEvent.press(await screen.findByText('Not now'));

        await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym'));
        expect(requestBatteryOptimizationExemption).not.toHaveBeenCalled();
    });
});

describe('notifications screen on Android', () => {
    it('shows the payoff push preview and the Android 13+ dialog mock', async () => {
        render(<OnboardingNotificationsScreen />);
        expect(screen.getByText('Session recorded')).toBeTruthy();
        expect(screen.getByText('Allow POWR to send you notifications?')).toBeTruthy();
        expect(screen.getByText('Allow')).toBeTruthy();
        expect(screen.getByText('Don’t allow')).toBeTruthy();
        expect(screen.getByText('ENABLE ALERTS')).toBeTruthy();
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
    });

    it('auto-skips when the OS granted at install (Android 12 and below)', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' });
        render(<OnboardingNotificationsScreen />);
        await waitFor(() =>
            expect(mockRouter.replace).toHaveBeenCalledWith({
                pathname: '/onboarding-achievement',
                params: {},
            }),
        );
        expect(mockRequestPermissions).toHaveBeenCalled();
    });
});
