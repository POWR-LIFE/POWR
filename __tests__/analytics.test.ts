/**
 * The contract these tests defend is not "analytics are accurate" — they are
 * lossy on purpose — it is that analytics can never damage the app around them.
 * Each case below is a way instrumentation could leak out into a member's
 * experience: by throwing into a call site, by growing without bound, by
 * sending when it has been switched off, or by swallowing a button press.
 */

// jest.mock factories are hoisted above the file, so anything they close over
// has to be `mock`-prefixed for Babel to allow the reference.
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockGetSession = jest.fn().mockResolvedValue({
  data: { session: { user: { id: 'user-1' } } },
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: mockInsert,
      select: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: [] }) })),
    })),
    auth: { getSession: () => mockGetSession() },
  },
  getSessionUser: async () => {
    const { data } = await mockGetSession();
    return data.session?.user ?? null;
  },
}));

import {
  trackScreen,
  trackTap,
  trackTouch,
  tracked,
  __analyticsInternals as internals,
} from '@/lib/analytics';

beforeEach(() => {
  mockInsert.mockClear();
  internals.reset();
});

describe('analytics buffering', () => {
  it('buffers screen views in memory instead of sending one request each', () => {
    trackScreen('/a');
    trackScreen('/b');
    trackScreen('/c');

    expect(internals.getBufferSize()).toBe(3);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('ignores a repeated view of the screen already showing', () => {
    // expo-router re-emits the current path on param changes and some
    // re-renders; counting those would inflate the busiest screens.
    trackScreen('/wallet');
    trackScreen('/wallet');
    trackScreen('/wallet');

    expect(internals.getBufferSize()).toBe(1);
  });

  it('records a return to a screen the member has already been on', () => {
    trackScreen('/wallet');
    trackScreen('/vault');
    trackScreen('/wallet');

    expect(internals.getBufferSize()).toBe(3);
  });

  it('caps the buffer so an offline device cannot grow it without bound', () => {
    // Alternating paths, because identical consecutive ones de-duplicate.
    for (let i = 0; i < 600; i++) trackScreen(`/screen-${i}`);

    expect(internals.getBufferSize()).toBeLessThanOrEqual(200);
  });

  it('keeps the most recent events when it overflows', () => {
    for (let i = 0; i < 600; i++) trackScreen(`/screen-${i}`);

    // Recent behaviour is the useful thing to keep; oldest is dropped first.
    expect(internals.getBufferSize()).toBe(200);
  });

  it('stamps every event with one launch-scoped session id', () => {
    const id = internals.getSessionId();
    expect(id).toEqual(expect.any(String));
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(64); // the column's cap
  });
});

describe('tracked() handler wrapper', () => {
  it('runs the real handler and returns its value', () => {
    const handler = jest.fn(() => 'result');
    const wrapped = tracked('some_button', handler);

    expect(wrapped()).toBe('result');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('forwards every argument untouched', () => {
    const handler = jest.fn();
    tracked('some_button', handler)('a', 2, { c: true });

    expect(handler).toHaveBeenCalledWith('a', 2, { c: true });
  });

  it('still runs the handler when recording the tap throws', () => {
    // The member's press must survive instrumentation failing underneath it.
    const boom = jest.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      throw new Error('clock exploded');
    });
    const handler = jest.fn(() => 'ran anyway');

    try {
      expect(tracked('some_button', handler)()).toBe('ran anyway');
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      boom.mockRestore();
    }
  });

  it('attributes a tap to the screen it happened on', () => {
    trackScreen('/wallet');
    trackTap('wallet_copy_code');

    expect(internals.getBufferSize()).toBe(2);
  });
});

describe('touch capture for the heatmap', () => {
  // The throttle keys off wall-clock time, so each case that needs to defeat it
  // advances the clock rather than sleeping.
  const advance = (ms: number) => {
    const base = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => base + ms);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a touch as a normalised fraction of the screen', () => {
    trackTouch(195, 422, 390, 844);
    expect(internals.getBufferSize()).toBe(1);
    const [e] = internals.peek();
    expect(e.event_type).toBe('touch');
    expect(e.x).toBeCloseTo(0.5, 3);
    expect(e.y).toBeCloseTo(0.5, 3);
    expect(e.vw).toBe(390);
    expect(e.vh).toBe(844);
  });

  it('clamps a touch that lands just outside the reported window', () => {
    // Overscroll and the notch area can report slightly out-of-bounds values;
    // the column rejects anything outside 0..1, so the batch must not carry one.
    trackTouch(-12, 900, 390, 844);
    const [e] = internals.peek();
    expect(e.x).toBe(0);
    expect(e.y).toBe(1);
  });

  it('throttles bursts so one scroll cannot flood the buffer', () => {
    for (let i = 0; i < 50; i++) trackTouch(10 * i, 10 * i, 390, 844);
    expect(internals.getBufferSize()).toBe(1);
  });

  it('records again once the throttle window has passed', () => {
    trackTouch(100, 100, 390, 844);
    advance(500);
    trackTouch(200, 200, 390, 844);
    expect(internals.getBufferSize()).toBe(2);
  });

  it('ignores a touch with no usable screen size', () => {
    trackTouch(100, 100, 0, 0);
    expect(internals.getBufferSize()).toBe(0);
  });

  it('attributes the touch to the current screen', () => {
    trackScreen('/vault');
    advance(500);
    trackTouch(100, 100, 390, 844);
    const events = internals.peek();
    expect(events.at(-1)?.route).toBe('/vault');
  });

  it('never throws, whatever the gesture reports', () => {
    expect(() => trackTouch(NaN, NaN, 390, 844)).not.toThrow();
    expect(() => trackTouch(1, 1, NaN, NaN)).not.toThrow();
    expect(() =>
      trackTouch(undefined as unknown as number, 1, 390, 844),
    ).not.toThrow();
  });
});

describe('failure containment', () => {
  it('never throws out of trackScreen, whatever it is handed', () => {
    expect(() => trackScreen('')).not.toThrow();
    expect(() => trackScreen(undefined as unknown as string)).not.toThrow();
    expect(() => trackScreen(null as unknown as string)).not.toThrow();
  });

  it('never throws out of trackTap', () => {
    expect(() => trackTap('')).not.toThrow();
    expect(() => trackTap(undefined as unknown as string)).not.toThrow();
  });

  it('truncates an over-long route rather than letting the insert fail', () => {
    // The column caps route at 128 chars; a rejected batch would take every
    // other event in it down too.
    expect(() => trackScreen('/'.padEnd(500, 'x'))).not.toThrow();
    expect(internals.getBufferSize()).toBe(1);
  });
});
