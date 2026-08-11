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

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

try {
    Sentry.init({
        dsn: DSN,
        enabled: Boolean(DSN),
        // Crash capture only for the first rollout: no perf tracing, nothing
        // that adds work to background wake paths.
        tracesSampleRate: 0,
        sendDefaultPii: false,
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
