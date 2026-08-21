import { isAlarmScheduled, scheduleExactAlarm } from './blockerBridge';
import { isNative } from './blockerBridge';
import { db } from '../data/db';

/**
 * Health-check service.
 * On app resume (visibility change), verifies that the next alarm is still
 * scheduled in the system AlarmManager. If not, re-schedules from persisted
 * instance state.
 */

let cleanupFn: (() => void) | null = null;

/**
 * Starts the health-check listener.
 * Listens for visibilitychange events and re-schedules alarms if needed.
 */
export function startHealthCheck(): void {
  if (cleanupFn) return; // Already running

  const handler = async () => {
    if (document.visibilityState === 'visible') {
      await verifyAlarms();
    }
  };

  document.addEventListener('visibilitychange', handler);
  cleanupFn = () => document.removeEventListener('visibilitychange', handler);

  // Also run immediately
  verifyAlarms().catch(console.error);
}

/**
 * Stops the health-check listener.
 */
export function stopHealthCheck(): void {
  cleanupFn?.();
  cleanupFn = null;
}

/**
 * Verifies all active WAITING instances still have their alarms scheduled.
 * Re-schedules any that were lost (e.g. after process death).
 */
async function verifyAlarms(): Promise<void> {
  if (!isNative()) return;

  const waitingInstances = await db.instances
    .where('state')
    .equals('WAITING')
    .filter((inst) => inst.deadline != null && inst.deadline > Date.now())
    .toArray();

  for (const instance of waitingInstances) {
    if (!instance.deadline) continue;

    const result = await isAlarmScheduled(instance.id);
    if (!result.scheduled) {
      console.warn(
        `[healthCheck] Alarm for instance ${instance.id} was lost — re-scheduling`,
      );
      await scheduleExactAlarm(instance.id, instance.deadline);
    }
  }
}
