import { useState } from "react";

/**
 * A setting kept in `localStorage`: read once when the app opens and saved on
 * every change. `load` and `store` are the pair from `@utils/prefs.js` or
 * `@utils/notes.js`, which own the keys.
 * @template T
 * @param {() => T} load
 * @param {(value: T) => void} store
 * @returns {[T, (next: T) => void]}
 */
export function useStoredPref(load, store) {
  const [value, setValue] = useState(load);
  /** @param {T} next */
  const change = (next) => {
    setValue(next);
    store(next);
  };
  return [value, change];
}
