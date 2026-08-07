/**
 * The reporter's contract has two halves, and the tests are split along them.
 *
 * The first is that nothing sensitive leaves the device. Unlike app_events —
 * which promises no free text by construction — this table carries messages and
 * stack traces, and a Supabase error message can quite happily contain an access
 * token, an email address or a gym's coordinates. Redaction is therefore
 * asserted field by field, and asserted to run BEFORE truncation, because
 * truncating first slices a token into a fragment the pattern no longer matches
 * and ships its head anyway.
 *
 * The second is that a crash storm cannot become a second incident: bounded
 * captures, bounded spool, no retry loop, and a send path that never touches
 * supabase-js — the auth machinery lib/backgroundRest.ts exists to keep off a
 * wake is exactly what would freeze the wake we are trying to report from.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockReadAuth = jest.fn().mockResolvedValue(null);
jest.mock('@/lib/backgroundRest', () => ({
  readBackgroundAuth: () => mockReadAuth(),
}));

// A throwing proxy: any touch of supabase-js from this module is a test failure,
// not a style opinion. It is what freezes background wakes.
jest.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_TESTKEY',
  get supabase(): never {
    throw new Error('crashReporter must never touch supabase-js');
  },
}));

import { __reporterInternals as internals, buildRow, fingerprint, flush, ingest, redact } from '@/lib/crashReporter';

const okResponse = { status: 201 } as Response;

/**
 * Assembled at runtime rather than written out as a literal. A realistic-looking
 * JWT in the source trips secret scanners in CI — GitGuardian flagged exactly
 * these three fixtures on #346 — and a test fixture is never worth a red build
 * or a rotation scare. Only the SHAPE matters to what is being tested.
 */
const fakeJwt = () => ['eyJ' + 'A'.repeat(20), 'B'.repeat(20), 'C'.repeat(20)].join('.');
const fakePublishableKey = () => ['sb', 'publishable', 'F'.repeat(24)].join('_');

beforeEach(async () => {
  // Settle BEFORE resetting: reset() replaces the write chain, which would
  // orphan a spool write still in flight from the previous case and let it land
  // after the clear.
  await internals.settle();
  internals.reset();
  await AsyncStorage.clear();
  mockReadAuth.mockClear().mockResolvedValue(null);
  global.fetch = jest.fn().mockResolvedValue(okResponse) as unknown as typeof fetch;
  // Sending is off by default under jest so no suite can post to the live
  // project by accident (it happened — see postRow). This file is the one that
  // turns it back on, and only against the mocked fetch above.
  internals.setNetworkEnabled(true);
});

afterEach(() => {
  internals.setNetworkEnabled(false);
});

describe('redaction', () => {
  it('removes every class of secret we know can appear in a message', () => {
    const dirty = [
      'user jamie@powr.life failed',
      `token ${fakeJwt()}`,
      `key ${fakePublishableKey()}`,
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      'GET /rest/v1/x?access_token=supersecretvalue&select=*',
      'at 51.50735, -0.12776',
    ].join('\n');

    const clean = redact(dirty);

    expect(clean).toContain('<email>');
    expect(clean).toContain('<jwt>');
    expect(clean).toContain('<key>');
    expect(clean).toContain('bearer <redacted>');
    expect(clean).toContain('access_token=<redacted>');
    expect(clean).toContain('<coord>');
    expect(clean).not.toContain('jamie@powr.life');
    expect(clean).not.toContain('supersecretvalue');
    expect(clean).not.toContain('51.50735');
  });

  it('keeps identical uuids identical, and different ones different', () => {
    // The structural fact worth keeping is "these two references are the same
    // object" — that is what you reason from — with none of the identifier.
    const a = '11111111-2222-3333-4444-555555555555';
    const b = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const clean = redact(`visit ${a} for user ${b}, retry on ${a}`);

    expect(clean).toBe('visit <id1> for user <id2>, retry on <id1>');
  });

  it('keeps line numbers, which are how a stack locates the defect', () => {
    expect(redact('at claim (lib/gymVisits.ts:412:19)')).toContain('412:19');
  });

  it('runs before truncation, so a secret deep in a long message still goes', () => {
    const jwt = fakeJwt();
    const row = buildRow({
      source: 'manual',
      fatal: false,
      message: `${'x'.repeat(1000)} ${jwt}`,
    });
    expect(row.message).not.toContain('eyJ');
    expect(row.message.length).toBeLessThanOrEqual(internals.CAP.message);
  });
});

