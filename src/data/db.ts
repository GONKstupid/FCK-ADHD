import Dexie from 'dexie';
import type { Routine, RoutineInstance } from '../core/models';

export class FckAdhdDatabase extends Dexie {
  routines!: Dexie.Table<Routine, string>;
  instances!: Dexie.Table<RoutineInstance, string>;

  constructor() {
    super('fck-adhd');

    this.version(1).stores({
      routines: '++id, qrCodeId',
      instances: '++id, routineId, [routineId+state], deadline',
    });
  }
}

export const db = new FckAdhdDatabase();
