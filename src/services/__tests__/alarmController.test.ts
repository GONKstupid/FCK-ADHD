import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Routine, RoutineInstance, Step } from '../../core/models';
import {
  ESCALATION_AFTER_REPEATS,
  MAX_EXTENSIONS,
} from '../../core/constants';
import { shouldEscalate } from '../escalationService';
import {
  handleScanResult,
  handleAlarmFired,
  handleExtend,
  handleConfirmDone,
  dismissCurrentRing,
  fireOverdueAlarm,
} from '../alarmController';
import * as bridge from '../blockerBridge';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// blockerBridge is fully mocked so no Capacitor/native call ever happens.
// The Dexie database is replaced by an in-memory store, which lets the REAL
// routineService + stateMachine run underneath the controller — the tests
// therefore verify genuine state-machine behaviour, not a fake.

const store = vi.hoisted(() => {
  const routines = new Map<string, Routine>();
  const instances = new Map<string, RoutineInstance>();

  const routinesTable = {
    add: (r: Routine): Promise<string> => {
      routines.set(r.id, r);
      return Promise.resolve(r.id);
    },
    get: (id: string) => Promise.resolve(routines.get(id)),
    where: (field: keyof Routine) => ({
      equals: (value: string) => ({
        first: () =>
          Promise.resolve(
            [...routines.values()].find((r) => r[field] === value),
          ),
      }),
    }),
    toArray: () => Promise.resolve([...routines.values()]),
    delete: (id: string) => {
      routines.delete(id);
      return Promise.resolve();
    },
  };

  const instancesTable = {
    add: (i: RoutineInstance): Promise<string> => {
      instances.set(i.id, i);
      return Promise.resolve(i.id);
    },
    get: (id: string) => Promise.resolve(instances.get(id)),
    /** Spied so tests can assert when/whether the instance was persisted. */
    put: vi.fn((i: RoutineInstance): Promise<void> => {
      instances.set(i.id, i);
      return Promise.resolve();
    }),
    update: (id: string, changes: Partial<RoutineInstance>) => {
      const current = instances.get(id);
      if (current) instances.set(id, { ...current, ...changes });
      return Promise.resolve();
    },
    where: () => ({
      between: () => ({
        filter: (pred: (i: RoutineInstance) => boolean) => ({
          first: () =>
            Promise.resolve([...instances.values()].find(pred)),
        }),
      }),
    }),
  };

  return {
    routines,
    instances,
    instancePut: instancesTable.put,
    db: { routines: routinesTable, instances: instancesTable },
  };
});

vi.mock('../../data/db', () => ({
  FckAdhdDatabase: class {},
  db: store.db,
}));

vi.mock('../blockerBridge', () => ({
  scheduleExactAlarm: vi.fn(() => Promise.resolve()),
  cancelAlarm: vi.fn(() => Promise.resolve()),
  dismissAlarm: vi.fn(() => Promise.resolve()),
  releaseAudioFocus: vi.fn(() => Promise.resolve()),
  requestAudioFocus: vi.fn(() => Promise.resolve()),
  showAlarm: vi.fn(() => Promise.resolve()),
  addAlarmFiredListener: vi.fn(() => Promise.resolve(() => {})),
  addAlarmConfirmedListener: vi.fn(() => Promise.resolve(() => {})),
}));

const scheduleExactAlarm = vi.mocked(bridge.scheduleExactAlarm);
const cancelAlarm = vi.mocked(bridge.cancelAlarm);
const dismissAlarm = vi.mocked(bridge.dismissAlarm);
const releaseAudioFocus = vi.mocked(bridge.releaseAudioFocus);
const requestAudioFocus = vi.mocked(bridge.requestAudioFocus);
const showAlarm = vi.mocked(bridge.showAlarm);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp
const MIN = 60_000;
const ROUTINE_NAME = 'Herd / Dunstabzugshaube';

