import { useEffect, useState } from 'react';
import { getRoutineById } from '../../services/routineService';
import {
  generateQRSvg,
  generateQRDataUrlHighRes,
} from '../../services/qrGenerator';
import { isNative, saveImageToGallery } from '../../services/blockerBridge';
import type { Routine } from '../../core/models';
import GlyphStrip from '../components/GlyphStrip';

interface Props {
  routineId: string;
  onBack: () => void;
}

export default function QRExportScreen({ routineId, onBack }: Props) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [svg, setSvg] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await getRoutineById(routineId);
      if (r) {
        setRoutine(r);
        const svgStr = await generateQRSvg(r.qrCodeId);
        setSvg(svgStr);
      }
      setLoading(false);
    })();
  }, [routineId]);

  async function handleExport() {
    if (!isNative()) {
      window.print();
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const dataUrl = await generateQRDataUrlHighRes(routine!.qrCodeId);
      const res = await saveImageToGallery(dataUrl);
      setFeedbackError(!res.saved);
      setFeedback(
        res.saved
          ? 'QR-Code wurde in Fotos gespeichert.'
          : 'Speichern nicht möglich.',
      );
    } catch {
      setFeedbackError(true);
      setFeedback('Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="screen">
        <div className="dot-grid-bg" aria-hidden />
        <header className="header">
          <button className="btn btn--ghost" onClick={onBack}>
            ← Zurück
          </button>
          <h1 className="header__title header__title--sm">QR-Code</h1>
          <div style={{ width: '3rem' }} />
        </header>
        {/* ── Glyph-Streifen (Signatur-Element) ── */}
        <GlyphStrip />
        <main className="main qr-main">
          <div className="spinner" />
        </main>
      </div>
    );
  }

  if (!routine) {
    return (
      <div className="screen">
        <div className="dot-grid-bg" aria-hidden />
        <header className="header">
          <button className="btn btn--ghost" onClick={onBack}>
            ← Zurück
          </button>
          <h1 className="header__title header__title--sm">QR-Code</h1>
          <div style={{ width: '3rem' }} />
        </header>
        {/* ── Glyph-Streifen (Signatur-Element) ── */}
        <GlyphStrip />
        <main className="main qr-main">
          <p className="empty-state__text">Routine nicht gefunden.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="dot-grid-bg" aria-hidden />

      <header className="header">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Zurück
        </button>
        <h1 className="header__title header__title--sm">QR-Code</h1>
        <div style={{ width: '3rem' }} />
      </header>

      {/* ── Glyph-Streifen (Signatur-Element) ── */}
      <GlyphStrip />

      <main className="main qr-main">
        <div className="qr-card">
          <div
            className="qr-card__svg"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <h2 className="qr-card__name">{routine.name}</h2>
          <p className="qr-card__id">
            ID: <code>{routine.qrCodeId.slice(0, 8)}…</code>
          </p>
        </div>

        <div className="qr-instructions">
          <div className="qr-instructions__icon">⊕</div>
          <p className="qr-instructions__title">Anleitung</p>
          <p className="qr-instructions__text">
            Klebe diesen QR-Code an den Ort, den du überwachen möchtest — z.B.
            an den Herd, die Dunstabzugshaube oder den Backofen.
          </p>
          <p className="qr-instructions__text qr-instructions__text--hint">
            Scanne den Code, wenn du das Gerät einschaltest. Die App erinnert
            dich dann automatisch ans Ausschalten.
          </p>
        </div>

        {feedback && (
          <div
            className={`scan-feedback scan-feedback--${feedbackError ? 'error' : 'success'}`}
            role="alert"
          >
            {feedback}
          </div>
        )}
        <button
          className="btn btn--secondary"
          onClick={() => void handleExport()}
          disabled={saving}
        >
          {isNative() ? 'In Fotos speichern' : 'Drucken'}
        </button>
      </main>
    </div>
  );
}
