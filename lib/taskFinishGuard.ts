/**
 * defineTask with a finish-hold — the OTA-side fix for an iOS data race in
 * expo-task-manager (14.0.9, and identical on expo/expo main as of 2026-08-30).
 *
 * Sentry POWR-G (Elliot, 1.5.1 build 18, 2026-08-30 06:24Z):
 *   NSRangeException -[__NSArrayM insertObject:atIndex:]: index 1 beyond bounds
 *   for empty array
 *   -[EXTaskService executeTask:withData:withError:]      EXTaskService.m:289
 *   -[EXGeofencingTaskConsumer locationManager:didDetermineState:forRegion:]
 *
 * EXTaskService keeps `_events` — NSMutableDictionary<appId, NSMutableArray of
 * eventIds> — with NO lock. Two threads mutate it:
 *   • MAIN: every task delivery does `[appEvents addObject:eventId]`
 *     (executeTask:withData:withError:). CoreLocation calls the geofencing
 *     consumer on main; after startGeofencingAsync arms N regions it also
 *     requests the state of every one, so N `didDetermineState` deliveries land
 *     in a ~1 s burst.
 *   • MODULE QUEUE: `notifyTaskFinishedAsync` (a legacy EX_EXPORT_METHOD, which
 *     runs on the module's private serial queue, not main) does
 *     `[appEvents removeObject:eventId]` and, when the array empties,
 *     `[_events removeObjectForKey:]`.
 * `addObject` is `insertObject:atIndex:count`; "index 1 into an empty array" is
 * the count being read on main a moment before the module queue emptied it.
 *
 * expo-task-manager's JS calls notifyTaskFinishedAsync in a `finally` the
 * instant our executor settles — and our fastest executors (the geofence storm
 * absorber, a suppressed exit) settle in the same tick they were delivered, so
 * their finish lands right in the middle of the delivery burst. That timing is
 * the only side of the race JS controls, and it is enough: the native insert
 * cannot collide with a remove that has not been requested yet. So on iOS,
 * every executor's settlement is held until no task has been delivered for
 * QUIET_MS (bounded by MAX_HOLD_MS so a continuous stream can't starve
 * finishes). All 20 `addObject`s of a burst then complete before the first
 * `removeObject` is even scheduled.
 *
 * Cost: a headless wake stays alive ≤ MAX_HOLD_MS longer than it did. expo's
 * own app-record invalidation already waits 1 s after the last finish for
 * exactly this "more events may be coming" reason; this widens that window
 * without changing what any task does. Not applied on Android (Kotlin
 * TaskService, different code) or web.
 *
 * Use this for EVERY TaskManager.defineTask in the app (lib/headlessTasks.ts
 * lists them): a task that bypasses it re-opens the race for its own finishes.
 * Native-side fix (a @synchronized around `_events`) needs an EAS build; this
 * is what protects the 1.5.1 fleet until one ships.
 */
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

/** Quiet time since the LAST delivery before any executor may settle. Arm-time
 *  state bursts land within ~1 s; a straggler after 1.5 s of silence is a
 *  single event against a single finish, not a burst. */
export const QUIET_MS = 1_500;
/** Ceiling on any one hold, so a stream that never goes quiet (the location
 *  task during an approach) still finishes its events promptly. */
export const MAX_HOLD_MS = 5_000;

let lastDeliveryAt = 0;

export function noteTaskDelivery(now: number = Date.now()): void {
  lastDeliveryAt = now;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once QUIET_MS has passed since the last delivery, or MAX_HOLD_MS
 *  since this hold began — whichever comes first. Only meaningful on iOS. */
export async function holdUntilQuiet(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const holdStart = Date.now();
  for (;;) {
    const now = Date.now();
    const sinceDelivery = now - lastDeliveryAt;
    const held = now - holdStart;
    if (sinceDelivery >= QUIET_MS || held >= MAX_HOLD_MS) return;
    await sleep(Math.min(QUIET_MS - sinceDelivery, MAX_HOLD_MS - held));
  }
}

type TaskBody = Parameters<TaskManager.TaskManagerTaskExecutor>[0];

/** Drop-in for TaskManager.defineTask. The executor runs exactly as before; its
 *  settlement (fulfil OR reject — expo finishes the task in a `finally`, so a
 *  throw must be held too) is delayed per holdUntilQuiet. */
export function defineTask<T = unknown>(
  taskName: string,
  executor: (body: TaskBody) => Promise<T> | T,
): void {
  TaskManager.defineTask(taskName, async (body: TaskBody) => {
    noteTaskDelivery();
    try {
      return await executor(body);
    } finally {
      await holdUntilQuiet();
    }
  });
}

/** Test seam. */
export function __resetForTests(): void {
  lastDeliveryAt = 0;
}