function seedRoutine(
  id: string,
  qrCodeId: string,
  steps: Step[],
  name: string = ROUTINE_NAME,
): Routine {
  const routine: Routine = {
    id,
    name,
    qrCodeId,
    steps,
    createdAt: NOW - 60_000,
  };
  store.routines.set(id, routine);
  return routine;
}

/** Directly seeds a routine instance in the fake DB. */
function seedInstance(overrides: Partial<RoutineInstance>): RoutineInstance {
  const instance: RoutineInstance = {
    id: 'inst-1',
    routineId: 'routine-1',
    state: 'IDLE',
    currentStepIndex: 0,
    startedAt: NOW - 60_000,
    deadline: null,
    repeatCount: 0,
    extensionsUsed: 0,
    completedAt: null,
    ...overrides,
  };
  store.instances.set(instance.id, instance);
  return instance;
}

function firstInstance(): RoutineInstance {
  const instance = [...store.instances.values()][0];
  expect(instance).toBeDefined();
  return instance;
}

beforeEach(() => {
  store.routines.clear();
  store.instances.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('alarmController – handleScanResult (starting a routine)', () => {
  it('returns "unknown" for an unregistered QR code and does nothing', async () => {
    const result = await handleScanResult('not-a-routine');

    expect(result.status).toBe('unknown');
    expect(store.instances.size).toBe(0);
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(showAlarm).not.toHaveBeenCalled();
  });

  it('starts a routine with a delayed first step → WAITING and schedules the exact alarm', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Herd ausschalten!', type: 'delayed_reminder', delayMinutes: 30 },
      { id: 's2', label: 'Alles aus', type: 'instant_hint', delayMinutes: 0 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    const result = await handleScanResult('qr-1');
    const instance = firstInstance();

    expect(result.status).toBe('started');
    expect(instance.state).toBe('WAITING');
    expect(instance.currentStepIndex).toBe(0);
    expect(instance.deadline).toBe(NOW + 30 * MIN);

    // WAITING side effects: cancel anything stale, then schedule natively
    expect(cancelAlarm).toHaveBeenCalledWith(instance.id);
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      instance.id,
      NOW + 30 * MIN,
      ROUTINE_NAME,
      undefined,
      false, // full reminder mode (default)
    );
  });

  it('starts a routine with an instant first step → REMINDING and shows the alarm directly', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Herd-Erinnerung aktiviert', type: 'instant_hint', delayMinutes: 0 },
      { id: 's2', label: 'Herd ausschalten!', type: 'delayed_reminder', delayMinutes: 30 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    const result = await handleScanResult('qr-1');
    const instance = firstInstance();

    expect(result.status).toBe('started');
    expect(instance.state).toBe('REMINDING');
    expect(instance.deadline).toBeNull();

    // web-triggered alarm path for instant hints (full mode by default)
    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
    expect(showAlarm).toHaveBeenCalledWith(
      'Herd-Erinnerung aktiviert',
      0,
      false,
      instance.id,
    );
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });
});

describe('alarmController – scan on a running routine ends it completely', () => {
  it('ends a multi-step WAITING routine: all remaining steps are confirmed at once', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
      { id: 's2', label: 'Schritt 2', type: 'delayed_reminder', delayMinutes: 30 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    await handleScanResult('qr-1'); // start → WAITING on step 0
    const instanceId = firstInstance().id;
    expect(store.instances.get(instanceId)!.state).toBe('WAITING');

    const result = await handleScanResult('qr-1'); // scan = end the routine
    const instance = store.instances.get(instanceId)!;

    expect(result.status).toBe('completed');
    expect(result.message).toBe(`✓ "${ROUTINE_NAME}" beendet.`);
    expect(instance.state).toBe('IDLE');
    expect(instance.currentStepIndex).toBe(2); // walked past the last step
    expect(instance.deadline).toBeNull();
    expect(instance.repeatCount).toBe(0);
    expect(instance.completedAt).toBe(NOW);

    // IDLE side effects: cancel + dismiss + release audio
    // (dismiss ×2: once when WAITING was scheduled at start, once on IDLE)
    expect(cancelAlarm).toHaveBeenLastCalledWith(instance.id);
    expect(dismissAlarm).toHaveBeenCalledTimes(2);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
    // the second step's alarm is never scheduled
    expect(scheduleExactAlarm).toHaveBeenCalledTimes(1);
  });

  it('ends a REMINDING routine whose next step would have been an instant hint', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
      { id: 's2', label: 'Sofort-Tipp', type: 'instant_hint', delayMinutes: 0 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    await handleScanResult('qr-1'); // start → WAITING on step 0
    const instanceId = firstInstance().id;
    vi.setSystemTime(NOW + 10 * MIN);
    await handleAlarmFired(instanceId, 0); // → REMINDING

    const result = await handleScanResult('qr-1'); // scan = end the routine
    const instance = store.instances.get(instanceId)!;

    expect(result.status).toBe('completed');
    expect(instance.state).toBe('IDLE');
    expect(instance.completedAt).toBe(NOW + 10 * MIN);

    // never shows the instant hint — it was confirmed away by the scan
    expect(showAlarm).not.toHaveBeenCalled();
    expect(cancelAlarm).toHaveBeenLastCalledWith(instance.id);
    // dismiss ×2: once when WAITING was scheduled at start, once on IDLE
    expect(dismissAlarm).toHaveBeenCalledTimes(2);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
  });

  it('completes the routine when the last step is scanned and cancels everything', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Einziger Schritt', type: 'delayed_reminder', delayMinutes: 15 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    await handleScanResult('qr-1'); // start → WAITING on the only step
    const instanceId = firstInstance().id;
    expect(store.instances.get(instanceId)!.state).toBe('WAITING');

    const result = await handleScanResult('qr-1'); // scan → done
    const instance = store.instances.get(instanceId)!;

    expect(result.status).toBe('completed');
    expect(instance.state).toBe('IDLE');
    expect(instance.completedAt).toBe(NOW);
    expect(instance.deadline).toBeNull();

    // IDLE side effects: cancel + dismiss + release audio
    expect(cancelAlarm).toHaveBeenCalledWith(instance.id);
    // dismiss ×2: once when WAITING was scheduled at start, once on IDLE
    expect(dismissAlarm).toHaveBeenCalledTimes(2);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
    expect(scheduleExactAlarm).toHaveBeenCalledTimes(1); // only the initial one
  });
});

