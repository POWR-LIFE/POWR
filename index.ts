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
