/**
 * Pins the device-kick watcher against the Realtime channel cache.
 *
 * THE BUG (Sentry 140313562, reported again 2026-08-14 off a stale bundle):
 * `supabase.channel(topic)` is a CACHE LOOKUP, not a factory — RealtimeClient
 * returns any existing instance with the same topic — and `.on()` throws
 * "cannot add `postgres_changes` callbacks ... after `subscribe()`" on an
 * instance that is already joined. Handed back a live channel, registration
 * threw, and the watcher that force-signs-out a kicked device never armed.
 *
 * Removing the old channel first does NOT close it. removeChannel only evicts
 * from the cache when the server ACKS the leave:
 *
 *     const status = await channel.unsubscribe()   // ok | timed out | error
 *     if (status === 'ok') channel.teardown()      // _remove fires via _onClose
 *
 * On a slow or half-open socket that ack never lands and the joined instance
 * survives in the cache. The field report came off a device seeing 7-second
 * REST round trips, so this is the normal case there, not a freak one.
 *
 * The fake below reproduces BOTH of those semantics exactly, because a fake
 * that evicts unconditionally would pass against the code that shipped the bug.
 *
 * The invariant: registration never asks for a topic that could already be in
 * the cache, so no leave — however slow, however broken — can stop the watcher
 * arming. The old fix (sweep by exact topic, then reuse it) depended on the
 * eviction it could not guarantee; the sequence number does not depend on
 * anything.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

/** A session_id claim is all AuthContext decodes out of the JWT. */
const jwt = (sessionId: string) =>
  `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64')}.y`;

const SESSION = (sessionId: string) => ({
  access_token: jwt(sessionId),
  user: { id: 'u-1', user_metadata: { onboarding_complete: true } },
});

// ─── the Realtime client fake, faithful to @supabase/realtime-js ────────────

type FakeChannel = {
  topic: string;
  joined: boolean;
  on: (type: string) => FakeChannel;
  subscribe: () => FakeChannel;
  unsubscribe: () => Promise<'ok' | 'timed out'>;
};

/** Set to 'timed out' to model the half-open socket that caused the field bug. */
let leaveAck: 'ok' | 'timed out' = 'ok';

let channels: FakeChannel[] = [];
/** Every topic ever handed to .channel(), in order — the assertion surface. */
let requestedTopics: string[] = [];

function makeChannel(topic: string): FakeChannel {
  const ch: FakeChannel = {
    topic,
    joined: false,
    on(type: string) {
      // RealtimeChannel.on: throws while joined OR joining.
      if (ch.joined) {
        throw new Error(`cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`);
      }
      return ch;
    },
    subscribe() { ch.joined = true; return ch; },
    unsubscribe: async () => leaveAck,
  };
  return ch;
}

const realtime = {
  channel(name: string) {
    requestedTopics.push(name);
    const topic = `realtime:${name}`;
    // THE CACHE. Returning a fresh channel here would make this suite green
    // against the very code that shipped the bug.
    const existing = channels.find(c => c.topic === topic);
    if (existing) return existing;
    const ch = makeChannel(topic);
    channels.push(ch);
    return ch;
  },
  getChannels: () => channels,
  async removeChannel(ch: FakeChannel) {
    const status = await ch.unsubscribe();
    if (status === 'ok') channels = channels.filter(c => c.topic !== ch.topic);
    return status;
  },
};

// ─── auth fake: drives onAuthStateChange by hand ────────────────────────────

type Listener = (event: string, session: unknown) => void | Promise<void>;
let listeners: Listener[] = [];
const emit = async (event: string, session: unknown) => {
  for (const l of listeners) await l(event, session);
};

const mockSupabase = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: jest.fn((cb: Listener) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signOut: jest.fn(async () => ({ error: null })),
    setSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: null }, error: null })),
  },
  from: jest.fn(() => ({ upsert: jest.fn(async () => ({ error: null })) })),
  channel: (name: string) => realtime.channel(name),
  getChannels: () => realtime.getChannels(),
  removeChannel: (ch: FakeChannel) => realtime.removeChannel(ch),
};

jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  authorizeSessionErase: jest.fn(),
  EMAIL_CONFIRM_REDIRECT: 'powr://confirm',
}));
jest.mock('@/lib/backgroundRest', () => ({
  clearDeviceWakeTicket: jest.fn(async () => {}),
  ensureDeviceWakeTicket: jest.fn(async () => {}),
  readStoredSession: jest.fn(async () => null),
}));
jest.mock('@/lib/deviceLock', () => ({
  claimDevice: jest.fn(async () => ({ status: 'ok' })),
  confirmDeviceTransfer: jest.fn(async () => ({ status: 'ok' })),
  getDeviceId: jest.fn(async () => 'device-1'),
}));
jest.mock('@/lib/locationPermission', () => ({ reportLocationPermission: jest.fn() }));
jest.mock('@/context/GeofenceContext', () => ({ reconcileActiveOnLogin: jest.fn(async () => {}) }));
jest.mock('@/components/TransferDeviceSheet', () => () => null);
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo-linking', () => ({
  createURL: jest.fn(() => 'powr://'),
  parse: jest.fn(() => ({})),
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })) }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

