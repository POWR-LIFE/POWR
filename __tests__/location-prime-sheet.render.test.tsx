/**
 * LocationPrimeSheet — the at-venue trigger (2026-08-28): opening the app while
 * standing inside a partner venue on "While Using" shows the sheet at once,
 * named for the venue, regardless of the weekly calendar; the generic path is
 * untouched when no venue is detected.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn().mockResolvedValue(undefined), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }));
jest.mock('expo-location', () => ({
    getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied', canAskAgain: true }),
    requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock('@/components/onboarding/PermissionPrimeScene', () => { const { View } = require('react-native'); return () => <View />; });
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }), useAuthOptional: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useActiveGeofence', () => ({ useActiveGeofence: () => ({ activeGeofence: null }) }));
jest.mock('@/hooks/useGymRelevance', () => ({ useGymRelevance: () => true }));
jest.mock('@/lib/backgroundHealth', () => ({ isBackgroundHealthDismissedToday: jest.fn().mockResolvedValue(false), readBackgroundHealth: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/locationPermission', () => ({ reportLocationPermission: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/country', () => ({ reportUserCountry: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/notificationPrompt', () => ({ getNotificationPromptState: jest.fn(), shouldShowNotificationPrompt: jest.fn(() => false) }));
jest.mock('@/lib/gymVisits', () => ({ logGeofenceRegionEvent: jest.fn().mockResolvedValue(undefined) }));

const mockPromptState = { lastPromptAt: null as number | null, dismissCount: 0, onboardingDeclinedAt: null, fgLastPromptAt: null, fgDismissCount: 0, firstSeenDay: null, lastSeenDay: null, atVenueLastPromptAt: null as number | null };
jest.mock('@/lib/locationPrompt', () => {
    const actual = jest.requireActual('@/lib/locationPrompt');
    return {
        ...actual,
        isWhileUsingOnly: jest.fn().mockResolvedValue(true),
        getLocationPromptState: jest.fn(async () => ({ ...mockPromptState })),
        hasReachedLocationValueMoment: jest.fn().mockResolvedValue(false),
        recordAtVenuePromptShown: jest.fn().mockResolvedValue(undefined),
        recordLocationPromptShown: jest.fn().mockResolvedValue(undefined),
        recordLocationPromptDismissed: jest.fn().mockResolvedValue(undefined),
    };
});
let mockVenue: { partnerId: string; partnerName: string; distanceM: number } | null = null;
jest.mock('@/lib/venuePresence', () => ({ probeVenuePresence: jest.fn(async () => mockVenue) }));

import { logGeofenceRegionEvent } from '@/lib/gymVisits';
import { recordAtVenuePromptShown } from '@/lib/locationPrompt';
import LocationPrimeSheet from '@/components/LocationPrimeSheet';

beforeEach(() => {
    jest.clearAllMocks();
    mockVenue = null;
    mockPromptState.lastPromptAt = null;
    mockPromptState.atVenueLastPromptAt = null;
});

describe('LocationPrimeSheet at-venue trigger', () => {
    it('fires immediately, named for the venue, even though the weekly sheet showed an hour ago and there is no value moment', async () => {
        mockVenue = { partnerId: 'p1', partnerName: 'One LDN', distanceM: 12 };
        mockPromptState.lastPromptAt = Date.now() - 60 * 60 * 1000;
        render(<LocationPrimeSheet />);
        expect(await screen.findByText('YOU’RE AT ONE LDN')).toBeTruthy();
        expect(screen.getByText(/count by itself/)).toBeTruthy();
        expect(screen.getByText(/starting with this one/)).toBeTruthy();
        expect(recordAtVenuePromptShown).toHaveBeenCalled();
        expect(logGeofenceRegionEvent).toHaveBeenCalledWith('p1', 'venue_nudge', expect.objectContaining({ partner: 'One LDN', mode: 'ask' }));
    });

    it('stays hidden when the at-venue latch fired earlier today', async () => {
        mockVenue = { partnerId: 'p1', partnerName: 'One LDN', distanceM: 12 };
        mockPromptState.atVenueLastPromptAt = Date.now() - 10 * 60 * 1000;
        render(<LocationPrimeSheet />);
        await waitFor(() => expect(require('@/lib/venuePresence').probeVenuePresence).not.toHaveBeenCalled());
        expect(screen.queryByText(/count by itself/)).toBeNull();
    });

    it('falls back to the generic pacing when no venue is detected (no value moment → hidden)', async () => {
        render(<LocationPrimeSheet />);
        await waitFor(() => expect(require('@/lib/venuePresence').probeVenuePresence).toHaveBeenCalled());
        expect(screen.queryByText(/BACKGROUND LOCATION/)).toBeNull();
        expect(screen.queryByText(/count by itself/)).toBeNull();
    });
});
