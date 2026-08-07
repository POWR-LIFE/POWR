/**
 * Catches uncaught JavaScript errors before React Native turns them into a hard
 * native crash, and records what threw.
 *
 * THE CRASH THIS EXISTS FOR (six TestFlight logs, 2026-08-05 and 2026-08-06,
 * two devices, builds 1.4.11 and 1.4.12). In a release build an uncaught JS
 * error is one abort, every time:
 *
 *   uncaught JS error
 *     -> ExceptionsManager.reportException
 *     -> NativeExceptionsManager.reportException, a VOID TurboModule method
 *     -> RCTExceptionsManager has no methodQueue, so it runs on the shared
 *        com.meta.react.turbomodulemanager.queue
 *     -> -reportFatal: falls through to RCTFatal (release, maxReloadAttempts 0)
 *     -> RCTFatal @throws an NSException — its @try/@catch is #if DEBUG only
 *     -> performVoidMethodInvocation's @catch converts it and rethrows a C++
 *        exception onto a bare dispatch block, where nothing can catch it
 *     -> std::terminate -> abort.
 *
 * The native report then names that dispatch queue and NOTHING about the
 * JavaScript that threw — there is no lastExceptionBacktrace, because the throw
 * was converted to a C++ rethrow. Six crash logs told us the queue and not one
 * told us the bug. That is what this file fixes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE ONE: THIS FILE HAS NO `import` STATEMENTS. require() ONLY.
 *
 * Expo's Metro runs with experimentalImportSupport and inlineRequires off, so
 * ES imports are hoisted and would run their module initialisers BEFORE
 * setGlobalHandler installs anything — reproducing the exact crash the file
 * exists to prevent, in the file that prevents it. Every dependency here is
 * lazy, and a well-meaning lint autofix that "tidies" a require into an import
 * silently disarms the whole change. __tests__/crashHandler.test.ts asserts
 * this statically so it cannot rot.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TWO LEVERS, BECAUSE ONE DOES NOT COVER IT:
 *
 *  1. ErrorUtils.setGlobalHandler catches module-init throws during bundle
 *     evaluation (Metro's guardedLoadModule reports through it), event handler
 *     throws, timer throws and native-callback throws.
 *  2. ExceptionsManager.unstable_setExceptionDecorator catches uncaught REACT
 *     RENDER errors, which never touch ErrorUtils at all — RN routes them
 *     through onUncaughtError -> handleException(error, true) directly. A
 *     global handler alone would have shipped and fixed nothing for that class.
 *     The decorator also sees every console.error, which is how every
 *     expo-task-manager executor failure arrives with no edit to any task file.
 *
 * The decorator is also where the crash is DEFUSED: native branches on the
 * payload's isFatal field (RCTExceptionsManager.mm:158), so returning
 * {...data, isFatal: false} routes the report to reportSoft — a complete no-op
 * in release — instead of RCTFatal.
 *
 * INVARIANTS, inherited from lib/analytics.ts:7-35 for the same reason:
 *  - Nothing throws. Every handler body is wholly inside try/catch, because an
 *    error raised inside an error handler re-enters the pipeline and aborts.
 *  - Nothing is awaited. Capture is synchronous and returns void.
 *  - console.warn only, NEVER console.error — console.error is monkey-patched
 *    to reactConsoleErrorHandler, which feeds straight back into this machinery.
 *  - Nothing unbounded: dedupe, a per-launch cap and a capped spool live in
 *    lib/crashReporter.ts.
 *
 * TWO CONSEQUENCES, STATED IN FULL BECAUSE THEY ARE REAL:
 *
 *  1. A suppressed uncaught render error leaves React unmounted. React commits
 *     {element: null} before the decorator ever runs, so without a boundary the
 *     member would sit on a blank screen instead of a crash. That is what the
 *     ErrorBoundary export in app/_layout.tsx is for, and it covers everything
 *     from RootLayout's default export down — but NOT a module-scope throw in
 *     app/_layout.tsx itself, which no JS-only change can reach.
 *  2. Suppression is sticky and total. RN marks _hasHandledFatalError on the
 *     first fatal, after which no fatal reaches native again for the life of the
 *     process — and expo-updates' launch-window ErrorRecovery rollback never
 *     fires. Capture is unaffected (preprocessException runs before that check),
 *     but this is the trade: we can no longer roll back automatically, so this
 *     bundle must be verified on a device before it goes to production.
 */

