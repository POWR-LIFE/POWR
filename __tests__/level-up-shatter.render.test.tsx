/**
 * Render test for the level-up shatter.
 *
 * The shatter used to be gated behind the `explosive` grade, which meant 16 of
 * the 19 level boundaries — every within-tier step — quietly fell back to a
 * plain cross-fade. It reads as "the explosion stopped working". This locks the
 * break in on every grade; the grade may only scale what surrounds it (rings,
 * particle count, haptic strength, kicker). The landing overshoot is likewise
 * universal now, but it lives entirely in shared values so only the shatter is
 * reachable from a render test.
 */

import { render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    // The celebration calls Image.prefetch() — a static on the component, not a
    // module-level export — to get the incoming artwork on disk before the swap.
    const Image: any = (props: any) =>
        React.createElement(Text, { testID: 'image' }, props.source?.uri ?? 'local');
    Image.prefetch = jest.fn();
    return { Image };
});

jest.mock('expo-linear-gradient', () => {
    const { View } = require('react-native');
    return { LinearGradient: View };
});

jest.mock('expo-haptics', () => ({
    impactAsync: jest.fn().mockResolvedValue(undefined),
    notificationAsync: jest.fn().mockResolvedValue(undefined),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    NotificationFeedbackType: { Success: 'success' },
}));

import { LevelUpCelebration, levelUpGraduation } from '@/components/LevelUpCelebration';

/** SHATTER_GRID² — the board is 5×5, so an intact old badge is 25 tiles. */
const TILES = 25;

function renderLevelUp(fromLevel: number, toLevel: number) {
    return render(
        <LevelUpCelebration
            fromLevel={fromLevel}
            toLevel={toLevel}
            fromXp={0}
            totalEarned={0}
            onDone={jest.fn()}
        />,
    );
}

describe('level-up shatter', () => {
    // fromLevel → the artwork filename that must appear once per tile.
    const cases: [string, number, number, string][] = [
        ['standard (within recruit)', 2, 3, 'the-cardio-goblin'],
        ['standard (within athlete)', 6, 7, 'cant-sit-still'],
        ['tier (recruit → athlete)', 5, 6, 'heavy-hit'],
        ['apex (→ Goggins)', 19, 20, 'long-hauler'],
    ];

    it.each(cases)('shatters the old badge on %s', (_label, from, to, oldArt) => {
        renderLevelUp(from, to);
        // Every tile renders the full old artwork clipped to its own slice, so
        // the board is exactly SHATTER_GRID² copies of the outgoing level.
        expect(screen.getAllByText(new RegExp(`${oldArt}\\.png(\\?|$)`))).toHaveLength(TILES);
    });

    it('lands the new artwork over the wreckage', () => {
        renderLevelUp(2, 3);
        expect(screen.getAllByText(/streak-freak\.png(\?|$)/)).toHaveLength(1);
    });

    it('still grades the trimmings around the break', () => {
        // The shatter is universal; the surrounding drama is not.
        expect(levelUpGraduation(2, 3)).toBe('standard');
        expect(levelUpGraduation(5, 6)).toBe('tier');
        expect(levelUpGraduation(19, 20)).toBe('apex');

        renderLevelUp(2, 3);
        expect(screen.getByText('LEVEL UP')).toBeTruthy();
        screen.unmount();

        renderLevelUp(5, 6);
        expect(screen.getByText('NEW TIER — ATHLETE')).toBeTruthy();
        screen.unmount();

        renderLevelUp(19, 20);
        expect(screen.getByText('MAX LEVEL')).toBeTruthy();
    });
});
