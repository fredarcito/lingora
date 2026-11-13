import { useState } from "react";
import { api, errorMessage } from "@utils/api";
import { downloadSummaryModel, useSummaryModel } from "@hooks/useSummaryModel";
import { notifySummarySource, useSummarySource } from "@hooks/useSummarySource";
import { setActiveSummary } from "@utils/noteRecorder.js";
import { cloudRequest, hasConsent, storeConsent, storeSummarySource } from "@utils/summarySource.js";

/**
 * Summarizing a note: on the computer or with the user's own key, with the
 * model download and the first-time permission of each service on the way.
 * The note and the tabs stay with the page, which passes how to change them.
 * @param {string} id The note's id.
 * @param {{
 *   setNote: (update: (prev: import("@utils/api").Note | null) => import("@utils/api").Note | null) => void,
 *   setTab: (update: (current: "summary" | "map" | "chat" | "transcript" | null) => "summary" | "map" | "chat" | "transcript" | null) => void,
 * }} page
 */
export function useNoteSummary(id, { setNote, setTab }) {
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");
  // Summarizing without the model leads to its download in the Summary tab, even if there is already a summary.
  const [askDownload, setAskDownload] = useState(false);
  // The service waiting for the first-time permission to send it the transcript.
  const [askConsent, setAskConsent] = useState(/** @type {string | null} */ (null));
  // A summary just made appears condensing into place, once (not each time the note opens).
  const [fresh, setFresh] = useState(false);
  // Language the summary is in, if the selector was changed after summarizing.
  const [wasIn, setWasIn] = useState(/** @type {string | null} */ (null));
  const model = useSummaryModel();
  const source = useSummarySource();
  const cloudOn = source.source !== "local";
  const ready = cloudOn ? source.hasKey === true : model.installed === true;
  // Known not to be usable yet (not just still being checked).
  const notReady = cloudOn ? source.hasKey === false : model.installed === false;

  /** @param {import("@utils/summarySource.js").CloudRequest | null} [cloud] */
  const summarize = async (cloud = null) => {
    setAskConsent(null);
    setError("");
    setSummarizing(true);
    // From the Map tab the map appears there; from anywhere else, the summary.
    setTab((current) => (current === "map" ? current : "summary"));
    try {
      await api.noteSummarize(id, cloud);
      const n = await api.noteRead(id);
      setNote((prev) => (prev ? { ...prev, summary: n.summary } : n));
      setActiveSummary(id, n.summary);
      setFresh(true);
      setWasIn(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSummarizing(false);
    }
  };

  /** With a service, asks first the first time. @param {string} where "local" or a service's id */
  const summarizeWith = (where) => {
    if (where === "local") summarize();
    else if (!hasConsent(where)) setAskConsent(where);
    else summarize(cloudRequest(where));
  };

  /** The «Summarize» button: what is missing first (the model or a key), then the summary. */
  const ask = () => {
    setTab((current) => (current === "map" && ready ? current : "summary"));
    if (!ready) setAskDownload(true);
    else summarizeWith(source.source);
  };

  /** Summarizing on the computer from the options: it becomes the way summaries are made. */
  const summarizeHere = () => {
    storeSummarySource("local");
    notifySummarySource();
    setAskDownload(false);
    summarize();
  };

  /** Once downloaded, it summarizes what was asked for. */
  const getModel = async () => {
    if (await downloadSummaryModel()) summarizeHere();
  };

  /** @param {string} provider */
  const keySaved = (provider) => {
    setAskDownload(false);
    summarizeWith(provider);
  };

  /** The user allowed sending the transcript to the service that was waiting. */
  const confirmConsent = () => {
    if (!askConsent) return;
    storeConsent(askConsent);
    summarize(cloudRequest(askConsent));
  };

  return {
    summarizing,
    error,
    askDownload,
    askConsent,
    fresh,
    wasIn,
    model,
    source,
    ready,
    notReady,
    ask,
    summarizeHere,
    getModel,
    keySaved,
    confirmConsent,
    cancelConsent: () => setAskConsent(null),
    endFresh: () => setFresh(false),
    /** The language selector changed: remembers the one the summary is in. @param {string} lang */
    langChanged: (lang) => setWasIn((prev) => prev ?? lang),
  };
}
