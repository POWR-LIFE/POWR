/**
 * The contract these tests defend is the one property the crash handler cannot
 * be wrong about: it must never itself become the crash.
 *
 * An error raised inside an error handler is the worst case in the whole
 * design — on the JS pipeline RN resets its fatal flag and re-reports natively
 * as fatal, which is the identical abort this change exists to prevent. So most
 * of what is asserted below is negative: never throws, never escalates in
 * release, never calls console.error (which is monkey-patched straight back into
 * the reporting machinery), never recurses.
 *
 * Deliberately NOT asserted: RN internals. RN$handleException,
 * RN$notifyOfFatalException and the C++ pipeline do not exist under jest-expo,
 * so a test written against them would pass green while a device still aborts.
 * The install ORDER is asserted statically against the source instead, because
 * that is the invariant a future edit is most likely to break silently.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

const mockIngest = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/crashReporter', () => ({
  ingest: (...args: unknown[]) => mockIngest(...args),
  flush: () => mockFlush(),
}));

const mockSetDecorator = jest.fn();
jest.mock('react-native/Libraries/Core/ExceptionsManager', () => ({
  __esModule: true,
  default: { unstable_setExceptionDecorator: (...a: unknown[]) => mockSetDecorator(...a) },
}));

type Handler = (error: unknown, isFatal?: boolean) => void;

/** Load the module fresh with a stub ErrorUtils, and hand back what it installed. */
function arm(dev: boolean) {
  jest.resetModules();
  mockIngest.mockClear();
  mockSetDecorator.mockClear();

  const prevHandler = jest.fn();
  let installed: Handler | undefined;
  (global as any).__DEV__ = dev;
  (global as any).ErrorUtils = {
    getGlobalHandler: () => prevHandler,
    setGlobalHandler: (h: Handler) => {
      installed = h;
    },
  };

  const mod = require('@/lib/crashHandler');
  return {
    mod,
    prevHandler,
    onGlobalError: installed as Handler,
    onDecorate: mockSetDecorator.mock.calls[0]?.[0] as (d: any) => any,
  };
}

afterEach(() => {
  (global as any).__DEV__ = true;
});

describe('install order', () => {
  it('arms the handler before anything else in the bundle can throw', () => {
    // index.ts is the whole reason this works: everything headlessTasks pulls
    // in initialises inside Metro's guard, and the guard reports to whichever
    // handler is installed at that instant.
    const entry = readFileSync(join(ROOT, 'index.ts'), 'utf8');
    const crash = entry.indexOf("import './lib/crashHandler'");
    const headless = entry.indexOf("import './lib/headlessTasks'");
    const router = entry.indexOf("import 'expo-router/entry'");

    expect(crash).toBeGreaterThanOrEqual(0);
    expect(crash).toBeLessThan(headless);
    expect(headless).toBeLessThan(router);
  });

  it('has no top-level import statements', () => {
    // The invariant the entire design rests on. ES imports are hoisted, so a
    // single one here would run its module initialiser before setGlobalHandler
    // — reproducing the crash inside the file that prevents it. A lint autofix
    // "tidying" a require into an import is the realistic way this breaks.
    const source = readFileSync(join(ROOT, 'lib/crashHandler.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)/m);
  });

  it('installs both levers exactly once, synchronously, on require', () => {
    const { onGlobalError } = arm(false);
    expect(typeof onGlobalError).toBe('function');
    expect(mockSetDecorator).toHaveBeenCalledTimes(1);
  });
});

describe('the handler never throws', () => {
  const hostile: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'something went wrong'],
    ['a number', 0],
    ['an error with no message', new Error()],
    ['a huge message', new Error('x'.repeat(100_000))],
  ];

  it.each(hostile)('survives %s', (_label, value) => {
    const { onGlobalError } = arm(false);
    expect(() => onGlobalError(value, true)).not.toThrow();
  });

  it('survives an error whose stack getter throws', () => {
    const { onGlobalError } = arm(false);
    const nasty = new Error('boom');
    Object.defineProperty(nasty, 'stack', {
      get() {
        throw new Error('stack getter exploded');
      },
    });
    expect(() => onGlobalError(nasty, true)).not.toThrow();
    expect(mockIngest).toHaveBeenCalledTimes(1);
  });

  it('survives a circular object', () => {
    const { onGlobalError } = arm(false);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => onGlobalError(circular, false)).not.toThrow();
  });

  it('still returns when the reporter itself throws', () => {
    const { onGlobalError } = arm(false);
    mockIngest.mockImplementationOnce(() => {
      throw new Error('engine is down');
    });
    expect(() => onGlobalError(new Error('boom'), true)).not.toThrow();
  });
});

