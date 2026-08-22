import { useCallback, useState } from 'react';
import MathPuzzle from '../components/MathPuzzle';
import HoldButton from '../components/HoldButton';
import { handleExtend } from '../../services/alarmController';
import {
  EXTENSION_MIN_MINUTES,
  EXTENSION_MAX_MINUTES,
} from '../../core/constants';

// ─── Extension screen: multi-step flow before granting snooze ───────────────────

type Step = 'puzzle' | 'hold' | 'duration';

// Spans the full allowed range (EXTENSION_MIN_MINUTES … EXTENSION_MAX_MINUTES)
const DURATION_OPTIONS = [
  EXTENSION_MIN_MINUTES,
  10,
  15,
  20,
  30,
  45,
  EXTENSION_MAX_MINUTES,
];

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
  const [step, setStep] = useState<Step>('puzzle');
  const [duration, setDuration] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stepIndex = step === 'puzzle' ? 1 : step === 'hold' ? 2 : 3;

  const handlePuzzleSolved = useCallback(() => {
    setStep('hold');
  }, []);

  const handleHoldComplete = useCallback(() => {
    setStep('duration');
  }, []);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setError('');
    const updated = await handleExtend(instanceId, duration);
    setBusy(false);
    if (updated && updated.state === 'WAITING') {
      onDone();
    } else {
      setError(
        'Verlängern nicht möglich – Limit erreicht oder Alarm nicht mehr aktiv.',
      );
    }
  }, [instanceId, duration, onDone]);

  return (
    <div className="extension-screen">
      <div className="dot-grid-bg" aria-hidden />

      {/* ── Header ── */}
      <header className="header">
        <button className="btn btn--ghost" onClick={onCancel}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">Verlängern</h1>
        <span className="extension-screen__step">{stepIndex}/3</span>
      </header>

      {/* ── Progress dots ── */}
      <div className="extension-screen__progress">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`extension-screen__dot ${n <= stepIndex ? 'extension-screen__dot--active' : ''}`}
          />
        ))}
      </div>

      {/* ── Step content ── */}
      <main className="extension-screen__main">
        {step === 'puzzle' && (
          <>
            <p className="extension-screen__hint">
              Löse die Aufgabe, um zu beweisen dass du wach bist.
            </p>
            <MathPuzzle onSolved={handlePuzzleSolved} />
          </>
        )}

        {step === 'hold' && (
          <>
            <p className="extension-screen__hint">
              Halte den Button gedrückt für 4 Sekunden.
            </p>
            <HoldButton holdDuration={4000} onComplete={handleHoldComplete} />
          </>
        )}

        {step === 'duration' && (
          <>
            <p className="extension-screen__hint">
              Wie lange möchtest du verlängern?
            </p>

            <div className="extension-screen__slider">
              <div className="extension-screen__ticks">
                {DURATION_OPTIONS.map((m) => (
                  <button
                    key={m}
                    className={`extension-screen__tick ${duration === m ? 'extension-screen__tick--active' : ''}`}
                    onClick={() => setDuration(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <input
                className="extension-screen__range"
                type="range"
                min={0}
                max={DURATION_OPTIONS.length - 1}
                value={DURATION_OPTIONS.indexOf(duration)}
                onChange={(e) =>
                  setDuration(DURATION_OPTIONS[parseInt(e.target.value, 10)])
                }
              />
              <div className="extension-screen__value">{duration} Minuten</div>
            </div>

            <button
              className="btn btn--scan extension-screen__confirm"
              onClick={() => void handleConfirm()}
              disabled={busy}
            >
              {busy ? 'Wird verlängert…' : `Verlängern für ${duration} Min`}
            </button>
            {error && (
              <p className="scan-feedback scan-feedback--error extension-screen__error">
                {error}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
