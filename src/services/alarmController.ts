import type { Routine, RoutineInstance } from '../core/models';
import {
  applyEvent,
  createInstance,
  getActiveInstance,
  getInstance,
  getRoutineById,
  getRoutineByQrCodeId,
  updateInstance,
} from './routineService';
import {
  addAlarmFiredListener,
  cancelAlarm,
  dismissAlarm,
  releaseAudioFocus,
  requestAudioFocus,
  scheduleExactAlarm,
  showAlarm,
} from './blockerBridge';
import { REPEAT_INTERVAL_MS } from '../core/constants';

// ─── Alarm Controller ─────────────────────────────────────────────────────────
//
// Single wiring point between UI / native events and the state machine.
// Every function applies state-machine events via routineService.applyEvent
// and then performs the native side effects appropriate for the RESULTING
// state. Services are imported at module level (existing code style).

export type ScanResultStatus =
  | 'started'
  | 'confirmed'
  | 'completed'
  | 'step-completed'
  | 'unknown'
  | 'debounced'
  | 'cancelled';

export interface ScanResult {
  status: ScanResultStatus;
  message: string;
}

// ─── Scan handling ────────────────────────────────────────────────────────────

/**
 * Consolidates all QR-scan logic:
 * - REMINDING → SCAN_CONFIRM (confirm while the alarm rings)
 * - WAITING   → SCAN_CONFIRM (early completion of the running step)
 * - otherwise → create a fresh instance + SCAN_START
 *
 * After every successful transition the native side effects for the
 * resulting state are applied (see applySideEffects).
 */
export async function handleScanResult(qrCodeId: string): Promise<ScanResult> {
  const routine = await getRoutineByQrCodeId(qrCodeId);
  if (!routine) {
    return {
      status: 'unknown',
      message: 'Unbekannter QR-Code. Keine Routine gefunden.',
    };
  }

  const active = await getActiveInstance(routine.id);

  if (active && (active.state === 'REMINDING' || active.state === 'WAITING')) {
    const updated = await applyEvent(active.id, { type: 'SCAN_CONFIRM' });
    if (!updated) {
      return {
        status: 'unknown',
        message: 'Routine-Instanz konnte nicht aktualisiert werden.',
      };
    }
    await applySideEffects(updated, routine);

    if (updated.state === 'IDLE') {
      return {
        status: 'completed',
        message: `✓ "${routine.name}" abgeschlossen!`,
      };
    }
    if (updated.state === 'WAITING') {
      return {
        status: 'step-completed',
        message: `✓ Schritt abgeschlossen – nächster Timer läuft.`,
      };
    }
    // REMINDING — next step is an instant hint
    return {
      status: 'confirmed',
      message: `✓ Bestätigt. Nächster Schritt…`,
    };
  }

  // No active instance — start a new one
  const instanceId = await createInstance(routine.id);
  const updated = await applyEvent(instanceId, { type: 'SCAN_START' });
  if (!updated) {
    return {
      status: 'unknown',
      message: 'Routine konnte nicht gestartet werden.',
    };
  }
  await applySideEffects(updated, routine);
  return { status: 'started', message: `✓ "${routine.name}" gestartet!` };
}

// ─── Native alarm events ──────────────────────────────────────────────────────

/**
 * Handles a native `alarmFired` event (initial fire or any 60s repeat).
 *
 * WAITING   → TIMER_FIRED (deadline reached, instance starts ringing)
 * REMINDING → ESCALATE    (repeat while already ringing)
 *
 * IMPORTANT: no showAlarm / scheduling happens here. Native already shows
 * AlarmActivity and has scheduled the next repeat in its own chain.
 * Returns the updated instance so the UI can react.
 */
export async function handleAlarmFired(
  instanceId: string,
  repeatCount: number,
): Promise<RoutineInstance | null> {
  const instance = await getInstance(instanceId);
  if (!instance) return null;

  if (instance.state === 'WAITING') {
    return applyEvent(instanceId, { type: 'TIMER_FIRED' });
  }

  if (instance.state === 'REMINDING') {
    let updated = await applyEvent(instanceId, { type: 'ESCALATE' });
    // Keep web repeat count in sync with the authoritative native counter.
    if (updated && updated.repeatCount !== repeatCount) {
      updated = { ...updated, repeatCount };
      await updateInstance(updated);
    }
    return updated;
  }

  // IDLE or unknown — nothing to do
  return instance;
}

// ─── Overdue recovery (healthCheck) ───────────────────────────────────────────

