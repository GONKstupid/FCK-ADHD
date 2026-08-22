import { v4 as uuidv4 } from 'uuid';
import type { Routine } from '../core/models';
import {
  createRoutine,
  getAllRoutines,
  deleteRoutine,
} from '../services/routineService';
import { db } from './db';

const MVP_ROUTINE: Omit<Routine, 'id' | 'createdAt'> = {
  name: 'Herd / Dunstabzugshaube',
  qrCodeId: uuidv4(),
  steps: [
    {
      id: uuidv4(),
      label: 'Herd-Erinnerung aktiviert',
      type: 'instant_hint',
      delayMinutes: 0,
    },
    {
      id: uuidv4(),
      label: 'Herd ausschalten!',
      type: 'delayed_reminder',
      delayMinutes: 30,
    },
  ],
};

/** In-flight guard: concurrent callers (StrictMode, interval ticks) share one run. */
let seeding: Promise<string | null> | null = null;

/**
 * Seeds the MVP routine if it does not exist yet (matched by name, since the
 * qrCodeId is regenerated per module load). Idempotent and concurrency-safe.
 * Also repairs DBs where concurrent seed runs already created duplicates:
 * extra seeded routines WITHOUT instances are removed; routines with
 * instances are never touched (no orphaned user data).
 */
export function seedMVPRoutine(): Promise<string | null> {
  if (!seeding) {
    seeding = seedOnce().finally(() => {
      seeding = null;
    });
  }
  return seeding;
}

async function seedOnce(): Promise<string | null> {
  const all = await getAllRoutines();
  const seeded = all.filter((r) => r.name === MVP_ROUTINE.name);

  if (seeded.length > 1) {
    await dedupeSeededRoutines(seeded);
  }

  if (seeded.length > 0) return null;
  return createRoutine(MVP_ROUTINE);
}

/**
 * Removes exact duplicate rows of the seeded routine, but only duplicates
 * that have no instances. Keeps the earliest copy that has instances
 * (or the earliest overall if none do). Never deletes user-created routines.
 */
async function dedupeSeededRoutines(duplicates: Routine[]): Promise<void> {
  const withInstances = await Promise.all(
    duplicates.map(async (routine) => ({
      routine,
      hasInstances:
        (await db.instances.where('routineId').equals(routine.id).count()) > 0,
    })),
  );
  withInstances.sort((a, b) => a.routine.createdAt - b.routine.createdAt);

  const keep =
    withInstances.find((entry) => entry.hasInstances) ?? withInstances[0];

  for (const entry of withInstances) {
    if (entry.routine.id !== keep.routine.id && !entry.hasInstances) {
      await deleteRoutine(entry.routine.id);
    }
  }
}
