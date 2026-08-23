import { useCallback, useEffect, useState } from 'react';
import HoldButton from '../components/HoldButton';
import WheelPicker from '../components/WheelPicker';
import { handleExtend } from '../../services/alarmController';
import {
  EXTENSION_MIN_MINUTES,
  EXTENSION_MAX_MINUTES,
} from '../../core/constants';

// ─── Extension screen: 3-step flow before granting snooze ──────────────────────
// Dauer wählen (Wheel Picker) → 2s halten (Verlängern) → Ergebnis mit 2s
// halten bestätigen. Nutzt dieselben Layout-/Header-Bausteine wie alle
// anderen Screens (Spec §9).

type Step = 'duration' | 'hold' | 'confirm';

const DURATION_OPTIONS = Array.from(
  { length: EXTENSION_MAX_MINUTES - EXTENSION_MIN_MINUTES + 1 },
  (_, i) => i + EXTENSION_MIN_MINUTES,
);

interface Props {
  /** The ringing routine instance to extend. */
  instanceId: string;
  /** Called after a successful extension (navigate back). */
  onDone: () => void;
  /** Go back to alarm / dashboard */
  onCancel: () => void;
}

export default function ExtensionScreen({
  instanceId,
  onDone,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>('duration');
  const [duration, setDuration] = useState(10);
  const [error, setError] = useState('');
  const [newDeadline, setNewDeadline] = useState('');

  const stepIndex = step === 'duration' ? 1 : step === 'hold' ? 2 : 3;

  // ── Step 2: apply the extension once the hold completed ─────────────────────
  useEffect(() => {
    if (step !== 'hold') return;
    let mounted = true;
    void (async () => {
      const updated = await handleExtend(instanceId, duration);
      if (!mounted) return;
      if (updated && updated.state === 'WAITING' && updated.deadline != null) {
        const d = new Date(updated.deadline);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        setNewDeadline(`${hh}:${mm}`);
        setStep('confirm');
      } else {
        setError(
          'Verlängern nicht möglich – Limit erreicht oder Alarm nicht mehr aktiv.',
        );
        setStep('duration');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [step, instanceId, duration]);

  const handleHoldComplete = useCallback(() => {
    setError('');
    setStep('hold');
  }, []);

  return (
    <div className="screen">
      <div className="dot-grid-bg" aria-hidden />

      {/* ── Header (wie Dashboard/RoutineEdit/Settings) ── */}
      <header className="header">
        <button className="btn btn--ghost" onClick={onCancel}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">Verlängern</h1>
        <span className="extension-step-meta">{stepIndex}/3</span>
      </header>

      {/* ── Progress dots ── */}
      <div className="extension-progress">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`extension-progress__dot ${n <= stepIndex ? 'extension-progress__dot--active' : ''}`}
          />
        ))}
      </div>

      {/* ── Step content ── */}
      <main className="main extension-main">
        {step === 'duration' && (
          <>
            <p className="extension-hint">
              Wie lange möchtest du verlängern?
            </p>

            <div className="extension-wheel-wrap">
              <WheelPicker
                options={DURATION_OPTIONS}
                value={duration}
                onChange={setDuration}
                unit="Minuten"
                ariaLabel="Verlängerungsdauer in Minuten"
              />
            </div>

            {/* Weiter geht es nur über das 2s-Halten. */}
            <HoldButton
              holdDuration={2000}
              onComplete={handleHoldComplete}
              label="HALTEN ZUM VERLÄNGERN (2 s)"
            />
            {error && (
              <p className="scan-feedback scan-feedback--error extension-error">
                {error}
              </p>
            )}
          </>
        )}

        {step === 'hold' && (
          <>
            <p className="extension-hint">
              Verlängern um {duration} Minuten…
            </p>
            <div className="empty-state">
              <div className="spinner" />
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="extension-hint">
              Verlängert bis {newDeadline}
            </p>
            <p className="extension-hint">
              Der Alarm meldet sich dann wieder – bestätige, dass du es
              mitbekommen hast.
            </p>
            <HoldButton
              holdDuration={2000}
              onComplete={onDone}
              label="BESTÄTIGEN (2 s)"
            />
          </>
        )}
      </main>
    </div>
  );
}
