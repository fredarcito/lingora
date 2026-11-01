import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";

/**
 * Lingora Mic, the virtual microphone for calls (`src-tauri/src/virtual_mic.rs`):
 * whether it is installed, and installing or removing it behind macOS's
 * password window. `status` is null while checking; `busy` says which action
 * is running; `error` is the raw cause of the last failure (for a `title`).
 * Each caller checks on mount (Settings and the Speak card are never on
 * screen at once).
 */
export function useVirtualMic() {
  const [status, setStatus] = useState(/** @type {import("@utils/api").VirtualMicStatus | null} */ (null));
  const [busy, setBusy] = useState(/** @type {"" | "install" | "remove"} */ (""));
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .virtualMicStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  /**
   * @param {"install" | "remove"} action
   * @returns {Promise<import("@utils/api").VirtualMicStatus | null>} null when it failed.
   */
  const run = useCallback(async (action) => {
    setBusy(action);
    setError("");
    try {
      const next = await (action === "install" ? api.virtualMicInstall() : api.virtualMicUninstall());
      setStatus(next);
      return next;
    } catch (e) {
      // The raw cause goes to the log; the UI shows a plain sentence.
      const message = errorMessage(e);
      setError(message);
      api.logUi(`micrófono virtual: ${message}`).catch(() => {});
      return null;
    } finally {
      setBusy("");
    }
  }, []);

  return { status, busy, error, install: () => run("install"), uninstall: () => run("remove") };
}
