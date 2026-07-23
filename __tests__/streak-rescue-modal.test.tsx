import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { StreakRescueModal } from '@/components/home/StreakRescueModal';
import type { StreakRescueOffer } from '@/hooks/useStreakRescue';

const offer: StreakRescueOffer = {
  id: 'rescue-1',
  state: 'offered',
  lostStreak: 12,
  missedDay: '2026-07-22',
  label: 'Back on track',
  requirementType: 'sessions',
  sessionsRequired: 2,
  sessionsDone: 1,
  expiresAt: new Date(Date.now() + 40 * 3600_000).toISOString(),
};

const SEEN_KEY = '@powr/rescue_seen/rescue-1/offered';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('StreakRescueModal', () => {
  it('announces an unseen offer with the challenge terms', async () => {
    render(<StreakRescueModal rescue={offer} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());
    expect(screen.getByText(/12-day streak isn't gone yet/)).toBeTruthy();
    expect(screen.getByText(/2 sessions in the next \d+h/)).toBeTruthy();
  });

  it('is one-shot: dismissing stamps the marker and it never auto-reopens', async () => {
    render(<StreakRescueModal rescue={offer} />);
    await waitFor(() => expect(screen.getByText("LET'S GO")).toBeTruthy());

    fireEvent.press(screen.getByText("LET'S GO"));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(SEEN_KEY)).toBe('1');
    });

    // Fresh mount with the marker already set — must stay silent.
    render(<StreakRescueModal rescue={offer} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Back on track')).toBeNull();
  });

  it('re-opens on user request via reopenNonce, bypassing the seen marker', async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1');
    const { rerender } = render(<StreakRescueModal rescue={offer} reopenNonce={0} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Back on track')).toBeNull();

    rerender(<StreakRescueModal rescue={offer} reopenNonce={1} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());
  });

  it('celebrates completion once with the saved variant', async () => {
    render(<StreakRescueModal rescue={{ ...offer, state: 'saved' }} />);
    await waitFor(() => expect(screen.getByText('Streak saved')).toBeTruthy());
    expect(screen.getByText(/12-day streak is back and counting/)).toBeTruthy();
    expect(screen.getByText('KEEP IT ROLLING')).toBeTruthy();
  });

  it('the offer marker does not silence the later saved announcement', async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1'); // offer was seen + dismissed
    render(<StreakRescueModal rescue={{ ...offer, state: 'saved' }} />);
    await waitFor(() => expect(screen.getByText('Streak saved')).toBeTruthy());
  });

  it('renders nothing without a rescue', () => {
    render(<StreakRescueModal rescue={null} />);
    expect(screen.queryByText("LET'S GO")).toBeNull();
  });

  it('phrases step challenges in steps, not sessions', async () => {
    render(
      <StreakRescueModal
        rescue={{ ...offer, id: 'rescue-2', requirementType: 'steps', sessionsRequired: 15000, label: 'Walk it back' }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Walk it back')).toBeTruthy());
    expect(screen.getByText(/15,000 steps in the next/)).toBeTruthy();
  });
});
