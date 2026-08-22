import { describe, it, expect } from 'vitest';
import type { RoutineInstance, Step } from '../models';
import { transition } from '../stateMachine';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp

function makeSteps(): Step[] {
  return [
    { id: 's1', label: 'Instant hint', type: 'instant_hint', delayMinutes: 0 },
    {
      id: 's2',
      label: 'Delayed reminder',
      type: 'delayed_reminder',
      delayMinutes: 30,
    },
  ];
}

function makeIdleInstance(): RoutineInstance {
  return {
    id: 'inst-1',
    routineId: 'r-1',
    state: 'IDLE',
    currentStepIndex: 0,
    startedAt: NOW - 60_000,
    deadline: null,
    repeatCount: 0,
    extensionsUsed: 0,
    completedAt: null,
  };
}

function makeWaitingInstance(stepIndex = 1): RoutineInstance {
  return {
    ...makeIdleInstance(),
    state: 'WAITING',
    currentStepIndex: stepIndex,
    deadline: NOW + 30 * 60_000,
  };
}

function makeRemindingInstance(stepIndex = 1): RoutineInstance {
  return {
    ...makeIdleInstance(),
    state: 'REMINDING',
    currentStepIndex: stepIndex,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('State Machine – transition()', () => {
  const steps = makeSteps();

  describe('SCAN_START', () => {
    it('transitions IDLE → REMINDING for instant_hint first step', () => {
      const result = transition(makeIdleInstance(), { type: 'SCAN_START' }, steps, NOW);
      expect(result.state).toBe('REMINDING');
      expect(result.deadline).toBeNull();
    });

    it('transitions IDLE → WAITING when first step is delayed', () => {
      const delayedSteps: Step[] = [
        { id: 'd1', label: 'Delayed', type: 'delayed_reminder', delayMinutes: 10 },
      ];
      const result = transition(makeIdleInstance(), { type: 'SCAN_START' }, delayedSteps, NOW);
      expect(result.state).toBe('WAITING');
      expect(result.deadline).toBe(NOW + 10 * 60_000);
    });

    it('is a no-op when state is not IDLE (double scan)', () => {
      const instance = makeWaitingInstance();
      const result = transition(instance, { type: 'SCAN_START' }, steps, NOW);
      expect(result).toBe(instance); // same reference — no change
    });
  });

  describe('TIMER_FIRED', () => {
    it('transitions WAITING → REMINDING and resets repeatCount', () => {
      const instance = { ...makeWaitingInstance(), repeatCount: 5 };
      const result = transition(instance, { type: 'TIMER_FIRED' }, steps, NOW);
      expect(result.state).toBe('REMINDING');
      expect(result.repeatCount).toBe(0);
    });

    it('is a no-op when state is not WAITING', () => {
      const result = transition(makeIdleInstance(), { type: 'TIMER_FIRED' }, steps, NOW);
      expect(result.state).toBe('IDLE');
    });

    it('is a no-op from REMINDING state', () => {
      const instance = makeRemindingInstance();
      const result = transition(instance, { type: 'TIMER_FIRED' }, steps, NOW);
      expect(result).toBe(instance);
    });
  });

  describe('SCAN_CONFIRM', () => {
    it('advances to next step (WAITING) when next step is delayed', () => {
      const instance = makeRemindingInstance(0); // on instant_hint step
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, steps, NOW);
      expect(result.state).toBe('WAITING');
      expect(result.currentStepIndex).toBe(1);
      expect(result.deadline).toBe(NOW + 30 * 60_000);
      expect(result.repeatCount).toBe(0);
    });

    it('advances to next step (REMINDING) when next step is instant_hint', () => {
      const instantSteps: Step[] = [
        { id: 'a', label: 'A', type: 'delayed_reminder', delayMinutes: 5 },
        { id: 'b', label: 'B', type: 'instant_hint', delayMinutes: 0 },
      ];
      const instance = makeRemindingInstance(0);
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, instantSteps, NOW);
      expect(result.state).toBe('REMINDING');
      expect(result.currentStepIndex).toBe(1);
      expect(result.deadline).toBeNull();
    });

    it('completes the routine when last step is confirmed', () => {
      const instance = makeRemindingInstance(1); // on the last step
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, steps, NOW);
      expect(result.state).toBe('IDLE');
      expect(result.completedAt).toBe(NOW);
      expect(result.currentStepIndex).toBe(2);
    });

    it('is a no-op from IDLE state', () => {
      const result = transition(makeIdleInstance(), { type: 'SCAN_CONFIRM' }, steps, NOW);
      expect(result.state).toBe('IDLE');
    });

    it('completes the current step early from WAITING state (user finished faster)', () => {
      // makeWaitingInstance() sits on step 1 (the last step) — confirm advances past it
      const instance = makeWaitingInstance();
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, steps, NOW);
      expect(result.state).toBe('IDLE');
      expect(result.completedAt).toBe(NOW);
      expect(result.currentStepIndex).toBe(2);
    });

    it('advances from WAITING to the next step with a new deadline', () => {
      const instance = { ...makeWaitingInstance(0), deadline: NOW + 5 * 60_000 };
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, steps, NOW);
      expect(result.state).toBe('WAITING');
      expect(result.currentStepIndex).toBe(1);
      expect(result.deadline).toBe(NOW + 30 * 60_000);
      expect(result.repeatCount).toBe(0);
    });

    it('completes the instance when SCAN_CONFIRM fires during WAITING on the last step', () => {
      const singleStep: Step[] = [
        { id: 'only', label: 'Only step', type: 'delayed_reminder', delayMinutes: 15 },
      ];
      const instance: RoutineInstance = {
        ...makeIdleInstance(),
        state: 'WAITING',
        currentStepIndex: 0,
        deadline: NOW + 15 * 60_000,
      };
      const result = transition(instance, { type: 'SCAN_CONFIRM' }, singleStep, NOW);
      expect(result.state).toBe('IDLE');
      expect(result.completedAt).toBe(NOW);
      expect(result.deadline).toBeNull();
      expect(result.currentStepIndex).toBe(1);
    });
  });

  describe('EXTEND', () => {
    it('transitions REMINDING → WAITING with new deadline', () => {
      const instance = makeRemindingInstance();
      const result = transition(
        instance,
        { type: 'EXTEND', durationMinutes: 10 },
        steps,
        NOW,
      );
      expect(result.state).toBe('WAITING');
      expect(result.deadline).toBe(NOW + 10 * 60_000);
      expect(result.extensionsUsed).toBe(1);
    });

    it('still allows the 3rd extend (boundary — MAX_EXTENSIONS = 3)', () => {
      const instance = { ...makeRemindingInstance(), extensionsUsed: 2 };
      const result = transition(
        instance,
        { type: 'EXTEND', durationMinutes: 5 },
        steps,
        NOW,
      );
      expect(result.state).toBe('WAITING');
      expect(result.extensionsUsed).toBe(3);
      expect(result.deadline).toBe(NOW + 5 * 60_000);
    });

    it('is a no-op on the 4th extend (MAX_EXTENSIONS reached)', () => {
      const instance = { ...makeRemindingInstance(), extensionsUsed: 3 };
      const result = transition(
        instance,
        { type: 'EXTEND', durationMinutes: 5 },
        steps,
        NOW,
      );
      expect(result).toBe(instance); // same reference — no change
      expect(result.extensionsUsed).toBe(3);
    });

    it('is a no-op from IDLE state', () => {
      const result = transition(
        makeIdleInstance(),
        { type: 'EXTEND', durationMinutes: 5 },
        steps,
        NOW,
      );
      expect(result.state).toBe('IDLE');
    });

    it('is a no-op from WAITING state', () => {
      const instance = makeWaitingInstance();
      const result = transition(
        instance,
        { type: 'EXTEND', durationMinutes: 5 },
        steps,
        NOW,
      );
      expect(result).toBe(instance);
    });
  });

  describe('ESCALATE', () => {
    it('increments repeatCount while staying in REMINDING', () => {
      const instance = { ...makeRemindingInstance(), repeatCount: 2 };
      const result = transition(instance, { type: 'ESCALATE' }, steps, NOW);
      expect(result.state).toBe('REMINDING');
      expect(result.repeatCount).toBe(3);
    });

    it('is a no-op from IDLE state', () => {
      const result = transition(makeIdleInstance(), { type: 'ESCALATE' }, steps, NOW);
      expect(result.state).toBe('IDLE');
      expect(result.repeatCount).toBe(0);
    });

    it('is a no-op from WAITING state', () => {
      const instance = { ...makeWaitingInstance(), repeatCount: 1 };
      const result = transition(instance, { type: 'ESCALATE' }, steps, NOW);
      expect(result.repeatCount).toBe(1);
    });
  });

  describe('Multi-step progression (full lifecycle)', () => {
    it('walks through a 3-step routine from start to completion', () => {
      const multiSteps: Step[] = [
        { id: 'a', label: 'Hint', type: 'instant_hint', delayMinutes: 0 },
        { id: 'b', label: 'Wait 10m', type: 'delayed_reminder', delayMinutes: 10 },
        { id: 'c', label: 'Final hint', type: 'instant_hint', delayMinutes: 0 },
      ];

      let inst = makeIdleInstance();

      // SCAN_START → REMINDING (instant_hint step 0)
      inst = transition(inst, { type: 'SCAN_START' }, multiSteps, NOW);
      expect(inst.state).toBe('REMINDING');
      expect(inst.currentStepIndex).toBe(0);

      // SCAN_CONFIRM → WAITING (delayed step 1)
      inst = transition(inst, { type: 'SCAN_CONFIRM' }, multiSteps, NOW);
      expect(inst.state).toBe('WAITING');
      expect(inst.currentStepIndex).toBe(1);
      expect(inst.deadline).toBe(NOW + 10 * 60_000);

      // TIMER_FIRED → REMINDING
      inst = transition(inst, { type: 'TIMER_FIRED' }, multiSteps, NOW);
      expect(inst.state).toBe('REMINDING');

      // EXTEND → WAITING
      inst = transition(
        inst,
        { type: 'EXTEND', durationMinutes: 5 },
        multiSteps,
        NOW,
      );
      expect(inst.state).toBe('WAITING');
      expect(inst.extensionsUsed).toBe(1);

      // TIMER_FIRED again → REMINDING
      inst = transition(inst, { type: 'TIMER_FIRED' }, multiSteps, NOW);
      expect(inst.state).toBe('REMINDING');

      // ESCALATE once
      inst = transition(inst, { type: 'ESCALATE' }, multiSteps, NOW);
      expect(inst.repeatCount).toBe(1);

      // SCAN_CONFIRM → REMINDING (instant_hint step 2)
      inst = transition(inst, { type: 'SCAN_CONFIRM' }, multiSteps, NOW);
      expect(inst.state).toBe('REMINDING');
      expect(inst.currentStepIndex).toBe(2);
      expect(inst.repeatCount).toBe(0);

      // SCAN_CONFIRM → IDLE (completed — past last step)
      inst = transition(inst, { type: 'SCAN_CONFIRM' }, multiSteps, NOW);
      expect(inst.state).toBe('IDLE');
      expect(inst.completedAt).toBe(NOW);
    });
  });
});
