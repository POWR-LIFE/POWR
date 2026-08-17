/**
 * Render test for the invite answer on the challenge detail screen
 * (app/shared-challenge.tsx) — the screen the "X invited you" push deep-links to.
 *
 * The bug this pins down: the screen used to fire the accept and call
 * router.back() in the same tick. Home refetches the moment it regains focus and
 * won that race against the edge function, so it redrew the invite the user had
 * just accepted — "I had to press Accept twice". The answer must land BEFORE we
 * navigate, a second tap must not fire a second call, and a refusal must keep
 * the user here with the reason instead of bouncing them to an unchanged card.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import SharedChallengeDetail from '@/app/shared-challenge';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'challenge-1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = (props: any) => React.createElement(Text, null, props.name);
  return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});

// Presentational children this test doesn't assert on. Stubbed inline (not via
// a shared helper) because jest.mock factories are hoisted above every const.
jest.mock('@/components/GeometricBackground', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/social/Avatar', () => ({ __esModule: true, Avatar: () => null }));
jest.mock('@/components/social/Countdown', () => ({ __esModule: true, Countdown: () => null }));
jest.mock('@/components/social/InvitePeopleSheet', () => ({ __esModule: true, InvitePeopleSheet: () => null }));
jest.mock('@/components/UserProfileSheet', () => ({ __esModule: true, UserProfileSheet: () => null }));
jest.mock('@/lib/social/inviteLinks', () => ({ fetchChallengeInviteUrl: jest.fn() }));

const mockChallenge = {
  id: 'challenge-1',
  template: {
    id: 'gym3', category: 'gym', categoryLabel: 'Gym', icon: { lib: 'ion', name: 'barbell' },
    tier: 'easy', title: '3 gym sessions', goal: 'Get to the gym 3 times', basePoints: 40, mode: 'solo',
  },
  kind: 'parallel',
  status: 'active',
  creatorId: 'friend',
  participants: [
    { friend: { id: 'me', username: 'me', displayName: 'Me', status: 'accepted' }, state: 'invited', progress: 0, completed: false, isSelf: true },
    { friend: { id: 'friend', username: 'friend', displayName: 'Friend', status: 'accepted' }, state: 'accepted', progress: 0, completed: false },
  ],
  expiresIn: 'Not started',
  endsAt: null,
  pendingInviteFromName: 'Friend',
};

const mockAcceptInvite = jest.fn();
const mockDeclineInvite = jest.fn();
jest.mock('@/hooks/useSharedChallenges', () => ({
  durationLabel: (h: number) => `${h}h`,
  useSharedChallenges: () => ({
    acceptInvite: mockAcceptInvite, declineInvite: mockDeclineInvite,
    leaveChallenge: jest.fn(), cancelChallenge: jest.fn(), inviteToChallenge: jest.fn(),
    fetchById: jest.fn(), getById: () => mockChallenge,
    bonusConfig: { perHead: 5, maxBonus: 30 },
    loading: false, error: false, refresh: jest.fn(),
    friends: [], search: jest.fn(), sendRequest: jest.fn(),
  }),
}));

describe('answering an invite on the challenge detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('waits for the server before navigating back', async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    mockAcceptInvite.mockImplementation(() => new Promise((res) => { release = res; }));

    render(<SharedChallengeDetail />);
    fireEvent.press(screen.getByText('Accept challenge'));

    await waitFor(() => expect(mockAcceptInvite).toHaveBeenCalledWith('challenge-1'));
    // Still in flight — leaving now is what let Home redraw the invite.
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.getByText('Joining…')).toBeTruthy();

    release({ ok: true });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  });

  it('ignores a second press while the first is still in flight', async () => {
    mockAcceptInvite.mockImplementation(() => new Promise(() => {}));

    render(<SharedChallengeDetail />);
    fireEvent.press(screen.getByText('Accept challenge'));
    await waitFor(() => expect(screen.getByText('Joining…')).toBeTruthy());
    fireEvent.press(screen.getByText('Joining…'));

    expect(mockAcceptInvite).toHaveBeenCalledTimes(1);
  });

  it('stays put and says why when the server refuses', async () => {
    mockAcceptInvite.mockResolvedValue({ ok: false, error: 'Challenge slots full — finish or drop one first' });

    render(<SharedChallengeDetail />);
    fireEvent.press(screen.getByText('Accept challenge'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      'Couldn’t join',
      'Challenge slots full — finish or drop one first',
    ));
    expect(mockRouter.back).not.toHaveBeenCalled();
    // Back to an idle button, so the user can retry once a slot frees up.
    expect(screen.getByText('Accept challenge')).toBeTruthy();
  });
});
