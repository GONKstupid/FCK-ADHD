import { useCallback, useEffect, useState } from 'react';
import {
  isNative,
  listRingtones,
  getEscalationRingtone,
  setEscalationRingtone,
  hasExactAlarmPermission,
  canUseFullScreenIntent,
  checkNotificationPermission,
  requestNotificationPermission,
  hasOverlayPermission,
  openExactAlarmSettings,
  openFullScreenIntentSettings,
  openOverlaySettings,
} from '../../services/blockerBridge';
import type { Ringtone } from '../../services/blockerBridge';
import GlyphStrip from '../components/GlyphStrip';

interface Props {
  onBack: () => void;
}

/**
 * Settings screen (German).
 * (a) Escalation ringtone selection (native only).
 * (b) Permission status: notifications + exact alarms + full-screen intents
 *     + "Über anderen Apps einblenden", with shortcuts into the system
 *     settings.
 */
export default function SettingsScreen({ onBack }: Props) {
  const native = isNative();

  const [loading, setLoading] = useState(true);
  const [ringtones, setRingtones] = useState<Ringtone[]>([]);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exactAlarmGranted, setExactAlarmGranted] = useState<boolean | null>(
    null,
  );
  const [fullScreenGranted, setFullScreenGranted] = useState<boolean | null>(
    null,
  );
  const [notificationGranted, setNotificationGranted] = useState<
    boolean | null
  >(null);
  const [overlayGranted, setOverlayGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [tones, current, exact, fsi, notif, overlay] =
          await Promise.all([
            listRingtones(),
            getEscalationRingtone(),
            hasExactAlarmPermission(),
            canUseFullScreenIntent(),
            checkNotificationPermission(),
            hasOverlayPermission(),
          ]);
        if (!mounted) return;
        setRingtones(tones.ringtones);
        setCurrentUri(current.uri);
        setExactAlarmGranted(exact.granted);
        setFullScreenGranted(fsi.granted);
        setNotificationGranted(notif.granted);
        setOverlayGranted(overlay.granted);
      } catch (err) {
        console.error('[SettingsScreen] failed to load settings:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshPermissions = useCallback(async () => {
    const [exact, fsi, notif, overlay] = await Promise.all([
      hasExactAlarmPermission(),
      canUseFullScreenIntent(),
      checkNotificationPermission(),
      hasOverlayPermission(),
    ]);
    setExactAlarmGranted(exact.granted);
    setFullScreenGranted(fsi.granted);
    setNotificationGranted(notif.granted);
    setOverlayGranted(overlay.granted);
  }, []);

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

  async function selectRingtone(uri: string) {
    setSaving(true);
    try {
      await setEscalationRingtone(uri);
      setCurrentUri(uri);
    } finally {
      setSaving(false);
    }
  }

  async function handleNotificationPermission() {
    try {
      await requestNotificationPermission();
    } catch (err) {
      console.error('[SettingsScreen] notification permission failed:', err);
    }
    await refreshPermissions();
  }

  function permissionBadge(granted: boolean | null) {
    if (granted === null) return <span className="badge badge--idle">…</span>;
    return granted ? (
      <span className="badge badge--idle">OK</span>
    ) : (
      // Amber statt Rot: Rot ist aktiven Alarmen vorbehalten (Spec §9).
      <span className="badge badge--missing">Fehlt</span>
    );
  }

  return (
    <div className="screen">
      <div className="dot-grid-bg" aria-hidden />

      <header className="header">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">Einstellungen</h1>
        <div style={{ width: '3rem' }} />
      </header>

      {/* ── Glyph-Streifen (Signatur-Element) ── */}
      <GlyphStrip />

      <main className="main settings-main">
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        ) : (
          <div className="card-list">
            {/* ── (a) Eskalations-Klingelton ── */}
            <section className="settings-section">
              <h2 className="settings-section__title">
                Eskalations-Klingelton
              </h2>

              {!native ? (
                <p className="settings-hint">Nur auf dem Gerät verfügbar.</p>
              ) : ringtones.length === 0 ? (
                <p className="settings-hint">Keine Klingeltöne gefunden.</p>
              ) : (
                <div className="settings-ringtone-list">
                  {ringtones.map((tone) => (
                    <button
                      key={tone.uri}
                      className={`settings-ringtone ${
                        tone.uri === currentUri
                          ? 'settings-ringtone--active'
                          : ''
                      }`}
                      onClick={() => void selectRingtone(tone.uri)}
                      disabled={saving}
                    >
                      <span className="settings-ringtone__name">
                        {tone.title}
                      </span>
                      {tone.uri === currentUri && (
                        <span className="settings-ringtone__check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* ── (b) Berechtigungs-Status ── */}
            <section className="settings-section">
              <h2 className="settings-section__title">Berechtigungen</h2>

              <div className="settings-row">
                <div className="settings-row__info">
                  <span className="settings-row__label">Benachrichtigungen</span>
                  {permissionBadge(native ? notificationGranted : true)}
                </div>
                {native && notificationGranted === false && (
                  <button
                    className="btn btn--secondary settings-row__action"
                    onClick={() => void handleNotificationPermission()}
                  >
                    Berechtigung anfragen
                  </button>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row__info">
                  <span className="settings-row__label">Exakte Alarme</span>
                  {permissionBadge(native ? exactAlarmGranted : true)}
                </div>
                {native && exactAlarmGranted === false && (
                  <button
                    className="btn btn--secondary settings-row__action"
                    onClick={() =>
                      void openExactAlarmSettings().then(refreshPermissions)
                    }
                  >
                    In Systemeinstellungen öffnen
                  </button>
                )}
              </div>

              {/* Fehlende Vollbild-Berechtigung ist kritisch für den
                  Alarm — die Zeile wird deshalb als Warnung hervorgehoben. */}
              <div
                className="settings-row"
                style={
                  native && fullScreenGranted === false
                    ? {
                        border: '1px solid #c78500',
                        borderBottom: '1px solid #c78500',
                        borderRadius: '6px',
                        padding: '0.625rem',
                        background:
                          'color-mix(in srgb, #c78500 8%, transparent)',
                      }
                    : undefined
                }
              >
                <div className="settings-row__info">
                  <span className="settings-row__label">
                    {native && fullScreenGranted === false
                      ? '⚠ Vollbild-Benachrichtigung'
                      : 'Vollbild-Benachrichtigung'}
                  </span>
                  {permissionBadge(native ? fullScreenGranted : true)}
                </div>
                {native && fullScreenGranted === false && (
                  <button
                    className="btn btn--secondary settings-row__action"
                    onClick={() =>
                      void openFullScreenIntentSettings().then(
                        refreshPermissions,
                      )
                    }
                  >
                    In Systemeinstellungen öffnen
                  </button>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row__info">
                  <span className="settings-row__label">
                    Über anderen Apps einblenden
                  </span>
                  {permissionBadge(native ? overlayGranted : true)}
                </div>
                {native && overlayGranted === false && (
                  <>
                    <p className="settings-hint">
                      Wird benötigt, damit sich der Alarm auch über anderen
                      Apps bemerkbar machen kann, wenn das Gerät entsperrt
                      ist.
                    </p>
                    <button
                      className="btn btn--secondary settings-row__action"
                      onClick={() =>
                        void openOverlaySettings().then(refreshPermissions)
                      }
                    >
                      In Systemeinstellungen öffnen
                    </button>
                  </>
                )}
              </div>

              {!native && (
                <p className="settings-hint">
                  Berechtigungen sind nur auf dem Gerät relevant.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
