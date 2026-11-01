import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { api } from "@utils/api";
import { CAPTION_SENTENCES } from "@components/Captions";
import { EMPTY_STATE } from "@utils/lanes";

/**
 * Floating captions: always from Listen, which is what the other person or the
 * video says. The main window keeps doing all the work and sends them the
 * latest sentences; the floating one can start and stop Listen. Whether it is
 * open lives in App, which needs it before the lanes (Take notes only
 * translates while it is open).
 * @param {{
 *   floating: boolean,
 *   setFloating: (open: boolean) => void,
 *   remoteLane: import("@app/types").Lane,
 *   remoteState: import("@app/types").LaneState,
 *   start: (lane: import("@app/types").Lane) => Promise<void>,
 *   stop: (lane: import("@app/types").Lane) => Promise<void>,
 * }} options
 */
export function useFloatingCaptions({ floating, setFloating, remoteLane, remoteState, start, stop }) {
  const floatingPayload = useRef(/** @type {object | null} */ (null));
  const toggleRemote = useRef(() => {});
  toggleRemote.current = () => (remoteState.running ? stop(remoteLane) : start(remoteLane));

  useEffect(() => {
    const same = remoteLane.sourceLang === remoteLane.targetLang;
    floatingPayload.current = {
      state: {
        ...EMPTY_STATE,
        running: remoteState.running,
        draft: remoteState.draft,
        history: remoteState.history
          .slice(0, CAPTION_SENTENCES)
          // "Original" with the voice on: what was said, in place of the translation.
          .map((h) => ({ id: h.id, captionKey: h.captionKey, translation: remoteLane.captionsOriginal ? h.transcript : h.translation, transcript: h.transcript })),
      },
      showSource: !same && !remoteLane.captionsOriginal && (remoteLane.showSource ?? (remoteLane.speak && !same)),
      // What is being heard right now, like at the foot of the app's captions.
      live: [...remoteState.heard.map((h) => h.text), remoteState.partial].filter(Boolean).join(" "),
    };
    if (floating) emitTo("captions", "captions", floatingPayload.current).catch(() => {});
  }, [floating, remoteState, remoteLane.sourceLang, remoteLane.targetLang, remoteLane.showSource, remoteLane.speak, remoteLane.captionsOriginal]);

  useEffect(() => {
    const offs = [
      listen("captions-ready", () => {
        setFloating(true);
        if (floatingPayload.current) emitTo("captions", "captions", floatingPayload.current).catch(() => {});
      }),
      listen("captions-control", () => toggleRemote.current()),
      listen("captions-closed", () => setFloating(false)),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, []);

  const toggleFloating = async () => {
    try {
      if (floating) {
        await (await Window.getByLabel("captions"))?.close();
        setFloating(false);
      } else {
        await api.openCaptions();
        setFloating(true);
      }
    } catch (e) {
      console.warn("[lingora] subtítulos flotantes:", e);
    }
  };

  return { toggleFloating };
}
