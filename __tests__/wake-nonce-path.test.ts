// Pins the ticketed (nonce) wake contract — the fix for the 2026-08-05 frozen
// wake class: a wake carrying the beacon's nonce must run with ZERO auth work,
// answering over raw fetch with the anon key. What must never regress:
//   1. extractData passes the nonce through from every payload shape.
//   2. The nonce RPCs hit /rest/v1/rpc/* with ONLY the anon key — never the
//      supabase client, never a user JWT.
//   3. confirmGymVisitViaNonce mirrors confirmGymVisit's return contract and
//      never throws (a wake must not be crashable by its answer).

import { extractData } from '@/lib/backgroundNotificationTask';
import {
  confirmGymVisitViaNonce,
  logGymWakeReceivedViaNonce,
} from '@/lib/gymVisits';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationHandler: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  registerTaskAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('@/lib/authFresh', () => ({
  callWithAuthRetry: jest.fn(),
  ensureFreshSession: jest.fn(async () => null),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {},
  SUPABASE_URL: 'https://test-ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
}));

const PAYLOAD = { type: 'gym_visit_check', visit_id: 'v-1', stage: 'dwell', nonce: 'ticket-abc' };

describe('extractData nonce passthrough', () => {
  it.each([
    ['android direct FCM', { data: PAYLOAD }],
    ['iOS Expo envelope', { data: { body: PAYLOAD, dataString: 'x', scopeKey: 's' } }],
    ['dataString fallback', { data: { dataString: JSON.stringify(PAYLOAD) } }],
  ])('%s', (_name, raw) => {
    expect(extractData(raw).nonce).toBe('ticket-abc');
  });
});

describe('nonce RPCs', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({ triggered: 'claim' }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  it('confirm hits confirm_gym_visit_v3 with only the anon key', async () => {
    const res = await confirmGymVisitViaNonce('v-1', 'ticket-abc', true, { stage: 'dwell' }, true, 1754000000000);

    expect(res).toEqual({ ok: true, triggered: 'claim' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test-ref.supabase.co/rest/v1/rpc/confirm_gym_visit_v3');
    expect(init.headers.apikey).toBe('anon-key-123');
    expect(init.headers.Authorization).toBe('Bearer anon-key-123');
    const body = JSON.parse(init.body);
    expect(body.p_nonce).toBe('ticket-abc');
    expect(body.p_inside).toBe(true);
    expect(body.p_request_credit).toBe(true);
  });

  it('telemetry hits log_gym_wake_received_v2 and swallows failures', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid or expired wake nonce' });
    await expect(logGymWakeReceivedViaNonce('v-1', 'stale-ticket', 'dwell')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain('log_gym_wake_received_v2');
  });

  it('confirm returns ok:false instead of throwing when the server rejects the ticket', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid or expired wake nonce' });
    await expect(confirmGymVisitViaNonce('v-1', 'stale-ticket', true)).resolves.toEqual({ ok: false });
  });

  it('never touches the supabase client', async () => {
    await confirmGymVisitViaNonce('v-1', 'ticket-abc', false);
    // The mocked client is an empty object — any property access in the nonce
    // path would have thrown before this assertion.
    expect(fetchMock).toHaveBeenCalled();
  });
});
