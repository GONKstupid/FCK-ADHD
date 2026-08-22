import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Routine, RoutineInstance, Step } from '../../core/models';
import {
  createRoutine,
  getRoutineById,
  getRoutineByQrCodeId,
  getAllRoutines,
  deleteRoutine,
  createInstance,
  getInstance,
  updateInstance,
  getActiveInstance,
  completeInstance,
  applyEvent,
} from '../routineService';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// The Dexie database is replaced by an in-memory store (the same boundary
// used in alarmController.test.ts). The REAL state machine runs underneath
// applyEvent, so transition results are genuine — not faked.

const store = vi.hoisted(() => {
  const routines = new Map<string, Routine>();
  const instances = new Map<string, RoutineInstance>();

  // Captures the lo/hi bounds passed to Dexie's between() so tests can
  // verify the compound-index range used by getActiveInstance.
  const betweenSpy = vi.fn();

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
      between: (...args: unknown[]) => {
        betweenSpy(...args);
        return {
          filter: (pred: (i: RoutineInstance) => boolean) => ({
            first: () => Promise.resolve([...instances.values()].find(pred)),
          }),
        };
      },
    }),
  };

  type DbShape = {
    routines: typeof routinesTable;
    instances: typeof instancesTable;
    transaction?: (
      mode: string,
      table1: unknown,
      table2: unknown,
      fn: () => Promise<RoutineInstance | null>,
    ) => Promise<RoutineInstance | null>;
  };

  const db: DbShape = { routines: routinesTable, instances: instancesTable };

  return {
    routines,
    instances,
    betweenSpy,
    instancePut: instancesTable.put,
    db,
  };
});

