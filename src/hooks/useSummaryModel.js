import { useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";

/** Id of the summary model in `api.setupStatus()` and `api.downloadModel()`. */
const SUMMARY_MODEL = "summary";

/**
 * The summary model: whether it is downloaded and how its download goes.
 * Shared by every view, so a download keeps going (and showing) when the user
 * opens another note and comes back.
 * @typedef {{ installed: boolean | null, downloading: boolean, downloaded: number,
 *   total: number, etaSecs: number, error: string }} SummaryModelState
 *   `installed` is null while it is being checked; `etaSecs` is 0 until the
 *   speed is known.
 */

/** @type {SummaryModelState} */
let state = { installed: null, downloading: false, downloaded: 0, total: 0, etaSecs: 0, error: "" };
/** @type {Set<(s: SummaryModelState) => void>} */
const listeners = new Set();
/** @type {Promise<boolean> | null} */
let download = null;

/** @param {Partial<SummaryModelState>} patch */
function update(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

/** Asks Rust whether the model is there (it may have been deleted in Settings). */
function check() {
  if (download) return;
  api
    .setupStatus()
    .then((list) => {
      const m = list.find((x) => x.id === SUMMARY_MODEL);
      update({ installed: !!m?.installed, total: m?.approx_bytes ?? 0 });
    })
    .catch(() => update({ installed: false }));
}

/**
 * Downloads the model (one download at a time; it resumes where it stopped).
 * @returns {Promise<boolean>} Whether it ended up installed.
 */
export function downloadSummaryModel() {
  download ??= (async () => {
    update({ downloading: true, error: "", etaSecs: 0 });
    // Smoothed speed, so the time left doesn't jump.
    const speed = { at: performance.now(), bytes: 0, rate: 0 };
    try {
      await api.downloadModel(SUMMARY_MODEL, ({ downloaded, total }) => {
        const now = performance.now();
        if (now - speed.at >= 1000) {
          const rate = ((downloaded - speed.bytes) * 1000) / (now - speed.at);
          speed.rate = speed.rate ? speed.rate * 0.7 + rate * 0.3 : rate;
          Object.assign(speed, { at: now, bytes: downloaded });
        }
        const left = (total || state.total) - downloaded;
        update({ downloaded, total: total || state.total, etaSecs: speed.rate > 0 ? left / speed.rate : 0 });
      });
      update({ installed: true, downloading: false });
      return true;
    } catch (e) {
      update({ downloading: false, error: errorMessage(e) });
      return false;
    } finally {
      download = null;
    }
  })();
  return download;
}

/**
 * The summary model's state, kept up to date, and checked again each time a
 * view that uses it opens.
 * @returns {SummaryModelState}
 */
export function useSummaryModel() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    check();
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
