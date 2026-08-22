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
  addAlarmConfirmedListener,
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

// Scanning a QR code either STARTS the routine (no active instance) or
// ENDS the running one completely (all remaining steps confirmed at once).
export type ScanResultStatus =
  | 'started'
  | 'completed'
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
 * - REMINDING/WAITING → end the WHOLE routine: SCAN_CONFIRM is applied
 *   repeatedly until the instance reaches IDLE (every remaining step is
 *   confirmed in one go).
 * - otherwise → create a fresh instance + SCAN_START
 *
 * After the final state is reached the native side effects for that state
 * are applied (see applySideEffects).
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
    // A scan on a running routine means "everything is done" — walk the
    // state machine to IDLE with a bounded loop of SCAN_CONFIRM events.
    let final: RoutineInstance | null = active;
    const maxEvents = routine.steps.length + 1; // hard bound against loops
    for (let i = 0; i < maxEvents && final.state !== 'IDLE'; i += 1) {
      const next = await applyEvent(final.id, { type: 'SCAN_CONFIRM' });
      if (!next) {
        return {
          status: 'unknown',
          message: 'Routine-Instanz konnte nicht aktualisiert werden.',
        };
      }
      final = next;
    }

    if (final.state !== 'IDLE') {
      return {
        status: 'unknown',
        message: 'Routine-Instanz konnte nicht aktualisiert werden.',
      };
    }

    await applySideEffects(final, routine);
    return {
      status: 'completed',
      message: `✓ "${routine.name}" beendet.`,
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

// ─── Confirm ("Erledigt") ─────────────────────────────────────────────────────────────────

/**
 * Confirms the CURRENT step only (the "Erledigt" slider on the alarm
 * screen / native alarmConfirmed event): applies a single SCAN_CONFIRM
 * and then performs the side effects for the resulting state — the
 * routine advances to its next step (or completes on the last one).
 *
 * Stale-overlay guard: the event is only applied while the instance is
 * REMINDING. A native alarmConfirmed can arrive after the web side has
 * already confirmed (the instance already advanced to WAITING/IDLE) —
 * re-applying SCAN_CONFIRM would skip a step (double confirm). Any
 * non-REMINDING instance is returned unchanged: no event, no side
 * effects.
 *
 * Returns the updated instance, or null if the instance/routine is
 * missing or the transition failed.
 */
export async function handleConfirmDone(
  instanceId: string,
): Promise<RoutineInstance | null> {
  const instance = await getInstance(instanceId);
  if (!instance) return null;

  const routine = await getRoutineById(instance.routineId);
  if (!routine) return null;

  // Stale-overlay guard: a confirm arriving after the instance already
  // advanced must not apply another SCAN_CONFIRM.
  if (instance.state !== 'REMINDING') return instance;

  const updated = await applyEvent(instanceId, { type: 'SCAN_CONFIRM' });
  if (!updated) return null;

  await applySideEffects(updated, routine);
  return updated;
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
  const step = routine?.steps[instance.currentStepIndex];
  const label = step?.label ?? routine?.name ?? '';
  const silent = step?.reminderMode === 'soft';

  await requestAudioFocus();
  await showAlarm(label, instance.repeatCount, silent, instance.id);
  await scheduleExactAlarm(
    instance.id,
    Date.now() + REPEAT_INTERVAL_MS,
    label,
    instance.repeatCount,
    silent,
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
    // cancelAlarm clears native silent metadata — re-derive silent from
    // the current step so the snoozed chain keeps its soft behaviour.
    const silent =
      routine?.steps[updated.currentStepIndex]?.reminderMode === 'soft';
    await cancelAlarm(instanceId);
    // Recovering an existing chain → hand over the current repeat count
    // so native preserves it.
    await scheduleExactAlarm(
      instanceId,
      updated.deadline,
      routine?.name,
      updated.repeatCount,
      silent,
    );
    await dismissAlarm();
    await releaseAudioFocus();
  }

  return updated;
}

// ─── Dismiss ("Später") ───────────────────────────────────────────────────────

/**
 * Silences the current ring ONLY — no state change.
 * The alarm returns after 60s via the native repeat chain, until it is
 * confirmed via the Erledigt button or the routine is ended by a QR scan.
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

// ─── alarmConfirmed listener lifecycle ─────────────────────────────────────────

let unsubscribeConfirmed: (() => void) | null = null;

/**
 * Registers the native `alarmConfirmed` listener. For every event the
 * current step is confirmed via handleConfirmDone — the same transition
 * an "Erledigt" press on the web alarm screen triggers.
 */
export async function startAlarmConfirmedListener(
  onConfirmed: (instanceId: string) => void,
): Promise<() => void> {
  await stopAlarmConfirmedListener();
  const stop = await addAlarmConfirmedListener((event) => {
    void handleConfirmDone(event.instanceId).then((updated) => {
      if (updated) onConfirmed(event.instanceId);
    });
  });
  unsubscribeConfirmed = stop;
  return stop;
}

/**
 * Removes the previously registered `alarmConfirmed` listener.
 */
export async function stopAlarmConfirmedListener(): Promise<void> {
  if (unsubscribeConfirmed) {
    const stop = unsubscribeConfirmed;
    unsubscribeConfirmed = null;
    await Promise.resolve(stop());
  }
}

// ─── Side effects per resulting state ─────────────────────────────────────────

/**
 * Applies the native side effects matching the state an instance is NOW in:
 *
 * - WAITING (with deadline) → schedule the exact alarm natively
 *   (silent when the step runs in soft reminder mode) and dismiss any
 *   leftover native overlay (e.g. after a confirm advanced the ringing
 *   instance to its next WAITING step; harmless when nothing is shown).
 * - REMINDING (instant step, no deadline) → web-triggered alarm path:
 *   request audio focus and show the alarm directly. This is the ONLY
 *   path where web triggers an alarm, because instant-hint steps have no
 *   native alarm chain behind them. Soft steps show a silent notification
 *   and additionally schedule the native silent 60s repeat chain (so they
 *   still repeat and escalate).
 * - IDLE (completed) → cancel alarm + dismiss ringing UI + release audio.
 */
async function applySideEffects(
  instance: RoutineInstance,
  routine: Routine,
): Promise<void> {
  if (instance.state === 'WAITING' && instance.deadline != null) {
    const silent =
      routine.steps[instance.currentStepIndex]?.reminderMode === 'soft';
    await cancelAlarm(instance.id); // drop any previous schedule first
    await scheduleExactAlarm(
      instance.id,
      instance.deadline,
      routine.name,
      undefined,
      silent,
    );
    // Close a leftover native overlay (stale alarm screen from the
    // previous ring); harmless when nothing is shown.
    await dismissAlarm();
    return;
  }

  if (instance.state === 'REMINDING' && instance.deadline == null) {
    const step = routine.steps[instance.currentStepIndex];
    const silent = step?.reminderMode === 'soft';
    const label = step?.label ?? routine.name;
    await requestAudioFocus();
    await showAlarm(label, instance.repeatCount, silent, instance.id);
    if (silent) {
      // Soft instant hints have no native chain behind them — start the
      // silent 60s repeat chain so they repeat and escalate like full ones.
      await scheduleExactAlarm(
        instance.id,
        Date.now() + REPEAT_INTERVAL_MS,
        label,
        instance.repeatCount,
        true,
      );
    }
    return;
  }

  if (instance.state === 'IDLE') {
    await cancelAlarm(instance.id);
    await dismissAlarm();
    await releaseAudioFocus();
  }
}
