import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Routine, RoutineInstance, Step } from '../../core/models';
import { REPEAT_INTERVAL_MS } from '../../core/constants';
import {
  startHealthCheck,
  stopHealthCheck,
  getExactAlarmPermissionStatus,
} from '../healthCheck';
import * as bridge from '../blockerBridge';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// blockerBridge is fully mocked so no Capacitor/native call ever happens
// (same boundary as alarmController.test.ts). The Dexie database is replaced
// by an in-memory store, which lets the REAL routineService + alarmController
// + stateMachine run underneath the health check. The node test environment
// has no `document`, so a fake one is injected for the visibility listener.

const store = vi.hoisted(() => {
  const routines = new Map<string, Routine>();
  const instances = new Map<string, RoutineInstance>();
  const scheduledIds = new Set<string>();

  const routinesTable = {
    get: (id: string) => Promise.resolve(routines.get(id)),
  };

  const instancesTable = {
    get: (id: string) => Promise.resolve(instances.get(id)),
    put: vi.fn((i: RoutineInstance): Promise<void> => {
      instances.set(i.id, i);
      return Promise.resolve();
    }),
    toArray: vi.fn(() => Promise.resolve([...instances.values()])),
  };

  const documentStub = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  return {
    routines,
    instances,
    scheduledIds,
    documentStub,
    db: { routines: routinesTable, instances: instancesTable },
  };
});

vi.mock('../../data/db', () => ({
  FckAdhdDatabase: class {},
  db: store.db,
}));

vi.mock('../blockerBridge', () => ({
  isNative: vi.fn(() => true),
  hasExactAlarmPermission: vi.fn(() => Promise.resolve({ granted: true })),
  isAlarmScheduled: vi.fn((instanceId: string) =>
    Promise.resolve({ scheduled: store.scheduledIds.has(instanceId) }),
  ),
  scheduleExactAlarm: vi.fn(() => Promise.resolve()),
  cancelAlarm: vi.fn(() => Promise.resolve()),
  dismissAlarm: vi.fn(() => Promise.resolve()),
  requestAudioFocus: vi.fn(() => Promise.resolve()),
  releaseAudioFocus: vi.fn(() => Promise.resolve()),
  showAlarm: vi.fn(() => Promise.resolve()),
  addAlarmFiredListener: vi.fn(() => Promise.resolve(() => {})),
}));

const isNative = vi.mocked(bridge.isNative);
const hasExactAlarmPermission = vi.mocked(bridge.hasExactAlarmPermission);
const isAlarmScheduled = vi.mocked(bridge.isAlarmScheduled);
const scheduleExactAlarm = vi.mocked(bridge.scheduleExactAlarm);
const requestAudioFocus = vi.mocked(bridge.requestAudioFocus);
const showAlarm = vi.mocked(bridge.showAlarm);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp
const MIN = 60_000;
const ROUTINE_NAME = 'Herd / Dunstabzugshaube';
const STEP_LABEL = 'Herd ausschalten!';

function seedRoutine(
  id: string,
  steps: Step[],
  name: string = ROUTINE_NAME,
): Routine {
  const routine: Routine = {
    id,
    name,
    qrCodeId: `qr-${id}`,
    steps,
    createdAt: NOW - 60_000,
  };
  store.routines.set(id, routine);
  return routine;
}

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

async function flushMicrotasks(times = 200): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** Runs the health check once (startHealthCheck verifies immediately). */
async function runHealthCheck(): Promise<void> {
  startHealthCheck();
  await flushMicrotasks();
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store.routines.clear();
  store.instances.clear();
  store.scheduledIds.clear();
  store.documentStub.visibilityState = 'visible';
  (globalThis as Record<string, unknown>).document = store.documentStub;

  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  // default bridge behaviour for these tests
  isNative.mockReturnValue(true);
  hasExactAlarmPermission.mockResolvedValue({ granted: true });

  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stopHealthCheck();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('healthCheck – platform & permission', () => {
  it('is a no-op on web (no permission check, no DB access)', async () => {
    isNative.mockReturnValue(false);
    seedInstance({ state: 'WAITING', deadline: NOW - 1_000 });

    await runHealthCheck();

    expect(hasExactAlarmPermission).not.toHaveBeenCalled();
    expect(store.db.instances.toArray).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('records the exact-alarm permission status (granted)', async () => {
    await runHealthCheck();

    expect(getExactAlarmPermissionStatus()).toBe(true);
  });

  it('warns and records the status when exact alarms are not permitted', async () => {
    hasExactAlarmPermission.mockResolvedValue({ granted: false });

    await runHealthCheck();

    expect(getExactAlarmPermissionStatus()).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Exact-alarm permission not granted'),
    );
  });
});

describe('healthCheck – overdue WAITING instances are fired immediately (S10 recovery)', () => {
  it('fires an overdue instance like a native alarm and triggers the alarm effects', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 30,
      },
    ]);
    seedInstance({ state: 'WAITING', deadline: NOW - 1 }); // overdue

    await runHealthCheck();

    // WAITING → REMINDING via the real state machine (TIMER_FIRED)
    const instance = store.instances.get('inst-1')!;
    expect(instance.state).toBe('REMINDING');
    expect(instance.repeatCount).toBe(0);

    // web-triggered alarm effects so the user actually hears it
    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
    expect(showAlarm).toHaveBeenCalledWith(STEP_LABEL, 0);
    // native 60s repeat chain is started with the current repeat count
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + REPEAT_INTERVAL_MS,
      STEP_LABEL,
      0,
    );
  });

  it('rings with a reset counter even if the WAITING instance had a stale repeatCount', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 30,
      },
    ]);
    // stale repeat count from a previous chain — TIMER_FIRED resets it
    seedInstance({ state: 'WAITING', deadline: NOW - 5_000, repeatCount: 2 });

    await runHealthCheck();

    const instance = store.instances.get('inst-1')!;
    expect(instance.state).toBe('REMINDING');
    expect(showAlarm).toHaveBeenCalledWith(STEP_LABEL, 0);
  });
});

