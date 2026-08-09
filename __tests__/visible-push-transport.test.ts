// Transport selection for user-facing pushes (2026-08-09).
//
// The bug this came from: a "Session complete" push was accepted by Expo with a
// clean receipt at 11:27:04.781 and reached the Android tray ~25 minutes later,
// while FCM-direct wakes to the same handset in the same radio outage landed in
// under a second — including two queued LATER that flushed the instant the link
// returned. Android visible pushes therefore submit straight to FCM now.
//
// Every test here guards a way this could COST a user their notification, which
// is the only currency that matters on this path: silently taking the new
// transport before the client can render it, dropping a push when FCM refuses
// it, or losing the id that ties a send to its delivery proof.

jest.mock('../supabase/functions/_shared/fcmV1.ts', () => ({
  sendFcmDataMessage: jest.fn(async () => ({ ok: true, messageName: 'projects/powr-life/messages/0:1' })),
}));
jest.mock('../supabase/functions/_shared/expoPush.ts', () => ({
  deliverExpoMessages: jest.fn(async (_admin, messages) => ({
    sent: messages.length, queued: messages.length, failed: 0, pruned: 0,
  })),
}));

import { deliverVisiblePush, buildDisplayPayload } from '@/supabase/functions/_shared/visiblePush';
import { sendFcmDataMessage } from '@/supabase/functions/_shared/fcmV1';
import { deliverExpoMessages } from '@/supabase/functions/_shared/expoPush';

const fcm = sendFcmDataMessage as jest.Mock;
const expo = deliverExpoMessages as jest.Mock;

const ANDROID = { expo_push_token: 'ExponentPushToken[and]', device_token: 'fcm-token', platform: 'android' };
const IOS = { expo_push_token: 'ExponentPushToken[ios]', device_token: 'apns-token', platform: 'ios' };

const CONTENT = {
  title: 'Session complete 💪',
  body: 'POWR · 60 min · +24 pts today',
  data: { type: 'session_completed', route: '/(tabs)/index' },
  sound: 'default' as const,
  channelId: 'powr_default_v2',
  priority: 'high' as const,
};

const LOG = { userId: 'user-1', type: 'gym_session_complete' };

/** Minimal supabase-js stand-in: records inserts/updates, answers the one
 *  system_config read the transport switch makes. */
function fakeAdmin(transport: string) {
  const inserts: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const thenable = (value: any) => ({ then: (fn: any) => Promise.resolve(fn(value)) });

  const admin = {
    inserts,
    updates,
    from(table: string) {
      if (table === 'system_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: transport } }) }) }),
        };
      }
      if (table === 'push_send_log') {
        return { insert: (row: any) => { inserts.push(row); return thenable({ error: null }); } };
      }
      if (table === 'user_push_tokens') {
        return { update: (row: any) => ({ eq: (_c: string, v: string) => { updates.push({ ...row, match: v }); return thenable({ error: null }); } }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return admin;
}

beforeEach(() => {
  fcm.mockClear();
  expo.mockClear();
  fcm.mockResolvedValue({ ok: true, messageName: 'projects/powr-life/messages/0:1' });
});

describe('the staging flag', () => {
  it('keeps Android on Expo until it is flipped', async () => {
    // ⚠ THE POINT OF THE WHOLE FLAG. A data-only push is rendered by the client;
    // a device on a bundle without lib/displayPush.ts shows NOTHING. Taking the
    // new transport by default would turn "the banner is late" into "there is no
    // banner", for every Android user, the moment the function deployed.
    const admin = fakeAdmin('expo');
    const res = await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);

    expect(fcm).not.toHaveBeenCalled();
    expect(expo).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ direct: 0, queued: 1 });
  });

  it('falls back to Expo when the config row is unreadable', async () => {
    const admin = fakeAdmin('expo');
    admin.from = ((table: string) => {
      if (table === 'system_config') throw new Error('config unreachable');
      return fakeAdmin('expo').from(table);
    }) as any;

    await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);
    expect(fcm).not.toHaveBeenCalled();
    expect(expo).toHaveBeenCalledTimes(1);
  });

  it('treats an unrecognised value as Expo, not as "try the new thing"', async () => {
    await deliverVisiblePush(fakeAdmin('FCM_DIRECT_PLEASE'), [ANDROID], CONTENT, LOG);
    expect(fcm).not.toHaveBeenCalled();
  });
});

