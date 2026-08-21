import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Puzzle generation ──────────────────────────────────────────────────────────

interface Puzzle {
  a: number;
  b: number;
  op: '+' | '−' | '×';
  answer: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePuzzle(): Puzzle {
  const ops: Puzzle['op'][] = ['+', '−', '×'];
  // Try to produce results in [1, 100]
  for (let attempt = 0; attempt < 50; attempt++) {
    const op = ops[randInt(0, 2)];
    let a: number, b: number, answer: number;

    switch (op) {
      case '+':
        a = randInt(1, 50);
        b = randInt(1, 50);
        answer = a + b;
        break;
      case '−':
        a = randInt(10, 100);
        b = randInt(1, a - 1);
        answer = a - b;
        break;
      case '×':
        a = randInt(2, 12);
        b = randInt(2, 9);
        answer = a * b;
        break;
    }

    if (answer >= 1 && answer <= 100) {
      return { a, b, op, answer };
    }
  }
  // Fallback: simple addition
  const a = randInt(1, 20);
  const b = randInt(1, 20);
  return { a, b, op: '+', answer: a + b };
}

function generateBatch(count: number): Puzzle[] {
  return Array.from({ length: count }, () => generatePuzzle());
}

// ─── Component ──────────────────────────────────────────────────────────────────

interface Props {
  onSolved: () => void;
}

export default function MathPuzzle({ onSolved }: Props) {
  const [puzzles] = useState(() => generateBatch(10));
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const puzzle = puzzles[index % puzzles.length];

  useEffect(() => {
    inputRef.current?.focus();
  }, [index]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const val = parseInt(input, 10);

      if (val === puzzle.answer) {
        onSolved();
      } else {
        // Wrong answer → shake, then new puzzle
        setShaking(true);
        setTimeout(() => {
          setShaking(false);
          setInput('');
          setIndex((i) => i + 1);
        }, 500);
      }
    },
    [input, puzzle.answer, onSolved],
  );

  return (
    <div className={`math-puzzle ${shaking ? 'math-puzzle--shake' : ''}`}>
      <div className="math-puzzle__equation">
        <span className="math-puzzle__operand">{puzzle.a}</span>
        <span className="math-puzzle__op">{puzzle.op}</span>
        <span className="math-puzzle__operand">{puzzle.b}</span>
        <span className="math-puzzle__eq">=</span>
        <span className="math-puzzle__blank">?</span>
      </div>

      <form className="math-puzzle__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="math-puzzle__input"
          type="number"
          inputMode="numeric"
          placeholder="?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
        />
        <button
          className="math-puzzle__submit"
          type="submit"
          disabled={input.length === 0}
        >
          ✓
        </button>
      </form>
    </div>
  );
}
