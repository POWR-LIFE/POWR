/**
 * Render tests for PermissionFixScreen — the primed permission-fixing modal
 * that Settings opens instead of bare OS alerts.
 *
 * Covers:
 *  - Route selection (ask vs settings) based on live permission state
 *  - CTA ask→settings fallthrough when the OS dialog is burned
 *  - AppState-driven auto-close once a grant lands (including the stricter
 *    "granted but still Approximate" case, which must NOT count as resolved)
 *  - Linking.openSettings rejection does not surface as an unhandled error
 *
 * These assert the iOS labels, which is what jest-expo runs as by default.
 * Android variants are deliberately not covered here: PermissionFixScreen
 * derives isIOS / ALWAYS / APP_SETTINGS_PATH at module load, so a Platform.OS
 * stub applied in beforeAll lands too late to reach them. (Harmless in the
 * app, where Platform.OS is fixed at startup.) The Android dialog mocks
 * themselves read Platform.OS per render and are covered in
 * onboarding-permissions.android.render.test.tsx.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Animated, AppState, Linking } from 'react-native';

// RN's Easing.bezier is broken under jest in this repo, so neutralise
// animation composers — these tests assert content and wiring, not motion.
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

jest.mock('@/components/GeometricBackground', () => {
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

jest.mock('expo-haptics', () => ({
    notificationAsync: jest.fn().mockResolvedValue(undefined),
    NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@/lib/batteryOptimization', () => ({
    requestBatteryOptimizationExemption: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/openAppSettings', () => ({
    openAppLocationSettings: jest.fn().mockResolvedValue(undefined),
}));

const mockRequestPermissions = jest.fn();
jest.mock('@/context/NotificationsContext', () => ({
    useNotifications: () => ({ requestPermissions: mockRequestPermissions }),
}));

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { openAppLocationSettings } from '@/lib/openAppSettings';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';
import PermissionFixScreen from '@/components/PermissionFixScreen';

const asMock = (fn: unknown) => fn as jest.Mock;

/**
 * Drives the "user came back from the settings app" moment.
 *
 * AppState is stubbed fresh for EVERY test rather than spied-and-restored:
 * mockRestore leaves a bare mock behind here, which returns no subscription and
 * blows up the screen's effect cleanup in whichever test renders next.
 */
let appStateHandler: (state: string) => void = () => {};
const appState = (state: string) => appStateHandler(state);

beforeEach(() => {
    jest.clearAllMocks();
    asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
    asMock(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue(true);

    appStateHandler = () => {};
    (AppState as any).addEventListener = jest.fn((_event: string, cb: (s: string) => void) => {
        appStateHandler = cb;
        return { remove: jest.fn() };
    });
});

// ── null / hidden state ───────────────────────────────────────────────────────

describe('PermissionFixScreen — null kind', () => {
    it('renders nothing when kind is null', () => {
        const { toJSON } = render(<PermissionFixScreen kind={null} onClose={jest.fn()} />);
        expect(toJSON()).toBeNull();
    });
});

// ── location (foreground) ─────────────────────────────────────────────────────

describe('PermissionFixScreen — location (foreground)', () => {
    it('shows the "ask" CTA and coaching copy when the OS dialog can still fire', async () => {
        render(<PermissionFixScreen kind="location" onClose={jest.fn()} />);
        expect(await screen.findByText('ALLOW WHILE USING')).toBeTruthy();
        expect(screen.getByText('map.')).toBeTruthy();
    });

    it('shows "OPEN SETTINGS" when the dialog is burned (canAskAgain false)', async () => {
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="location" onClose={jest.fn()} />);
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });

    it('requests foreground permission on the ask CTA and closes on grant', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location" onClose={onClose} />);

        fireEvent.press(await screen.findByText('ALLOW WHILE USING'));
        await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('falls through to "settings" route when the OS ask is denied and the dialog is burned', async () => {
        asMock(Location.requestForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="location" onClose={jest.fn()} />);

        fireEvent.press(await screen.findByText('ALLOW WHILE USING'));
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });

    it('opens location settings from the "settings" route CTA', async () => {
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="location" onClose={jest.fn()} />);

        fireEvent.press(await screen.findByText('OPEN SETTINGS'));
        await waitFor(() => expect(openAppLocationSettings).toHaveBeenCalled());
    });

    it('shows "Not now" skip label', async () => {
        render(<PermissionFixScreen kind="location" onClose={jest.fn()} />);
        expect(await screen.findByText('Not now')).toBeTruthy();
    });
});

// ── location-background ───────────────────────────────────────────────────────

