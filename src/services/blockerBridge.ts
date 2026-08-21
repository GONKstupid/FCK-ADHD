import { Capacitor, registerPlugin } from '@capacitor/core';

// ─── Native Plugin Interface ──────────────────────────────────────────────────

interface BlockerPluginInterface {
  showAlarm(options: { label: string; repeatCount: number }): Promise<void>;
  dismissAlarm(): Promise<void>;
  requestAudioFocus(): Promise<void>;
  releaseAudioFocus(): Promise<void>;
  scheduleExactAlarm(options: {
    instanceId: string;
    deadlineMs: number;
  }): Promise<void>;
  cancelAlarm(options: { instanceId: string }): Promise<void>;
  isAlarmScheduled(options: {
    instanceId: string;
  }): Promise<{ scheduled: boolean }>;
  requestBatteryOptimizationExemption(): Promise<void>;
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

const BlockerNative = registerPlugin<BlockerPluginInterface>('BlockerPlugin');

/** Whether the app is running on a native (Android) platform. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Shows a full-screen alarm activity over the lock screen.
 * No-op on web.
 */
export async function showAlarm(
  label: string,
  repeatCount: number,
): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.showAlarm({ label, repeatCount });
}

/**
 * Dismisses the currently shown alarm activity and stops the foreground service.
 * No-op on web.
 */
export async function dismissAlarm(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.dismissAlarm();
}

/**
 * Requests transient exclusive audio focus on STREAM_ALARM.
 * No-op on web.
 */
export async function requestAudioFocus(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.requestAudioFocus();
}

/**
 * Releases previously acquired audio focus.
 * No-op on web.
 */
export async function releaseAudioFocus(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.releaseAudioFocus();
}

/**
 * Schedules an exact alarm via AlarmManager (setAlarmClock on API 31+).
 * No-op on web.
 */
export async function scheduleExactAlarm(
  instanceId: string,
  deadlineMs: number,
): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.scheduleExactAlarm({ instanceId, deadlineMs });
}

/**
 * Cancels a previously scheduled exact alarm.
 * No-op on web.
 */
export async function cancelAlarm(instanceId: string): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.cancelAlarm({ instanceId });
}

/**
 * Checks if an alarm is still scheduled in the system AlarmManager.
 * Returns { scheduled: false } on web.
 */
export async function isAlarmScheduled(
  instanceId: string,
): Promise<{ scheduled: boolean }> {
  if (!isNative()) return { scheduled: false };
  return BlockerNative.isAlarmScheduled({ instanceId });
}

/**
 * Opens the system battery optimization exemption dialog.
 * No-op on web.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.requestBatteryOptimizationExemption();
}

/**
 * Plays the escalation ringtone.
 * Native implementation was removed; this is a no-op on both web and native.
 * Kept as an exported function so escalationService imports don't break.
 */
export async function playEscalationRingtone(): Promise<void> {
  // Intentionally a no-op – native side removed.
  // TODO: implement Web Audio API beep fallback if needed.
}

/**
 * Stops the escalation ringtone.
 * Native implementation was removed; this is a no-op on both web and native.
 */
export async function stopEscalationRingtone(): Promise<void> {
  // Intentionally a no-op – native side removed.
}
