import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Routine, Step } from '../../core/models';
import {
  getActiveInstance,
  getRoutineById,
  updateRoutine,
} from '../../services/routineService';
import GlyphStrip from '../components/GlyphStrip';
import WheelPicker from '../components/WheelPicker';

// ─── Routine editor ─────────────────────────────────────────────────────────
//
// Edits name + steps of an existing routine. Editing is locked while an
// instance of the routine is actively WAITING/REMINDING — a running alarm
// chain must never be reconfigured mid-flight (same rule as seed.ts).

/** Delay options for timer steps (minutes) — same wheel as the extension screen. */
const DELAY_OPTIONS = Array.from({ length: 120 }, (_, i) => i + 1);

interface Props {
  routineId: string;
  /** Navigate back to the dashboard (cancel + after saving). */
  onBack: () => void;
}

/** New steps get uuids — identical to seed/creation code. */
function makeStep(): Step {
  return {
    id: uuidv4(),
    label: '',
    type: 'delayed_reminder',
    delayMinutes: 10,
    reminderMode: 'full',
  };
}

export default function RoutineEditScreen({ routineId, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [qrCodeId, setQrCodeId] = useState('');
  const [createdAt, setCreatedAt] = useState(0);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Load routine + lock state (polled like the dashboard) ────────────────
  const loadedRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function load() {
      const routine = await getRoutineById(routineId);
      if (!routine) {
        if (!disposed) {
          setNotFound(true);
          setLoading(false);
        }
        return;
      }
      const active = await getActiveInstance(routineId);
      if (disposed) return;
      setLocked(Boolean(active));
      // Only fill the form once — later polls just refresh the lock state.
      if (!loadedRef.current) {
        loadedRef.current = true;
        setName(routine.name);
        setSteps(routine.steps.map((s) => ({ ...s })));
        setQrCodeId(routine.qrCodeId);
        setCreatedAt(routine.createdAt);
        setLoading(false);
      }
    }

    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [routineId]);

  // ── Step mutations ───────────────────────────────────────────────────────
  function patchStep(index: number, patch: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, makeStep()]);
  }

  function deleteStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, delta: -1 | 1) {
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const canSave =
    !locked && !saving && name.trim().length > 0 && steps.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    // Final guard right before persisting — never reconfigure a running chain.
    const active = await getActiveInstance(routineId);
    if (active) {
      setLocked(true);
      setSaving(false);
      return;
    }
    const routine: Routine = {
      id: routineId,
      name: name.trim(),
      qrCodeId, // updateRoutine preserves the stored id anyway
      createdAt,
      steps: steps.map((s) => ({
        ...s,
        label: s.label.trim() || 'Schritt',
        // delayMinutes is only meaningful for delayed reminders
        delayMinutes:
          s.type === 'delayed_reminder'
            ? Math.max(1, Math.round(s.delayMinutes))
            : 0,
      })),
    };
    await updateRoutine(routine);
    onBack();
  }

  // ── States ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="screen">
        <div className="dot-grid-bg" aria-hidden />
        <div className="empty-state">
          <div className="spinner" />
          <p className="empty-state__text">Lade Routine…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="screen">
        <div className="dot-grid-bg" aria-hidden />
        <div className="empty-state">
          <div className="empty-state__icon">◇</div>
          <p className="empty-state__title">Routine nicht gefunden</p>
          <button className="btn btn--ghost" onClick={onBack}>
            ← Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="dot-grid-bg" aria-hidden />

      {/* ── Header ── */}
      <header className="header">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Abbrechen
        </button>
        <h1 className="header__title header__title--sm">Bearbeiten</h1>
        <div style={{ width: '3rem' }} />
      </header>

      <GlyphStrip />

      <main className="main routine-edit-main">
        {/* ── Running-instance guard ── */}
        {locked && (
          <div className="routine-edit-guard" role="alert">
            ⚠ Routine läuft gerade – Bearbeiten erst nach Abschluss möglich.
          </div>
        )}

        {/* ── Routine name ── */}
        <section className="routine-edit-section">
          <label className="routine-edit-label" htmlFor="routine-name">
            Name
          </label>
          <input
            id="routine-name"
            className="routine-edit-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Herd ausschalten"
            disabled={locked}
          />
        </section>

        {/* ── Steps ── */}
        <section className="routine-edit-section">
          <h2 className="routine-edit-section__title">Schritte</h2>

          {steps.map((step, index) => (
            <div key={step.id} className="routine-edit-step">
              <div className="routine-edit-step__head">
                <span className="routine-edit-step__index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="routine-edit-step__actions">
                  <button
                    className="routine-edit-icon-btn"
                    onClick={() => moveStep(index, -1)}
                    disabled={locked || index === 0}
                    title="Nach oben"
                    aria-label="Schritt nach oben verschieben"
                  >
                    ↑
                  </button>
                  <button
                    className="routine-edit-icon-btn"
                    onClick={() => moveStep(index, 1)}
                    disabled={locked || index === steps.length - 1}
                    title="Nach unten"
                    aria-label="Schritt nach unten verschieben"
                  >
                    ↓
                  </button>
                  <button
                    className="routine-edit-icon-btn routine-edit-icon-btn--danger"
                    onClick={() => deleteStep(index)}
                    disabled={locked}
                    title="Löschen"
                    aria-label="Schritt löschen"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <label className="routine-edit-label" htmlFor={`step-${step.id}`}>
                Beschriftung
              </label>
              <input
                id={`step-${step.id}`}
                className="routine-edit-input"
                value={step.label}
                onChange={(e) => patchStep(index, { label: e.target.value })}
                placeholder="z. B. Herd ausschalten!"
                disabled={locked}
              />

              {/* ── Type toggle ── */}
              <div className="routine-edit-toggle" role="group" aria-label="Erinnerungstyp">
                <button
                  type="button"
                  className={`routine-edit-toggle__opt ${step.type === 'instant_hint' ? 'routine-edit-toggle__opt--active' : ''}`}
                  onClick={() =>
                    patchStep(index, {
                      type: 'instant_hint',
                      delayMinutes: 0,
                    })
                  }
                  disabled={locked}
                >
                  Sofort-Hinweis
                </button>
                <button
                  type="button"
                  className={`routine-edit-toggle__opt ${step.type === 'delayed_reminder' ? 'routine-edit-toggle__opt--active' : ''}`}
                  onClick={() =>
                    patchStep(index, {
                      type: 'delayed_reminder',
                      delayMinutes: Math.max(1, step.delayMinutes || 10),
                    })
                  }
                  disabled={locked}
                >
                  Timer-Erinnerung
                </button>
              </div>

              {/* ── Delay (only for timer reminders) ── */}
              {step.type === 'delayed_reminder' && (
                <div className="routine-edit-field">
                  <span className="routine-edit-label">Verzögerung</span>
                  <div
                    className={`extension-wheel-wrap ${locked ? 'extension-wheel-wrap--locked' : ''}`}
                  >
                    <WheelPicker
                      options={DELAY_OPTIONS}
                      value={Math.max(1, step.delayMinutes || 1)}
                      onChange={(v) => patchStep(index, { delayMinutes: v })}
                      unit="Minuten"
                      ariaLabel={`Verzögerung Schritt ${index + 1} in Minuten`}
                    />
                  </div>
                </div>
              )}

              {/* ── Reminder mode toggle ── */}
              <div className="routine-edit-toggle" role="group" aria-label="Erinnerungsmodus">
                <button
                  type="button"
                  className={`routine-edit-toggle__opt ${step.reminderMode === 'soft' ? 'routine-edit-toggle__opt--active' : ''}`}
                  onClick={() => patchStep(index, { reminderMode: 'soft' })}
                  disabled={locked}
                >
                  Sanfte Erinnerung
                </button>
                <button
                  type="button"
                  className={`routine-edit-toggle__opt ${step.reminderMode !== 'soft' ? 'routine-edit-toggle__opt--active' : ''}`}
                  onClick={() => patchStep(index, { reminderMode: 'full' })}
                  disabled={locked}
                >
                  Voller Alarm
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="routine-edit-add"
            onClick={addStep}
            disabled={locked}
          >
            + Schritt hinzufügen
          </button>
        </section>

        {/* ── Save / cancel ── */}
        <div className="routine-edit-actions">
          <button
            className="btn btn--scan routine-edit-save"
            onClick={() => void handleSave()}
            disabled={!canSave}
          >
            {saving ? 'Speichert…' : 'Speichern'}
          </button>
          <button className="btn btn--secondary" onClick={onBack}>
            Abbrechen
          </button>
        </div>
      </main>
    </div>
  );
}