describe('alarmController – handleConfirmDone ("Erledigt")', () => {
  it('advances a REMINDING instance to the next WAITING step and schedules it', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
      { id: 's2', label: 'Schritt 2', type: 'delayed_reminder', delayMinutes: 30 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);
    seedInstance({ state: 'REMINDING', repeatCount: 2 });

    const updated = await handleConfirmDone('inst-1');

    expect(updated!.state).toBe('WAITING');
    expect(updated!.currentStepIndex).toBe(1);
    expect(updated!.deadline).toBe(NOW + 30 * MIN);
    expect(updated!.repeatCount).toBe(0); // confirmed → counter resets

    // WAITING side effects: cancel the old chain, schedule the next step
    expect(cancelAlarm).toHaveBeenCalledWith('inst-1');
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + 30 * MIN,
      ROUTINE_NAME,
      undefined,
      false,
    );
    // leftover native overlay is closed when advancing to WAITING
    expect(dismissAlarm).toHaveBeenCalledTimes(1);
    expect(releaseAudioFocus).not.toHaveBeenCalled();
  });

  it('advances to an instant next step → REMINDING and shows its alarm', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
      { id: 's2', label: 'Sofort-Tipp', type: 'instant_hint', delayMinutes: 0 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);
    seedInstance({ state: 'REMINDING' });

    const updated = await handleConfirmDone('inst-1');

    expect(updated!.state).toBe('REMINDING');
    expect(updated!.currentStepIndex).toBe(1);
    expect(updated!.deadline).toBeNull();
    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
    expect(showAlarm).toHaveBeenCalledWith('Sofort-Tipp', 0, false, 'inst-1');
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('completes the routine when confirming the last step (IDLE, cancel + dismiss + release)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Einziger Schritt', type: 'delayed_reminder', delayMinutes: 15 },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 1 });

    const updated = await handleConfirmDone('inst-1');

    expect(updated!.state).toBe('IDLE');
    expect(updated!.completedAt).toBe(NOW);
    expect(updated!.deadline).toBeNull();

    // IDLE side effects: cancel + dismiss + release audio
    expect(cancelAlarm).toHaveBeenCalledWith('inst-1');
    expect(dismissAlarm).toHaveBeenCalledTimes(1);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('returns null for an unknown instanceId and makes no native calls', async () => {
    const updated = await handleConfirmDone('does-not-exist');

    expect(updated).toBeNull();
    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
  });

  it('returns a WAITING instance unchanged — stale-overlay guard (no event, no side effects)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
      { id: 's2', label: 'Schritt 2', type: 'delayed_reminder', delayMinutes: 30 },
    ]);
    const waiting = seedInstance({
      state: 'WAITING',
      deadline: NOW + 10 * MIN,
    });

    const updated = await handleConfirmDone('inst-1');

    // unchanged: no SCAN_CONFIRM applied, nothing persisted
    expect(updated).toEqual(waiting);
    expect(store.instancePut).not.toHaveBeenCalled();
    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
    expect(releaseAudioFocus).not.toHaveBeenCalled();
  });

  it('returns an IDLE instance unchanged — stale-overlay guard (no event, no side effects)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Schritt 1', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    const idle = seedInstance({ state: 'IDLE', completedAt: NOW });

    const updated = await handleConfirmDone('inst-1');

    expect(updated).toEqual(idle);
    expect(store.instancePut).not.toHaveBeenCalled();
    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
    expect(releaseAudioFocus).not.toHaveBeenCalled();
  });
});

