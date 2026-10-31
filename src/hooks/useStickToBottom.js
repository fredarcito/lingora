import { useCallback, useEffect, useRef, useState } from "react";

/** Distance from the bottom (px) that still counts as "at the bottom". */
const NEAR_BOTTOM = 60;

/**
 * Keeps a scrolling list at its bottom while new content arrives, like a
 * chat: only if it was already there. If the user scrolled up to reread, it
 * stays put and `away` turns true (to offer a "jump to latest" button).
 * Pass the values whose change means new content; `ref` goes on the list and
 * `onScroll` on its scroll event.
 * @param {unknown[]} deps
 */
export function useStickToBottom(deps) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const stuck = useRef(true);
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    stuck.current = atBottom;
    setAway(!atBottom);
  }, []);

  /** @param {ScrollBehavior} [behavior] */
  const toBottom = useCallback((behavior = "smooth") => {
    const el = ref.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (stuck.current) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, away, onScroll, toBottom };
}