describe('truncation', () => {
  it('caps every field at exactly the length the migration allows', () => {
    // A mismatch here is rejected by PostgREST as 23514, and postRow does not
    // read the response body — so the report would be lost silently.
    // Spaced words, not one long run of characters: an unbroken 40-character
    // token is redacted to <token> before it is ever truncated, which is the
    // correct behaviour and would quietly make this assertion meaningless.
    const long = (n: number) => 'word '.repeat(n);
    const row = buildRow({
      source: 'manual',
      fatal: true,
      name: long(100),
      message: long(1000),
      stack: long(4000),
      componentStack: long(2000),
      route: long(50),
      task: long(30),
    });

    expect(row.name!.length).toBe(internals.CAP.name);
    expect(row.message.length).toBe(internals.CAP.message);
    expect(row.stack!.length).toBe(internals.CAP.stack);
    expect(row.component_stack!.length).toBe(internals.CAP.componentStack);
    expect(row.route!.length).toBe(internals.CAP.route);
    expect(row.task!.length).toBe(internals.CAP.task);
    expect(row.fingerprint.length).toBeLessThanOrEqual(internals.CAP.fingerprint);
  });

  it('never sends an empty message, which the column forbids', () => {
    expect(buildRow({ source: 'manual', fatal: false, message: '' }).message).toBe('unknown');
  });

  it('drops props wholesale rather than sending something over cap', () => {
    // Many short values, not one long one: a single long run of characters is
    // redacted to <token> before the cap is ever consulted, which would make
    // this assertion pass without exercising the branch it names.
    const props: Record<string, string> = {};
    for (let i = 0; i < 40; i++) props[`key_${i}`] = `some readable prose value ${i} `.repeat(3);

    expect(buildRow({ source: 'manual', fatal: false, message: 'x', props }).props).toEqual({
      note: 'props omitted: over cap',
    });
  });

  it('scrubs a long value inside props rather than dropping it', () => {
    const row = buildRow({
      source: 'manual',
      fatal: false,
      message: 'x',
      props: { blob: 'y'.repeat(4000) },
    });
    expect(JSON.stringify(row.props)).toContain('<token>');
  });
});

describe('fingerprinting', () => {
  it('groups two runs of the same bug that differ only by ids and numbers', () => {
    const stack = 'Error\n    at claim (lib/gymVisits.ts:412:19)';
    const a = fingerprint('TypeError', redact('visit 11111111-2222-3333-4444-555555555555 failed after 3 tries'), stack);
    const b = fingerprint('TypeError', redact('visit aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee failed after 91 tries'), stack);
    expect(a).toBe(b);
  });

  it('separates genuinely different bugs', () => {
    const stack = 'Error\n    at claim (lib/gymVisits.ts:412:19)';
    expect(fingerprint('TypeError', 'a is undefined', stack)).not.toBe(
      fingerprint('TypeError', 'b is not a function', stack),
    );
  });

  it('skips node_modules frames to find the one that is ours', () => {
    const stack = [
      'Error: boom',
      '    at step (node_modules/@supabase/x.js:1:1)',
      '    at fetch (node_modules/whatwg-fetch/dist.js:2:2)',
      '    at runVisitCheck (lib/gymVisits.ts:412:19)',
    ].join('\n');
    expect(internals.topOwnFrame(stack)).toBe('lib/gymVisits.ts:412:19');
  });

  it('still separates bugs on a release stack, which has no source paths at all', () => {
    // Hermes in production gives you main.jsbundle:1:<offset> and nothing else.
    // Without matching that, every release fingerprint would share one frame.
    const a = internals.topOwnFrame('Error\n    at f (main.jsbundle:1:207431)');
    const b = internals.topOwnFrame('Error\n    at g (main.jsbundle:1:998877)');
    expect(a).toBe('main.jsbundle:1:207431');
    expect(a).not.toBe(b);
  });
});