describe('alarmController – soft reminder mode', () => {
  it('starting with a soft instant hint shows a silent alarm and schedules the silent 60s chain', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Sanfter Tipp', type: 'instant_hint', delayMinutes: 0, reminderMode: 'soft' },
      { id: 's2', label: 'Später', type: 'delayed_reminder', delayMinutes: 30 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    await handleScanResult('qr-1');
    const instance = firstInstance();

    expect(instance.state).toBe('REMINDING');
    expect(instance.deadline).toBeNull();
    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
    // silent = true on the alarm itself … (plus the instanceId)
    expect(showAlarm).toHaveBeenCalledWith('Sanfter Tipp', 0, true, instance.id);
    // … plus the native silent 60s repeat chain (repeat + escalation)
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      instance.id,
      NOW + MIN,
      'Sanfter Tipp',
      0,
      true,
    );
  });

  it('passes silent=true when scheduling a WAITING soft step', async () => {
    const steps: Step[] = [
      { id: 's1', label: 'Sanft', type: 'delayed_reminder', delayMinutes: 30, reminderMode: 'soft' },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    await handleScanResult('qr-1');
    const instance = firstInstance();

    expect(instance.state).toBe('WAITING');
    expect(cancelAlarm).toHaveBeenCalledWith(instance.id);
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      instance.id,
      NOW + 30 * MIN,
      ROUTINE_NAME,
      undefined,
      true,
    );
  });
});

describe('alarmController – fireOverdueAlarm (healthCheck recovery)', () => {
  it('shows a silent alarm WITH instanceId and schedules the silent chain for a soft step', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Sanfter Herd', type: 'delayed_reminder', delayMinutes: 30, reminderMode: 'soft' },
    ]);
    const instance = seedInstance({ state: 'REMINDING', repeatCount: 1 });

    await fireOverdueAlarm(instance);

    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
    // silent AND instanceId reach the native overlay
    expect(showAlarm).toHaveBeenCalledWith('Sanfter Herd', 1, true, 'inst-1');
    // … and the recovered 60s repeat chain is silent too
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + MIN,
      'Sanfter Herd',
      1,
      true,
    );
  });

  it('shows a loud alarm with instanceId for a full step (silent = false)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Lauter Herd', type: 'delayed_reminder', delayMinutes: 30 },
    ]);
    const instance = seedInstance({ state: 'REMINDING', repeatCount: 0 });

    await fireOverdueAlarm(instance);

    expect(showAlarm).toHaveBeenCalledWith('Lauter Herd', 0, false, 'inst-1');
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + MIN,
      'Lauter Herd',
      0,
      false,
    );
  });
});

