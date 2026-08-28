/**
 * Render test for EventShareCard — the live event as a 9:16 social card.
 * The hero lockup (venue logo · POWR mark) is the identity, the name is
 * hidden for logo-only events, the facts are labelled, the code is on the
 * card, and onReady fires only once every image has painted.
 */

import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Image as NativeImage } from 'react-native';

// Remote images become text nodes carrying their URI; the load-end callback
// is exposed so the test can drive readiness by hand.
jest.mock('expo-image', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return {
        Image: (props: any) =>
            React.createElement(Text, { testID: 'expo-image', onLoadEnd: props.onLoadEnd }, props.source?.uri ?? 'local'),
    };
});
jest.mock('expo-linear-gradient', () => {
    const { View } = require('react-native');
    return { LinearGradient: View };
});

import { EventShareCard } from '@/components/share/EventShareCard';
import type { EventShareEvent } from '@/lib/eventShare';

const VENUE_LOGO = 'https://x.supabase.co/storage/v1/object/public/partner-logos/partners/one.webp';

const base: EventShareEvent = {
    slug: 'fnl-x-powr',
    name: 'FNL x POWR',
    status: 'live',
    logo_url: null,
    logo_only: true,
    window_start_at: '2026-08-26T23:00:00.000Z',
    window_end_at: '2026-09-03T23:00:00.000Z',
    doors_open_at: '2026-09-04T17:00:00.000Z',
    doors_close_at: '2026-09-04T18:00:00.000Z',
    invite_bonus_points: 20,
    // A promo VIDEO: no still to ground the card, the lockup carries it.
    promo_media_url: 'https://video.example/playlist.m3u8',
    promo_headline: null,
    venue: { name: 'ONE LDN', logo_url: VENUE_LOGO, logo_bg: 'dark' },
};

test('logo-only event: lockup + facts + code, no name text, no promo ground', () => {
    render(<EventShareCard event={base} referralCode="ABC123" width={1080} />);
    expect(screen.getByText('LIVE EVENT')).toBeTruthy();
    expect(screen.getByText('LIVE NOW')).toBeTruthy();
    // Venue logo requested at the lockup's 512 spec; POWR mark is the bundled one.
    expect(screen.getByText(/partner-logos\/partners\/one\.webp\?width=512&height=512/)).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(NativeImage)).toHaveLength(1);
    expect(screen.queryByText('FNL x POWR')).toBeNull();
    // A video promo never becomes a ground image.
    expect(screen.queryByText(/playlist\.m3u8/)).toBeNull();
    expect(screen.getByText('THE NIGHT')).toBeTruthy();
    expect(screen.getByText(/^Fri.*Sep/)).toBeTruthy();
    expect(screen.getByText('WHERE')).toBeTruthy();
    expect(screen.getByText('ONE LDN')).toBeTruthy();
    expect(screen.getByText('SCORING')).toBeTruthy();
    expect(screen.getByText('JOIN ME WITH CODE')).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('POWR.LIFE')).toBeTruthy();
});

test('named event with a promo still: name, headline, ground image at card size', () => {
    const still = 'https://x.supabase.co/storage/v1/object/public/event-media/fnl.jpg';
    render(
        <EventShareCard
            event={{ ...base, logo_only: false, promo_headline: 'The night is coming', promo_media_url: still }}
            referralCode={null}
            width={1080}
        />,
    );
    expect(screen.getByText('FNL x POWR')).toBeTruthy();
    expect(screen.getByText('The night is coming')).toBeTruthy();
    expect(screen.getByText(/event-media\/fnl\.jpg\?width=1080&height=1920/)).toBeTruthy();
    expect(screen.getByText('JOIN ME ON POWR')).toBeTruthy();
});

test('no doors time → no night row, never the scoring window in its place', () => {
    render(<EventShareCard event={{ ...base, doors_open_at: null, doors_close_at: null }} referralCode="A" width={1080} />);
    expect(screen.queryByText('THE NIGHT')).toBeNull();
    expect(screen.getByText('SCORING')).toBeTruthy();
});

test('onReady fires once, after every image has painted', () => {
    const onReady = jest.fn();
    render(<EventShareCard event={base} referralCode="A" width={1080} onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
    // Venue logo (expo-image) and the POWR mark (RN Image): two images.
    act(() => { screen.getByTestId('expo-image').props.onLoadEnd(); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { screen.UNSAFE_getByType(NativeImage).props.onLoadEnd(); });
    expect(onReady).toHaveBeenCalledTimes(1);
});

test('no venue logo → ready after the mark alone', () => {
    const onReady = jest.fn();
    render(
        <EventShareCard event={{ ...base, venue: { name: 'ONE LDN', logo_url: null, logo_bg: null } }} referralCode="A" width={1080} onReady={onReady} />,
    );
    act(() => { screen.UNSAFE_getByType(NativeImage).props.onLoadEnd(); });
    expect(onReady).toHaveBeenCalledTimes(1);
});