vi.mock('../../data/db', () => ({
  FckAdhdDatabase: class {},
  db: store.db,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp
const MIN = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEPS: Step[] = [
  {
    id: 's1',
    label: 'Herd ausschalten!',
    type: 'delayed_reminder',
    delayMinutes: 30,
  },
  { id: 's2', label: 'Alles aus', type: 'instant_hint', delayMinutes: 0 },
];

function seedRoutine(id: string, qrCodeId: string): Routine {
  const routine: Routine = {
    id,
    name: 'Herd / Dunstabzugshaube',
    qrCodeId,
    steps: STEPS,
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

beforeEach(() => {
  store.routines.clear();
  store.instances.clear();
  delete store.db.transaction;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('routineService – routine CRUD', () => {
  it('createRoutine stores the routine with a generated UUID and createdAt', async () => {
    const id = await createRoutine({
      name: 'Herd / Dunstabzugshaube',
      qrCodeId: 'qr-1',
      steps: STEPS,
    });

    expect(id).toMatch(UUID_PATTERN);
    const stored = store.routines.get(id);
    expect(stored).toEqual({
      id,
      name: 'Herd / Dunstabzugshaube',
      qrCodeId: 'qr-1',
      steps: STEPS,
      createdAt: NOW,
    });
  });

  it('createRoutine generates a fresh id on every call', async () => {
    const id1 = await createRoutine({ name: 'A', qrCodeId: 'qr-a', steps: [] });
    const id2 = await createRoutine({ name: 'B', qrCodeId: 'qr-b', steps: [] });

    expect(id1).not.toBe(id2);
    expect(store.routines.size).toBe(2);
  });

  it('getRoutineById returns the routine or undefined', async () => {
    seedRoutine('routine-1', 'qr-1');

    await expect(getRoutineById('routine-1')).resolves.toEqual(
      store.routines.get('routine-1'),
    );
    await expect(getRoutineById('missing')).resolves.toBeUndefined();
  });

  it('getRoutineByQrCodeId finds the routine via the qrCodeId index', async () => {
    seedRoutine('routine-1', 'qr-1');
    seedRoutine('routine-2', 'qr-2');

    const found = await getRoutineByQrCodeId('qr-2');
    expect(found?.id).toBe('routine-2');

    await expect(getRoutineByQrCodeId('unknown')).resolves.toBeUndefined();
  });

  it('getAllRoutines lists every stored routine', async () => {
    await expect(getAllRoutines()).resolves.toEqual([]);

    seedRoutine('routine-1', 'qr-1');
    seedRoutine('routine-2', 'qr-2');

    const all = await getAllRoutines();
    expect(all.map((r) => r.id).sort()).toEqual(['routine-1', 'routine-2']);
  });

  it('deleteRoutine removes the routine', async () => {
    seedRoutine('routine-1', 'qr-1');

    await deleteRoutine('routine-1');

    expect(store.routines.has('routine-1')).toBe(false);
    await expect(getRoutineById('routine-1')).resolves.toBeUndefined();

    // deleting an unknown id does not throw
    await expect(deleteRoutine('missing')).resolves.toBeUndefined();
  });
});

describe('routineService – instance CRUD', () => {
  it('createInstance creates a fresh IDLE instance with zeroed fields', async () => {
    seedRoutine('routine-1', 'qr-1');

    const id = await createInstance('routine-1');

    expect(id).toMatch(UUID_PATTERN);
    expect(store.instances.get(id)).toEqual({
      id,
      routineId: 'routine-1',
      state: 'IDLE',
      currentStepIndex: 0,
      startedAt: NOW,
      deadline: null,
      repeatCount: 0,
      extensionsUsed: 0,
      completedAt: null,
    });
  });

  it('getInstance returns the instance or undefined', async () => {
    seedInstance({ id: 'inst-1' });

    await expect(getInstance('inst-1')).resolves.toEqual(
      store.instances.get('inst-1'),
    );
    await expect(getInstance('missing')).resolves.toBeUndefined();
  });

  it('updateInstance persists the given instance via put', async () => {
    const instance = seedInstance({ id: 'inst-1', state: 'REMINDING' });
    const updated = { ...instance, repeatCount: 4 };

    await updateInstance(updated);

    expect(store.instancePut).toHaveBeenCalledWith(updated);
    expect(store.instances.get('inst-1')!.repeatCount).toBe(4);
  });

  it('getActiveInstance returns the WAITING instance of a routine', async () => {
    seedRoutine('routine-1', 'qr-1');
    seedInstance({ id: 'inst-idle', state: 'IDLE' });
    seedInstance({
      id: 'inst-waiting',
      state: 'WAITING',
      deadline: NOW + 10 * MIN,
    });

    const active = await getActiveInstance('routine-1');
    expect(active?.id).toBe('inst-waiting');

    // the compound-index range must exactly match the production bounds
    expect(store.betweenSpy).toHaveBeenCalledWith(
      ['routine-1', 'IDLE'],
      ['routine-1', 'WAITING\uFFFF'],
    );
  });

  it('getActiveInstance also finds REMINDING instances and none for quiet routines', async () => {
    seedRoutine('routine-1', 'qr-1');
    seedRoutine('routine-2', 'qr-2');
    seedInstance({ id: 'inst-reminding', state: 'REMINDING' });
    seedInstance({
      id: 'inst-other',
      routineId: 'routine-2',
      state: 'WAITING',
    });

    const active = await getActiveInstance('routine-1');
    expect(active?.id).toBe('inst-reminding');

    // routine-2 has an active instance, routine-1 does not
    seedInstance({ id: 'inst-done', state: 'IDLE', completedAt: NOW });
    store.instances.delete('inst-reminding');
    await expect(getActiveInstance('routine-1')).resolves.toBeUndefined();
  });

  it('completeInstance resets the state to IDLE and stamps completedAt', async () => {
    seedInstance({ id: 'inst-1', state: 'REMINDING', repeatCount: 3 });

    await completeInstance('inst-1');

    const instance = store.instances.get('inst-1')!;
    expect(instance.state).toBe('IDLE');
    expect(instance.completedAt).toBe(NOW);
    // other fields survive the partial update
    expect(instance.repeatCount).toBe(3);
  });
});

describe('routineService – applyEvent', () => {
  it('applies a state-machine event and persists the result', async () => {
    seedRoutine('routine-1', 'qr-1'); // first step is delayed → WAITING
    seedInstance({ id: 'inst-1', state: 'IDLE' });

    const updated = await applyEvent('inst-1', { type: 'SCAN_START' });

    expect(updated!.state).toBe('WAITING');
    expect(updated!.deadline).toBe(NOW + 30 * MIN);
    expect(store.instancePut).toHaveBeenCalledWith(updated);
    expect(store.instances.get('inst-1')!.state).toBe('WAITING');
  });

  it('returns null for an unknown instance without writing anything', async () => {
    const updated = await applyEvent('does-not-exist', { type: 'SCAN_START' });

    expect(updated).toBeNull();
    expect(store.instancePut).not.toHaveBeenCalled();
  });

  it('returns null when the routine of the instance is missing', async () => {
    seedInstance({ id: 'inst-1', state: 'IDLE' }); // no routine seeded

    const updated = await applyEvent('inst-1', { type: 'SCAN_START' });

    expect(updated).toBeNull();
    expect(store.instancePut).not.toHaveBeenCalled();
  });

  it('runs the read → transition → write cycle inside a Dexie transaction when available', async () => {
    seedRoutine('routine-1', 'qr-1');
    seedInstance({ id: 'inst-1', state: 'IDLE' });

    store.db.transaction = vi.fn(
      (
        _mode: string,
        _table1: unknown,
        _table2: unknown,
        fn: () => Promise<RoutineInstance | null>,
      ) => fn(),
    );

    const updated = await applyEvent('inst-1', { type: 'SCAN_START' });

    expect(store.db.transaction).toHaveBeenCalledWith(
      'rw',
      store.db.instances,
      store.db.routines,
      expect.any(Function),
    );
    expect(updated!.state).toBe('WAITING');
    expect(store.instances.get('inst-1')!.state).toBe('WAITING');
  });
});
