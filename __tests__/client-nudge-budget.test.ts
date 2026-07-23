import AsyncStorage from '@react-native-async-storage/async-storage';
import { consumeClientNudgeBudget } from '@/lib/notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('@/lib/gymDwellConfig', () => ({ getGymUpgradeMinutes: () => 40 }));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// The client-side share of the anti-bombardment budget: locally-scheduled
// nudges (nearby offer, within-reach, step goal) share ONE slot per calendar
// day. The only same-day re-consume allowed is points_milestone re-claiming
// its own slot — within-reach cancels + reschedules itself to stay fresh,
// which must not read as a second nudge.
describe('consumeClientNudgeBudget', () => {
  it('grants the first nudge of the day', async () => {
    await expect(consumeClientNudgeBudget('nearby_offer')).resolves.toBe(true);
  });

  it('denies a second different-type nudge the same day', async () => {
    await consumeClientNudgeBudget('nearby_offer');
    await expect(consumeClientNudgeBudget('step_goal_nudge')).resolves.toBe(false);
  });

  it('denies a second SAME-type nudge the same day (the Copilot loophole)', async () => {
    await consumeClientNudgeBudget('nearby_offer');
    await expect(consumeClientNudgeBudget('nearby_offer')).resolves.toBe(false);
  });

  it('allows points_milestone to re-consume its own slot for reschedules', async () => {
    await consumeClientNudgeBudget('points_milestone');
    await expect(consumeClientNudgeBudget('points_milestone')).resolves.toBe(true);
  });

  it('does not let points_milestone steal a slot another nudge already took', async () => {
    await consumeClientNudgeBudget('step_goal_nudge');
    await expect(consumeClientNudgeBudget('points_milestone')).resolves.toBe(false);
  });

  it('resets on a new calendar day', async () => {
    // Simulate yesterday's consumption directly in storage.
    await AsyncStorage.setItem(
      '@powr/client_nudge_budget',
      JSON.stringify({ day: '2020-01-01', type: 'nearby_offer' }),
    );
    await expect(consumeClientNudgeBudget('step_goal_nudge')).resolves.toBe(true);
  });

  it('fails open when storage is unreadable — budget plumbing must never mute outright', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(consumeClientNudgeBudget('nearby_offer')).resolves.toBe(true);
    spy.mockRestore();
  });
});
