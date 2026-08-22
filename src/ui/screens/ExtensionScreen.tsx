import { useCallback, useEffect, useState } from 'react';
import HoldButton from '../components/HoldButton';
import { handleExtend } from '../../services/alarmController';
import {
  EXTENSION_MIN_MINUTES,
  EXTENSION_MAX_MINUTES,
} from '../../core/constants';

// ─── Extension screen: 3-step flow before granting snooze ──────────────────────
// Dauer wählen → 2s halten (Verlängern) → Ergebnis mit 2s halten bestätigen.

type Step = 'duration' | 'hold' | 'confirm';

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

            {/* Weiter geht es nur über das 2s-Halten. */}
            <HoldButton
              holdDuration={2000}
              onComplete={handleHoldComplete}
              label="HALTEN ZUM VERLÄNGERN (2 s)"
            />
            {error && (
              <p className="scan-feedback scan-feedback--error extension-screen__error">
                {error}
              </p>
            )}
          </>
        )}

        {step === 'hold' && (
          <>
            <p className="extension-screen__hint">
              Verlängern um {duration} Minuten…
            </p>
            <div className="empty-state">
              <div className="spinner" />
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="extension-screen__hint">
              Verlängert bis {newDeadline}
            </p>
            <p className="extension-screen__hint">
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