declare const require: (moduleId: string) => any;
declare const __DEV__: boolean;

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

const g = globalThis as Record<string, any>;

/** Shared by BOTH levers. An error thrown while handling an error is the worst
 *  case in this whole change: on the JS pipeline it resets RN's fatal flag and
 *  re-reports natively as fatal — the identical abort — and on the Metro path it
 *  leaves guardedLoadModule's inGuard stuck true, silently unguarding every
 *  later module load. Checked first, reset in a finally, never awaited. */
let inHandler = false;

let prevHandler: GlobalErrorHandler | null = null;
let lastRoute: string | null = null;
let lastTask: string | null = null;
/** Flipped only by noteRoute(), i.e. only once a screen has rendered. It is the
 *  one bit that separates a headless wake from a backgrounded app: AppState
 *  reads 'background' for both and cannot tell them apart. */
let uiSeen = false;

/** Read any property off any value without trusting it — the input is by
 *  definition a value that was already going wrong, and .stack may be a getter
 *  that throws. */
function pluck(value: unknown, key: string): unknown {
  try {
    return value == null ? undefined : (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function currentPhase(): string {
  try {
    if (!uiSeen) return 'headless';
    const state = require('react-native').AppState?.currentState;
    return state === 'active' ? 'foreground' : 'background';
  } catch {
    return 'unknown';
  }
}

/**
 * The only route from a handler to the engine. The try/catch is mandatory, not
 * defensive dressing: a require() performed inside a handler runs outside
 * Metro's guard, so its throw would propagate straight back out of the handler
 * and into native.
 */
function handOff(input: Record<string, unknown>): void {
  try {
    require('./crashReporter').ingest({
      route: lastRoute,
      task: lastTask,
      phase: currentPhase(),
      ...input,
    });
  } catch {
    /* nothing left to report with */
  }
}

// ── Lever 1: the global handler ────────────────────────────────────────────

function onGlobalError(error: unknown, isFatal?: boolean): void {
  if (inHandler) return;
  inHandler = true;
  try {
    const isObject = error != null && typeof error === 'object';
    handOff({
      source: 'global_handler',
      fatal: !!isFatal,
      name: pluck(error, 'name') ?? 'Error',
      message: isObject ? pluck(error, 'message') : error,
      stack: pluck(error, 'stack'),
      componentStack: pluck(error, 'componentStack'),
      props: { js_engine: pluck(error, 'jsEngine') ?? null },
    });

    if (__DEV__ && prevHandler) {
      // Development keeps its redbox: delegating hands the error back to RN's
      // own handler untouched. It is release, where that path aborts the
      // process, that we refuse to take.
      prevHandler(error, isFatal);
      return;
    }

    console.warn(
      `[crash] uncaught ${isFatal ? 'fatal' : 'error'} captured and suppressed:`,
      pluck(error, 'message') ?? error,
    );
  } catch {
    /* never re-enter */
  } finally {
    inHandler = false;
  }
}

// ── Lever 2: the exception decorator ───────────────────────────────────────

/** RN hands the decorator its parsed frames; the original string lives in
 *  extraData.rawStack and is far more useful, so prefer it. */
function stackFrom(data: Record<string, any>): unknown {
  const raw = pluck(pluck(data, 'extraData'), 'rawStack');
  if (typeof raw === 'string' && raw.length > 0) return raw;
  try {
    const frames = data?.stack;
    if (!Array.isArray(frames)) return undefined;
    return frames
      .map((f: any) => `${f?.methodName ?? '?'}@${f?.file ?? '?'}:${f?.lineNumber ?? 0}:${f?.column ?? 0}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

function onDecorate(data: Record<string, any>): Record<string, any> {
  if (inHandler) return data;
  inHandler = true;
  let out = data;
  try {
    const fatal = !!pluck(data, 'isFatal');
    // reportException rewrites the message before we see it: it prefixes the
    // error name and appends the component stack. Both are carried in their own
    // columns here, so use RN's own untouched copy when it kept one, and strip
    // the appendix from what is left. This is not cosmetic — the same error also
    // arrives through reportHandled with its raw message, and two spellings of
    // one message fingerprint as two different bugs.
    const raw = pluck(data, 'originalMessage');
    const message = typeof raw === 'string' && raw.length > 0 ? raw : pluck(data, 'message');
    handOff({
      source: 'decorator',
      fatal,
      name: pluck(data, 'name') ?? 'Error',
      message: typeof message === 'string' ? message.split('\n\nThis error is located at:')[0] : message,
      stack: stackFrom(data),
      componentStack: pluck(data, 'componentStack'),
      props: { exception_id: pluck(data, 'id') ?? null },
    });

    // THE DEFUSE. Native reads this field off the payload to choose reportFatal
    // vs reportSoft, so flipping it here is what turns an abort into a no-op.
    // Dev is left alone: the redbox is the point of dev.
    if (!__DEV__ && fatal) out = { ...data, isFatal: false };
  } catch {
    out = data;
  } finally {
    inHandler = false;
  }
  return out;
}

// ── Install ────────────────────────────────────────────────────────────────

/**
 * Runs at module scope, before anything else in the bundle can throw. Order is
 * deliberate: the global handler goes on FIRST, with zero require() calls ahead
 * of it, so there is no window in which a module initialiser can throw while
 * the stock handler is still live.
 */
function install(): void {
  try {
    prevHandler = g.ErrorUtils?.getGlobalHandler?.() ?? null;
    g.ErrorUtils?.setGlobalHandler?.(onGlobalError);
  } catch {
    /* an app without ErrorUtils still gets the decorator below */
  }
  try {
    require('react-native/Libraries/Core/ExceptionsManager').default.unstable_setExceptionDecorator(
      onDecorate,
    );
  } catch {
    /* InitializeCore always loads this first, so this is a cache hit in
       practice — but if it ever were not, the handler above is already armed */
  }
}

install();

// ── Context, fed in by the app ─────────────────────────────────────────────

/** Records the current screen AND marks that a React tree exists — see uiSeen.
 *  Clears the task name too: a route change means a screen is driving, so the
 *  last background executor's name would misattribute every later report. */
export function noteRoute(route: string | null): void {
  try {
    uiSeen = true;
    lastRoute = route;
    lastTask = null;
  } catch {
    /* unreachable, and still not worth a crash */
  }
}

/** Names the background executor that is running. A stack from a headless wake
 *  has no route to place it, and this is the only thing that does. */
export function noteTask(task: string | null): void {
  lastTask = task;
}

/** Capture something already caught, where the catch would otherwise flatten it
 *  — expo-task-manager's own console.error loses the original stack. `source`
 *  is a parameter so the error boundary's reports are distinguishable from a
 *  task's; without it every caller would land under 'manual' and the
 *  'error_boundary' value in the table would never appear. */
export function reportHandled(
  error: unknown,
  context?: Record<string, unknown>,
  source: 'manual' | 'error_boundary' = 'manual',
): void {
  if (inHandler) return;
  inHandler = true;
  try {
    const isObject = error != null && typeof error === 'object';
    handOff({
      source,
      fatal: false,
      name: pluck(error, 'name') ?? 'Error',
      message: isObject ? pluck(error, 'message') : error,
      stack: pluck(error, 'stack'),
      componentStack: pluck(error, 'componentStack'),
      props: context ?? null,
    });
  } catch {
    /* never re-enter */
  } finally {
    inHandler = false;
  }
}

/** Drain reports that earlier launches left spooled. Called only from the root
 *  layout: a headless wake must not spend its Doze budget on a backlog. */
export function flushCrashReports(): void {
  try {
    void require('./crashReporter').flush();
  } catch {
    /* the spool keeps until a launch that can send it */
  }
}

/** Exposed for tests. */
export const __crashInternals = {
  install,
  onGlobalError,
  onDecorate,
  reset: () => {
    inHandler = false;
    lastRoute = null;
    lastTask = null;
    uiSeen = false;
  },
  peek: () => ({ inHandler, lastRoute, lastTask, uiSeen, hasPrev: prevHandler != null }),
};
