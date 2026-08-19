/**
 * Render test for EventPrizeGallery — the "THE PRIZES" block under the League
 * hero. Text-only events get a rows card; once any prize has an image the
 * block is a horizontal strip of tappable cards, and tapping one opens the
 * spotlight viewer on that prize.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return {
        Image: (props: any) => React.createElement(Text, { testID: 'prize-image' }, props.source?.uri ?? 'local'),
    };
});
jest.mock('expo-linear-gradient', () => {
    const { View } = require('react-native');
    return { LinearGradient: View };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { EventPrizeGallery } from '@/components/events/EventPrizeGallery';
import type { LiveEventPrize } from '@/lib/api/liveEvents';

const ev = (prizes: LiveEventPrize[]) => ({ slug: 'fnl-x-powr', prizes });

const IMG = 'https://x.supabase.co/storage/v1/object/public/reward-images/event-prizes/whoop.jpg';

describe('EventPrizeGallery', () => {
    it('renders nothing with no prizes', () => {
        expect(render(<EventPrizeGallery event={ev([])} />).toJSON()).toBeNull();
    });

    it('text-only prizes render the rows card, not the gallery', () => {
        const prizes: LiveEventPrize[] = [{ rank: 1, label: 'Free membership' }, { rank: 2, label: 'Gymshark bundle' }];
        render(<EventPrizeGallery event={ev(prizes)} />);
        expect(screen.getByText('THE PRIZES')).toBeTruthy();
        expect(screen.getByText('Free membership')).toBeTruthy();
        expect(screen.queryAllByRole('imagebutton')).toHaveLength(0);
        // Still shareable: the card's own SHARE opens the spotlight on first prize.
        fireEvent.press(screen.getByLabelText('Share the prizes'));
        expect(screen.getByLabelText('Share 1ST prize')).toBeTruthy();
    });

    it('with imagery: one card per prize at art size, tap opens the viewer on that prize', () => {
        const prizes: LiveEventPrize[] = [
            { rank: 1, label: '3 months free + Whoop', image_url: IMG },
            { rank: 2, label: 'Gymshark bundle', image_url: null },
        ];
        render(<EventPrizeGallery event={ev(prizes)} />);
        const cards = screen.getAllByRole('imagebutton');
        expect(cards).toHaveLength(2);
        // Card art requests the 1080 spec — the same URL the viewer will ask for.
        expect(screen.getByTestId('prize-image').props.children).toContain('width=1080&height=1080');
        // Imageless prize shows its rank large.
        expect(screen.getByText('2')).toBeTruthy();

        // Viewer closed until a tap.
        expect(screen.queryByLabelText('Close')).toBeNull();
        fireEvent.press(cards[1]);
        expect(screen.getAllByLabelText('Close').length).toBeGreaterThan(0);
        // The tapped prize's label appears in the viewer (once in card, once in viewer).
        expect(screen.getAllByText('Gymshark bundle')).toHaveLength(2);
    });

    it('SHARE in the spotlight hands off to /share-prize for that prize once the viewer has closed', () => {
        jest.useFakeTimers();
        const prizes: LiveEventPrize[] = [
            { rank: 1, label: 'Wellness day', image_url: IMG },
            { rank: 2, label: 'Gymshark bundle', image_url: IMG },
        ];
        render(<EventPrizeGallery event={ev(prizes)} />);
        fireEvent.press(screen.getAllByRole('imagebutton')[1]);
        fireEvent.press(screen.getByLabelText('Share 2ND prize'));
        // The push waits for the dismiss animation — nothing routed yet.
        expect(mockPush).not.toHaveBeenCalled();
        act(() => { jest.runAllTimers(); });
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/share-prize', params: { slug: 'fnl-x-powr', rank: '2' } });
        jest.useRealTimers();
    });
});
