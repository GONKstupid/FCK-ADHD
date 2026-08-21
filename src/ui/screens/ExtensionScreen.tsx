import { useCallback, useState } from 'react';
import MathPuzzle from '../components/MathPuzzle';
import HoldButton from '../components/HoldButton';

// ─── Extension screen: multi-step flow before granting snooze ───────────────────

type Step = 'puzzle' | 'hold' | 'duration';

const DURATION_OPTIONS = [5, 10, 15, 20, 30]; // minutes

interface Props {
  /** Dispatches the EXTEND event and reschedules the alarm */
  onExtend: (durationMinutes: number) => void;
  /** Go back to alarm / dashboard */
  onCancel: () => void;
}

export default function ExtensionScreen({ onExtend, onCancel }: Props) {
  const [step, setStep] = useState<Step>('puzzle');
  const [duration, setDuration] = useState(10);

  const stepIndex = step === 'puzzle' ? 1 : step === 'hold' ? 2 : 3;

  const handlePuzzleSolved = useCallback(() => {
    setStep('hold');
  }, []);

  const handleHoldComplete = useCallback(() => {
    setStep('duration');
  }, []);

  const handleConfirm = useCallback(() => {
    onExtend(duration);
  }, [onExtend, duration]);

  return (
    <div className="extension-screen">
      <div className="dot-grid-bg" aria-hidden />

      {/* ── Header ── */}
      <header className="header">
        <button className="btn btn--ghost" onClick={onCancel}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">Verlängern</h1>
        <span className="extension-screen__step">
          {stepIndex}/3
        </span>
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
                onChange={(e) => setDuration(DURATION_OPTIONS[parseInt(e.target.value, 10)])}
              />
              <div className="extension-screen__value">
                {duration} Minuten
              </div>
            </div>

            <button
              className="btn btn--scan extension-screen__confirm"
              onClick={handleConfirm}
            >
              Verlängern für {duration} Min
            </button>
          </>
        )}
      </main>
    </div>
  );
}
