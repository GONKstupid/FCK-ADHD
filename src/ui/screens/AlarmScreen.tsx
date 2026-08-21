import { useEffect, useState } from 'react';
import { dismissAlarm, releaseAudioFocus } from '../../services/blockerBridge';

interface Props {
  routineName: string;
  repeatCount: number;
  onDismiss: () => void;
}

/**
 * Fullscreen alarm screen — always dark palette (inverted).
 * Shows routine name, repeat counter, pulsing red accent.
 * "Scanne QR-Code zum Bestätigen" instruction.
 */
export default function AlarmScreen({ routineName, repeatCount, onDismiss }: Props) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse((p) => !p), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleDismiss() {
    await dismissAlarm();
    await releaseAudioFocus();
    onDismiss();
  }

  return (
    <div className="alarm-screen">
      {/* ── Pulsing background ring ── */}
      <div
        className={`alarm-screen__ring ${pulse ? 'alarm-screen__ring--active' : ''}`}
        aria-hidden
      />

      {/* ── Content ── */}
      <div className="alarm-screen__content">
        <span className="alarm-screen__icon">⏰</span>

        <h1 className="alarm-screen__label">{routineName}</h1>

        <p className="alarm-screen__repeat">
          {repeatCount > 0
            ? `Wiederholung #${repeatCount}`
            : 'Erster Alarm'}
        </p>

        <div className="alarm-screen__divider" />

        <p className="alarm-screen__instruction">
          Scanne QR-Code zum Bestätigen
        </p>

        <button
          className="alarm-screen__dismiss"
          onClick={handleDismiss}
        >
          Alarm stummschalten
        </button>
      </div>
    </div>
  );
}
