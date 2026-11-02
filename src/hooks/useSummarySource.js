import { useCallback, useEffect, useState } from "react";
import { api } from "@utils/api";
import { loadSummarySource, providerOf } from "@utils/summarySource.js";

/** Notice between views (note, Settings, menu) that the source or a key changed. */
const SOURCE_EVENT = "lingora:summary-source";

export const notifySummarySource = () => window.dispatchEvent(new Event(SOURCE_EVENT));

/** @type {Promise<number | null> | null} */
let memory = null;

/**
 * Where summaries are made and whether it can be used: `source` is "local" or
 * a service's id, `hasKey` whether that service has its key (a custom server
 * can go without one; null while checking), `memoryGb` the computer's RAM
 * (null if unknown or still being read).
 * @returns {{ source: string, hasKey: boolean | null, keyStatus: string | null, memoryGb: number | null }}
 */
export function useSummarySource() {
  const [source, setSource] = useState(loadSummarySource);
  const [keyStatus, setKeyStatus] = useState(/** @type {string | null} */ (null));
  const [memoryGb, setMemoryGb] = useState(/** @type {number | null} */ (null));

  const load = useCallback(() => {
    const current = loadSummarySource();
    setSource(current);
    if (current === "local") return setKeyStatus(null);
    api
      .summaryKeyStatus(current)
      .then(setKeyStatus)
      .catch(() => setKeyStatus("none"));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SOURCE_EVENT, load);
    memory ??= api.systemMemory().catch(() => null);
    let alive = true;
    memory.then((gb) => alive && setMemoryGb(gb ?? null));
    return () => {
      alive = false;
      window.removeEventListener(SOURCE_EVENT, load);
    };
  }, [load]);

  const custom = !!providerOf(source)?.custom;
  const hasKey = source === "local" ? false : keyStatus === null ? null : custom || keyStatus !== "none";
  return { source, hasKey, keyStatus, memoryGb };
}
