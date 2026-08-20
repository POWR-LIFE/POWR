/**
 * Sentry bootstrap. Imported for its side effect from index.ts, and its
 * position there is load-bearing:
 *
 *   - AFTER './lib/crashHandler': crashHandler must own the innermost
 *     ErrorUtils handler. Sentry.init wraps whatever handler is current, so
 *     initialising here makes the chain
 *       Sentry (capture) -> crashHandler (record to app_errors) -> RN default
 *     and the release fatal-defusal in crashHandler's exception decorator
 *     still runs last. Nothing in this file may change isFatal semantics —
 *     that trade (no native abort, no expo-updates auto-rollback) is owned by
 *     lib/crashHandler.ts alone.
 *
 *   - BEFORE './lib/headlessTasks': a silent-push / geofence headless boot
 *     executes the bundle without ever rendering the React tree, so anything
 *     initialised from the tree does not exist on those boots. Initialising
 *     here means module-init throws in the headless graph are captured too.
 *
 * The native layer (enabled by default) is the whole point: it catches the
 * TurboModule/std::terminate aborts whose .ips files name a dispatch queue and
 * nothing else. JS-side capture stays on lib/crashHandler.ts -> app_errors;
 * Sentry is additive, not a replacement.
 *
 * No DSN in the env (local dev, Expo Go, or a build made before the Sentry
 * project existed) => enabled: false, everything below is inert.
 */
import * as Sentry from '@sentry/react-native';
import type { ErrorEvent, EventHint } from '@sentry/core';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * postgrest-js never throws on failure — it resolves `{ error }` where error is
 * a PLAIN `{ message, details, hint, code }` object, and on a transport-level
 * failure it fabricates that object itself with `code: ''` and the fetch
 * error's message ("TypeError: Network request failed" on RN). The app's
 * `if (error) throw error` idiom then throws that plain object, and when the
 * chain has no catch, Sentry's unhandled-rejection instrumentation captures it
 * as the message-less "Object captured as exception with keys: code, details,
 * hint, message" — one blind issue every offline user funnels into.
 *
 * Deliberately narrow: an Error instance is never postgrest-shaped, even if it
 * carries the same keys (supabase-js Auth/Functions/Storage errors are real
 * Error subclasses and already group fine).
 */
function isPostgrestShaped(
    x: unknown,
): x is { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } {
    return (
        typeof x === 'object' && x !== null && !(x instanceof Error) &&
        'message' in x && 'details' in x && 'hint' in x && 'code' in x
    );
}

/**
 * Transport-failure messages postgrest-js forwards from fetch. RN's fetch
 * polyfill throws TypeError('Network request failed'); the others cover web
 * (expo web / dev) and aborted requests. Matched ONLY alongside an empty
 * `code` — a real PostgREST/Postgres failure always carries a code, so this
 * can never swallow a server-side error.
 */
const NETWORK_FAILURE_RE = /network request failed|failed to fetch|load failed|abort/i;

/**
 * Drop unactionable offline noise; make everything else legible. Fails open:
 * anything this can't confidently classify goes through unmodified — a filter
 * that is too clever is how you go blind to a real incident.
 */
export function beforeSend(event: ErrorEvent, hint: EventHint | undefined): ErrorEvent | null {
    try {
        const thrown = hint?.originalException;
        if (!isPostgrestShaped(thrown)) return event;

        const message = typeof thrown.message === 'string' ? thrown.message : '';
        const code = typeof thrown.code === 'string' ? thrown.code : '';

        // No HTTP response ever arrived. A user with no signal is not a bug
        // report — the breadcrumbs on kept events still show any offline storm.
        if (code === '' && NETWORK_FAILURE_RE.test(message)) return null;

        // Real (server-side) failure: rewrite the synthesized exception so
        // events group by what actually failed instead of one keys-only bucket.
        const top = event.exception?.values?.[0];
        if (top && message) {
            top.type = 'PostgrestError';
            top.value = code ? `${message} [${code}]` : message;
        }
        event.extra = {
            ...event.extra,
            postgrest: {
                code,
                details: typeof thrown.details === 'string' ? thrown.details : undefined,
                hint: typeof thrown.hint === 'string' ? thrown.hint : undefined,
            },
        };
        return event;
    } catch {
        return event;
    }
}

try {
    Sentry.init({
        dsn: DSN,
        enabled: Boolean(DSN),
        // Crash capture only for the first rollout: no perf tracing, nothing
        // that adds work to background wake paths.
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeSend,
    });

    // Tag which OTA bundle was actually running. ota_update_id in our own
    // telemetry is overwritten every launch, so the crash-time value here is
    // the only trustworthy record.
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Updates = require('expo-updates');
        if (Updates?.updateId) {
            Sentry.setTag('expo_update_id', String(Updates.updateId));
        }
    } catch {
        // expo-updates unavailable (Expo Go) — nothing to tag.
    }
} catch (e) {
    // A Sentry failure must never take down the entry path; crashHandler is
    // already armed and remains the system of record.
    console.warn('[sentry] init failed:', e);
}
