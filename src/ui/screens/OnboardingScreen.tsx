import { useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import {
  isNative,
  requestBatteryOptimizationExemption,
} from '../../services/blockerBridge';

interface Props {
  onComplete: () => void;
}

const PREF_KEY = 'onboarding_complete';

/**
 * Onboarding screen shown on first launch.
 * Explains why battery optimization exemption is needed (safety app).
 */
export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [requesting, setRequesting] = useState(false);

  async function handleFinish() {
    await Preferences.set({ key: PREF_KEY, value: 'true' });
    onComplete();
  }

  async function handleBatteryExemption() {
    setRequesting(true);
    try {
      await requestBatteryOptimizationExemption();
    } catch {
      // User may have dismissed the system dialog — that's fine
    }
    setRequesting(false);
    setStep(1);
  }

  const showNativeSteps = isNative();

  return (
    <div className="onboarding">
      <div className="onboarding__bg" aria-hidden />

      <div className="onboarding__content">
        {step === 0 && (
          <>
            <div className="onboarding__logo">
              <h1 className="onboarding__title">FCK ADHD</h1>
              <span className="onboarding__subtitle">reminder system</span>
            </div>

            <div className="onboarding__card">
              <div className="onboarding__icon">🔔</div>
              <h2 className="onboarding__heading">Zuverlässige Alarme</h2>
              <p className="onboarding__text">
                FCK-ADHD ist eine Sicherheits-App, die dich zuverlässig an
                wichtige Aufgaben erinnert — auch wenn dein Handy im
                Energiesparmodus ist.
              </p>
              <p className="onboarding__text">
                Damit Alarme immer zur richtigen Zeit kommen, braucht die App
                eine Ausnahme von der Akku-Optimierung.
              </p>
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={showNativeSteps ? handleBatteryExemption : handleFinish}
              disabled={requesting}
            >
              {showNativeSteps ? 'Akku-Ausnahme erlauben' : 'Los geht\'s'}
            </button>

            {showNativeSteps && (
              <button
                className="btn btn--ghost onboarding__skip"
                onClick={handleFinish}
              >
                Überspringen
              </button>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">✓</div>
              <h2 className="onboarding__heading">Alles bereit!</h2>
              <p className="onboarding__text">
                Die App kann jetzt zuverlässig Alarme auslösen, auch im
                Hintergrund. Du kannst jederzeit in den Einstellungen des
                Geräts die Berechtigung ändern.
              </p>
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={handleFinish}
            >
              Los geht's
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Checks whether onboarding has already been completed.
 */
export async function isOnboardingComplete(): Promise<boolean> {
  const { value } = await Preferences.get({ key: PREF_KEY });
  return value === 'true';
}
