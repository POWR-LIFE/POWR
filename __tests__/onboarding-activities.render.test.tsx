/**
 * Render tests for the onboarding activities step after gym stopped being a
 * locked slot (2026-08-28): gym starts ticked but removable, a wearable
 * backfill pre-ticks what it saw, and the home-gym map step only follows
 * when gym is still among the picks.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/GeometricBackground', () => {
    const { View } = require('react-native');
    return () => <View />;
});
jest.mock('@expo/vector-icons', () => {
    const { Text } = require('react-native');
    return { Ionicons: () => <Text>icon</Text>, MaterialCommunityIcons: () => <Text>icon</Text> };
});
jest.mock('@/hooks/useHealthProviders', () => ({ useHealthProviders: () => ({ rows: [] }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/api/user', () => ({ updateActivitySelections: jest.fn().mockResolvedValue({ error: null }) }));

let mockSessionRows: { type: string }[] = [];
jest.mock('@/lib/supabase', () => {
    const chain: any = {};
    for (const m of ['from', 'select', 'eq', 'neq', 'gte', 'limit']) chain[m] = jest.fn(() => chain);
    chain.then = (resolve: any) => Promise.resolve({ data: mockSessionRows, error: null }).then(resolve);
    return { supabase: chain };
});

import { updateActivitySelections } from '@/lib/api/user';
import OnboardingActivitiesScreen from '@/app/onboarding-activities';

const pressChip = (label: string) => fireEvent.press(screen.getAllByText(label)[0]);

beforeEach(() => { jest.clearAllMocks(); mockSessionRows = []; });

describe('onboarding activities — gym as an ordinary pick', () => {
    it('starts with gym ticked and can continue straight away (min 1 pick)', async () => {
        render(<OnboardingActivitiesScreen />);
        expect(await screen.findByText(/Gym is ticked to start/)).toBeTruthy();
        expect(screen.getByText(/Room for 2 more/)).toBeTruthy();
        fireEvent.press(screen.getByText('CONTINUE'));
        await waitFor(() => expect(updateActivitySelections).toHaveBeenCalledWith([
            expect.objectContaining({ bucket: 'gym' }),
        ]));
        // Gym kept → the home-gym map step follows.
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-gym');
    });

    it('lets a non-gym user untick gym, and then skips the home-gym step', async () => {
        render(<OnboardingActivitiesScreen />);
        await screen.findByText(/Gym is ticked to start/);
        pressChip('Gym');
        expect(screen.getByText('Pick at least one activity')).toBeTruthy();
        pressChip('Running');
        pressChip('Walking');
        fireEvent.press(screen.getByText('CONTINUE'));
        await waitFor(() => expect(updateActivitySelections).toHaveBeenCalled());
        const saved = (updateActivitySelections as jest.Mock).mock.calls[0][0].map((s: any) => s.bucket);
        expect(saved).toEqual(['running', 'walking']);
        expect(mockRouter.push).toHaveBeenCalledWith('/onboarding-health');
        expect(mockRouter.push).not.toHaveBeenCalledWith('/onboarding-gym');
    });

    it('pre-ticks what the wearable backfill already recorded, then fills with gym', async () => {
        mockSessionRows = [{ type: 'cycling' }, { type: 'cycling' }, { type: 'running' }, { type: 'sleep' }];
        render(<OnboardingActivitiesScreen />);
        expect(await screen.findByText(/already shows cycling and running/)).toBeTruthy();
        fireEvent.press(screen.getByText('CONTINUE'));
        await waitFor(() => expect(updateActivitySelections).toHaveBeenCalled());
        const saved = (updateActivitySelections as jest.Mock).mock.calls[0][0].map((s: any) => s.bucket);
        expect(saved).toEqual(['cycling', 'running', 'gym']);
    });
});
