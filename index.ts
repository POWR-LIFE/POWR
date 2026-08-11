// Arms the JS crash handler before anything else in the bundle can throw.
// Everything './lib/headlessTasks' pulls in (GeofenceContext -> AsyncStorage,
// expo-location, expo-task-manager, supabase) initialises inside Metro's
// guardedLoadModule, whose catch reports through whichever global handler is
// installed at that instant — and in a release build RN's own handler turns
// that report into a hard native abort. See lib/crashHandler.ts.
import './lib/crashHandler';

// Sentry second: it wraps the handler crashHandler just installed (so both
// capture), and must be live before the headless graph below initialises.
// See lib/sentry.ts for the full ordering contract.
import './lib/sentry';

// The app's real entry (package.json "main").
//
// The side-effect import below MUST come before 'expo-router/entry' and MUST
// live here, not in the React tree: it defines every background task at
// bundle-execution time. A headless boot — silent FCM wake, geofence
// PendingIntent, BackgroundFetch job arriving after the app was swiped away —
// executes this bundle but never renders the React tree, and the production
// bundle inline-requires everything only the tree imports, so a defineTask
// reachable only from a component or provider does not exist headlessly. The
// native TaskService then holds its queued events forever, JS sits idle, and
// Android kills the process as "empty" ~90 s later (bench-proven 2026-08-04).
import './lib/headlessTasks';
import 'expo-router/entry';
