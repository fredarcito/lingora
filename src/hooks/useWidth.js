import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The rendered width of an element, kept up to date when it changes (window
 * size, language of the interface). Returns the ref callback to attach and the
 * width in px (0 until it is measured).
 * @returns {[(el: HTMLElement | null) => void, number]}
 */
export function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef(/** @type {ResizeObserver | null} */ (null));
  const ref = useCallback((/** @type {HTMLElement | null} */ el) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width)));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}