describe('budgets', () => {
  it('collapses a storm of one error into a single row with a repeat count', () => {
    for (let i = 0; i < 400; i++) ingest({ source: 'global_handler', fatal: true, message: 'same bug' });
    const rows = internals.peek();
    expect(rows).toHaveLength(1);
    expect(rows[0].repeat).toBe(400);
  });

  it('caps distinct non-fatal bugs per launch', () => {
    for (let i = 0; i < 200; i++) {
      ingest({ source: 'decorator', fatal: false, message: `noise ${i}`, stack: `at f${i} (lib/a${i}.ts:1:1)` });
    }
    expect(internals.peek()).toHaveLength(internals.MAX_DISTINCT_PER_LAUNCH);
  });

  it('never drops a fatal for a budget reason', () => {
    // The decorator sees every console.error in the app, on exactly the paths
    // that are hot during an incident. If routine logging could spend the
    // budget, the fatal that follows would be the one report we lose — which is
    // the whole thing this change exists to capture.
    for (let i = 0; i < 50; i++) {
      ingest({ source: 'decorator', fatal: false, message: `noise ${i}`, stack: `at f${i} (lib/a${i}.ts:1:1)` });
    }
    ingest({ source: 'global_handler', fatal: true, message: 'the actual crash', stack: 'at boom (lib/z.ts:9:9)' });

    expect(internals.peek().some((r) => r.message === 'the actual crash')).toBe(true);
  });

  it('leaves a mark on a launch where reports were dropped', () => {
    // Stamped onto a row that already exists: once the cap is reached there may
    // never be a next report, so a starved launch would otherwise look quiet.
    for (let i = 0; i < 40; i++) {
      ingest({ source: 'decorator', fatal: false, message: `noise ${i}`, stack: `at f${i} (lib/a${i}.ts:1:1)` });
    }
    const marked = internals.peek().filter((r) => (r.props as any)?.dropped_this_launch != null);
    expect(marked.length).toBeGreaterThan(0);
  });

  it('numbers reports within a launch so the culprit is identifiable', () => {
    ingest({ source: 'global_handler', fatal: true, message: 'first', stack: 'at a (lib/a.ts:1:1)' });
    ingest({ source: 'global_handler', fatal: true, message: 'second', stack: 'at b (lib/b.ts:1:1)' });
    const rows = internals.peek();
    expect(rows[0].seq).toBe(0);
    expect(rows[1].seq).toBe(1);
    expect(rows[0].launch_id).toBe(rows[1].launch_id);
  });
});

describe('the spool', () => {
  it('keeps this launch’s seq-0 report even when the cap forces an eviction', () => {
    // seq 0 threw first; everything after it in a launch is usually the
    // downstream victim. Dropping the cause to keep the symptom is the wrong
    // half to lose.
    const rows = Array.from({ length: internals.MAX_SPOOL + 5 }, (_, i) => ({
      seq: i,
      fingerprint: `f${i}`,
      launch_id: 'now',
    }));
    const kept = internals.evict(rows as any, 'now');
    expect(kept).toHaveLength(internals.MAX_SPOOL);
    expect(kept.some((r: any) => r.seq === 0)).toBe(true);
  });

  it('does not let old seq-0 reports crowd out new ones', () => {
    // Protecting every seq-0 row ever spooled would let twenty old ones fill
    // the queue and evict each new report the moment it arrived.
    const old = Array.from({ length: internals.MAX_SPOOL }, (_, i) => ({
      seq: 0,
      fingerprint: `old${i}`,
      launch_id: `launch-${i}`,
    }));
    const fresh = { seq: 1, fingerprint: 'fresh', launch_id: 'now' };
    const kept = internals.evict([...old, fresh] as any, 'now');

    expect(kept).toHaveLength(internals.MAX_SPOOL);
    expect(kept.some((r: any) => r.fingerprint === 'fresh')).toBe(true);
  });

  it('persists a captured report so it survives the process dying', async () => {
    ingest({ source: 'global_handler', fatal: true, message: 'spool me' });
    await internals.settle();
    const spooled = await internals.peekSpool();
    expect(spooled.some((r) => r.message === 'spool me')).toBe(true);
  });

  it('heals a corrupt spool instead of wedging on it forever', async () => {
    // A kill mid-write leaves truncated JSON. Without this, every future read
    // AND write throws on the same value, so the queue is dead for the life of
    // the install and every later crash is lost silently.
    await AsyncStorage.setItem(internals.SPOOL_KEY, '{"truncated": tru');

    ingest({ source: 'global_handler', fatal: true, message: 'after corruption' });
    await internals.settle();

    const spooled = await internals.peekSpool();
    expect(spooled).toHaveLength(1);
    expect(spooled[0].message).toBe('after corruption');
  });

  it('loses nothing when several reports land in the same tick', async () => {
    for (let i = 0; i < 5; i++) {
      ingest({ source: 'global_handler', fatal: true, message: `bug ${i}`, stack: `at f${i} (lib/a${i}.ts:1:1)` });
    }
    await internals.settle();
    expect(await internals.peekSpool()).toHaveLength(5);
  });
});

