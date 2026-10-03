/**
 * Render tests for components/GarminViaPhoneSheet.tsx — the sheet a Garmin tile
 * opens while Garmin's direct link is paused. The connect action must show
 * whenever the phone store isn't live-connected, and never on web, where there
 * is no phone store to connect.
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

import GarminViaPhoneSheet from '@/components/GarminViaPhoneSheet';

function renderSheet(phoneConnected: boolean) {
    const onConnectPhone = jest.fn();
    const onClose = jest.fn();
    render(
        <GarminViaPhoneSheet visible phoneConnected={phoneConnected} onConnectPhone={onConnectPhone} onClose={onClose} />,
    );
    return { onConnectPhone, onClose };
}

describe('GarminViaPhoneSheet', () => {
    it('offers the connect action when the phone store is not connected (iOS)', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'ios');
        const { onConnectPhone } = renderSheet(false);
        expect(screen.getByText('Garmin syncs through Apple Health')).toBeTruthy();
        expect(screen.getByText(/Connected Apps → Apple Health/)).toBeTruthy();
        fireEvent.press(screen.getByText('CONNECT APPLE HEALTH'));
        expect(onConnectPhone).toHaveBeenCalledTimes(1);
        os.restore();
    });

    it('shows DONE instead of the connect action once connected', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'android');
        const { onClose } = renderSheet(true);
        expect(screen.getByText('Garmin syncs through Health Connect')).toBeTruthy();
        expect(screen.queryByText('CONNECT HEALTH CONNECT')).toBeNull();
        fireEvent.press(screen.getByText('DONE'));
        expect(onClose).toHaveBeenCalledTimes(1);
        os.restore();
    });

    it('explains without a dead connect button on web', () => {
        const os = jest.replaceProperty(Platform, 'OS', 'web');
        const { onConnectPhone, onClose } = renderSheet(false);
        expect(screen.getByText('Garmin syncs through your phone')).toBeTruthy();
        expect(screen.queryByText(/^CONNECT /)).toBeNull();
        expect(screen.queryByText(/Connected Apps/)).toBeNull();
        fireEvent.press(screen.getByText('GOT IT'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConnectPhone).not.toHaveBeenCalled();
        os.restore();
    });
});