describe('alarmController – handleAlarmFired', () => {
  it('applies TIMER_FIRED on a WAITING instance → REMINDING (no native calls)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'WAITING', deadline: NOW + 10 * MIN });

    const updated = await handleAlarmFired('inst-1', 0);

    expect(updated).not.toBeNull();
    expect(updated!.state).toBe('REMINDING');
    expect(updated!.repeatCount).toBe(0);

    // native already shows AlarmActivity itself — controller must not
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(showAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
  });

  it('applies ESCALATE while REMINDING and syncs repeatCount from the native payload', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 0 });

    // native says this is repeat #4 — post-ESCALATE web count is only 1
    const updated = await handleAlarmFired('inst-1', 4);

    expect(updated!.state).toBe('REMINDING');
    expect(updated!.repeatCount).toBe(4); // synced from the native payload

    // 1st put = applyEvent persistence, 2nd put = repeatCount sync
    expect(store.instancePut).toHaveBeenCalledTimes(2);
    expect(store.instancePut).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'inst-1', repeatCount: 4 }),
    );
  });

  it('does not write an extra sync when native and web repeat counts already match', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 0 });

    // ESCALATE brings web count to 1, which matches the payload
    const updated = await handleAlarmFired('inst-1', 1);

    expect(updated!.repeatCount).toBe(1);
    expect(store.instancePut).toHaveBeenCalledTimes(1); // applyEvent only
  });

  it('returns null for an unknown instanceId without crashing', async () => {
    const updated = await handleAlarmFired('does-not-exist', 3);

    expect(updated).toBeNull();
    expect(store.instancePut).not.toHaveBeenCalled();
  });

  it('is a no-op for an IDLE instance (no event applied)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    const idle = seedInstance({ state: 'IDLE' });

    const updated = await handleAlarmFired('inst-1', 2);

    expect(updated).toEqual(idle);
    expect(updated!.state).toBe('IDLE');
    expect(store.instancePut).not.toHaveBeenCalled(); // nothing was persisted
  });
});

describe('alarmController – handleExtend', () => {
  it('reschedules the alarm on a successful extend (cancel + schedule + dismiss + release)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 2 });

    const extendAt = NOW + 2 * MIN;
    vi.setSystemTime(extendAt);

    const updated = await handleExtend('inst-1', 5);

    expect(updated!.state).toBe('WAITING');
    expect(updated!.deadline).toBe(extendAt + 5 * MIN);
    expect(updated!.extensionsUsed).toBe(1);

    expect(cancelAlarm).toHaveBeenCalledWith('inst-1');
    // recovering an existing chain → current repeatCount is handed over,
    // silent re-derived from the step (full mode here)
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      extendAt + 5 * MIN,
      ROUTINE_NAME,
      2,
      false,
    );
    expect(dismissAlarm).toHaveBeenCalledTimes(1);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
  });

  it('passes silent=true to scheduleExactAlarm when extending a soft step', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'Sanft', type: 'delayed_reminder', delayMinutes: 10, reminderMode: 'soft' },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 1 });

    const extendAt = NOW + 2 * MIN;
    vi.setSystemTime(extendAt);

    const updated = await handleExtend('inst-1', 5);

    expect(updated!.state).toBe('WAITING');
    // cancelAlarm drops the native silent metadata → silent must be
    // re-derived from the step and handed over explicitly
    expect(cancelAlarm).toHaveBeenCalledWith('inst-1');
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      extendAt + 5 * MIN,
      ROUTINE_NAME,
      1,
      true,
    );
  });

  it('returns null for an unknown instanceId and makes no native calls', async () => {
    const updated = await handleExtend('does-not-exist', 5);

    expect(updated).toBeNull();
    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
  });

  it('rejects the extend once MAX_EXTENSIONS is reached (state machine no-op, no native calls)', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'REMINDING', extensionsUsed: MAX_EXTENSIONS });

    const updated = await handleExtend('inst-1', 5);

    // EXTEND was a no-op → still ringing
    expect(updated!.state).toBe('REMINDING');
    expect(updated!.extensionsUsed).toBe(MAX_EXTENSIONS);
    expect(updated!.deadline).toBeNull();

    expect(cancelAlarm).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(dismissAlarm).not.toHaveBeenCalled();
    expect(releaseAudioFocus).not.toHaveBeenCalled();
  });
});

