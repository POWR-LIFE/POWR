import { requireOptionalNativeModule } from 'expo';

/**
 * iOS visit monitoring (CLVisit), delivered to an expo-task-manager task.
 *
 * DORMANT: nothing starts it yet. To wire it, define the task at module top
 * level (beside the geofence tasks, so a headless relaunch finds it) and start
 * it behind a remote switch:
 *
 *   TaskManager.defineTask<VisitTaskData>(VISIT_TASK, ({ data, error }) => …);
 *   await startVisitMonitoringAsync(VISIT_TASK);
 *
 * Needs Always location to deliver anything. Android has no equivalent — every
 * function here is a no-op there.
 */

export type VisitEvent = {
  /** ms epoch; null when the visit began before monitoring started. */
  arrivalTimestamp: number | null;
  /** ms epoch; null while the visit is still in progress (an arrival event). */
  departureTimestamp: number | null;
  latitude: number;
  longitude: number;
  /** Metres. Coarse by design — and coarser still on reduced-accuracy permission. */
  horizontalAccuracy: number;
  /** ms epoch the app received the event; departure → receivedAt is the delivery lag. */
  receivedAt: number;
};

/** The `data` an expo-task-manager task receives for a visit. */
export type VisitTaskData = { visit: VisitEvent };

type NativeModule = {
  startVisitMonitoringAsync(taskName: string): Promise<void>;
  stopVisitMonitoringAsync(taskName: string): Promise<void>;
  hasStartedVisitMonitoringAsync(taskName: string): Promise<boolean>;
};

// Optional on purpose: iOS-only, so Android and web resolve null.
const native = requireOptionalNativeModule<NativeModule>('PowrVisits');

/** True on a binary that carries the native module (iOS 1.6.0+). */
export const isVisitMonitoringAvailable = native != null;

/** Starts visit monitoring for `taskName`. Resolves false where unsupported. */
export async function startVisitMonitoringAsync(taskName: string): Promise<boolean> {
  if (!native) return false;
  await native.startVisitMonitoringAsync(taskName);
  return true;
}

/** Stops visit monitoring for `taskName`. No-op where unsupported. */
export async function stopVisitMonitoringAsync(taskName: string): Promise<void> {
  if (!native) return;
  await native.stopVisitMonitoringAsync(taskName);
}

export async function hasStartedVisitMonitoringAsync(taskName: string): Promise<boolean> {
  if (!native) return false;
  return native.hasStartedVisitMonitoringAsync(taskName);
}
