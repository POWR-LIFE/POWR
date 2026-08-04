// Side-effect-only imports that make every TaskManager.defineTask() call run
// during bundle execution, so the handlers exist in HEADLESS boots (no React
// render). Imported by index.ts, ahead of expo-router/entry — do not move any
// of these back behind a component/provider import, and do not make them lazy;
// that is exactly the bug this file exists to prevent (see index.ts).
//
// expo-task-manager's own module scope also matters: loading it registers the
// JS 'TaskManager.executeTask' listener, whose OnStartObserving is the ONLY
// trigger for the native side to flush events queued before JS was up.
//
// Task names defined by each module:
//   context/GeofenceContext         GEOFENCE_CHECK_IN, POWR_LOCATION_TRACKING,
//                                   POWR_GEOFENCE_BOOT_REARM
//   lib/backgroundNotificationTask  POWR_BACKGROUND_NOTIFICATION (beacon wake)
//   lib/health/walkingSync          powr-walking-sync
//   lib/placementNotifyTask         POWR_PLACEMENT_NOTIFY
//   lib/stepGoalNotifyTask          POWR_STEP_GOAL_NOTIFY
//
// Registration (registerTaskAsync / startGeofencingAsync) still happens from
// the providers on UI mount — only the DEFINITIONS belong here.
import '@/context/GeofenceContext';
import '@/lib/backgroundNotificationTask';
import '@/lib/health/walkingSync';
import '@/lib/placementNotifyTask';
import '@/lib/stepGoalNotifyTask';
