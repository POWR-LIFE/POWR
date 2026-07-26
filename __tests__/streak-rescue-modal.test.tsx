import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
  sessionsDone: 0,
  expiresAt: new Date(Date.now() + 40 * 3600_000).toISOString(),
};

// Countable offers carry banked progress in the marker, so each step forward
// re-announces once. Saved / steps offers don't (see the component).
const SEEN_KEY = '@powr/rescue_seen/rescue-1/offered/0';
const SAVED_KEY = '@powr/rescue_seen/rescue-1/saved';

// The modal waits SETTLE_MS (700) before presenting so it decides on
// post-invalidate data; every assertion here has to outlast that.
configure({ asyncUtilTimeout: 4000 });
const PAST_SETTLE = 1200;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('StreakRescueModal', () => {
  it('announces an unseen offer with the challenge terms', async () => {
    render(<StreakRescueModal rescue={offer} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());
    expect(screen.getByText(/12-day streak isn't gone yet/)).toBeTruthy();
    expect(screen.getByText(/2 sessions in the next \d+h/)).toBeTruthy();
    expect(screen.getByText('0 of 2 sessions done')).toBeTruthy();
  });

  it('counts down what is LEFT once part of the challenge is done', async () => {
    render(<StreakRescueModal rescue={{ ...offer, id: 'rescue-partial', sessionsDone: 1 }} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());

    expect(screen.getByText(/Just 1 session left in the next \d+h/)).toBeTruthy();
    expect(screen.getByText('1 of 2 sessions done')).toBeTruthy();
    expect(screen.getByText('RESCUE IN PROGRESS')).toBeTruthy();
    expect(screen.getByText('FINISH IT')).toBeTruthy();
    // The full requirement must not be restated at someone already halfway.
    expect(screen.queryByText(/2 sessions in the next/)).toBeNull();
  });

  it('shows remaining steps, not remaining sessions, for a step challenge', async () => {
    render(
      <StreakRescueModal
        rescue={{ ...offer, id: 'rescue-3', requirementType: 'steps', sessionsRequired: 15000, sessionsDone: 7500 }}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Just 7,500 steps left/)).toBeTruthy());
    expect(screen.getByText('7,500 of 15,000 steps done')).toBeTruthy();
  });

  it('clamps overshoot so progress never reads past the requirement', async () => {
    render(<StreakRescueModal rescue={{ ...offer, id: 'rescue-4', sessionsDone: 5 }} />);
    await waitFor(() => expect(screen.getByText('2 of 2 sessions done')).toBeTruthy());
  });

  it('drops the progress meter on the saved variant', async () => {
    render(<StreakRescueModal rescue={{ ...offer, state: 'saved', sessionsDone: 2 }} />);
    await waitFor(() => expect(screen.getByText('Streak saved')).toBeTruthy());
    expect(screen.queryByText(/of 2 sessions done/)).toBeNull();
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
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Back on track')).toBeNull();
  });

  it('re-opens on user request via reopenNonce, bypassing the seen marker', async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1');
    const { rerender } = render(<StreakRescueModal rescue={offer} reopenNonce={0} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
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

  it('re-announces once when a session banks, without the user having to tap', async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1'); // saw + dismissed the 0/2 offer
    const { rerender } = render(<StreakRescueModal rescue={offer} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Back on track')).toBeNull();

    // A session lands — the revision bus refetches and progress moves to 1/2.
    rerender(<StreakRescueModal rescue={{ ...offer, sessionsDone: 1 }} />);
    await waitFor(() => expect(screen.getByText(/Just 1 session left/)).toBeTruthy());

    // ...and only once. Dismissing stamps the 1/2 marker and it stays quiet.
    fireEvent.press(screen.getByText('FINISH IT'));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('@powr/rescue_seen/rescue-1/offered/1')).toBe('1');
    });
    rerender(<StreakRescueModal rescue={{ ...offer, sessionsDone: 1 }} reopenNonce={0} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText(/Just 1 session left/)).toBeNull();
  });

  it('does not re-announce on every step count — a steps offer keys on state alone', async () => {
    const steps = { ...offer, requirementType: 'steps' as const, sessionsRequired: 15000, sessionsDone: 4000 };
    await AsyncStorage.setItem('@powr/rescue_seen/rescue-1/offered', '1');
    const { rerender } = render(<StreakRescueModal rescue={steps} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Back on track')).toBeNull();

    rerender(<StreakRescueModal rescue={{ ...steps, sessionsDone: 4231 }} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Back on track')).toBeNull();
  });

  it('a dismissed save stays dismissed', async () => {
    await AsyncStorage.setItem(SAVED_KEY, '1');
    render(<StreakRescueModal rescue={{ ...offer, state: 'saved', sessionsDone: 2 }} />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Streak saved')).toBeNull();
  });

  it('holds while another modal owns the screen, then presents when it clears', async () => {
    // Two RN Modals visible at once means one silently never appears on iOS.
    const { rerender } = render(<StreakRescueModal rescue={offer} deferred />);
    await new Promise((r) => setTimeout(r, PAST_SETTLE));
    expect(screen.queryByText('Back on track')).toBeNull();
    // Held, not dropped — no marker was stamped, so it still owes an announcement.
    expect(await AsyncStorage.getItem(SEEN_KEY)).toBeNull();

    rerender(<StreakRescueModal rescue={offer} deferred={false} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());
  });

  it('does not yank a sheet the user is already reading', async () => {
    const { rerender } = render(<StreakRescueModal rescue={offer} />);
    await waitFor(() => expect(screen.getByText('Back on track')).toBeTruthy());

    // Something goes pending mid-read (points land → level-up queues).
    rerender(<StreakRescueModal rescue={offer} deferred />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByText('Back on track')).toBeTruthy();
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