describe('alarmController – dismissCurrentRing', () => {
  it('dismisses the ring and releases audio focus WITHOUT mutating instance state', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    const reminding = seedInstance({ state: 'REMINDING', repeatCount: 2 });

    await dismissCurrentRing();

    expect(dismissAlarm).toHaveBeenCalledTimes(1);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);

    // no state-machine event was applied, nothing was persisted
    expect(store.instancePut).not.toHaveBeenCalled();
    expect(store.instances.get('inst-1')).toEqual(reminding);
    expect(store.instances.get('inst-1')!.state).toBe('REMINDING');
  });
});

describe('alarmController – escalation threshold (ESCALATION_AFTER_REPEATS)', () => {
  it('shouldEscalate flips exactly at the threshold', () => {
    const base: RoutineInstance = {
      id: 'inst-1',
      routineId: 'routine-1',
      state: 'REMINDING',
      currentStepIndex: 0,
      startedAt: NOW,
      deadline: null,
      repeatCount: 0,
      extensionsUsed: 0,
      completedAt: null,
    };

    expect(shouldEscalate({ ...base, repeatCount: ESCALATION_AFTER_REPEATS - 1 })).toBe(false);
    expect(shouldEscalate({ ...base, repeatCount: ESCALATION_AFTER_REPEATS })).toBe(true);
    expect(shouldEscalate({ ...base, repeatCount: ESCALATION_AFTER_REPEATS + 5 })).toBe(true);
  });

  it('marks the instance as escalated once the synced native repeatCount reaches the threshold', async () => {
    seedRoutine('routine-1', 'qr-1', [
      { id: 's1', label: 'X', type: 'delayed_reminder', delayMinutes: 10 },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 0 });

    const below = await handleAlarmFired('inst-1', ESCALATION_AFTER_REPEATS - 1);
    expect(shouldEscalate(below!)).toBe(false);

    const atThreshold = await handleAlarmFired('inst-1', ESCALATION_AFTER_REPEATS);
    expect(atThreshold!.repeatCount).toBe(ESCALATION_AFTER_REPEATS);
    expect(shouldEscalate(atThreshold!)).toBe(true);
  });
});