describe('sending', () => {
  it('posts to app_errors without asking PostgREST to return the row', async () => {
    // app_errors has no member SELECT policy on purpose, so return=representation
    // would be refused by RLS and every report would be lost.
    ingest({ source: 'global_handler', fatal: true, message: 'send me' });
    await internals.settle();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/app_errors');
    expect(init.headers.Prefer).toBe('return=minimal');
    expect(init.headers.Prefer).not.toContain('representation');
    expect(init.headers.apikey).toBe('sb_publishable_TESTKEY');
  });

  it('sends anonymously when nobody is signed in, rather than not at all', async () => {
    // The crash that stops a member ever reaching a session can only arrive
    // this way, and it is the class nobody can report any other way.
    ingest({ source: 'global_handler', fatal: true, message: 'pre-auth crash' });
    await internals.settle();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body).user_id).toBeNull();
  });

  it('attributes the report when a token is on hand', async () => {
    mockReadAuth.mockResolvedValue({ accessToken: 'tok', userId: 'user-1' });
    ingest({ source: 'global_handler', fatal: true, message: 'signed in crash' });
    await internals.settle();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body).user_id).toBe('user-1');
  });

  it('never puts the access token in the report itself', async () => {
    mockReadAuth.mockResolvedValue({ accessToken: 'supersecrettoken', userId: 'user-1' });
    ingest({ source: 'global_handler', fatal: true, message: 'x' });
    await internals.settle();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(JSON.stringify({ ...body })).not.toContain('supersecrettoken');
  });
});

describe('flushing what earlier launches left behind', () => {
  async function spoolOne(message: string) {
    ingest({ source: 'global_handler', fatal: true, message });
    await internals.settle();
    (global.fetch as jest.Mock).mockClear();
  }

  it('clears a report once it lands', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 } as Response);
    await spoolOne('will retry');

    (global.fetch as jest.Mock).mockResolvedValue(okResponse);
    await flush();
    expect(await internals.peekSpool()).toHaveLength(0);
  });

  it('keeps a report the server could not take yet', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 } as Response);
    await spoolOne('server down');

    await flush();
    expect(await internals.peekSpool()).toHaveLength(1);
  });

  it('drops a report the server will never accept, rather than wedging on it', async () => {
    // A 4xx will not become a 2xx on a retry. Occupying the spool forever with
    // one malformed row would cost every report behind it.
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 } as Response);
    await spoolOne('malformed');

    (global.fetch as jest.Mock).mockResolvedValue({ status: 400 } as Response);
    await flush();
    expect(await internals.peekSpool()).toHaveLength(0);
  });

  it('never rejects, whatever the network does', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    ingest({ source: 'global_handler', fatal: true, message: 'offline crash' });
    await internals.settle();
    await expect(flush()).resolves.toBeUndefined();
  });

  it('does nothing at all when there is nothing to send', async () => {
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends nothing at all from a test runner unless a suite opts in', async () => {
    // The guard that stops `npm test` writing to the production incident table.
    // Suites that drive the real background task reach reportHandled without
    // mocking supabase or fetch, and a green run says nothing about it.
    internals.setNetworkEnabled(false);

    ingest({ source: 'global_handler', fatal: true, message: 'must not leave the machine' });
    await internals.settle();
    await flush();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not send everything twice when two drains overlap', async () => {
    // The recovery screen's Try again remounts the root layout, which re-arms
    // the flush timer while the first drain may still be in flight.
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 } as Response);
    await spoolOne('spooled once');

    (global.fetch as jest.Mock).mockResolvedValue(okResponse);
    await Promise.all([flush(), flush(), flush()]);

    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });
});

describe('scrubbing cost', () => {
  it('stays fast on a pathological input, because it runs inside the handler', () => {
    // Redaction is synchronous and on the JS thread. A stall here is
    // indistinguishable from the freeze this whole area of the app fights.
    const started = Date.now();
    redact('a'.repeat(200_000));
    redact(`${'x '.repeat(50_000)}user@example.com`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('discards text beyond the window rather than shipping it unscrubbed', () => {
    const jwt = fakeJwt();
    const row = buildRow({ source: 'manual', fatal: false, message: `${'word '.repeat(100_000)}${jwt}` });
    expect(row.message).not.toContain('eyJ');
  });
});
