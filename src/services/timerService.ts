import { Capacitor } from '@capacitor/core';
import {
  scheduleExactAlarm as nativeSchedule,
  cancelAlarm as nativeCancel,
} from './blockerBridge';

// ─── Web fallback timers ──────────────────────────────────────────────────────

type TimerEntry = {
  id: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

const activeTimers = new Map<string, TimerEntry>();

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ─── Callback registry (native → web) ─────────────────────────────────────────

const callbackRegistry = new Map<string, () => void>();

/**
 * Schedules a one-shot alarm.
 * On native Android: uses AlarmManager via the BlockerPlugin bridge.
 * On web: falls back to setTimeout.
 */
export function scheduleAlarm(
  instanceId: string,
  deadline: number,
  callback: () => void,
): string {
  const timerId = `timer_${instanceId}_${Date.now()}`;

  if (isNative()) {
    // Store callback for when the alarm fires (app is in foreground)
    callbackRegistry.set(instanceId, callback);
    nativeSchedule(instanceId, deadline).catch((err) => {
      console.error('[timerService] Failed to schedule native alarm:', err);
    });
    return timerId;
  }

  // Web fallback
  const delay = Math.max(0, deadline - Date.now());
  const timeoutId = setTimeout(() => {
    activeTimers.delete(timerId);
    callback();
  }, delay);

  activeTimers.set(timerId, { id: timerId, timeoutId });
  return timerId;
}

/**
 * Cancels a previously scheduled alarm.
 * On native: cancels via AlarmManager.
 * On web: clears the setTimeout.
 */
export function cancelAlarm(timerId: string): void {
  if (isNative()) {
    // Extract instanceId from timerId format: timer_{instanceId}_{timestamp}
    const parts = timerId.split('_');
    if (parts.length >= 3) {
      const instanceId = parts.slice(1, -1).join('_');
      nativeCancel(instanceId).catch((err) => {
        console.error('[timerService] Failed to cancel native alarm:', err);
      });
      callbackRegistry.delete(instanceId);
    }
    return;
  }

  const entry = activeTimers.get(timerId);
  if (entry) {
    clearTimeout(entry.timeoutId);
    activeTimers.delete(timerId);
  }
}

/**
 * Cancels all active alarms. Useful during teardown or testing.
 */
export function cancelAllAlarms(): void {
  if (isNative()) {
    // Native alarms are cancelled individually; clear the registry
    callbackRegistry.clear();
    return;
  }

  for (const entry of activeTimers.values()) {
    clearTimeout(entry.timeoutId);
  }
  activeTimers.clear();
}

/**
 * Invokes the registered callback for a given instance.
 * Called from the native side when an alarm fires while the app is in foreground.
 */
export function fireAlarmCallback(instanceId: string): void {
  const callback = callbackRegistry.get(instanceId);
  if (callback) {
    callbackRegistry.delete(instanceId);
    callback();
  }
}
