import { v4 as uuidv4 } from 'uuid';
import type { Routine } from '../core/models';
import { createRoutine, getAllRoutines } from '../services/routineService';

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

/**
 * Seeds the MVP routine if no routines exist yet.
 * Safe to call multiple times — only creates when the DB is empty.
 */
export async function seedMVPRoutine(): Promise<string | null> {
  const existing = await getAllRoutines();
  if (existing.length > 0) return null;
  return createRoutine(MVP_ROUTINE);
}
