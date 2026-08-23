import { useEffect, useRef } from 'react';

// ─── Wheel Picker (iOS-Timer-Stil) ─────────────────────────────────────────────
// Scrollbares Rad mit Scroll-Snap: Optionen drehen wie beim Apple-Timer,
// die zentrierte Option ist ausgewählt. Nutzt die Design-Token der App
// (Dot-Matrix-Zahlen, JetBrains-Mono-Labels).

interface Props {
  /** Available values, evenly spaced on the wheel. */
  options: number[];
  /** Currently selected value. */
  value: number;
  /** Called when the wheel settles on a new value. */
  onChange: (value: number) => void;
  /** Unit label rendered next to the wheel (e.g. 'Minuten'). */
  unit?: string;
  /** Accessible label. */
  ariaLabel?: string;
}

const ITEM_HEIGHT = 44;

export default function WheelPicker({
  options,
  value,
  onChange,
  unit,
  ariaLabel = 'Auswahl',
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const isProgrammatic = useRef(false);

  const clampIndex = (i: number) =>
    Math.min(Math.max(i, 0), options.length - 1);

  // Sync scroll position when the value changes externally.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const idx = Math.max(options.indexOf(value), 0);
    const target = idx * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      isProgrammatic.current = true;
      el.scrollTo({ top: target, behavior: 'smooth' });
      window.setTimeout(() => {
        isProgrammatic.current = false;
      }, 350);
    }
  }, [value, options.length]);

  const handleScroll = () => {
    if (isProgrammatic.current) return;
    if (settleTimer.current !== null)
      window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = listRef.current;
      if (!el) return;
      const idx = clampIndex(Math.round(el.scrollTop / ITEM_HEIGHT));
      if (options[idx] !== undefined && options[idx] !== value) {
        onChange(options[idx]);
      }
    }, 120);
  };

  return (
    <div className="wheel" role="group" aria-label={ariaLabel}>
      <div
        ref={listRef}
        className="wheel__list"
        style={{
          // 3 sichtbare Zeilen → oben/unten je 1× Item-Height Padding
          height: ITEM_HEIGHT * 3,
          ['--wheel-item-height' as string]: `${ITEM_HEIGHT}px`,
        }}
        onScroll={handleScroll}
      >
        <div className="wheel__spacer" aria-hidden />
        {options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            tabIndex={-1}
            className={`wheel__item ${opt === value ? 'wheel__item--active' : ''}`}
            style={{ height: ITEM_HEIGHT }}
            onClick={() => onChange(opt)}
            aria-label={`${opt} ${unit ?? ''}`}
            data-index={i}
          >
            <span className="wheel__value">{opt}</span>
          </button>
        ))}
        <div className="wheel__spacer" aria-hidden />
      </div>
      <div className="wheel__selection-band" aria-hidden />
      {unit && <span className="wheel__unit">{unit}</span>}
    </div>
  );
}