describe('healthCheck – lost alarms are re-scheduled (S11 recovery)', () => {
  it('re-schedules a WAITING instance whose native alarm was lost', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 10,
      },
    ]);
    seedInstance({ state: 'WAITING', deadline: NOW + 10 * MIN });
    // not in store.scheduledIds → isAlarmScheduled reports it as lost

    await runHealthCheck();

    expect(isAlarmScheduled).toHaveBeenCalledWith('inst-1');
    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + 10 * MIN,
      ROUTINE_NAME,
    );
    // state untouched — still waiting for its deadline
    expect(store.instances.get('inst-1')!.state).toBe('WAITING');
  });

  it('leaves a WAITING instance alone while its alarm is still scheduled', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 10,
      },
    ]);
    seedInstance({ state: 'WAITING', deadline: NOW + 10 * MIN });
    store.scheduledIds.add('inst-1');

    await runHealthCheck();

    expect(isAlarmScheduled).toHaveBeenCalledWith('inst-1');
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('restarts the repeat chain of a REMINDING instance at now + 60s', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 10,
      },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 2 });
    // repeat chain is dead → must be restarted, keeping the repeat count

    await runHealthCheck();

    expect(scheduleExactAlarm).toHaveBeenCalledWith(
      'inst-1',
      NOW + REPEAT_INTERVAL_MS,
      ROUTINE_NAME,
      2,
    );
  });

  it('does not touch a REMINDING instance with a living repeat chain', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 10,
      },
    ]);
    seedInstance({ state: 'REMINDING', repeatCount: 1 });
    store.scheduledIds.add('inst-1');

    await runHealthCheck();

    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('ignores IDLE instances and WAITING instances without a deadline', async () => {
    seedRoutine('routine-1', [
      {
        id: 's1',
        label: STEP_LABEL,
        type: 'delayed_reminder',
        delayMinutes: 10,
      },
    ]);
    seedInstance({ id: 'inst-idle', state: 'IDLE' });
    seedInstance({ id: 'inst-nodl', state: 'WAITING', deadline: null });

    await runHealthCheck();

    expect(isAlarmScheduled).not.toHaveBeenCalled();
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
    expect(showAlarm).not.toHaveBeenCalled();
  });
});

describe('healthCheck – lifecycle (visibility listener)', () => {
  it('registers a visibilitychange listener and verifies immediately', async () => {
    await runHealthCheck();

    expect(store.documentStub.addEventListener).toHaveBeenCalledTimes(1);
    expect(store.documentStub.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(hasExactAlarmPermission).toHaveBeenCalledTimes(1);
  });

  it('does not register twice while already running', async () => {
    await runHealthCheck();
    startHealthCheck(); // second call while running
    await flushMicrotasks();

    expect(store.documentStub.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('re-verifies when the app becomes visible again', async () => {
    await runHealthCheck();
    const handler = store.documentStub.addEventListener.mock
      .calls[0][1] as () => void;

    vi.clearAllMocks();
    isNative.mockReturnValue(true);
    hasExactAlarmPermission.mockResolvedValue({ granted: true });

    store.documentStub.visibilityState = 'visible';
    handler();
    await flushMicrotasks();

    expect(hasExactAlarmPermission).toHaveBeenCalledTimes(1);

    // hidden → no verification
    vi.clearAllMocks();
    store.documentStub.visibilityState = 'hidden';
    handler();
    await flushMicrotasks();
    expect(hasExactAlarmPermission).not.toHaveBeenCalled();
  });

  it('stopHealthCheck removes the visibilitychange listener', async () => {
    await runHealthCheck();
    const handler: () => void = store.documentStub.addEventListener.mock
      .calls[0][1] as () => void;

    stopHealthCheck();

    expect(store.documentStub.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      handler,
    );
  });
});
