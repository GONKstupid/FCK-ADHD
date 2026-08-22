import { v4 as uuidv4 } from 'uuid';
import type {
  Routine,
  RoutineInstance,
  StateMachineEvent,
} from '../core/models';
import { transition } from '../core/stateMachine';
import { db } from '../data/db';

// ─── Routine CRUD ──────────────────────────────────────────────────────────────

export async function createRoutine(
  routine: Omit<Routine, 'id' | 'createdAt'>,
): Promise<string> {
  return db.routines.add({
    ...routine,
    id: uuidv4(),
    createdAt: Date.now(),
  });
}

export async function getRoutineById(id: string): Promise<Routine | undefined> {
  return db.routines.get(id);
}

export async function getRoutineByQrCodeId(
  qrCodeId: string,
): Promise<Routine | undefined> {
  return db.routines.where('qrCodeId').equals(qrCodeId).first();
}

export async function getAllRoutines(): Promise<Routine[]> {
  return db.routines.toArray();
}

/**
 * Persists an updated routine. The stored qrCodeId is ALWAYS preserved:
 * the QR code physically exists (printed/stuck somewhere), so its UUID
 * must never change — even if the incoming object carries a different one.
 */
export async function updateRoutine(routine: Routine): Promise<Routine> {
  const existing = await db.routines.get(routine.id);
  const toStore: Routine = {
    ...routine,
    qrCodeId: existing?.qrCodeId ?? routine.qrCodeId,
  };
  await db.routines.put(toStore);
  return toStore;
}

export async function deleteRoutine(id: string): Promise<void> {
  await db.routines.delete(id);
}

// ─── Instance operations ───────────────────────────────────────────────────────

export async function createInstance(routineId: string): Promise<string> {
  const now = Date.now();
  const instance: RoutineInstance = {
    id: uuidv4(),
    routineId,
    state: 'IDLE',
    currentStepIndex: 0,
    startedAt: now,
    deadline: null,
    repeatCount: 0,
    extensionsUsed: 0,
    completedAt: null,
  };
  return db.instances.add(instance);
}

export async function getInstance(
  id: string,
): Promise<RoutineInstance | undefined> {
  return db.instances.get(id);
}

export async function updateInstance(instance: RoutineInstance): Promise<void> {
  await db.instances.put(instance);
}

export async function getActiveInstance(
  routineId: string,
): Promise<RoutineInstance | undefined> {
  return db.instances
    .where('[routineId+state]')
    .between([routineId, 'IDLE'], [routineId, 'WAITING' + '\uFFFF'])
    .filter(
      (inst) =>
        inst.routineId === routineId &&
        (inst.state === 'WAITING' || inst.state === 'REMINDING'),
    )
    .first();
}

export async function completeInstance(id: string): Promise<void> {
  await db.instances.update(id, {
    state: 'IDLE',
    completedAt: Date.now(),
  });
}

/**
 * Returns the most recently completed instance of a routine (or null).
 * Used to enforce the restart cooldown after a routine was ended by scan.
 */
export async function getLatestCompletedInstance(
  routineId: string,
): Promise<RoutineInstance | null> {
  const completed = await db.instances
    .where('routineId')
    .equals(routineId)
    .filter((inst) => inst.completedAt != null)
    .toArray();
  if (completed.length === 0) return null;
  return completed.sort(
    (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0),
  )[0];
}

// ─── Transition helper ─────────────────────────────────────────────────────────

/**
 * Applies a state-machine event to a persisted instance,
 * then writes the updated instance back to the DB.
 *
 * The read → transition → write cycle runs inside a Dexie transaction so
 * concurrent event sources (native alarmFired listener, healthCheck, user
 * scans) cannot interleave and lose updates.
 */
export async function applyEvent(
  instanceId: string,
  event: StateMachineEvent,
): Promise<RoutineInstance | null> {
  const readTransitionWrite = async (): Promise<RoutineInstance | null> => {
    const instance = await getInstance(instanceId);
    if (!instance) return null;

    const routine = await getRoutineById(instance.routineId);
    if (!routine) return null;

    const updated = transition(instance, event, routine.steps);
    await updateInstance(updated);
    return updated;
  };

  // The `transaction` guard keeps the plain-object db mock used in the
  // tests compatible (it has no Dexie transaction API).
  if (typeof db.transaction === 'function') {
    return db.transaction('rw', db.instances, db.routines, readTransitionWrite);
  }
  return readTransitionWrite();
}
