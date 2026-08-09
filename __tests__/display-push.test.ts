// The direct visible-push path (2026-08-09).
//
// Background: every user-facing push used to go through Expo, which submits it
// to FCM for us. On 2026-08-09 a "Session complete" banner took ~25 minutes to
// reach an Android tray while FCM-direct wakes to the same handset, during the
// same radio outage, landed in under a second — including two queued LATER that
// flushed the instant the link returned. Android visible pushes now go direct,
// data-only, which means nothing displays unless this code displays it.
//
// So the tests that matter here are the ones that cost a user a notification:
// the payload surviving the envelope, the banner actually being scheduled on the
// right channel with a working tap route, and the duplicate guard holding.

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({
  unregisterTaskAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  setNotificationHandler: jest.fn(),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  supabase: {},
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { extractData } from '@/lib/backgroundNotificationTask';
import {
  DISPLAY_NOTIFICATION_TYPE,
  isDisplayPush,
  presentDisplayPush,
} from '@/lib/displayPush';

const scheduleMock = Notifications.scheduleNotificationAsync as jest.Mock;

/** Exactly what _shared/visiblePush.ts buildDisplayPayload emits — every value a
 *  string, because FCM v1 requires it. */
function payload(overrides: Record<string, string> = {}) {
  return {
    type: 'display_notification',
    log_id: 'log-1',
    notif_type: 'session_completed',
    title: 'Session complete 💪',
    body: 'POWR · 60 min · +24 pts today',
    channel_id: 'powr_default_v2',
    sound: '1',
    route: '/(tabs)/index',
    data: JSON.stringify({ type: 'session_completed', route: '/(tabs)/index' }),
    ...overrides,
  };
}

beforeEach(async () => {
  scheduleMock.mockClear();
  await AsyncStorage.clear();
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' })) as unknown as typeof fetch;
});

describe('the payload marker', () => {
  // These two constants live in separate files on purpose — see the comment on
  // DISPLAY_NOTIFICATION_TYPE in backgroundNotificationTask. Pinning them here
  // is the price of that, and it is cheaper than pulling the supabase client
  // into the headless boot path for one string.
  it('is the same string on both sides of the wake boundary', () => {
    expect(DISPLAY_NOTIFICATION_TYPE).toBe('display_notification');
    expect(isDisplayPush({ type: DISPLAY_NOTIFICATION_TYPE })).toBe(true);
    expect(isDisplayPush({ type: 'gym_visit_check' })).toBe(false);
    expect(isDisplayPush(null)).toBe(false);
  });
});

describe('extractData', () => {
  it('still matches ONLY the wake type by default', () => {
    // The whole wake path calls extractData(raw) with no second argument. If
    // widening the matcher had changed that default, a visible push would be
    // handed to runVisitCheck as if it were a presence request.
    const raw = { data: payload() };
    expect(extractData(raw)).toEqual({});
  });

  it('finds a display push when asked for it, through the Android FCM shape', () => {
    const raw = { data: payload() };
    expect(extractData(raw, ['gym_visit_check', 'display_notification']).type)
      .toBe('display_notification');
  });

  it('finds a display push through the iOS Expo envelope', () => {
    // iOS stays on Expo today, but the matcher must not be the thing that breaks
    // if that changes — this is the exact envelope that ate the iOS wake path
    // for 17 days.
    const raw = {
      aps: { 'content-available': 1 },
      data: { body: payload(), dataString: JSON.stringify(payload()), scopeKey: '@powr/powr' },
    };
    expect(extractData(raw, ['display_notification']).log_id).toBe('log-1');
  });
});

describe('presentDisplayPush', () => {
  it('schedules a banner carrying the original type and route', async () => {
    expect(await presentDisplayPush(payload())).toBe(true);

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const arg = scheduleMock.mock.calls[0][0];
    expect(arg.trigger).toBeNull();
    expect(arg.content.title).toBe('Session complete 💪');
    expect(arg.content.body).toBe('POWR · 60 min · +24 pts today');
    // The tap has to route. getRouteFromNotification reads content.data.route,
    // and `type` is what NotificationsContext switches on for the points
    // refresh — neither may be left as the transport marker.
    expect(arg.content.data.route).toBe('/(tabs)/index');
    expect(arg.content.data.type).toBe('session_completed');
  });

  it('puts the banner on the channel the server named', async () => {
    // Omitting the channel is not a cosmetic slip: it lands the notification on
    // Expo's auto-created "Default" channel at importance DEFAULT, i.e. no
    // heads-up banner. That is what the 08-09 completion push did.
    await presentDisplayPush(payload());
    expect(scheduleMock.mock.calls[0][0].content.channelId).toBe('powr_default_v2');
  });

  it('stamps delivered_at exactly once, without awaiting it', async () => {
    await presentDisplayPush(payload());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/rpc/mark_push_displayed');
    expect(JSON.parse(init.body)).toEqual({ p_log_id: 'log-1' });
  });

  it('never displays the same send twice', async () => {
    // A duplicate banner is a shipped-and-regretted failure here: the beacon's
    // ANNOUNCE pass told users about a check-in twice and was deleted for it.
    expect(await presentDisplayPush(payload())).toBe(true);
    expect(await presentDisplayPush(payload())).toBe(false);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('still displays when the dedupe store is unreadable', async () => {
    // Fails OPEN, deliberately: a missing banner is worse than a repeated one.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage gone'));
    expect(await presentDisplayPush(payload())).toBe(true);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('survives a malformed data blob rather than dropping the banner', async () => {
    expect(await presentDisplayPush(payload({ data: '{not json' }))).toBe(true);
    const arg = scheduleMock.mock.calls[0][0];
    expect(arg.content.title).toBe('Session complete 💪');
    // Falls back to the flat keys the payload always carries.
    expect(arg.content.data.type).toBe('session_completed');
    expect(arg.content.data.route).toBe('/(tabs)/index');
  });

  it('refuses a payload with no copy in it', async () => {
    expect(await presentDisplayPush(payload({ title: '', body: '' }))).toBe(false);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('does not let a scheduling failure stamp a delivery that never happened', async () => {
    scheduleMock.mockRejectedValueOnce(new Error('no channel'));
    expect(await presentDisplayPush(payload())).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