describe('alarmController – full lifecycle', () => {
  it('walks from scan start through firing, repeats, 3 extends, rejected 4th and final confirm', async () => {
    // single delayed step → the final scan confirm completes the routine
    const steps: Step[] = [
      { id: 's1', label: 'Herd ausschalten!', type: 'delayed_reminder', delayMinutes: 30 },
    ];
    seedRoutine('routine-1', 'qr-1', steps);

    // ── 1. Scan start → WAITING, alarm scheduled ─────────────────────────────
    const started = await handleScanResult('qr-1');
    const instanceId = firstInstance().id;

    expect(started.status).toBe('started');
    expect(store.instances.get(instanceId)!.state).toBe('WAITING');
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      instanceId,
      NOW + 30 * MIN,
      ROUTINE_NAME,
      undefined,
      false,
    );

    // ── 2. Deadline reached → native fires → TIMER_FIRED → REMINDING ─────────
    vi.setSystemTime(NOW + 30 * MIN);
    const fired = await handleAlarmFired(instanceId, 0);
    expect(fired!.state).toBe('REMINDING');
    expect(fired!.repeatCount).toBe(0);

    // ── 3. Repeats while ringing → ESCALATE, repeatCount synced natively ─────
    const repeat = await handleAlarmFired(instanceId, 2);
    expect(repeat!.state).toBe('REMINDING');
    expect(repeat!.repeatCount).toBe(2);

    // ── 4. Three extends are allowed; each reschedules natively ──────────────
    for (let i = 1; i <= MAX_EXTENSIONS; i += 1) {
      const extendAt = NOW + 30 * MIN + i * 5 * MIN;
      vi.setSystemTime(extendAt);

      const extended = await handleExtend(instanceId, 5);
      expect(extended!.state).toBe('WAITING');
      expect(extended!.extensionsUsed).toBe(i);
      expect(extended!.deadline).toBe(extendAt + 5 * MIN);

      expect(cancelAlarm).toHaveBeenCalledWith(instanceId);
      // extend recovers the running chain → current repeatCount is passed
      // (2 after the synced repeat in step 3; TIMER_FIRED resets it to 0)
      expect(scheduleExactAlarm).toHaveBeenLastCalledWith(
        instanceId,
        extendAt + 5 * MIN,
        ROUTINE_NAME,
        i === 1 ? 2 : 0,
        false,
      );
      // dismiss: once from the initial WAITING schedule + once per extend
      expect(dismissAlarm).toHaveBeenCalledTimes(i + 1);
      expect(releaseAudioFocus).toHaveBeenCalledTimes(i);

      // the rescheduled snooze fires again → back to REMINDING
      vi.setSystemTime(extendAt + 5 * MIN);
      const firedAgain = await handleAlarmFired(instanceId, i - 1);
      expect(firedAgain!.state).toBe('REMINDING');
    }
    expect(scheduleExactAlarm).toHaveBeenCalledTimes(1 + MAX_EXTENSIONS);

    // ── 5. The 4th extend is rejected — no state change, no native calls ─────
    const callsBefore = {
      cancel: cancelAlarm.mock.calls.length,
      schedule: scheduleExactAlarm.mock.calls.length,
      dismiss: dismissAlarm.mock.calls.length,
      release: releaseAudioFocus.mock.calls.length,
    };
    const rejected = await handleExtend(instanceId, 5);
    expect(rejected!.state).toBe('REMINDING');
    expect(rejected!.extensionsUsed).toBe(MAX_EXTENSIONS);
    expect(cancelAlarm.mock.calls.length).toBe(callsBefore.cancel);
    expect(scheduleExactAlarm.mock.calls.length).toBe(callsBefore.schedule);
    expect(dismissAlarm.mock.calls.length).toBe(callsBefore.dismiss);
    expect(releaseAudioFocus.mock.calls.length).toBe(callsBefore.release);

    // ── 6. Final scan confirm (past the last step) → IDLE, everything cleared ─
    const finished = await handleScanResult('qr-1');
    const instance = store.instances.get(instanceId)!;
    expect(finished.status).toBe('completed');
    expect(instance.state).toBe('IDLE');
    expect(instance.currentStepIndex).toBe(1);
    expect(instance.completedAt).toBe(NOW + 50 * MIN);
    expect(instance.deadline).toBeNull();

    expect(cancelAlarm).toHaveBeenLastCalledWith(instanceId);
    // dismiss/release once more on completion (initial WAITING schedule +
    // 3 extends + final IDLE)
    expect(dismissAlarm).toHaveBeenCalledTimes(MAX_EXTENSIONS + 2);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(MAX_EXTENSIONS + 1);
    expect(scheduleExactAlarm).toHaveBeenCalledTimes(1 + MAX_EXTENSIONS); // no new schedule
  });
});
