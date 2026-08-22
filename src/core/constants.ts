// ─── Core Constants ───────────────────────────────────────────────────────────

/** Maximum number of times a user may extend an alarm before escalation is forced. */
export const MAX_EXTENSIONS = 3;

/** How often the alarm repeats once ringing (in milliseconds). */
export const REPEAT_INTERVAL_MS = 60_000;

/** Number of alarm repeats before escalation kicks in. */
export const ESCALATION_AFTER_REPEATS = 3;

/** Minimum allowed extension duration (in minutes). */
export const EXTENSION_MIN_MINUTES = 5;

/** Maximum allowed extension duration (in minutes). */
export const EXTENSION_MAX_MINUTES = 60;

/**
 * Cooldown after a routine was completed: scanning the same QR code
 * within this window cannot start a fresh instance (protects against
 * camera double-scans immediately re-starting a just-ended routine).
 */
export const SCAN_RESTART_COOLDOWN_MS = 10_000;
