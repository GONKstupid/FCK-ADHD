import {
  hasExactAlarmPermission,
  isAlarmScheduled,
  isNative,
  scheduleExactAlarm,
} from './blockerBridge';
import { db } from '../data/db';
import { getRoutineById } from './routineService';
import { fireOverdueAlarm, handleAlarmFired } from './alarmController';
import { REPEAT_INTERVAL_MS } from '../core/constants';

/**
 * Health-check service.
 * On app resume (visibility change), verifies that the native alarm chains
 * are still alive and re-schedules anything that was lost (e.g. after
 * process death). Overdue WAITING instances are fired immediately through
 * the same path as a native `alarmFired` event.
 */

let cleanupFn: (() => void) | null = null;

// ─── Permission status (read by the Dashboard later) ──────────────────────────

let exactAlarmPermissionGranted: boolean | null = null;

/** Last known SCHEDULE_EXACT_ALARM permission state (null = unknown/web). */
export function getExactAlarmPermissionStatus(): boolean | null {
  return exactAlarmPermissionGranted;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Starts the health-check listener.
 * Listens for visibilitychange events and re-verifies alarms when visible.
 */
export function startHealthCheck(): void {
  if (cleanupFn) return; // Already running

  const handler = () => {
    if (document.visibilityState === 'visible') {
      void verifyAlarms();
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

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies all active instances against the native AlarmManager:
 *
 * - WAITING, deadline overdue  → fire immediately (handleAlarmFired) and
 *                                perform the web-triggered alarm effects
 *                                (audio focus + alarm UI + repeat chain).
 * - WAITING, deadline in future → re-schedule if the alarm was lost.
 * - REMINDING                   → the native 60s repeat chain must still be
 *                                 scheduled; if not, restart it at now+60s.
 */
async function verifyAlarms(): Promise<void> {
  if (!isNative()) return;

  // Permission check — warn and expose the status for later UI use.
  try {
    const perm = await hasExactAlarmPermission();
    exactAlarmPermissionGranted = perm.granted;
    if (!perm.granted) {
      console.warn(
        '[healthCheck] Exact-alarm permission not granted — alarms may be unreliable.',
      );
    }
  } catch (err) {
    console.error('[healthCheck] Permission check failed:', err);
  }

  const now = Date.now();
  // NOTE: no standalone `state` index exists (only `[routineId+state]`),
  // so load all instances and filter in JS.
  const allInstances = await db.instances.toArray();

  for (const instance of allInstances) {
    if (instance.state === 'WAITING') {
      if (instance.deadline == null) continue;

      if (instance.deadline <= now) {
        // Overdue — treat like a native alarm fire (WAITING → REMINDING).
        // handleAlarmFired applies no side effects by contract, so for the
        // resulting REMINDING state we must trigger the same effects as a
        // web-triggered alarm — otherwise the user would never hear it.
        console.warn(
          `[healthCheck] Instance ${instance.id} is overdue — firing now`,
        );
        const updated = await handleAlarmFired(
          instance.id,
          instance.repeatCount,
        );
        if (updated && updated.state === 'REMINDING') {
          await fireOverdueAlarm(updated);
        }
        continue;
      }

      const result = await isAlarmScheduled(instance.id);
      if (!result.scheduled) {
        const routine = await getRoutineById(instance.routineId);
        console.warn(
          `[healthCheck] Alarm for instance ${instance.id} was lost — re-scheduling`,
        );
        await scheduleExactAlarm(instance.id, instance.deadline, routine?.name);
      }
      continue;
    }

    if (instance.state === 'REMINDING') {
      // The native repeat chain should be alive while ringing.
      const result = await isAlarmScheduled(instance.id);
      if (!result.scheduled) {
        const routine = await getRoutineById(instance.routineId);
        console.warn(
          `[healthCheck] Repeat chain for instance ${instance.id} is dead — restarting`,
        );
        await scheduleExactAlarm(
          instance.id,
          now + REPEAT_INTERVAL_MS,
          routine?.name,
          instance.repeatCount,
        );
      }
    }
  }
}
