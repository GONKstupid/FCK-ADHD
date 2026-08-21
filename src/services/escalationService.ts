import type { RoutineInstance } from '../core/models';
import {
  playEscalationRingtone as nativePlay,
  stopEscalationRingtone as nativeStop,
} from './blockerBridge';

// ─── Escalation Service ──────────────────────────────────────────────────────────

/**
 * Returns true when the user has ignored the alarm 3+ times.
 * At that point, a louder ringtone should play.
 */
export function shouldEscalate(instance: RoutineInstance): boolean {
  return instance.repeatCount >= 3;
}

/**
 * Triggers the escalation ringtone via the native bridge.
 * On web, falls back to a Web Audio API beep.
 */
export async function triggerEscalation(): Promise<void> {
  await nativePlay();
}

/**
 * Stops the escalation ringtone.
 */
export async function stopEscalation(): Promise<void> {
  await nativeStop();
}
