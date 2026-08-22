import { useEffect, useState } from 'react';
import type { Routine, RoutineInstance } from '../../core/models';
import {
  getAllRoutines,
  getActiveInstance,
} from '../../services/routineService';
import { seedMVPRoutine } from '../../data/seed';
import GlyphStrip from '../components/GlyphStrip';

interface Props {
  onNavigate: (screen: string, params?: Record<string, string>) => void;
  onThemeToggle: () => void;
  isDark: boolean;
}

function formatDeadline(deadline: number | null): string {
  if (!deadline) return '';
  const diff = deadline - Date.now();
  if (diff <= 0) return 'jetzt!';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `in ${mins} Min`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `in ${hrs}h ${remMins}m`;
}

const stateBadge: Record<
  RoutineInstance['state'],
  { label: string; className: string }
> = {
  IDLE: { label: 'Bereit', className: 'badge--idle' },
  WAITING: { label: 'Wartet', className: 'badge--waiting' },
  REMINDING: { label: 'Erinnert!', className: 'badge--reminding' },
};

export default function DashboardScreen({
  onNavigate,
  onThemeToggle,
  isDark,
}: Props) {
  const [routines, setRoutines] = useState<
    (Routine & { instance?: RoutineInstance })[]
  >([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    await seedMVPRoutine();
    const all = await getAllRoutines();
    const withInstances = await Promise.all(
      all.map(async (r) => {
        const inst = await getActiveInstance(r.id);
        return { ...r, instance: inst };
      }),
    );
    setRoutines(withInstances);
    setLoading(false);
  }

  useEffect(() => {
    const tick = () => {
      void load();
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="screen">
      {/* ── Background dot grid ── */}
      <div className="dot-grid-bg" aria-hidden />

      {/* ── Header ── */}
      <header className="header">
        <div className="header__left">
          <h1 className="header__title">FCK ADHD</h1>
          <span className="header__sub">reminder system</span>
        </div>
        <div className="header__actions">
          <button
            className="btn btn--ghost"
            onClick={() => onNavigate('Settings')}
            title="Einstellungen"
            aria-label="Einstellungen"
          >
            ⚙
          </button>
          <button
            className="btn btn--ghost"
            onClick={onThemeToggle}
            title={isDark ? 'Helles Design' : 'Dunkles Design'}
            aria-label={isDark ? 'Helles Design' : 'Dunkles Design'}
          >
            {isDark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Glyph-Streifen (Signatur-Element) ── */}
      <GlyphStrip />

      {/* ── Routine list ── */}
      <main className="main">
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
            <p className="empty-state__text">Lade Routinen…</p>
          </div>
        ) : routines.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">◇</div>
            <p className="empty-state__title">Keine Routinen</p>
            <p className="empty-state__text">
              Erstelle deine erste Routine um loszulegen.
            </p>
          </div>
        ) : (
          <div className="card-list">
            {routines.map((r) => {
              const inst = r.instance;
              const badge = inst ? stateBadge[inst.state] : stateBadge['IDLE'];
              return (
                <div
                  key={r.id}
                  className="card"
                  onClick={() => onNavigate('QRExport', { routineId: r.id })}
                >
                  <div className="card__header">
                    <span className="card__name">{r.name}</span>
                    <span className={`badge ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="card__meta">
                    <span className="card__steps">
                      {r.steps.length} Schritt{r.steps.length !== 1 ? 'e' : ''}
                    </span>
                    {inst?.state === 'WAITING' && inst.deadline && (
                      <span className="card__deadline">
                        ⏱ {formatDeadline(inst.deadline)}
                      </span>
                    )}
                    {inst?.state === 'REMINDING' && (
                      <span className="card__deadline card__deadline--urgent">
                        ⚠ Jetzt bestätigen!
                      </span>
                    )}
                  </div>
                  <div className="card__qr-hint">QR-Code anzeigen →</div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Scan button ── */}
      <div className="scan-bar">
        <button className="btn btn--scan" onClick={() => onNavigate('Scanner')}>
          <span className="btn--scan__icon">⊞</span>
          <span className="btn--scan__label">QR Scannen</span>
        </button>
      </div>
    </div>
  );
}
