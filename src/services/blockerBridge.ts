import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

// ─── Native Plugin Interface ──────────────────────────────────────────────────

/** Payload of the `alarmFired` event pushed by the native side. */
export interface AlarmFiredEvent {
  instanceId: string;
  repeatCount: number;
}

/** Payload of the `alarmConfirmed` event pushed by the native side. */
export interface AlarmConfirmedEvent {
  instanceId: string;
}

export interface Ringtone {
  uri: string;
  title: string;
}

interface BlockerPluginInterface {
  showAlarm(options: {
    label: string;
    repeatCount: number;
    /**
     * Soft reminder: silent notification only — no sound, no vibration,
     * no full-screen takeover. Absent/false = full alarm behaviour.
     */
    silent?: boolean;
    /** Instance the alarm belongs to (lets native cancel/repeat per instance). */
    instanceId?: string;
  }): Promise<void>;
  dismissAlarm(): Promise<void>;
  requestAudioFocus(): Promise<void>;
  releaseAudioFocus(): Promise<void>;
  scheduleExactAlarm(options: {
    instanceId: string;
    deadlineMs: number;
    /** Optional label persisted natively (shown on the alarm screen). */
    label?: string;
    /**
     * Optional repeat counter of a recovered/restarted alarm chain.
     * When absent, native preserves the existing count.
     */
    repeatCount?: number;
    /**
     * Soft reminder chain: fire silently (notification only, no sound).
     * Absent/false = full alarm behaviour.
     */
    silent?: boolean;
  }): Promise<{ scheduled: boolean }>;
  cancelAlarm(options: { instanceId: string }): Promise<void>;
  isAlarmScheduled(options: {
    instanceId: string;
  }): Promise<{ scheduled: boolean }>;
  requestBatteryOptimizationExemption(): Promise<void>;

