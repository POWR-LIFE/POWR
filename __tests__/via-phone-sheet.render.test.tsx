/**
 * Render tests for components/ViaPhoneSheet.tsx — the sheet a paused wearable's
 * tile opens: Garmin since 2026-09-21, and every Terra brand while the Terra
 * pause switch is on. The connect action must show whenever the phone store
 * isn't live-connected, never on web (no phone store to connect), and a brand
 * that can't share into this phone's store must say so instead of pointing at
 * a setting that doesn't exist.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = (props: any) => React.createElement(Text, null, props.name);
    return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

import ViaPhoneSheet from '@/components/ViaPhoneSheet';

function renderSheet(brand: { id: string; name: string } | null, phoneConnected: boolean) {
    const onConnectPhone = jest.fn();
    const onClose = jest.fn();
    render(
        <ViaPhoneSheet brand={brand} phoneConnected={phoneConnected} onConnectPhone={onConnectPhone} onClose={onClose} />,
    );
    return { onConnectPhone, onClose };
}

const GARMIN = { id: 'garmin', name: 'Garmin' };

describe('ViaPhoneSheet', () => {
    it('offers the connect action when the phone store is not connected (iOS)', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'ios');
        const { onConnectPhone } = renderSheet(GARMIN, false);
        expect(screen.getByText('Garmin syncs through Apple Health')).toBeTruthy();
        expect(screen.getByText(/Connected Apps → Apple Health/)).toBeTruthy();
        // Garmin only shares while Garmin Connect is open — say so.
        expect(screen.getByText(/Open Garmin Connect once a day/)).toBeTruthy();
        fireEvent.press(screen.getByText('CONNECT APPLE HEALTH'));
        expect(onConnectPhone).toHaveBeenCalledTimes(1);
        os.restore();
    });

    it('shows DONE instead of the connect action once connected', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'android');
        const { onClose } = renderSheet(GARMIN, true);
        expect(screen.getByText('Garmin syncs through Health Connect')).toBeTruthy();
        expect(screen.queryByText('CONNECT HEALTH CONNECT')).toBeNull();
        fireEvent.press(screen.getByText('DONE'));
        expect(onClose).toHaveBeenCalledTimes(1);
        os.restore();
    });

    it('explains without a dead connect button on web', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'web');
        const { onConnectPhone, onClose } = renderSheet(GARMIN, false);
        expect(screen.getByText('Garmin syncs through your phone')).toBeTruthy();
        expect(screen.queryByText(/^CONNECT /)).toBeNull();
        expect(screen.queryByText(/Connected Apps/)).toBeNull();
        fireEvent.press(screen.getByText('GOT IT'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConnectPhone).not.toHaveBeenCalled();
        os.restore();
    });

    it("points a Whoop user at WHOOP's own Apple Health setting", () => {
        const os = jest.replaceProperty(Platform, 'OS', 'ios');
        renderSheet({ id: 'whoop', name: 'Whoop' }, false);
        expect(screen.getByText('Whoop syncs through Apple Health')).toBeTruthy();
        expect(screen.getByText('2. Turn on sharing in the WHOOP app')).toBeTruthy();
        expect(screen.getByText(/Integrations → Apple Health/)).toBeTruthy();
        os.restore();
    });

    it("tells a Fitbit user on iPhone the truth: no Apple Health route, phone steps only", () => {
        const os = jest.replaceProperty(Platform, 'OS', 'ios');
        const { onConnectPhone } = renderSheet({ id: 'fitbit', name: 'Fitbit' }, false);
        expect(screen.getByText('Fitbit can’t sync to iPhone right now')).toBeTruthy();
        expect(screen.queryByText(/Turn on sharing/)).toBeNull();
        // Still useful: the phone's own steps.
        fireEvent.press(screen.getByText('CONNECT APPLE HEALTH'));
        expect(onConnectPhone).toHaveBeenCalledTimes(1);
        os.restore();
    });

    it('renders nothing without a brand', () => {
        renderSheet(null, false);
        expect(screen.queryByText(/syncs through/)).toBeNull();
    });
});
