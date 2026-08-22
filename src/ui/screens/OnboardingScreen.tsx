import { useCallback, useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import {
  isNative,
  hasExactAlarmPermission,
  canUseFullScreenIntent,
  checkNotificationPermission,
  requestNotificationPermission,
  openExactAlarmSettings,
  openFullScreenIntentSettings,
  requestBatteryOptimizationExemption,
} from '../../services/blockerBridge';

interface Props {
  onComplete: () => void;
}

const PREF_KEY = 'onboarding_complete';

/** Inhaltliche Schritte (ohne den Abschluss-Screen „Alles bereit!“). */
const TOTAL_STEPS = 6;

/**
 * Schritte, deren Überspringen eine Warnung auslöst
 * (Benachrichtigungen, exakte Alarme, Vollbild-Benachrichtigungen,
 * Akku-Optimierung).
 */
const WARN_ON_SKIP = new Set([1, 2, 3, 4]);

const SKIP_WARNING =
  'Ohne diese Berechtigung ist die Zuverlässigkeit der Alarme nicht garantiert.';

/** Kleiner Status-Chip für Berechtigungen. */
function StatusChip({ granted }: { granted: boolean | null }) {
  if (granted === null) {
    return <span className="onboarding__status">Prüfe…</span>;
  }
  return granted ? (
    <span className="onboarding__status onboarding__status--granted">
      ✓ Erteilt
    </span>
  ) : (
    <span className="onboarding__status onboarding__status--missing">
      ! Fehlt
    </span>
  );
}

/**
 * Onboarding screen shown on first launch.
 * Multi-step flow (German) that explains why this safety app needs
 * permissions so alarms ring reliably.
 */
export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [skipWarned, setSkipWarned] = useState(false);
  const [exactAlarmGranted, setExactAlarmGranted] = useState<boolean | null>(
    null,
  );
  const [fullScreenGranted, setFullScreenGranted] = useState<boolean | null>(
    null,
  );
  const [notificationGranted, setNotificationGranted] = useState<
    boolean | null
  >(null);

  const showNativeSteps = isNative();

  // ── Permission status (native only) ────────────────────────────────────────
  const refreshPermissions = useCallback(async () => {
    if (!isNative()) return;
    try {
      const [exact, fsi, notif] = await Promise.all([
        hasExactAlarmPermission(),
        canUseFullScreenIntent(),
        checkNotificationPermission(),
      ]);
      setExactAlarmGranted(exact.granted);
      setFullScreenGranted(fsi.granted);
      setNotificationGranted(notif.granted);
    } catch (err) {
      console.error('[OnboardingScreen] permission check failed:', err);
    }
  }, []);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  // Re-check when the user returns from the system settings screen.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPermissions();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refreshPermissions]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  async function handleFinish() {
    await Preferences.set({ key: PREF_KEY, value: 'true' });
    onComplete();
  }

  function goTo(next: number) {
    setSkipWarned(false);
    setStep(next);
  }

  function handleSkip() {
    if (WARN_ON_SKIP.has(step) && !skipWarned) {
      setSkipWarned(true);
      return;
    }
    goTo(step + 1);
  }

  // ── Permission actions ─────────────────────────────────────────────────────
  async function handleNotificationPermission() {
    try {
      const result = await requestNotificationPermission();
      setNotificationGranted(result.granted);
    } catch (err) {
      console.error('[OnboardingScreen] notification permission failed:', err);
    }
  }

  async function handleExactAlarm() {
    await openExactAlarmSettings();
    await refreshPermissions();
  }

  async function handleFullScreenIntent() {
    await openFullScreenIntentSettings();
    await refreshPermissions();
  }

  async function handleBatteryExemption() {
    setRequesting(true);
    try {
      await requestBatteryOptimizationExemption();
    } catch {
      // User may have dismissed the system dialog — that's fine
    }
    setRequesting(false);
    goTo(5);
  }

  return (
    <div className="onboarding">
      <div className="onboarding__bg" aria-hidden />

      <div className="onboarding__content">
        {/* ── Fortschritt (nur während der Schritte, nicht am Ende) ── */}
        {step < TOTAL_STEPS && (
          <>
            <span className="onboarding__step-meta">
              Schritt {step + 1} von {TOTAL_STEPS}
            </span>
            <div className="onboarding__progress" aria-hidden>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <span
                  key={i}
                  className={`onboarding__progress-dot ${
                    i === step
                      ? 'onboarding__progress-dot--active'
                      : i < step
                        ? 'onboarding__progress-dot--done'
                        : ''
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Schritt 1: Willkommen / Warum ── */}
        {step === 0 && (
          <>
            <div className="onboarding__logo">
              <h1 className="onboarding__title">FCK ADHD</h1>
              <span className="onboarding__subtitle">reminder system</span>
            </div>

            <div className="onboarding__card">
              <div className="onboarding__icon">🔔</div>
              <h2 className="onboarding__heading">Eine Sicherheits-App</h2>
              <p className="onboarding__text">
                FCK-ADHD erinnert dich zuverlässig an wichtige Aufgaben — zum
                Beispiel den Herd auszuschalten. Auch wenn dein Handy im
                Energiesparmodus ist.
              </p>
              <p className="onboarding__text">
                Damit jeder Alarm garantiert klingelt, braucht die App einige
                Berechtigungen. Wir führen dich kurz durch die wichtigsten.
              </p>
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={() => goTo(1)}
            >
              Weiter
            </button>

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              Überspringen
            </button>
          </>
        )}

        {/* ── Schritt 2: Benachrichtigungen ── */}
        {step === 1 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">📣</div>
              <h2 className="onboarding__heading">Benachrichtigungen</h2>
              {showNativeSteps && (
                <StatusChip granted={notificationGranted} />
              )}
              <p className="onboarding__text">
                Benachrichtigungen werden für die Alarm-Anzeige benötigt. Auf
                Android 13 oder neuer muss diese Berechtigung einmalig erteilt
                werden — ohne sie bleibt der Alarm stumm.
              </p>
              {!showNativeSteps && (
                <p className="onboarding__text">
                  Im Browser ist hier nichts zu tun — dieser Schritt betrifft
                  nur die Android-App.
                </p>
              )}
            </div>

            {showNativeSteps && notificationGranted === false && (
              <button
                className="btn btn--scan onboarding__btn"
                onClick={() => void handleNotificationPermission()}
              >
                Berechtigung erteilen
              </button>
            )}

            <button
              className={`btn ${
                showNativeSteps && notificationGranted === false
                  ? 'btn--secondary'
                  : 'btn--scan'
              } onboarding__btn`}
              onClick={() => goTo(2)}
            >
              Weiter
            </button>

            {skipWarned && (
              <p className="onboarding__warning" role="alert">
                {SKIP_WARNING}
              </p>
            )}

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              {skipWarned ? 'Trotzdem überspringen' : 'Überspringen'}
            </button>
          </>
        )}

        {/* ── Schritt 3: Exakte Alarme ── */}
        {step === 2 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">⏰</div>
              <h2 className="onboarding__heading">Exakte Alarme</h2>
              {showNativeSteps && <StatusChip granted={exactAlarmGranted} />}
              <p className="onboarding__text">
                Ab Android 12 braucht die App eine eigene Berechtigung für
                minutengenaue Alarme. Ohne sie kann das System Alarme verzögern
                oder ganz streichen.
              </p>
              {!showNativeSteps && (
                <p className="onboarding__text">
                  Im Browser ist hier nichts zu tun — dieser Schritt betrifft
                  nur die Android-App.
                </p>
              )}
            </div>

            {showNativeSteps && exactAlarmGranted === false && (
              <button
                className="btn btn--scan onboarding__btn"
                onClick={() => void handleExactAlarm()}
              >
                Berechtigung erteilen
              </button>
            )}

            <button
              className={`btn ${
                showNativeSteps && exactAlarmGranted === false
                  ? 'btn--secondary'
                  : 'btn--scan'
              } onboarding__btn`}
              onClick={() => goTo(3)}
            >
              Weiter
            </button>

            {skipWarned && (
              <p className="onboarding__warning" role="alert">
                {SKIP_WARNING}
              </p>
            )}

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              {skipWarned ? 'Trotzdem überspringen' : 'Überspringen'}
            </button>
          </>
        )}

        {/* ── Schritt 4: Vollbild-Benachrichtigungen ── */}
        {step === 3 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">📲</div>
              <h2 className="onboarding__heading">
                Vollbild-Benachrichtigungen
              </h2>
              {showNativeSteps && <StatusChip granted={fullScreenGranted} />}
              <p className="onboarding__text">
                Ab Android 14 muss die App Alarme im Vollbild anzeigen dürfen —
                nur so erscheint der Alarm auch über dem Sperrbildschirm.
              </p>
              {!showNativeSteps && (
                <p className="onboarding__text">
                  Im Browser ist hier nichts zu tun — dieser Schritt betrifft
                  nur die Android-App.
                </p>
              )}
            </div>

            {showNativeSteps && fullScreenGranted === false && (
              <button
                className="btn btn--scan onboarding__btn"
                onClick={() => void handleFullScreenIntent()}
              >
                Berechtigung erteilen
              </button>
            )}

            <button
              className={`btn ${
                showNativeSteps && fullScreenGranted === false
                  ? 'btn--secondary'
                  : 'btn--scan'
              } onboarding__btn`}
              onClick={() => goTo(4)}
            >
              Weiter
            </button>

            {skipWarned && (
              <p className="onboarding__warning" role="alert">
                {SKIP_WARNING}
              </p>
            )}

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              {skipWarned ? 'Trotzdem überspringen' : 'Überspringen'}
            </button>
          </>
        )}

        {/* ── Schritt 5: Akku-Optimierung ── */}
        {step === 4 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">🔋</div>
              <h2 className="onboarding__heading">Akku-Optimierung</h2>
              <p className="onboarding__text">
                Damit Alarme auch im Energiesparmodus pünktlich kommen, braucht
                die App eine Ausnahme von der Akku-Optimierung.
              </p>
              {!showNativeSteps && (
                <p className="onboarding__text">
                  Im Browser ist hier nichts zu tun — dieser Schritt betrifft
                  nur die Android-App.
                </p>
              )}
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={() =>
                void (showNativeSteps ? handleBatteryExemption() : goTo(5))
              }
              disabled={requesting}
            >
              {showNativeSteps ? 'Akku-Ausnahme erlauben' : 'Weiter'}
            </button>

            {skipWarned && (
              <p className="onboarding__warning" role="alert">
                {SKIP_WARNING}
              </p>
            )}

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              {skipWarned ? 'Trotzdem überspringen' : 'Überspringen'}
            </button>
          </>
        )}

        {/* ── Schritt 6: Kamera-Hinweis ── */}
        {step === 5 && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">📷</div>
              <h2 className="onboarding__heading">Kamera</h2>
              <p className="onboarding__text">
                Zum Bestätigen eines Alarms scannst du einen QR-Code. Den
                Kamera-Zugriff fragt die App automatisch beim ersten Scan an —
                hier ist nichts zu tun.
              </p>
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={() => goTo(6)}
            >
              Weiter
            </button>

            <button
              className="btn btn--ghost onboarding__skip"
              onClick={handleSkip}
            >
              Überspringen
            </button>
          </>
        )}

        {/* ── Abschluss ── */}
        {step === TOTAL_STEPS && (
          <>
            <div className="onboarding__card">
              <div className="onboarding__icon">✓</div>
              <h2 className="onboarding__heading">Alles bereit!</h2>
              <p className="onboarding__text">
                Die App kann jetzt zuverlässig Alarme auslösen, auch im
                Hintergrund. Du kannst jederzeit in den Einstellungen des Geräts
                die Berechtigungen ändern.
              </p>
            </div>

            <button
              className="btn btn--scan onboarding__btn"
              onClick={() => void handleFinish()}
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
