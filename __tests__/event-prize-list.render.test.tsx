/**
 * Render test for EventPrizeList — the prize block shared by the League ticket
 * and the register sheet.
 *
 * Two shapes ride on the data: events configured before prize images existed
 * (no image_url on any row) must render exactly the compact rank · label rows
 * they always had; once any prize carries an image every row gets a tile —
 * the image, or a rank monogram for a prize without one, so the column stays
 * level. Thumbnails go through the storage render endpoint at a fixed size.
 */

import { render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return {
        Image: (props: any) => React.createElement(Text, { testID: 'prize-image' }, props.source?.uri ?? 'local'),
    };
});

import { EventPrizeList } from '@/components/events/EventPrizeList';
import type { LiveEventPrize } from '@/lib/api/liveEvents';

const IMG = 'https://x.supabase.co/storage/v1/object/public/reward-images/event-prizes/whoop.jpg';

describe('EventPrizeList', () => {
    it('renders nothing for an event with no prizes', () => {
        const { toJSON } = render(<EventPrizeList prizes={[]} />);
        expect(toJSON()).toBeNull();
    });

    it('text-only prizes (pre-image events) render the compact rows with no tiles', () => {
        const prizes: LiveEventPrize[] = [
            { rank: 1, label: 'Free membership' },
            { rank: 2, label: 'Gymshark bundle', image_url: null },
        ];
        render(<EventPrizeList prizes={prizes} />);
        expect(screen.getByText('1ST')).toBeTruthy();
        expect(screen.getByText('2ND')).toBeTruthy();
        expect(screen.getByText('Free membership')).toBeTruthy();
        expect(screen.queryAllByTestId('prize-image')).toHaveLength(0);
        // No monogram tiles either — the legacy shape has no image column.
        expect(screen.queryByText('1')).toBeNull();
    });

    it('with imagery: image tiles resize via the render endpoint, imageless rows get a rank monogram', () => {
        const prizes: LiveEventPrize[] = [
            { rank: 1, label: '3 months free + Whoop', image_url: IMG },
            { rank: 2, label: 'Gymshark bundle', image_url: null },
            { rank: 3, label: 'PT sessions' },
        ];
        render(<EventPrizeList prizes={prizes} size="sheet" />);
        const images = screen.getAllByTestId('prize-image');
        expect(images).toHaveLength(1);
        expect(images[0].props.children).toBe(
            'https://x.supabase.co/storage/v1/render/image/public/reward-images/event-prizes/whoop.jpg?width=256&height=256&resize=contain',
        );
        // Rank monograms fill the slot for the prizes without an image.
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.queryByText('1')).toBeNull();
        expect(screen.getByText('3RD')).toBeTruthy();
    });

    it('caps at the top three prizes', () => {
        const prizes: LiveEventPrize[] = [1, 2, 3, 4, 5].map((rank) => ({ rank, label: `Prize ${rank}` }));
        render(<EventPrizeList prizes={prizes} />);
        expect(screen.getByText('Prize 3')).toBeTruthy();
        expect(screen.queryByText('Prize 4')).toBeNull();
    });
});
