/**
 * Render test for the ShareCard level mark — the "My Level" share background.
 * Asserts the card derives the level from lifetime earned points (not balance)
 * and renders that level's artwork.
 */

import { render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return {
        Image: (props: any) =>
            React.createElement(Text, { testID: 'image' }, props.source?.uri ?? 'local'),
    };
});

jest.mock('expo-linear-gradient', () => {
    const { View } = require('react-native');
    return { LinearGradient: View };
});

import { ShareCard } from '@/components/share/ShareCard';
import type { ShareSummary } from '@/lib/api/share';

function summary(totalEarned: number): ShareSummary {
    return {
        mode: 'streak',
        longestStreak: 5,
        pointsBalance: 0,
        totalEarned,
        lifetimeCount: 12,
        monthCount: 3,
        currentStreak: 4,
        weekActiveDays: [true, false, true, false, false, false, false],
        reward: null,
        profile: { displayName: 'Jamie', username: 'jamie', avatarUrl: null, coverUrl: null },
    };
}

test('renders the level for lifetime earned points', () => {
    render(<ShareCard summary={summary(10_000)} width={1080} showLevel />);
    expect(screen.getByText('LEVEL 7')).toBeTruthy();
    expect(screen.getByText('IRON LUNGS')).toBeTruthy();
    expect(screen.getByText(/iron-lungs\.png$/)).toBeTruthy();
});

test('a spent-down balance does not demote the level', () => {
    // totalEarned counts credits only, so the level survives a big redemption.
    render(<ShareCard summary={summary(182_000)} width={1080} showLevel />);
    expect(screen.getByText('LEVEL 20')).toBeTruthy();
    expect(screen.getByText('GOGGINS')).toBeTruthy();
});

test('no level mark unless asked for', () => {
    render(<ShareCard summary={summary(10_000)} width={1080} />);
    expect(screen.queryByText('LEVEL 7')).toBeNull();
});
