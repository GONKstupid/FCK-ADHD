import { useEffect, useState } from 'react';
import {
  getAllRoutines,
  getActiveInstance,
} from '../../services/routineService';

// ─── Glyph-Streifen: Signatur-Element (Spec §9) ────────────────────────────────
// Ein Punktraster-Statusstreifen, der den tatsächlichen Zustand der aktiven
// Routine-Instanz codiert: aus/gedimmt (IDLE), wartend (WAITING),
// pulsierend rot (REMINDING) — Rot ausschließlich im Alarmzustand.

type StripState = 'IDLE' | 'WAITING' | 'REMINDING';

const DOT_COUNT = 28;
const REFRESH_MS = 3000;

const STATE_LABEL: Record<StripState, string> = {
  IDLE: 'System bereit',
  WAITING: 'Wartend',
  REMINDING: 'Alarm aktiv',
};

export default function GlyphStrip() {
  const [state, setState] = useState<StripState>('IDLE');

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const routines = await getAllRoutines();
        let next: StripState = 'IDLE';
        for (const routine of routines) {
          const inst = await getActiveInstance(routine.id);
          if (inst?.state === 'REMINDING') {
            next = 'REMINDING';
            break;
          }
          if (inst?.state === 'WAITING') {
            next = 'WAITING';
          }
        }
        if (mounted) setState(next);
      } catch (err) {
        console.error('[GlyphStrip] failed to refresh state:', err);
      }
    }

    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      className={`glyph-strip glyph-strip--${state.toLowerCase()}`}
      role="status"
      aria-label={`Systemstatus: ${STATE_LABEL[state]}`}
    >
      <span className="glyph-strip__dots" aria-hidden>
        {'•'.repeat(DOT_COUNT)}
      </span>
      <span className="glyph-strip__label">{STATE_LABEL[state]}</span>
    </div>
  );
}