/**
 * Performs the web-triggered alarm effects for an instance that the
 * healthCheck recovered as overdue (WAITING whose deadline passed while
 * the app was dead/backgrounded).
 *
 * handleAlarmFired applies no native side effects by contract, so without
 * this the instance would ring silently: here we take audio focus, show
 * the full-screen alarm UI and start the native 60s repeat chain (native
 * auto-chains every further repeat itself). One implementation — used by
 * healthCheck only.
 */
export async function fireOverdueAlarm(
  instance: RoutineInstance,
): Promise<void> {
  const routine = await getRoutineById(instance.routineId);
  const label =
    routine?.steps[instance.currentStepIndex]?.label ?? routine?.name ?? '';

  await requestAudioFocus();
  await showAlarm(label, instance.repeatCount);
  await scheduleExactAlarm(
    instance.id,
    Date.now() + REPEAT_INTERVAL_MS,
    label,
    instance.repeatCount,
  );
}

// ─── Extend (snooze) ──────────────────────────────────────────────────────────

/**
 * Applies EXTEND (the state machine enforces MAX_EXTENSIONS).
 * On success the running alarm is cancelled, the new deadline is scheduled
 * natively, and any ringing UI/audio is torn down.
 */
export async function handleExtend(
  instanceId: string,
  minutes: number,
): Promise<RoutineInstance | null> {
  const before = await getInstance(instanceId);
  if (!before) return null;

  const updated = await applyEvent(instanceId, {
    type: 'EXTEND',
    durationMinutes: minutes,
  });
  if (!updated) return null;

  const succeeded =
    before.state === 'REMINDING' &&
    updated.state === 'WAITING' &&
    updated.deadline != null;

  if (succeeded && updated.deadline != null) {
    const routine = await getRoutineById(updated.routineId);
    await cancelAlarm(instanceId);
    // Recovering an existing chain → hand over the current repeat count
    // so native preserves it.
    await scheduleExactAlarm(
      instanceId,
      updated.deadline,
      routine?.name,
      updated.repeatCount,
    );
    await dismissAlarm();
    await releaseAudioFocus();
  }

  return updated;
}

// ─── Dismiss ("Später") ───────────────────────────────────────────────────────

/**
 * Silences the current ring ONLY — no state change.
 * The alarm returns after 60s via the native repeat chain until the user
 * confirms by scanning the QR code.
 */
export async function dismissCurrentRing(): Promise<void> {
  await dismissAlarm();
  await releaseAudioFocus();
}

// ─── alarmFired listener lifecycle ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null;

/**
 * Registers the native `alarmFired` listener. For every event the state
 * machine is advanced via handleAlarmFired and the callback receives the
 * updated instance (so the app can navigate to the alarm screen etc.).
 */
export async function startAlarmFiredListener(
  onFired: (instance: RoutineInstance) => void,
): Promise<() => void> {
  await stopAlarmFiredListener();
  const stop = await addAlarmFiredListener((event) => {
    void handleAlarmFired(event.instanceId, event.repeatCount).then(
      (updated) => {
        if (updated) onFired(updated);
      },
    );
  });
  unsubscribe = stop;
  return stop;
}

/**
 * Removes the previously registered `alarmFired` listener.
 */
export async function stopAlarmFiredListener(): Promise<void> {
  if (unsubscribe) {
    const stop = unsubscribe;
    unsubscribe = null;
    await Promise.resolve(stop());
  }
}

// ─── Side effects per resulting state ─────────────────────────────────────────

/**
 * Applies the native side effects matching the state an instance is NOW in:
 *
 * - WAITING (with deadline) → schedule the exact alarm natively.
 * - REMINDING (instant step, no deadline) → web-triggered alarm path:
 *   request audio focus and show the alarm activity directly. This is the
 *   ONLY path where web triggers an alarm, because instant-hint steps have
 *   no native alarm chain behind them.
 * - IDLE (completed) → cancel alarm + dismiss ringing UI + release audio.
 */
async function applySideEffects(
  instance: RoutineInstance,
  routine: Routine,
): Promise<void> {
  if (instance.state === 'WAITING' && instance.deadline != null) {
    await cancelAlarm(instance.id); // drop any previous schedule first
    await scheduleExactAlarm(instance.id, instance.deadline, routine.name);
    return;
  }

  if (instance.state === 'REMINDING' && instance.deadline == null) {
    const step = routine.steps[instance.currentStepIndex];
    await requestAudioFocus();
    await showAlarm(step?.label ?? routine.name, instance.repeatCount);
    return;
  }

  if (instance.state === 'IDLE') {
    await cancelAlarm(instance.id);
    await dismissAlarm();
    await releaseAudioFocus();
  }
}
