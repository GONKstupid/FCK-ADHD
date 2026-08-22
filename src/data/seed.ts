import { v4 as uuidv4 } from 'uuid';
import type { Routine } from '../core/models';
import {
  createRoutine,
  getAllRoutines,
  deleteRoutine,
  getActiveInstance,
  getRoutineById,
  updateRoutine,
} from '../services/routineService';
import { db } from './db';

const MVP_ROUTINE: Omit<Routine, 'id' | 'createdAt'> = {
  name: 'Herd / Dunstabzugshaube',
  qrCodeId: uuidv4(),
  steps: [
    {
      id: uuidv4(),
      label: 'Dunstabzugshaube anmachen',
      type: 'instant_hint',
      delayMinutes: 0,
      reminderMode: 'soft',
    },
    {
      id: uuidv4(),
      label: 'Herd ausmachen',
      type: 'delayed_reminder',
      delayMinutes: 30,
      reminderMode: 'soft',
    },
  ],
};

/**
 * Old seeded step labels → current wording. Used by the one-time label
 * migration: only steps that still carry the exact old seeded default
 * are renamed — user-customized labels are never overwritten.
 */
const LEGACY_STEP_LABELS: Record<string, string> = {
  'Herd-Erinnerung aktiviert': 'Dunstabzugshaube anmachen',
  'Herd ausschalten!': 'Herd ausmachen',
};

/** In-flight guard: concurrent callers (StrictMode, interval ticks) share one run. */
let seeding: Promise<string | null> | null = null;

/**
 * Seeds the MVP routine if it does not exist yet (matched by name, since the
 * qrCodeId is regenerated per module load). Idempotent and concurrency-safe.
 * Also repairs DBs where concurrent seed runs already created duplicates:
 * extra seeded routines WITHOUT instances are removed; routines with
 * instances are never touched (no orphaned user data).
 * Already-seeded routines created before `reminderMode` existed are
 * migrated once (steps get `reminderMode: 'soft'`), and steps that still
 * carry the old seeded default labels get the current wording — but only
 * while no instance of that routine is actively waiting/reminding.
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

  if (seeded.length > 0) {
    // One-time migration: pre-reminderMode installs get soft steps.
    for (const routine of seeded) {
      await migrateReminderMode(routine);
    }
    return null;
  }
  return createRoutine(MVP_ROUTINE);
}

/**
 * One-time migration for already-seeded routines:
 * - pre-`reminderMode` installs: sets `reminderMode: 'soft'` on every
 *   step that lacks it.
 * - pre-label-update installs: renames steps whose label still equals
 *   the old seeded default text (see LEGACY_STEP_LABELS). User-customized
 *   labels are never touched.
 * Skipped while an instance of the routine is actively WAITING/REMINDING,
 * so a running alarm chain is never reconfigured mid-flight. updateRoutine
 * preserves the stored qrCodeId, so existing physical QR codes keep
 * working. The routine is re-read first: dedupeSeededRoutines may have
 * deleted this copy in the meantime, and updateRoutine (Dexie put) would
 * resurrect a deleted row.
 */
async function migrateReminderMode(routine: Routine): Promise<void> {
  const current = await getRoutineById(routine.id);
  if (!current) return; // deleted by dedupe — do not resurrect it

  const needsMode = current.steps.some((step) => step.reminderMode == null);
  const needsLabels = current.steps.some(
    (step) => step.label in LEGACY_STEP_LABELS,
  );
  if (!needsMode && !needsLabels) return;

  const active = await getActiveInstance(current.id);
  if (active) return; // never touch a running alarm chain

  await updateRoutine({
    ...current,
    steps: current.steps.map((step) => ({
      ...step,
      reminderMode: step.reminderMode ?? 'soft',
      label: LEGACY_STEP_LABELS[step.label] ?? step.label,
    })),
  });
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
