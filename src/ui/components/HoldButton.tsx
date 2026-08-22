import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Hold Button with circular progress ring ─────────────────────────────────────

interface Props {
  /** How long (in ms) the user must hold. Default: 4000ms */
  holdDuration?: number;
  /** Called when hold is completed successfully */
  onComplete: () => void;
  /** Text shown while not holding. Default: 'HALTEN' */
  label?: string;
}

const RADIUS = 72;
const STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function HoldButton({
  holdDuration = 4000,
  onComplete,
  label = 'HALTEN',
}: Props) {
  const [progress, setProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  // ── Animation loop ────────────────────────────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.min(elapsed / holdDuration, 1);
      setProgress(p);

      if (p >= 1) {
        onComplete();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [holdDuration, onComplete],
  );

  // ── Start holding ─────────────────────────────────────────────────────────────
  const startHold = useCallback(() => {
    if (resetting) return;
    setIsHolding(true);
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, resetting]);

  // ── Stop holding (early release) ──────────────────────────────────────────────
  const stopHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsHolding(false);
    // Brief reset animation
    setResetting(true);
    setTimeout(() => {
      setProgress(0);
      setResetting(false);
    }, 200);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── SVG ring offset ───────────────────────────────────────────────────────────
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div
      className={`hold-button ${isHolding ? 'hold-button--active' : ''}`}
      onMouseDown={startHold}
      onMouseUp={stopHold}
      onMouseLeave={() => isHolding && stopHold()}
      onTouchStart={startHold}
      onTouchEnd={stopHold}
    >
      <svg
        className="hold-button__ring"
        viewBox={`0 0 ${(RADIUS + STROKE) * 2} ${(RADIUS + STROKE) * 2}`}
        width="180"
        height="180"
      >
        {/* Background track */}
        <circle
          cx={RADIUS + STROKE}
          cy={RADIUS + STROKE}
          r={RADIUS}
          fill="none"
          stroke="var(--paper-border, #3a3936)"
          strokeWidth={STROKE}
        />
        {/* Progress arc */}
        <circle
          cx={RADIUS + STROKE}
          cy={RADIUS + STROKE}
          r={RADIUS}
          fill="none"
          stroke="var(--accent, #ff453a)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={`hold-button__progress ${resetting ? 'hold-button__progress--reset' : ''}`}
          transform={`rotate(-90 ${RADIUS + STROKE} ${RADIUS + STROKE})`}
        />
      </svg>

      <span className={`hold-button__label ${isHolding ? 'hold-button__label--pulse' : ''}`}>
        {isHolding ? `${Math.ceil((holdDuration * (1 - progress)) / 1000)}s` : label}
      </span>
    </div>
  );
}