describe('escalation', () => {
  it('never delegates to RN in release, fatal or not', () => {
    // Delegating is what aborts the process: RN's handler reports to native,
    // native calls RCTFatal, RCTFatal throws an NSException that nothing can
    // catch. Refusing to delegate IS the fix.
    const { onGlobalError, prevHandler } = arm(false);
    onGlobalError(new Error('fatal one'), true);
    onGlobalError(new Error('soft one'), false);
    expect(prevHandler).not.toHaveBeenCalled();
    expect(mockIngest).toHaveBeenCalledTimes(2);
  });

  it('preserves the redbox in development', () => {
    const { onGlobalError, prevHandler } = arm(true);
    const err = new Error('dev error');
    onGlobalError(err, true);
    expect(prevHandler).toHaveBeenCalledWith(err, true);
  });

  it('records whether the error was fatal', () => {
    const { onGlobalError } = arm(false);
    onGlobalError(new Error('a'), true);
    onGlobalError(new Error('b'), false);
    expect(mockIngest.mock.calls[0][0]).toMatchObject({ source: 'global_handler', fatal: true });
    expect(mockIngest.mock.calls[1][0]).toMatchObject({ source: 'global_handler', fatal: false });
  });

  it('never calls console.error', () => {
    // console.error is monkey-patched to reactConsoleErrorHandler, which feeds
    // straight back into the machinery we are standing in.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { onGlobalError } = arm(false);
    onGlobalError(new Error('boom'), true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });
});

describe('the decorator', () => {
  it('defuses a fatal in release by flipping the payload flag', () => {
    // Native branches on data.isFatal to choose reportFatal (which aborts) over
    // reportSoft (a release no-op), so this one field is the whole defuse.
    const { onDecorate } = arm(false);
    const out = onDecorate({ message: 'render blew up', isFatal: true, id: 3 });
    expect(out.isFatal).toBe(false);
    expect(out.message).toBe('render blew up');
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ source: 'decorator', fatal: true }));
  });

  it('passes a non-fatal through untouched', () => {
    const { onDecorate } = arm(false);
    const data = { message: 'just a console.error', isFatal: false };
    expect(onDecorate(data)).toBe(data);
  });

  it('changes nothing in development', () => {
    const { onDecorate } = arm(true);
    const data = { message: 'render blew up', isFatal: true };
    expect(onDecorate(data)).toBe(data);
  });

  it('returns a usable payload even when the reporter throws', () => {
    const { onDecorate } = arm(false);
    mockIngest.mockImplementationOnce(() => {
      throw new Error('engine is down');
    });
    const data = { message: 'boom', isFatal: true };
    expect(() => onDecorate(data)).not.toThrow();
    expect(onDecorate(data)).toBeTruthy();
  });

  it('splits the appended component stack out of the message', () => {
    const { onDecorate } = arm(false);
    onDecorate({
      message: 'Cannot read property x of undefined\n\nThis error is located at:\n    in Wallet',
      componentStack: '\n    in Wallet',
      isFatal: true,
    });
    expect(mockIngest.mock.calls[0][0].message).toBe('Cannot read property x of undefined');
    expect(mockIngest.mock.calls[0][0].componentStack).toBe('\n    in Wallet');
  });

  it('prefers the raw stack string over RN’s parsed frames', () => {
    const { onDecorate } = arm(false);
    onDecorate({
      message: 'boom',
      isFatal: true,
      stack: [{ methodName: 'f', file: 'a.js', lineNumber: 1, column: 2 }],
      extraData: { rawStack: 'Error: boom\n    at f (a.js:1:2)' },
    });
    expect(mockIngest.mock.calls[0][0].stack).toContain('at f (a.js:1:2)');
  });
});

