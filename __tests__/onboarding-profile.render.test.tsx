/**
 * Render tests for the onboarding profile screen (app/onboarding-profile.tsx).
 *
 * Heavy/native deps (router, image, image-picker, vector-icons, AuthContext, the
 * Supabase-backed user API) are mocked; the real pure lib/onboarding/username +
 * flow helpers run, so this exercises prefill → auto-suggested handle →
 * availability gating → submit end-to-end.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

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

jest.mock('expo-image-picker', () => ({
    requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true }),
    launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true }),
}));

jest.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        session: { user: { email: 'jamie@powr.life', user_metadata: { full_name: 'Jamie Tester' } } },
    }),
}));

jest.mock('@/lib/api/user', () => ({
    fetchProfile: jest.fn().mockResolvedValue(null),
    isUsernameAvailable: jest.fn().mockResolvedValue({ available: true, error: null }),
    updateProfile: jest.fn().mockResolvedValue({ error: null }),
    uploadAvatar: jest.fn().mockResolvedValue({ url: 'https://x/a.jpg', error: null }),
}));

import { fetchProfile, isUsernameAvailable, updateProfile } from '@/lib/api/user';
import OnboardingProfileScreen from '@/app/onboarding-profile';

beforeEach(() => {
    jest.clearAllMocks();
    (fetchProfile as jest.Mock).mockResolvedValue(null);
    (isUsernameAvailable as jest.Mock).mockResolvedValue({ available: true, error: null });
    (updateProfile as jest.Mock).mockResolvedValue({ error: null });
});

describe('OnboardingProfileScreen', () => {
    it('renders the heading, name + username fields and avatar hint', async () => {
        render(<OnboardingProfileScreen />);
        expect(screen.getByText('name.')).toBeTruthy();
        expect(screen.getByPlaceholderText('Your name')).toBeTruthy();
        expect(screen.getByPlaceholderText('username')).toBeTruthy();
        expect(screen.getByText('Add a photo (optional)')).toBeTruthy();
        // settle the prefill effect inside act()
        await screen.findByDisplayValue('Jamie Tester');
    });

    it('prefills the name from OAuth and auto-suggests an available username', async () => {
        render(<OnboardingProfileScreen />);
        expect(await screen.findByDisplayValue('Jamie Tester')).toBeTruthy();
        await waitFor(() => expect(screen.getByDisplayValue('jamietester')).toBeTruthy());
        expect(isUsernameAvailable).toHaveBeenCalledWith('jamietester');
    });

    it('saves the profile and advances to the permission step', async () => {
        render(<OnboardingProfileScreen />);
        await screen.findByDisplayValue('jamietester');

        fireEvent.press(screen.getByText('CONTINUE'));

        await waitFor(() =>
            expect(updateProfile).toHaveBeenCalledWith({
                display_name: 'Jamie Tester',
                username: 'jamietester',
            }),
        );
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-permission');
    });

    it('blocks continue on a taken username', async () => {
        render(<OnboardingProfileScreen />);
        await screen.findByDisplayValue('jamietester');

        (isUsernameAvailable as jest.Mock).mockResolvedValue({ available: false, error: null });
        fireEvent.changeText(screen.getByPlaceholderText('username'), 'takenhandle');

        expect(await screen.findByText('That username is taken.')).toBeTruthy();

        fireEvent.press(screen.getByText('CONTINUE'));
        expect(updateProfile).not.toHaveBeenCalled();
        expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('normalizes invalid username characters as the user types', async () => {
        render(<OnboardingProfileScreen />);
        await screen.findByDisplayValue('jamietester');

        fireEvent.changeText(screen.getByPlaceholderText('username'), 'J@mie Smith!');
        // lowercased + stripped to [a-z0-9_]
        expect(screen.getByDisplayValue('jmiesmith')).toBeTruthy();
    });
});
