import { useEffect, useRef, useState } from "react";

/** The slowest the text appears (characters per second). */
const MIN_RATE = 45;
/** What is pending is shown in about this long (ms): the further behind, the faster. */
const CATCH_UP_MS = 220;

/**
 * Shows a text that arrives in pieces (an answer being written) at a steady
 * pace, character by character, instead of in jumps when each piece lands.
 * It speeds up when it falls behind, so it never lags much. A text that does
 * not continue the previous one (a new answer) starts over. With reduced
 * motion, or `text` null, it is shown as it is.
 * @param {string | null} text
 * @returns {string | null}
 */
export function useSmoothText(text) {
  const [shown, setShown] = useState(0);
  const pos = useRef(0);
  const target = useRef(text ?? "");
  const frame = useRef(0);
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const next = text ?? "";
    if (!next.startsWith(target.current.slice(0, Math.floor(pos.current)))) pos.current = 0;
    target.current = next;
    if (reduced.current || text === null) {
      pos.current = next.length;
      setShown(next.length);
      return;
    }
    if (frame.current) return;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const behind = target.current.length - pos.current;
      if (behind <= 0) {
        frame.current = 0;
        return;
      }
      pos.current = Math.min(target.current.length, pos.current + Math.max((MIN_RATE * dt) / 1000, (behind * dt) / CATCH_UP_MS));
      setShown(Math.floor(pos.current));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [text]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return text === null ? null : (text ?? "").slice(0, shown);
}
