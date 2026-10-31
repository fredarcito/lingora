import { useRef } from "react";

/**
 * When each entry first showed up (ms since epoch), by `id`. Noted on the
 * first render that sees it: the entry itself carries no time, and this is
 * within milliseconds of when it was created. Entries that left are forgotten.
 * @param {Array<{ id: number }>} entries
 * @returns {Map<number, number>}
 */
export function useArrivalTimes(entries) {
  const times = useRef(/** @type {Map<number, number>} */ (new Map()));
  const now = Date.now();
  const ids = new Set(entries.map((e) => e.id));
  for (const id of ids) if (!times.current.has(id)) times.current.set(id, now);
  for (const id of times.current.keys()) if (!ids.has(id)) times.current.delete(id);
  return times.current;
}
