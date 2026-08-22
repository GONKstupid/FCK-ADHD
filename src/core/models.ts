// ─── Domain Models ────────────────────────────────────────────────────────────

export interface Step {
  id: string;
  label: string;
  type: 'instant_hint' | 'delayed_reminder';
  delayMinutes: number; // 0 for instant hints
  /**
   * How the reminder presents itself.
   * - 'full' (default when absent): full-screen alarm, sound, vibration.
   * - 'soft': silent notification only — no sound, no full-screen takeover.
   */
  reminderMode?: 'soft' | 'full';
}

export interface Routine {
  id: string;
  name: string;
  qrCodeId: string; // UUID encoded in the QR code
  steps: Step[];
  createdAt: number;
}

export interface RoutineInstance {
  id: string;
  routineId: string;
  state: 'IDLE' | 'WAITING' | 'REMINDING';
  currentStepIndex: number;
  startedAt: number;
  deadline: number | null; // timestamp when the alarm should fire
  repeatCount: number; // how many times the alarm has repeated
  extensionsUsed: number;
  completedAt: number | null;
}

// ─── State Machine Events ─────────────────────────────────────────────────────

export type StateMachineEvent =
  | { type: 'SCAN_START' }
  | { type: 'TIMER_FIRED' }
  | { type: 'SCAN_CONFIRM' }
  | { type: 'EXTEND'; durationMinutes: number }
  | { type: 'ESCALATE' };