describe('PermissionFixScreen — location-background', () => {
    it('shows the "SET TO ALWAYS" ask CTA on iOS (default)', async () => {
        render(<PermissionFixScreen kind="location-background" onClose={jest.fn()} />);
        expect(await screen.findByText('SET TO ALWAYS')).toBeTruthy();
        expect(screen.getByText('move.')).toBeTruthy();
    });

    it('switches to "settings" route on iOS when canAskAgain is false', async () => {
        asMock(Location.getBackgroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="location-background" onClose={jest.fn()} />);
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });

    it('requests background permission on the ask CTA and closes on grant', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location-background" onClose={onClose} />);

        fireEvent.press(await screen.findByText('SET TO ALWAYS'));
        await waitFor(() => expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('falls through to "settings" route on iOS when background ask is declined', async () => {
        asMock(Location.requestBackgroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="location-background" onClose={jest.fn()} />);

        fireEvent.press(await screen.findByText('SET TO ALWAYS'));
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });
});

// ── location-precise ──────────────────────────────────────────────────────────

describe('PermissionFixScreen — location-precise', () => {
    it('always takes the settings route — the OS will not re-prompt to sharpen accuracy', async () => {
        render(<PermissionFixScreen kind="location-precise" onClose={jest.fn()} />);
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
        expect(screen.getByText('count.')).toBeTruthy();
    });

    it('opens location settings from the CTA', async () => {
        render(<PermissionFixScreen kind="location-precise" onClose={jest.fn()} />);
        fireEvent.press(await screen.findByText('OPEN SETTINGS'));
        await waitFor(() => expect(openAppLocationSettings).toHaveBeenCalled());
    });

    it('stays open when location is granted but accuracy is still coarse', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location-precise" onClose={onClose} />);
        await screen.findByText('OPEN SETTINGS');

        // Granted is not enough — Approximate still voids every session.
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'granted',
            android: { accuracy: 'coarse' },
        });
        appState('active');

        await new Promise((r) => setTimeout(r, 50));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes once accuracy is fine', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location-precise" onClose={onClose} />);
        await screen.findByText('OPEN SETTINGS');

        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'granted',
            android: { accuracy: 'fine' },
        });
        appState('active');

        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

// ── location-ok ───────────────────────────────────────────────────────────────

describe('PermissionFixScreen — location-ok', () => {
    it('renders with "OPEN SETTINGS" CTA and "Done" skip label', async () => {
        render(<PermissionFixScreen kind="location-ok" onClose={jest.fn()} />);
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
        expect(screen.getByText('set.')).toBeTruthy();
        expect(screen.getByText('Done')).toBeTruthy();
    });
});

// ── notifications ─────────────────────────────────────────────────────────────

describe('PermissionFixScreen — notifications', () => {
    it('shows "ENABLE ALERTS" when the OS dialog can still fire', async () => {
        render(<PermissionFixScreen kind="notifications" onClose={jest.fn()} />);
        expect(await screen.findByText('ENABLE ALERTS')).toBeTruthy();
        expect(screen.getByText('earn.')).toBeTruthy();
    });

    it('shows "OPEN SETTINGS" when the dialog is burned', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        render(<PermissionFixScreen kind="notifications" onClose={jest.fn()} />);
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });

    it('calls requestPermissions on the ask CTA and closes on grant', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="notifications" onClose={onClose} />);

        fireEvent.press(await screen.findByText('ENABLE ALERTS'));
        await waitFor(() => expect(mockRequestPermissions).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('falls through to "settings" route when the ask is declined', async () => {
        mockRequestPermissions.mockResolvedValue(false);
        render(<PermissionFixScreen kind="notifications" onClose={jest.fn()} />);

        fireEvent.press(await screen.findByText('ENABLE ALERTS'));
        expect(await screen.findByText('OPEN SETTINGS')).toBeTruthy();
    });

    it('opens settings from the "settings" route CTA', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
        render(<PermissionFixScreen kind="notifications" onClose={jest.fn()} />);

        fireEvent.press(await screen.findByText('OPEN SETTINGS'));
        await waitFor(() => expect(openSettings).toHaveBeenCalled());
        openSettings.mockRestore();
    });

    it('swallows a Linking.openSettings rejection — does not surface as unhandled error', async () => {
        asMock(Notifications.getPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });
        const openSettings = jest
            .spyOn(Linking, 'openSettings')
            .mockRejectedValue(new Error('OS refused'));

        render(<PermissionFixScreen kind="notifications" onClose={jest.fn()} />);
        const cta = await screen.findByText('OPEN SETTINGS');

        // Must not throw — the rejection is swallowed by .catch(() => {})
        expect(() => fireEvent.press(cta)).not.toThrow();
        await waitFor(() => expect(openSettings).toHaveBeenCalled());
        openSettings.mockRestore();
    });
});

// ── battery ───────────────────────────────────────────────────────────────────

describe('PermissionFixScreen — battery', () => {
    it('renders the background-activity coaching copy and "ALLOW UNRESTRICTED" CTA', async () => {
        render(<PermissionFixScreen kind="battery" onClose={jest.fn()} />);
        expect(await screen.findByText('ALLOW UNRESTRICTED')).toBeTruthy();
        expect(screen.getByText('sleep on it.')).toBeTruthy();
    });

    it('calls requestBatteryOptimizationExemption and closes on the CTA', async () => {
        const onClose = jest.fn();
        render(<PermissionFixScreen kind="battery" onClose={onClose} />);

        fireEvent.press(await screen.findByText('ALLOW UNRESTRICTED'));
        await waitFor(() => expect(requestBatteryOptimizationExemption).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

// ── AppState auto-close ───────────────────────────────────────────────────────

describe('PermissionFixScreen — AppState auto-close', () => {
    it('closes when the permission is resolved on returning to the foreground', async () => {
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });

        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location" onClose={onClose} />);
        await screen.findByText('OPEN SETTINGS');

        // Simulate returning from OS settings with the permission now granted
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
        appState('active');

        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('stays open when the permission is still missing after returning to the foreground', async () => {
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });

        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location" onClose={onClose} />);
        await screen.findByText('OPEN SETTINGS');

        // Return to app without fixing the permission
        appState('active');

        await new Promise((r) => setTimeout(r, 50));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores non-active AppState transitions', async () => {
        // Burned at mount so the screen takes the settings route...
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
        });

        const onClose = jest.fn();
        render(<PermissionFixScreen kind="location" onClose={onClose} />);
        await screen.findByText('OPEN SETTINGS');

        // ...then granted, so a check WOULD resolve. Only 'active' may trigger
        // one, so backgrounding must leave the screen up.
        asMock(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' });
        appState('background');
        appState('inactive');

        await new Promise((r) => setTimeout(r, 50));
        expect(onClose).not.toHaveBeenCalled();
    });
});
