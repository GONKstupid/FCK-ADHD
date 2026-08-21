import { useEffect, useState } from 'react';
import {
  getRoutineByQrCodeId,
  createInstance,
  getActiveInstance,
  applyEvent,
} from '../../services/routineService';
import { startScan, stopScan, resetDebounce, requestCameraPermission } from '../../services/scannerService';

interface Props {
  onBack: () => void;
}

type ScanStatus = 'idle' | 'scanning' | 'success' | 'error';

export default function ScannerScreen({ onBack }: Props) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [message, setMessage] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    requestCameraPermission().then(setPermissionGranted);
    return () => {
      stopScan();
      resetDebounce();
    };
  }, []);

  async function handleScan() {
    setStatus('scanning');
    setMessage('Suche QR-Code…');

    try {
      const qrCodeId = await startScan();

      const routine = await getRoutineByQrCodeId(qrCodeId);
      if (!routine) {
        setStatus('error');
        setMessage('Unbekannter QR-Code. Keine Routine gefunden.');
        return;
      }

      const active = await getActiveInstance(routine.id);

      if (active) {
        if (active.state === 'REMINDING') {
          const updated = await applyEvent(active.id, { type: 'SCAN_CONFIRM' });
          if (updated) {
            if (updated.state === 'IDLE') {
              setStatus('success');
              setMessage(`✓ "${routine.name}" abgeschlossen!`);
            } else {
              setStatus('success');
              setMessage(`✓ "${routine.name}" bestätigt. Nächster Schritt…`);
            }
          } else {
            throw new Error('applyEvent returned null');
          }
          return;
        }

        if (active.state === 'WAITING') {
          setStatus('error');
          setMessage(`"${routine.name}" wartet noch auf den Timer.`);
          return;
        }
      }

      // No active instance or IDLE — start a new one
      const instanceId = await createInstance(routine.id);
      const updated = await applyEvent(instanceId, { type: 'SCAN_START' });

      if (updated) {
        setStatus('success');
        setMessage(`✓ "${routine.name}" gestartet!`);
      } else {
        throw new Error('Failed to start routine');
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'DEBOUNCED') {
        setStatus('error');
        setMessage('Dieser Code wurde gerade erst gescannt. Bitte warte kurz.');
        return;
      }
      if (err instanceof Error && err.message === 'Scan cancelled') {
        setStatus('idle');
        setMessage('');
        return;
      }
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Scan fehlgeschlagen.');
    }
  }

  return (
    <div className="screen">
      <div className="dot-grid-bg" aria-hidden />

      <header className="header">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">Scanner</h1>
        <div style={{ width: '3rem' }} />
      </header>

      <main className="main scanner-main">
        {/* ── Viewfinder ── */}
        <div className="viewfinder">
          <div className="viewfinder__frame">
            <div className="viewfinder__corner viewfinder__corner--tl" />
            <div className="viewfinder__corner viewfinder__corner--tr" />
            <div className="viewfinder__corner viewfinder__corner--bl" />
            <div className="viewfinder__corner viewfinder__corner--br" />
            {status === 'scanning' && (
              <div className="viewfinder__scanline" />
            )}
            <div className="viewfinder__center">
              {status === 'scanning' ? (
                <div className="spinner" />
              ) : (
                <span className="viewfinder__hint">
                  {!permissionGranted
                    ? 'Kein Kamerazugriff'
                    : 'Bereit zum Scannen'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Status message ── */}
        {message && (
          <div
            className={`scan-feedback scan-feedback--${status}`}
            role="alert"
          >
            {message}
          </div>
        )}

        {/* ── Action ── */}
        <button
          className="btn btn--scan"
          onClick={handleScan}
          disabled={status === 'scanning'}
        >
          <span className="btn--scan__icon">⊞</span>
          <span className="btn--scan__label">
            {status === 'scanning' ? 'Scannt…' : 'Jetzt Scannen'}
          </span>
        </button>
      </main>
    </div>
  );
}
