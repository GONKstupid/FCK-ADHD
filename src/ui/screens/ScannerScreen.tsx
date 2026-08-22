import { useEffect, useState } from 'react';
import { handleScanResult } from '../../services/alarmController';
import { isNative } from '../../services/blockerBridge';
import {
  startScan,
  stopScan,
  resetDebounce,
  requestCameraPermission,
} from '../../services/scannerService';
import GlyphStrip from '../components/GlyphStrip';

interface Props {
  onBack: () => void;
}

type ScanStatus = 'idle' | 'scanning' | 'success' | 'error';

export default function ScannerScreen({ onBack }: Props) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [message, setMessage] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    void requestCameraPermission().then(setPermissionGranted);
    return () => {
      stopScan();
      resetDebounce();
      document.body.classList.remove('barcode-scanner-active');
    };
  }, []);

  async function handleScan() {
    setStatus('scanning');
    setMessage('Suche QR-Code…');

    // Make the webview transparent so the native ML Kit camera preview
    // shines through while scanning. Only needed on native platforms.
    if (isNative()) {
      document.body.classList.add('barcode-scanner-active');
    }

    try {
      const qrCodeId = await startScan();

      // All routine/instance logic + native side effects live in the
      // alarm controller — the screen only renders the outcome.
      const result = await handleScanResult(qrCodeId);
      setStatus(result.status === 'unknown' ? 'error' : 'success');
      setMessage(result.message);
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
    } finally {
      document.body.classList.remove('barcode-scanner-active');
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

      {/* ── Glyph-Streifen (Signatur-Element) ── */}
      <GlyphStrip />

      <main className="main scanner-main">
        {/* ── Viewfinder ── */}
        <div className="viewfinder">
          <div className="viewfinder__frame">
            <div className="viewfinder__corner viewfinder__corner--tl" />
            <div className="viewfinder__corner viewfinder__corner--tr" />
            <div className="viewfinder__corner viewfinder__corner--bl" />
            <div className="viewfinder__corner viewfinder__corner--br" />
            {status === 'scanning' && <div className="viewfinder__scanline" />}
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
          onClick={() => void handleScan()}
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