describe('re-entrancy', () => {
  it('drops an error raised while an error is already being handled', () => {
    const { onGlobalError, onDecorate } = arm(false);
    mockIngest.mockImplementationOnce(() => {
      // Exactly the shape of the worst case: reporting an error causes another.
      onDecorate({ message: 'secondary', isFatal: true });
    });
    onGlobalError(new Error('primary'), true);
    expect(mockIngest).toHaveBeenCalledTimes(1);
  });

  it('resets the guard so the next error is still captured', () => {
    const { onGlobalError } = arm(false);
    onGlobalError(new Error('first'), true);
    onGlobalError(new Error('second'), true);
    expect(mockIngest).toHaveBeenCalledTimes(2);
  });
});

describe('context', () => {
  it('reports a wake as headless until a screen has rendered', () => {
    const { mod, onGlobalError } = arm(false);
    mod.noteTask('POWR_BACKGROUND_NOTIFICATION:dwell');
    onGlobalError(new Error('boom'), true);
    expect(mockIngest.mock.calls[0][0]).toMatchObject({
      phase: 'headless',
      task: 'POWR_BACKGROUND_NOTIFICATION:dwell',
      route: null,
    });
  });

  it('reports the route once the tree exists', () => {
    const { mod, onGlobalError } = arm(false);
    mod.noteRoute('/wallet');
    onGlobalError(new Error('boom'), true);
    const row = mockIngest.mock.calls[0][0];
    expect(row.route).toBe('/wallet');
    expect(row.phase).not.toBe('headless');
  });

  it('files a handled report without escalating anything', () => {
    const { mod } = arm(false);
    mod.reportHandled(new Error('caught'), { task: 'X' });
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'manual', fatal: false, props: { task: 'X' } }),
    );
  });

  it('lets the error boundary label its own reports', () => {
    const { mod } = arm(false);
    mod.reportHandled(new Error('render blew up'), undefined, 'error_boundary');
    expect(mockIngest.mock.calls[0][0].source).toBe('error_boundary');
  });

  it('clears the task name once a screen takes over', () => {
    // Otherwise a foreground crash hours later still reports itself as having
    // happened inside the last background executor that ran.
    const { mod, onGlobalError } = arm(false);
    mod.noteTask('POWR_LOCATION_TRACKING');
    mod.noteRoute('/wallet');
    onGlobalError(new Error('boom'), true);
    expect(mockIngest.mock.calls[0][0].task).toBeNull();
  });

  it('spells one bug the same way through both levers', () => {
    // React reports a boundary-caught error through onCaughtError (the
    // decorator) AND the boundary files it by hand. If the two messages differ,
    // one bug becomes two rows that never merge.
    const { mod, onDecorate } = arm(false);
    onDecorate({
      name: 'TypeError',
      message: 'TypeError: x is undefined\n\nThis error is located at:\n    in Wallet',
      originalMessage: 'x is undefined',
      isFatal: false,
    });
    mod.reportHandled(new Error('x is undefined'), undefined, 'error_boundary');

    expect(mockIngest.mock.calls[0][0].message).toBe('x is undefined');
    expect(mockIngest.mock.calls[1][0].message).toBe('x is undefined');
  });

  it('flushes through the engine without awaiting it', () => {
    const { mod } = arm(false);
    expect(() => mod.flushCrashReports()).not.toThrow();
    expect(mockFlush).toHaveBeenCalled();
  });
});
