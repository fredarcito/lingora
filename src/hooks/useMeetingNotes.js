import { useEffect, useRef } from "react";
import { t } from "@i18n";
import { withEchoFilter } from "@utils/echo.js";
import { SYSTEM_AUDIO } from "@utils/audio.js";
import { ROUTE_CHECK_MS, echoPossible, meetingMic, readRoute, roomMic } from "@utils/route.js";

/**
 * @typedef {import("@app/types").Lane} Lane
 * @typedef {import("@app/types").LaneState} LaneState
 * @typedef {ReturnType<typeof import("@utils/notes.js").createRecorder>} Recorder
 */

/**
 * Take notes in an online meeting: the Mac audio (the other people)
 * and your microphone ("Me") at the same time, each on its own lane.
 * - When starting, the microphone is chosen based on what is connected (`meetingMic`).
 * - During the meeting, if the default input changes (you connect or remove
 *   AirPods) or the microphone is lost, it reopens without stopping the note.
 * - If the Mac audio is lost, the note ends: your microphone too.
 * - `wrapRecorder` puts the echo filter in front of the recorder.
 * Without a meeting (`meeting` false) only the Mac lane is used, as always; if
 * it is the microphone (in person), it is chosen with `roomMic`.
 * @param {{
 *   mode: import("@app/types").Mode,
 *   meeting: boolean,
 *   remoteLane: Lane, localLane: Lane,
 *   state: Record<string, LaneState>,
 *   lanesRef: React.MutableRefObject<Lane[]>,
 *   runtime: React.MutableRefObject<Record<string, { pending: number, capture?: import("@utils/audio").AutoCapture }>>,
 *   start: (lane: Lane) => Promise<void>,
 *   stop: (lane: Lane) => Promise<void>,
 *   stopping: React.MutableRefObject<Promise<void> | null>,
 * }} options
 */
export function useMeetingNotes({ mode, meeting, remoteLane, localLane, state, lanesRef, runtime, start, stop, stopping }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Whether the note-taking in progress is an online meeting (set when it starts). */
  const meetingRef = useRef(false);
  /** What is connected; null if unknown (treated as speakers). */
  const routeRef = useRef(/** @type {import("@utils/api").AudioRoute | null} */ (null));
  /** The Mac audio did start in this note-taking session (the microphone opens first). */
  const macRan = useRef(false);

  const inMeeting = mode === "notes" && meetingRef.current;
  const remote = state.remote_to_local;
  const local = state.local_to_remote;

  /** The microphone lane with the current settings. */
  const micLane = () => lanesRef.current.find((l) => l.direction === "local_to_remote") ?? localLane;

  /** Which microphone to open with what is connected now. */
  const chooseMic = async () => {
    const route = await readRoute();
    routeRef.current = route;
    return meetingMic(route).catch(() => "");
  };

  /** Opens your microphone; `inputDeviceId`, if it was already chosen. @param {string} [inputDeviceId] */
  const startMic = async (inputDeviceId) => {
    await start({ ...micLane(), inputDeviceId: inputDeviceId ?? (await chooseMic()) });
  };

  const startNotes = async () => {
    meetingRef.current = meeting;
    macRan.current = false;
    if (!meeting) {
      if (remoteLane.inputDeviceId === SYSTEM_AUDIO) return start(remoteLane);
      // In person, with Bluetooth headphones, the Mac microphone (`roomMic`).
      return start({ ...remoteLane, inputDeviceId: await roomMic(await readRoute()).catch(() => "") });
    }
    // Your microphone opens before capturing the Mac audio: with the capture
    // just created and nothing playing, Core Audio does not answer until something plays.
    const mic = await chooseMic();
    await startMic(mic);
    await start(remoteLane);
    // Without the Mac audio there is no meeting; without the microphone there is (only the others).
    // The capture is checked, not the state: React has not repainted with `running` yet.
    if (runtime.current.remote_to_local.capture) macRan.current = true;
    else await stop(micLane());
  };

  // The microphone first: while the Mac audio is still running the screen keeps
  // the transcript, so the options do not flash when both have stopped.
  const stopNotes = () => {
    stopping.current = (inMeeting ? stop(localLane) : Promise.resolve()).then(() => stop(remoteLane));
  };

  /** @param {Recorder} recorder @returns {Recorder} */
  const wrapRecorder = (recorder) =>
    mode === "notes" && meetingRef.current
      ? withEchoFilter(recorder, {
          echoPossible: () => echoPossible(routeRef.current),
          macIdle: () => {
            const rt = runtime.current.remote_to_local;
            return !rt.capture?.speaking() && rt.pending === 0;
          },
        })
      : recorder;

  const meetingOn = inMeeting && remote.running;
  useEffect(() => {
    if (!meetingOn) return;
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const route = await readRoute();
        const before = routeRef.current;
        const mic = stateRef.current.local_to_remote;
        const lost = !mic.running && !mic.starting && mic.error === t("app.error.inputLost");
        const moved = Boolean(route && before && route.input_name !== before.input_name);
        // The output can change without touching the input: the echo is decided with the current one.
        if (route) routeRef.current = route;
        if (!lost && !moved) return;
        if (mic.running) await stop(micLane());
        await startMic();
      } finally {
        busy = false;
      }
    }, ROUTE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [meetingOn]);

  const macLost = inMeeting && macRan.current && !remote.running && !remote.starting && local.running;
  useEffect(() => {
    if (macLost) stopNotes();
  }, [macLost]);

  return {
    /** The note-taking in progress (or the last one) is an online meeting. */
    inMeeting,
    startNotes,
    stopNotes,
    wrapRecorder,
    /** The error of your microphone, if it could not be opened and the Mac is still running. */
    micError: inMeeting && remote.running && !local.running && !local.starting ? local.error : null,
  };
}
