import type { RoutineInstance, StateMachineEvent, Step } from './models';
import { MAX_EXTENSIONS } from './constants';

/**
 * Derives the deadline for a given step starting from `now`.
 * instant_hint steps (delayMinutes === 0) fire immediately — no deadline needed.
 */
function computeDeadline(step: Step, now: number): number | null {
  if (step.type === 'instant_hint' || step.delayMinutes === 0) return null;
  return now + step.delayMinutes * 60_000;
}

/**
 * Pure state-machine transition function.
 * Returns a NEW RoutineInstance — never mutates the input.
 */
export function transition(
  instance: RoutineInstance,
  event: StateMachineEvent,
  steps: Step[],
  now: number = Date.now(),
): RoutineInstance {
  switch (event.type) {
    // ── Start the routine (QR scanned for the first time) ────────────────────
    case 'SCAN_START': {
      if (instance.state !== 'IDLE') return instance; // no-op if already running

      const step = steps[instance.currentStepIndex];
      if (!step) return instance;

      if (step.type === 'instant_hint' || step.delayMinutes === 0) {
        // Skip straight to REMINDING so the user sees the hint immediately
        return { ...instance, state: 'REMINDING', deadline: null };
      }

      return {
        ...instance,
        state: 'WAITING',
        deadline: computeDeadline(step, now),
      };
    }

    // ── Deadline reached → fire alarm ────────────────────────────────────────
    case 'TIMER_FIRED': {
      if (instance.state !== 'WAITING') return instance;
      return { ...instance, state: 'REMINDING', repeatCount: 0 };
    }

    // ── User confirms (scans QR again) → advance or complete ─────────────────
    case 'SCAN_CONFIRM': {
      // Allowed from REMINDING (alarm ringing) and WAITING (user finished the
      // step faster than planned — a scan during WAITING ends it immediately).
      if (instance.state !== 'REMINDING' && instance.state !== 'WAITING') {
        return instance;
      }

      const nextIndex = instance.currentStepIndex + 1;

      if (nextIndex >= steps.length) {
        // All steps done — mark complete and return to IDLE
        return {
          ...instance,
          state: 'IDLE',
          currentStepIndex: nextIndex,
          deadline: null,
          repeatCount: 0,
          completedAt: now,
        };
      }

      const nextStep = steps[nextIndex];
      if (nextStep.type === 'instant_hint' || nextStep.delayMinutes === 0) {
        return {
          ...instance,
          state: 'REMINDING',
          currentStepIndex: nextIndex,
          deadline: null,
          repeatCount: 0,
        };
      }

      return {
        ...instance,
        state: 'WAITING',
        currentStepIndex: nextIndex,
        deadline: computeDeadline(nextStep, now),
        repeatCount: 0,
      };
    }

    // ── User extends the timer ───────────────────────────────────────────────
    case 'EXTEND': {
      if (instance.state !== 'REMINDING') return instance;
      if (instance.extensionsUsed >= MAX_EXTENSIONS) return instance; // limit reached
      return {
        ...instance,
        state: 'WAITING',
        deadline: now + event.durationMinutes * 60_000,
        extensionsUsed: instance.extensionsUsed + 1,
      };
    }

    // ── Alarm escalation (repeat ringtone) ───────────────────────────────────
    case 'ESCALATE': {
      if (instance.state !== 'REMINDING') return instance;
      return { ...instance, repeatCount: instance.repeatCount + 1 };
    }

    default:
      return instance;
  }
}
