/**
 * Render tests for the permission-priming onboarding screens:
 * app/onboarding-permission.tsx (foreground location),
 * app/onboarding-permission-background.tsx ("all the time" location) and
 * app/onboarding-notifications.tsx (push). Native deps are mocked; the real
 * flow helpers + PermissionPrimeMock run, so these exercise the priming copy,
 * the OS-mock coaching, the request wiring and the skip/advance routing.
 *
 * jest-expo runs as iOS by default, so the iOS mock variants are asserted.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Animated, Linking } from 'react-native';

// RN's Easing.bezier is broken under jest in this repo (`_bezier is not a
// function` the moment any timing animation starts), so neutralise the Animated
// composers — these tests assert content and wiring, not motion. Animated
// values stay real, elements just keep their initial opacity.
const noopAnimation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any;
beforeAll(() => {
    jest.spyOn(Animated, 'timing').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'sequence').mockReturnValue(noopAnimation);
    jest.spyOn(Animated, 'loop').mockReturnValue(noopAnimation);
});

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
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
import { awardBonus } from '@/lib/api/points';
import { recordOnboardingDeclined } from '@/lib/notificationPrompt';
import OnboardingPermissionScreen from '@/app/onboarding-permission';
import OnboardingPermissionBackgroundScreen from '@/app/onboarding-permission-background';
import OnboardingNotificationsScreen from '@/app/onboarding-notifications';

const asMock = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue(true);
});

describe('OnboardingPermissionScreen (foreground location)', () => {
    it('primes with the benefit copy and a mock of the OS dialog', async () => {
        render(<OnboardingPermissionScreen />);
        expect(screen.getByText('map.')).toBeTruthy();
        // The iOS sheet mock coaches the exact option to pick
        expect(screen.getByText('Allow While Using App')).toBeTruthy();
        expect(screen.getByText('Don’t Allow')).toBeTruthy();
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());
        expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('requests foreground on the CTA, awards the bonus and advances to the background page', async () => {
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ALLOW WHILE USING'));
        await waitFor(() =>
            expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-permission-background'),
        );
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
        expect(awardBonus).toHaveBeenCalledWith('location_permission');
    });

    it('skips past both location pages straight to the gym step', async () => {
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('Skip for now'));
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym');
    });

    it('auto-forwards when foreground is already granted: to background page, or gym if that is granted too', async () => {
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
        render(<OnboardingPermissionScreen />);
        await waitFor(() =>
            expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding-permission-background'),
        );

        mockRouter.replace.mockClear();
        asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
        render(<OnboardingPermissionScreen />);
        await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding-gym'));
    });
});

describe('OnboardingPermissionBackgroundScreen ("all the time")', () => {
    it('primes the Always upgrade with the OS-dialog mock', async () => {
        render(<OnboardingPermissionBackgroundScreen />);
        expect(screen.getByText('move.')).toBeTruthy();
        expect(screen.getByText('Change to Always Allow')).toBeTruthy();
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
        expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('requests background on the CTA and advances to gym when granted', async () => {
        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('SET TO ALWAYS'));
        await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym'));
        expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    });

    it('auto-forwards to gym when background is already granted', async () => {
        asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding-gym'));
    });

    it('is skippable without touching the OS request', async () => {
        render(<OnboardingPermissionBackgroundScreen />);
        await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('Skip for now'));
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym');
        expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    });
});

describe('OnboardingNotificationsScreen', () => {
    it('primes with the payoff push preview and the OS-dialog mock', async () => {
        render(<OnboardingNotificationsScreen />);
        expect(screen.getByText('earn.')).toBeTruthy();
        // The POWR push being opted into, plus the coached OS dialog
        expect(screen.getByText('Session recorded')).toBeTruthy();
        expect(screen.getByText('Allow')).toBeTruthy();
        expect(screen.getByText('Don’t Allow')).toBeTruthy();
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
        expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('fires the real ask from the CTA and advances, forwarding health-sync params', async () => {
        mockParams = { streakDays: '3', totalSessions: '5' };
        render(<OnboardingNotificationsScreen />);
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ENABLE ALERTS'));
        await waitFor(() =>
            expect(mockRouter.push).toHaveBeenCalledWith({
                pathname: '/onboarding-achievement',
                params: { streakDays: '3', totalSessions: '5' },
            }),
        );
        expect(mockRequestPermissions).toHaveBeenCalled();
    });

    it('still advances when the user denies the OS dialog, and starts the re-ask cool-off', async () => {
        mockRequestPermissions.mockResolvedValue(false);
        render(<OnboardingNotificationsScreen />);
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('ENABLE ALERTS'));
        await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
        expect(recordOnboardingDeclined).toHaveBeenCalled();
    });

    it('auto-forwards (and still registers the token) when permission is already granted', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' });
        mockParams = { streakDays: '2' };
        render(<OnboardingNotificationsScreen />);
        await waitFor(() =>
            expect(mockRouter.replace).toHaveBeenCalledWith({
                pathname: '/onboarding-achievement',
                params: { streakDays: '2' },
            }),
        );
        expect(mockRequestPermissions).toHaveBeenCalled();
    });

    it('switches the CTA to Settings when the OS dialog is burned, without advancing', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

        render(<OnboardingNotificationsScreen />);
        fireEvent.press(await screen.findByText('OPEN SETTINGS'));

        await waitFor(() => expect(openSettings).toHaveBeenCalled());
        // Never tries the dead OS dialog; the user has to come back from
        // settings (AppState listener) or skip.
        expect(mockRequestPermissions).not.toHaveBeenCalled();
        expect(mockRouter.push).not.toHaveBeenCalled();
        openSettings.mockRestore();
    });

    it('is skippable, forwards params untouched and records the decline for the re-ask', async () => {
        mockParams = { activeDays: '4' };
        render(<OnboardingNotificationsScreen />);
        await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());

        fireEvent.press(screen.getByText('Skip for now'));
        expect(mockRouter.push).toHaveBeenCalledWith({
            pathname: '/onboarding-achievement',
            params: { activeDays: '4' },
        });
        expect(mockRequestPermissions).not.toHaveBeenCalled();
        expect(recordOnboardingDeclined).toHaveBeenCalled();
    });
});
