// The wake payload matcher. This file exists because a `??` chain in extractData
// silently ate EVERY iOS wake for 17 days: ~200 pushes from 2026-07-13 onward,
// zero confirmed_* rows, while Android worked perfectly off the same line.
//
// The shapes below are not invented. The iOS ones are copied from
// expo-notifications' own BackgroundEventTransformerSpec.swift (and the transform
// in BackgroundEventTransformer.swift), which wraps the APNs userInfo as
//   { data: { body: <our payload>, dataString, … }, aps, notification }
// so `raw.data` exists but is the ENVELOPE and carries no `type`. Android's direct
// FCM message puts our keys at `raw.data` verbatim. Both must resolve to the same
// payload — that is the whole contract, and nothing else in the suite covers it.

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({
  unregisterTaskAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => {}),
}));

import { extractData } from '@/lib/backgroundNotificationTask';

const PAYLOAD = { type: 'gym_visit_check', visit_id: 'visit-1', stage: 'dwell' as const };

describe('extractData', () => {
  it('finds the payload in the iOS Expo/APNs background envelope', () => {
    // Exactly what BackgroundEventTransformer.transform produces for a
    // content-available push whose developer data Expo nested under `body`.
    const iosTaskData = {
      notification: null,
      aps: { 'content-available': 1 },
      data: {
        body: PAYLOAD,
        dataString: JSON.stringify(PAYLOAD),
        scopeKey: '@powr/powr',
        experienceId: '@powr/powr',
        projectId: '7f4fe661-8919-4790-bd66-209373f958de',
      },
    };

    expect(extractData(iosTaskData)).toEqual(PAYLOAD);
  });

  it('finds the payload in the Android direct-FCM shape', () => {
    // gym-visit-beacon sends {...payload, body: JSON.stringify(payload)} to FCM,
    // so our keys sit at the top level of `data` AND `data.body` is a STRING.
    // The string must not be mistaken for the payload object.
    const androidTaskData = {
      data: { ...PAYLOAD, body: JSON.stringify(PAYLOAD) },
    };

    expect(extractData(androidTaskData)).toEqual({ ...PAYLOAD, body: JSON.stringify(PAYLOAD) });
    expect(extractData(androidTaskData).type).toBe('gym_visit_check');
  });

  it('falls back to the mirrored dataString when the object nesting changes', () => {
    // Guards the next envelope reshuffle: as long as Expo still mirrors the JSON,
    // the wake path survives a shape we have not seen yet.
    const futureShape = {
      data: { dataString: JSON.stringify(PAYLOAD), somethingNew: { deeper: PAYLOAD } },
    };

    expect(extractData(futureShape)).toEqual(PAYLOAD);
  });

  it('reads the foreground UNNotification shape', () => {
    expect(extractData({ request: { content: { data: PAYLOAD } } })).toEqual(PAYLOAD);
  });

  it('ignores a notification that is not ours', () => {
    // A visible push (e.g. session_completed) must not be treated as a wake —
    // running a presence check off one would burn a GPS fix for nothing.
    expect(extractData({ data: { body: { type: 'session_completed', title: 'Session recorded' } } }))
      .toEqual({});
  });

  it('survives null, undefined and junk without throwing', () => {
    expect(extractData(null)).toEqual({});
    expect(extractData(undefined)).toEqual({});
    expect(extractData('not an object')).toEqual({});
    expect(extractData({ data: { dataString: '{ not json' } })).toEqual({});
  });
});