// require, not import: babel hoists `import` above the const declarations the
// jest.mock factories close over, so an import here reads mockSupabase in its TDZ.
const { AuthProvider } = require('@/context/AuthContext') as typeof import('@/context/AuthContext');

/** Topics minted for the single-device watcher, in order. */
const watcherTopics = () => requestedTopics.filter(t => t.startsWith('single-device:'));

beforeEach(() => {
  jest.clearAllMocks();
  channels = [];
  requestedTopics = [];
  listeners = [];
  leaveAck = 'ok';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

async function mountProvider() {
  render(<AuthProvider><></></AuthProvider>);
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
}

describe('the watcher arms even when the previous channel will not leave', () => {
  it('re-registers the SAME session after a synthetic sign-out — the field sequence', async () => {
    // auth-js emits SIGNED_OUT from its own refresh-failure paths. The erase gate
    // blocks the keychain wipe, AuthContext restores the surviving session, and
    // the SAME session_id registers again — with the first channel still joined
    // in the cache because its leave never acked. This is the collision.
    leaveAck = 'timed out';
    await mountProvider();

    await emit('SIGNED_IN', SESSION('s-1'));
    await waitFor(() => expect(watcherTopics()).toHaveLength(1));

    await emit('SIGNED_OUT', null);          // cleanupSessionWatch — unawaited removal
    await emit('SIGNED_IN', SESSION('s-1')); // restored: same session_id, again

    await waitFor(() => expect(watcherTopics()).toHaveLength(2));

    // The bug, stated directly: the second topic must not be the first one.
    const [first, second] = watcherTopics();
    expect(second).not.toBe(first);

    // And the watcher is actually listening — under the old code .on() threw
    // here and the device could no longer be kicked.
    const armed = channels.filter(c => c.joined);
    expect(armed).toHaveLength(2);
    expect(armed[1].topic).toBe(`realtime:${second}`);
  });

  it('mints a distinct topic for every attempt, ack or no ack', async () => {
    leaveAck = 'timed out';
    await mountProvider();

    await emit('SIGNED_IN', SESSION('s-1'));
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_IN', SESSION('s-1'));
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_IN', SESSION('s-1'));

    await waitFor(() => expect(watcherTopics()).toHaveLength(3));
    expect(new Set(watcherTopics()).size).toBe(3);
  });

  it('still carries the user and session ids, so the topic stays diagnosable', async () => {
    await mountProvider();
    await emit('SIGNED_IN', SESSION('s-1'));
    await waitFor(() => expect(watcherTopics()).toHaveLength(1));
    expect(watcherTopics()[0]).toMatch(/^single-device:u-1:s-1:\d+$/);
  });
});

describe('the sweep', () => {
  it('evicts previous attempts once the socket is healthy again', async () => {
    // Two dead channels accumulate while leaves time out; the next registration
    // sweeps by prefix, so nothing is orphaned forever.
    leaveAck = 'timed out';
    await mountProvider();
    await emit('SIGNED_IN', SESSION('s-1'));
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_IN', SESSION('s-1'));
    await waitFor(() => expect(channels).toHaveLength(2));

    leaveAck = 'ok';
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_IN', SESSION('s-1'));

    // Only the newest watcher survives — the backlog left it, it did not leak.
    await waitFor(() => expect(channels).toHaveLength(1));
    expect(channels[0].topic).toBe(`realtime:${watcherTopics().at(-1)}`);
  });

  it('does not block arming on a leave that never returns', async () => {
    // The removals are fire-and-forget precisely because awaiting them was the
    // window the collision lived in: a channel whose unsubscribe() hangs must
    // not hold the new watcher hostage behind it.
    await mountProvider();
    await emit('SIGNED_IN', SESSION('s-1'));
    await waitFor(() => expect(channels).toHaveLength(1));

    channels[0].unsubscribe = () => new Promise(() => { /* never settles */ });
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_IN', SESSION('s-1'));

    await waitFor(() => expect(watcherTopics()).toHaveLength(2));
    expect(channels.some(c => c.joined && c.topic === `realtime:${watcherTopics()[1]}`)).toBe(true);
  });
});
