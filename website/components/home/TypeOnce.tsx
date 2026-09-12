'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Types a string out once, then stops.
 *
 * Four constraints shape this, and all four are requirements rather than
 * preferences:
 *
 *  - `prefers-reduced-motion` renders the finished text instantly. No timers
 *    are started at all in that case.
 *  - It runs once. A headline that re-types itself after the visitor has read
 *    it is a distraction, not a flourish, so there is no loop and no replay on
 *    scroll.
 *  - It never gates anything. The full text is in the server-rendered HTML, the
 *    element reserves its final size before the first frame, and the buttons
 *    around it are interactive immediately. With JavaScript off, the finished
 *    text is simply what renders.
 *  - It finishes inside `durationMs` regardless of length, because the step is
 *    derived from elapsed time rather than a fixed per-character delay.
 *
 * Layout is held by a hidden copy of the finished text stacked underneath the
 * visible one, so nothing below moves while it types. Assistive technology
 * reads `aria-label` on the host element and skips the partial text entirely.
 */

// useLayoutEffect clears the text before the browser paints, which is what
// keeps the finished string from flashing for a frame before typing starts.
// React warns if it runs during SSR, so fall back to useEffect there.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface TypeOnceProps {
  text: string;
  /** Total time to finish, whatever the length. Kept well under two seconds. */
  durationMs?: number;
  /** Held back so the page paints first; the text is already sized and visible. */
  delayMs?: number;
  className?: string;
  /** Show a caret while typing. It stops when the text does. */
  caret?: boolean;
  onDone?: () => void;
}

export default function TypeOnce({
  text,
  durationMs = 1400,
  delayMs = 120,
  className,
  caret = true,
  onDone,
}: TypeOnceProps) {
  // Starts finished: that is what the server renders and what a visitor
  // without JavaScript, or with reduced motion, keeps.
  const [shown, setShown] = useState(text);
  const [typing, setTyping] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    setShown('');
    setTyping(true);
  }, [text]);

  useEffect(() => {
    if (!typing) return;
    let frame = 0;
    let start = 0;

    const step = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start - delayMs;
      if (elapsed < 0) {
        frame = requestAnimationFrame(step);
        return;
      }
      const ratio = Math.min(1, elapsed / durationMs);
      setShown(text.slice(0, Math.ceil(ratio * text.length)));
      if (ratio < 1) {
        frame = requestAnimationFrame(step);
      } else {
        setTyping(false);
        doneRef.current?.();
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [typing, text, durationMs, delayMs]);

  return (
    <span className={`type-stack ${className ?? ''}`.trim()}>
      {/* Reserves the finished size so nothing below shifts while typing. */}
      <span className="type-ghost" aria-hidden="true">
        {text}
      </span>
      <span className="type-live" aria-hidden="true">
        {shown}
        {caret && typing && <i className="type-caret" />}
      </span>
    </span>
  );
}
