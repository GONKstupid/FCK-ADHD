import { useEffect, useState } from 'react';
import { dismissCurrentRing, handleConfirmDone } from '../../services/alarmController';
import { getInstance, getRoutineById } from '../../services/routineService';
import { MAX_EXTENSIONS } from '../../core/constants';
import HoldButton from '../components/HoldButton';

interface Props {
  routineName: string;
  repeatCount: number;
  instanceId: string;
  extensionsUsed: number;
  /** Navigate to the extension flow. */
  onExtend: () => void;
  /** Navigate back to the dashboard after the current step was confirmed. */
  onDone: () => void;
}

/**
 * Fullscreen alarm screen — always dark palette (inverted).
 * Spec §9: confirming ("Erledigt" hold button) is the easy, dominant option.
 * "Später" only silences the current ring — the alarm returns after
 * 60s via the native repeat chain until the step is confirmed or the
 * routine is ended by a QR scan.
 */
export default function AlarmScreen({
  routineName,
  repeatCount,
  instanceId,
  extensionsUsed,
  onExtend,
  onDone,
}: Props) {
  const [pulse, setPulse] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // On the LAST step "Erledigt" no longer completes the routine — ending
  // it requires scanning the QR code again.
  const [isLastStep, setIsLastStep] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse((p) => !p), 1000);
    return () => clearInterval(interval);
  }, []);

  // Re-check whenever the screen re-renders from props changes (new
  // instance, alarm repeats) so the QR hint appears exactly on the last step.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const instance = await getInstance(instanceId);
      const routine = instance
        ? await getRoutineById(instance.routineId)
        : undefined;
      if (cancelled || !instance || !routine) return;
      setIsLastStep(instance.currentStepIndex >= routine.steps.length - 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId, repeatCount]);

  async function handleLater() {
    // No navigation, no state change — native chain rings again in 60s.
    await dismissCurrentRing();
  }

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    // Applies SCAN_CONFIRM + native side effects (next step or completion).
    await handleConfirmDone(instanceId);
    onDone();
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

        {isLastStep ? (
          <>
            {/* Letzter Schritt: Abschließen geht nur per QR-Scan */}
            <p className="alarm-screen__instruction">
              Zum Abschließen QR-Code scannen
            </p>
            <p className="alarm-screen__snooze-hint">
              Halte ERLEDIGT, um nur den aktuellen Alarm zu stoppen – die
              Routine endet erst per QR-Scan.
            </p>
          </>
        ) : (
          <p className="alarm-screen__instruction">
            Halte ERLEDIGT zum Bestätigen
          </p>
        )}

        {/* ── Erledigt: bestätigt den aktuellen Schritt ── */}
        <div className="alarm-screen__confirm">
          <HoldButton
            label="ERLEDIGT"
            holdDuration={2000}
            onComplete={() => void handleConfirm()}
          />
        </div>

        <button
          className="alarm-screen__dismiss"
          onClick={() => void handleLater()}
        >
          Später
        </button>

        <p className="alarm-screen__snooze-hint">
          Die Erinnerung kommt in 1 Minute wieder – bis du bestätigst oder die
          Routine per QR-Scan beendest.
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