describe('when fcm_direct is on', () => {
  it('sends Android direct and leaves iOS on Expo', async () => {
    const admin = fakeAdmin('fcm_direct');
    const res = await deliverVisiblePush(admin, [ANDROID, IOS], CONTENT, LOG);

    expect(fcm).toHaveBeenCalledTimes(1);
    expect(fcm.mock.calls[0][0]).toBe('fcm-token');
    expect(expo).toHaveBeenCalledTimes(1);
    expect(expo.mock.calls[0][1]).toHaveLength(1);
    expect(expo.mock.calls[0][1][0].to).toBe('ExponentPushToken[ios]');
    expect(res).toMatchObject({ direct: 1, queued: 1 });
  });

  it('still uses Expo for an Android row with no device token', async () => {
    await deliverVisiblePush(fakeAdmin('fcm_direct'), [{ ...ANDROID, device_token: null }], CONTENT, LOG);
    expect(fcm).not.toHaveBeenCalled();
    expect(expo).toHaveBeenCalledTimes(1);
  });

  it('logs the send under the SAME id it put in the payload', async () => {
    // This is what makes delivered_at attributable to one send. If the logged row
    // and the payload disagreed, the device's stamp would land on nothing and the
    // receipt would look permanently missing.
    const admin = fakeAdmin('fcm_direct');
    await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);

    const payload = fcm.mock.calls[0][1];
    expect(admin.inserts).toHaveLength(1);
    expect(admin.inserts[0].id).toBe(payload.n_log_id);
    expect(admin.inserts[0].transport).toBe('fcm_direct');
    expect(admin.inserts[0].status).toBe('accepted');
  });

  it('falls back to Expo when FCM has no credentials', async () => {
    // The documented rollback: unset FCM_SERVICE_ACCOUNT and every row goes back
    // to the old path. It must not cost a push on the way.
    fcm.mockResolvedValue({ ok: false, unavailable: true, error: 'fcm_credentials_unavailable' });
    const admin = fakeAdmin('fcm_direct');
    const res = await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);

    expect(expo).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ direct: 0, queued: 1 });
    // No log row: the Expo path writes its own, and a phantom 'rejected' here
    // would make a healthy rollback look like a delivery failure.
    expect(admin.inserts).toHaveLength(0);
  });

  it('retries a refused message on Expo rather than dropping it', async () => {
    // FCM refusing means nothing was delivered, so a second attempt cannot
    // duplicate — and a user-facing push is worth it.
    fcm.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    const admin = fakeAdmin('fcm_direct');
    const res = await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);

    expect(expo).toHaveBeenCalledTimes(1);
    expect(res.failed).toBe(1);
    expect(res.queued).toBe(1);
    expect(admin.inserts[0].status).toBe('rejected');
  });

  it('clears only device_token when FCM reports the token unregistered', async () => {
    // Never the whole row: it also carries the Expo token, and UNREGISTERED can
    // be an environment mismatch rather than a dead device. Deleting the row
    // would silence visible pushes too.
    fcm.mockResolvedValue({ ok: false, unregistered: true, error: 'UNREGISTERED' });
    const admin = fakeAdmin('fcm_direct');
    await deliverVisiblePush(admin, [ANDROID], CONTENT, LOG);

    expect(admin.updates).toEqual([{ device_token: null, match: 'fcm-token' }]);
  });
});

describe('the Expo fallback message', () => {
  it('supplies a channel when the caller forgot one', async () => {
    // The 08-09 completion push omitted channelId, which per Expo's docs means
    // Expo's auto-created "Default" channel at importance DEFAULT — a tray entry
    // with no heads-up banner, not the app's HIGH-importance channel.
    const { channelId: _drop, ...noChannel } = CONTENT;
    await deliverVisiblePush(fakeAdmin('expo'), [IOS], noChannel, LOG);
    expect(expo.mock.calls[0][1][0].channelId).toBe('powr_default_v2');
    expect(expo.mock.calls[0][1][0].priority).toBe('high');
  });
});

describe('buildDisplayPayload', () => {
  it('stringifies every value, as FCM v1 requires', () => {
    const payload = buildDisplayPayload('log-1', 'gym_session_complete', CONTENT);
    for (const [key, value] of Object.entries(payload)) {
      expect(typeof value).toBe('string');
      expect(key).not.toBe('');
    }
  });

  it('carries the copy, the route and the original type', () => {
    const payload = buildDisplayPayload('log-1', 'gym_session_complete', CONTENT);
    expect(payload.type).toBe('display_notification');
    expect(payload.n_title).toBe('Session complete 💪');
    expect(payload.n_route).toBe('/(tabs)/index');
    expect(payload.n_type).toBe('gym_session_complete');
    expect(JSON.parse(payload.n_data)).toEqual(CONTENT.data);
  });

  it('keeps every field out of expo-notifications reserved namespace', () => {
    // Field 2026-08-09: `title` in the data payload made expo-notifications post
    // its own body-less banner alongside ours, and `body` was parsed as JSON.
    // The library reads these straight off remoteMessage.data and presents
    // BEFORE our task runs, so this can only be prevented at the sender.
    const payload = buildDisplayPayload('log-1', 'gym_session_complete', CONTENT);
    for (const reserved of ['title', 'message', 'body', 'sound', 'vibrate',
                            'sticky', 'color', 'autoDismiss', 'categoryId',
                            'subtitle', 'badge']) {
      expect(payload).not.toHaveProperty(reserved);
    }
  });
});
