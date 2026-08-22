import { describe, it, expect } from 'vitest';
import type { RoutineInstance, Step } from '../../core/models';
import { ESCALATION_AFTER_REPEATS, MAX_EXTENSIONS } from '../../core/constants';
import { shouldEscalate } from '../escalationService';
import { transition } from '../../core/stateMachine';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp

function makeInstance(overrides: Partial<RoutineInstance>): RoutineInstance {
  return {
    id: 'inst-1',
    routineId: 'routine-1',
    state: 'REMINDING',
    currentStepIndex: 0,
    startedAt: NOW,
    deadline: null,
    repeatCount: 0,
    extensionsUsed: 0,
    completedAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('escalationService – shouldEscalate (S5)', () => {
  it('pins the spec constant: escalation starts at the 3rd repeat', () => {
    expect(ESCALATION_AFTER_REPEATS).toBe(3);
  });

  it('does not escalate on the normal path (fewer than 3 repeats)', () => {
    expect(shouldEscalate(makeInstance({ repeatCount: 0 }))).toBe(false);
    expect(shouldEscalate(makeInstance({ repeatCount: 1 }))).toBe(false);
    expect(shouldEscalate(makeInstance({ repeatCount: 2 }))).toBe(false);
  });

  it('escalates from the 3rd unanswered repeat onward', () => {
    expect(shouldEscalate(makeInstance({ repeatCount: 3 }))).toBe(true);
    expect(shouldEscalate(makeInstance({ repeatCount: 4 }))).toBe(true);
    expect(shouldEscalate(makeInstance({ repeatCount: 10 }))).toBe(true);
  });

  it('flips exactly at the threshold boundary', () => {
    const below = makeInstance({ repeatCount: ESCALATION_AFTER_REPEATS - 1 });
    const atThreshold = makeInstance({ repeatCount: ESCALATION_AFTER_REPEATS });

    expect(shouldEscalate(below)).toBe(false);
    expect(shouldEscalate(atThreshold)).toBe(true);
  });

  it('is a pure counter check — independent of the instance state', () => {
    // The decision helper only looks at repeatCount; the ringtone switch
    // itself happens natively (see design note in escalationService.ts).
    expect(
      shouldEscalate(makeInstance({ state: 'WAITING', repeatCount: 3 })),
    ).toBe(true);
    expect(
      shouldEscalate(makeInstance({ state: 'IDLE', repeatCount: 3 })),
    ).toBe(true);
    expect(
      shouldEscalate(makeInstance({ state: 'WAITING', repeatCount: 2 })),
    ).toBe(false);
  });
});

describe('escalationService – extension cap cross-check (S6)', () => {
  // The max-3-extension limit is NOT decided in escalationService (it is a
  // pure decision helper) but enforced by the state machine via
  // MAX_EXTENSIONS. These tests pin that boundary next to the escalation
  // threshold so both S5 and S6 spec values are verified in one place.

  const steps: Step[] = [
    { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
  ];

  it('pins the spec constant: at most 3 extensions', () => {
    expect(MAX_EXTENSIONS).toBe(3);
  });

  it('allows exactly 3 extensions, then blocks any further one', () => {
    let instance = makeInstance({ state: 'REMINDING' });

    for (let i = 1; i <= MAX_EXTENSIONS; i += 1) {
      instance = transition(
        instance,
        { type: 'EXTEND', durationMinutes: 5 },
        steps,
        NOW,
      );
      expect(instance.state).toBe('WAITING');
      expect(instance.extensionsUsed).toBe(i);

      // the snoozed alarm fires again → back to REMINDING for the next round
      instance = transition(instance, { type: 'TIMER_FIRED' }, steps, NOW);
      expect(instance.state).toBe('REMINDING');
    }

    // 4th extend is a no-op — same reference, still ringing
    const rejected = transition(
      instance,
      { type: 'EXTEND', durationMinutes: 5 },
      steps,
      NOW,
    );
    expect(rejected).toBe(instance);
    expect(rejected.extensionsUsed).toBe(MAX_EXTENSIONS);
  });
});
