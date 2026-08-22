import { useEffect, useState } from 'react';
import { dismissCurrentRing } from '../../services/alarmController';
import { MAX_EXTENSIONS } from '../../core/constants';

interface Props {
  routineName: string;
  repeatCount: number;
  instanceId: string;
  extensionsUsed: number;
  /** Navigate to the extension flow. */
  onExtend: () => void;
}

/**
 * Fullscreen alarm screen — always dark palette (inverted).
 * Spec §9: confirming (QR scan) is the easy, dominant option.
 * "Später" only silences the current ring — the alarm returns after
 * 60s via the native repeat chain until the QR code is scanned.
 */
export default function AlarmScreen({
  routineName,
  repeatCount,
  instanceId,
  extensionsUsed,
  onExtend,
}: Props) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse((p) => !p), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleLater() {
    // No navigation, no state change — native chain rings again in 60s.
    await dismissCurrentRing();
  }

  return (
    <div className="alarm-screen" data-instance-id={instanceId}>
      {/* ── Pulsing background ring ── */}
      <div
        className={`alarm-screen__ring ${pulse ? 'alarm-screen__ring--active' : ''}`}
        aria-hidden
      />

      {/* ── Content ── */}
      <div className="alarm-screen__content">
        <span className="alarm-screen__icon">⏰</span>

        <h1 className="alarm-screen__label">{routineName}</h1>

        {/* ── Dot-Matrix-Zähler (DotGothic16) ── */}
        <div className="alarm-screen__repeat">
          <span className="alarm-screen__repeat-label">
            {repeatCount > 0 ? 'Wiederholung' : 'Erster Alarm'}
          </span>
          {repeatCount > 0 && (
            <span className="alarm-screen__repeat-count">
              #{String(repeatCount).padStart(2, '0')}
            </span>
          )}
        </div>

        <div className="alarm-screen__divider" />

        <p className="alarm-screen__instruction">
          QR-Code scannen zum Bestätigen
        </p>

        <button
          className="alarm-screen__dismiss"
          onClick={() => void handleLater()}
        >
          Später
        </button>

        <p className="alarm-screen__snooze-hint">
          Der Alarm kommt in 1 Minute wieder – bis du den QR-Code scannst.
        </p>

        {extensionsUsed < MAX_EXTENSIONS && (
          <button className="alarm-screen__extend" onClick={onExtend}>
            Verlängern
          </button>
        )}
      </div>
    </div>
  );
}
