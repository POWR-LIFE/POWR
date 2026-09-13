/**
 * Render test for LeaguePreview — the League tab between events (no live
 * event configured, global board not yet open): two segments, one editorial
 * page each. Only the segment bar looks like a tab.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-svg', () => {
    const React = require('react');
    const { View } = require('react-native');
    const Stub = (props: any) => React.createElement(View, null, props.children);
    return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, Defs: Stub, LinearGradient: Stub, Stop: Stub };
});
jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return { Image: (props: any) => React.createElement(Text, { testID: 'avatar-image' }, props.source?.uri ?? 'local') };
});
jest.mock('expo-linear-gradient', () => {
    const { View } = require('react-native');
    return { LinearGradient: View };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
const mockSetString = jest.fn(async (_text: string) => {});
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => mockSetString(s) }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/usePoints', () => ({
    usePoints: () => ({ balance: 900, todayEarned: 40, weeklyEarned: 1250, totalEarned: 18420 }),
}));
const mockFetchProfile = jest.fn();
jest.mock('@/lib/api/user', () => ({ fetchProfile: () => mockFetchProfile() }));

import { LeaguePreview } from '@/components/league/LeaguePreview';

const AVATAR = 'https://x.supabase.co/storage/v1/object/public/avatars/jamie.jpg';
const CODE = 'JAMIE7K';

function renderPreview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <LeaguePreview />
        </QueryClientProvider>,
    );
}

describe('LeaguePreview', () => {
    beforeEach(() => {
        mockPush.mockClear();
        mockFetchProfile.mockResolvedValue({ id: 'u1', username: 'jamie', display_name: 'Jamie P', avatar_url: AVATAR, referral_code: CODE });
        mockSetString.mockClear();
    });

    it('opens on the leaderboard: headline, the viewer in the champion seat, their all-time total, no second tab row', async () => {
        renderPreview();
        expect(screen.getByText('LEADERBOARD')).toBeTruthy();
        expect(screen.getByText('EVENTS')).toBeTruthy();
        expect(screen.getByText('GLOBAL LEADERBOARD')).toBeTruthy();
        expect(screen.getByText('Every move.')).toBeTruthy();
        expect(screen.getByText('One board.')).toBeTruthy();
        expect(screen.getByText('CHAMPION')).toBeTruthy();
        // The viewer sits in the champion's seat; the other two stay empty.
        await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
        expect(screen.getByTestId('avatar-image').props.children).toBe(AVATAR);
        expect(screen.getAllByTestId('avatar-image').length).toBe(1);
        expect(screen.getByText('18,420')).toBeTruthy();
        expect(screen.getByText('POINTS ALL TIME')).toBeTruthy();
        // Weekly/All-time pills would read as a second row of tabs — gone.
        expect(screen.queryByText('WEEKLY')).toBeNull();
        expect(screen.queryByText('ALL TIME')).toBeNull();
        // Nothing promises a date.
        expect(screen.queryByText(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/)).toBeNull();
    });

    it('falls back to initials in the champion seat without an avatar', async () => {
        mockFetchProfile.mockResolvedValue({ id: 'u1', username: 'sam', display_name: 'Sam Lee', avatar_url: null });
        renderPreview();
        await waitFor(() => expect(screen.getByText('SL')).toBeTruthy());
        expect(screen.queryByTestId('avatar-image')).toBeNull();
    });

    it('EVENTS shows the three beats and the viewer’s code with share, copy and QR', async () => {
        const { Share } = require('react-native');
        const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
        renderPreview();
        fireEvent.press(screen.getByText('EVENTS'));
        expect(screen.getByText('LIVE EVENTS')).toBeTruthy();
        expect(screen.getByText('One night to win.')).toBeTruthy();
        expect(screen.getByText('Register')).toBeTruthy();
        expect(screen.getByText('Score for a week')).toBeTruthy();
        expect(screen.getByText('Revealed live')).toBeTruthy();
        expect(screen.queryByText('GLOBAL LEADERBOARD')).toBeNull();

        // The code itself is on the page, as the live ticket showed it.
        await waitFor(() => expect(screen.getByText(CODE)).toBeTruthy());

        fireEvent.press(screen.getByText('SHARE'));
        await waitFor(() => expect(shareSpy).toHaveBeenCalled());
        const shared = shareSpy.mock.calls[0][0] as { message: string; url: string };
        expect(shared.url).toBe(`https://powr.life/app?to=add-friend&ref=${CODE}`);
        expect(shared.message).toContain(CODE);
        expect(shared.message).toContain(shared.url);

        fireEvent.press(screen.getByText(CODE));
        await waitFor(() => expect(mockSetString).toHaveBeenCalled());
        expect(mockSetString.mock.calls[0][0]).toContain(CODE);

        fireEvent.press(screen.getByLabelText('Show your POWR QR code'));
        expect(mockPush).toHaveBeenCalledWith('/my-qr');

        fireEvent.press(screen.getByText('LEADERBOARD'));
        expect(screen.getByText('GLOBAL LEADERBOARD')).toBeTruthy();
        shareSpy.mockRestore();
    });
});
