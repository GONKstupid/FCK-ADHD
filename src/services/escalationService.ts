import type { RoutineInstance } from '../core/models';
import { ESCALATION_AFTER_REPEATS } from '../core/constants';

// ─── Escalation Service ──────────────────────────────────────────────────────────
//
// DESIGN NOTE: Triggering and stopping the escalation ringtone is now handled
// ENTIRELY on the native side. AlarmActivity watches the repeat count passed
// with each `alarmFired` event and switches to the configured escalation
// ringtone (see Settings → listRingtones/setEscalationRingtone) once the
// threshold is reached. The former web-side play/stop stubs were removed.
//
// This service keeps only the pure decision helper, which the UI can use to
// show escalation hints (e.g. on the alarm screen).

/**
 * Returns true when the user has ignored the alarm often enough
 * (ESCALATION_AFTER_REPEATS or more) for escalation to be active.
 */
export function shouldEscalate(instance: RoutineInstance): boolean {
  return instance.repeatCount >= ESCALATION_AFTER_REPEATS;
}