  // ── Permissions & settings ──
  hasExactAlarmPermission(): Promise<{ granted: boolean }>;
  canUseFullScreenIntent(): Promise<{ granted: boolean }>;
  checkNotificationPermission(): Promise<{ granted: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  openFullScreenIntentSettings(): Promise<void>;

  // ── Escalation ringtone ──
  listRingtones(): Promise<{ ringtones: Ringtone[] }>;
  setEscalationRingtone(options: { uri: string }): Promise<void>;
  getEscalationRingtone(): Promise<{ uri: string | null }>;

  // ── Gallery export ──
  saveImageToGallery(options: {
    dataUrl: string;
  }): Promise<{ saved: boolean; uri?: string }>;

  // ── Event channel (native → web) ──
  addListener(
    eventName: 'alarmFired',
    listenerFunc: (event: AlarmFiredEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'alarmConfirmed',
    listenerFunc: (event: AlarmConfirmedEvent) => void,
  ): Promise<PluginListenerHandle>;
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

const BlockerNative = registerPlugin<BlockerPluginInterface>('BlockerPlugin');

/** Whether the app is running on a native (Android) platform. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Shows a full-screen alarm activity over the lock screen.
 * With `silent` the native side shows a silent notification instead of
 * the loud full-screen alarm (soft reminder mode).
 * `instanceId` ties the shown alarm to its instance so native can
 * cancel/repeat it per instance.
 * No-op on web.
 */
export async function showAlarm(
  label: string,
  repeatCount: number,
  silent?: boolean,
  instanceId?: string,
): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.showAlarm({ label, repeatCount, silent, instanceId });
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
 * The native side auto-chains a 60s repeat once the alarm fires —
 * web must NOT schedule repeats itself.
 * `repeatCount` is optional: pass it only when restarting/recovering an
 * existing alarm chain so native preserves the current count.
 * `silent` marks a soft-reminder chain (silent notifications instead of
 * loud alarms).
 * Failures are logged and swallowed (scheduling is best-effort).
 * No-op on web.
 */
export async function scheduleExactAlarm(
  instanceId: string,
  deadlineMs: number,
  label?: string,
  repeatCount?: number,
  silent?: boolean,
): Promise<void> {
  if (!isNative()) return;
  try {
    await BlockerNative.scheduleExactAlarm({
      instanceId,
      deadlineMs,
      label,
      repeatCount,
      silent,
    });
  } catch (err) {
    console.error('[blockerBridge] scheduleExactAlarm failed:', err);
  }
}

/**
 * Cancels a previously scheduled exact alarm — also stops an active
 * repeat chain and clears native metadata.
 * No-op on web.
 */
export async function cancelAlarm(instanceId: string): Promise<void> {
  if (!isNative()) return;
  try {
    await BlockerNative.cancelAlarm({ instanceId });
  } catch (err) {
    console.error('[blockerBridge] cancelAlarm failed:', err);
  }
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

// ─── Permissions & settings ───────────────────────────────────────────────────

/**
 * Whether the SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM permission is granted.
 * On web, treated as granted.
 */
export async function hasExactAlarmPermission(): Promise<{
  granted: boolean;
}> {
  if (!isNative()) return { granted: true };
  return BlockerNative.hasExactAlarmPermission();
}

/**
 * Whether full-screen intents are allowed (required for the alarm
 * to appear over the lock screen). On web, treated as granted.
 */
export async function canUseFullScreenIntent(): Promise<{ granted: boolean }> {
  if (!isNative()) return { granted: true };
  return BlockerNative.canUseFullScreenIntent();
}

/**
 * Whether the POST_NOTIFICATIONS runtime permission is granted
 * (required for the alarm foreground notification on Android 13+).
 * On web, treated as granted.
 */
export async function checkNotificationPermission(): Promise<{
  granted: boolean;
}> {
  if (!isNative()) return { granted: true };
  return BlockerNative.checkNotificationPermission();
}

/**
 * Requests the POST_NOTIFICATIONS runtime permission (Android 13+).
 * Without it the alarm foreground notification is silently suppressed.
 * On web, treated as granted.
 */
export async function requestNotificationPermission(): Promise<{
  granted: boolean;
}> {
  if (!isNative()) return { granted: true };
  return BlockerNative.requestNotificationPermission();
}

/**
 * Opens the system settings page for exact alarms.
 * No-op on web.
 */
export async function openExactAlarmSettings(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.openExactAlarmSettings();
}

/**
 * Opens the system settings page for full-screen intents.
 * No-op on web.
 */
export async function openFullScreenIntentSettings(): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.openFullScreenIntentSettings();
}

// ─── Escalation ringtone ──────────────────────────────────────────────────────

/**
 * Lists available system ringtones for the escalation ring.
 * Returns an empty list on web.
 */
export async function listRingtones(): Promise<{ ringtones: Ringtone[] }> {
  if (!isNative()) return { ringtones: [] };
  return BlockerNative.listRingtones();
}

/**
 * Persists the escalation ringtone choice natively.
 * No-op on web.
 */
export async function setEscalationRingtone(uri: string): Promise<void> {
  if (!isNative()) return;
  await BlockerNative.setEscalationRingtone({ uri });
}

/**
 * Reads the currently persisted escalation ringtone.
 * Returns { uri: null } on web.
 */
export async function getEscalationRingtone(): Promise<{
  uri: string | null;
}> {
  if (!isNative()) return { uri: null };
  return BlockerNative.getEscalationRingtone();
}

// ─── Gallery export ─────────────────────────────────────────────────────────────

/**
 * Saves a PNG data URL to the device photo gallery (Pictures/FCK-ADHD).
 * Returns { saved: false } on web.
 */
export async function saveImageToGallery(
  dataUrl: string,
): Promise<{ saved: boolean; uri?: string }> {
  if (!isNative()) return { saved: false };
  return BlockerNative.saveImageToGallery({ dataUrl });
}

// ─── Event channel (native → web) ─────────────────────────────────────────────

/**
 * Subscribes to the native `alarmFired` event. The native side runs the
 * endless 60s repeat chain itself (each fire auto-schedules the next) and
 * shows AlarmActivity on its own — this listener only lets the web layer
 * update its state machine / UI.
 * Returns an unsubscribe function. No-op on web.
 */
export async function addAlarmFiredListener(
  cb: (event: AlarmFiredEvent) => void,
): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await BlockerNative.addListener('alarmFired', cb);
  return () => {
    void handle.remove();
  };
}

/**
 * Subscribes to the native `alarmConfirmed` event. Native emits it when
 * the user confirms an alarm directly on the alarm screen ("Erledigt"),
 * so the web state machine can advance the instance the same way a QR
 * scan confirm would.
 * Returns an unsubscribe function. No-op on web.
 */
export async function addAlarmConfirmedListener(
  cb: (event: AlarmConfirmedEvent) => void,
): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await BlockerNative.addListener('alarmConfirmed', cb);
  return () => {
    void handle.remove();
  };
}
