/**
 * Render tests for the onboarding home-gym screen (app/onboarding-gym.tsx).
 *
 * Heavy/native deps (maps, location, image, vector-icons, router, the
 * Supabase-backed API + GeofenceContext functions) are mocked; the real pure
 * lib/onboarding/gym + flow helpers run, so this exercises the screen wiring
 * end-to-end: nearby load → select (persists home gym) → search → request → skip.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

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
    return { Ionicons: Icon, FontAwesome: Icon };
});

jest.mock('expo-image', () => {
    const React = require('react');
    const { View } = require('react-native');
    return { __esModule: true, Image: (props: any) => React.createElement(View, props) };
});

jest.mock('react-native-maps', () => {
    const React = require('react');
    const { View } = require('react-native');
    const MapView = React.forwardRef((props: any, ref: any) => {
        React.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
        return React.createElement(View, null, props.children);
    });
    const Marker = (props: any) => React.createElement(View, null, props.children);
    return { __esModule: true, default: MapView, Marker, PROVIDER_GOOGLE: 'google' };
});

jest.mock('expo-location', () => ({
    getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getLastKnownPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.12 } }),
    getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.12 } }),
    Accuracy: { Balanced: 3 },
}));

jest.mock('@/context/GeofenceContext', () => ({
    fetchNearbyGyms: jest.fn(),
    searchPartners: jest.fn(),
}));

jest.mock('@/lib/api/gyms', () => ({ createGymRequest: jest.fn().mockResolvedValue({ error: null }) }));
jest.mock('@/lib/api/user', () => ({ setPreferredGym: jest.fn().mockResolvedValue({ error: null }) }));

import { fetchNearbyGyms, searchPartners } from '@/context/GeofenceContext';
import { createGymRequest } from '@/lib/api/gyms';
import { setPreferredGym } from '@/lib/api/user';
import OnboardingGymScreen from '@/app/onboarding-gym';

// Minimal Partner shape the screen consumes.
function gym(over: { dbId: string; name: string; address?: string; lat?: number; lng?: number }) {
    return {
        id: `${over.dbId}-0`,
        dbId: over.dbId,
        name: over.name,
        description: '',
        category: 'Gym',
        status: 'open',
        address: over.address ?? '',
        area: '',
        pts: 0,
        distance: '',
        logoText: 'PG',
        logoUrl: undefined,
        logoBg: 'dark',
        logoLight: false,
        lat: over.lat ?? 51.5,
        lng: over.lng ?? -0.12,
        geofenceRadius: 25,
        isOpenNow: true,
    } as any;
}

const NEARBY = [
    gym({ dbId: 'g1', name: 'PureGym Shoreditch', address: 'Old St' }),
    gym({ dbId: 'g2', name: 'The Gym Aldgate', address: 'Aldgate' }),
];

beforeEach(() => {
    jest.clearAllMocks();
    (fetchNearbyGyms as jest.Mock).mockResolvedValue(NEARBY);
    (searchPartners as jest.Mock).mockResolvedValue([]);
    mockRouter.canGoBack.mockReturnValue(true);
});

describe('OnboardingGymScreen', () => {
    it('renders the heading, search box and request affordance', async () => {
        render(<OnboardingGymScreen />);
        expect(screen.getByText('home gym.')).toBeTruthy();
        expect(screen.getByPlaceholderText('Search for your gym')).toBeTruthy();
        expect(screen.getByText('Request it')).toBeTruthy();
        // let the nearby-load effect settle so its setState is inside act()
        await screen.findByText('PureGym Shoreditch');
    });

    it('loads nearby gyms from the user location fix', async () => {
        render(<OnboardingGymScreen />);
        expect(await screen.findByText('PureGym Shoreditch')).toBeTruthy();
        expect(screen.getByText('The Gym Aldgate')).toBeTruthy();
        expect(fetchNearbyGyms).toHaveBeenCalledWith(51.5, -0.12, 20);
    });

    it('persists the chosen gym as the home gym and flips the button to CONTINUE', async () => {
        render(<OnboardingGymScreen />);
        const row = await screen.findByText('PureGym Shoreditch');
        expect(screen.getByText('SKIP FOR NOW')).toBeTruthy();

        fireEvent.press(row);
        await waitFor(() => expect(setPreferredGym).toHaveBeenCalledWith('g1'));
        expect(screen.getByText('CONTINUE')).toBeTruthy();
    });

    it('runs a whole-DB search and shows the results', async () => {
        (searchPartners as jest.Mock).mockResolvedValue([gym({ dbId: 'g9', name: 'Barry’s Bank' })]);
        render(<OnboardingGymScreen />);
        await screen.findByText('PureGym Shoreditch');

        fireEvent.changeText(screen.getByPlaceholderText('Search for your gym'), 'barry');
        await waitFor(() => expect(searchPartners).toHaveBeenCalledWith('barry'));
        expect(await screen.findByText('Barry’s Bank')).toBeTruthy();
    });

    it('submits a gym request from the modal', async () => {
        render(<OnboardingGymScreen />);
        await screen.findByText('PureGym Shoreditch');

        fireEvent.press(screen.getByText('Request it'));
        const nameInput = await screen.findByPlaceholderText('Gym name');
        fireEvent.changeText(nameInput, 'My Local Box');
        fireEvent.changeText(screen.getByPlaceholderText('City or address (optional)'), 'Leeds');
        fireEvent.press(screen.getByText('SEND REQUEST'));

        await waitFor(() =>
            expect(createGymRequest).toHaveBeenCalledWith({ name: 'My Local Box', locationText: 'Leeds' }),
        );
        expect(await screen.findByText('Thanks!')).toBeTruthy();
    });

    it('advances to the health step when continuing/skipping', async () => {
        render(<OnboardingGymScreen />);
        await screen.findByText('PureGym Shoreditch');

        fireEvent.press(screen.getByText('SKIP FOR NOW'));
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-health');
    });
});
