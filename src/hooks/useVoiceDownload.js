import { useState } from "react";
import { api, errorMessage } from "@utils/api";
import { announceVoices } from "@utils/voiceDownloads";

/**
 * Downloads a voice (natural or light) with its progress, and tells the voice
 * lists to read again when it ends.
 * - `busy`: the download id going on, or "".
 * - `progress`: 0–1 of that download.
 * - `download(model)`: resolves true when it is installed, false if it failed (`error` says why).
 */
export function useVoiceDownload() {
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  /** @param {string} model @returns {Promise<boolean>} */
  const download = async (model) => {
    setBusy(model);
    setProgress(0);
    setError("");
    try {
      await api.downloadModel(model, ({ downloaded, total }) => setProgress(total ? downloaded / total : 0));
      announceVoices();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  };

  return { busy, progress, error, download };
}
