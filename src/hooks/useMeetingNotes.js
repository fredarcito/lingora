import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { withEchoFilter } from "../utils/echo.js";
import { SYSTEM_AUDIO } from "../utils/audio.js";
import { ROUTE_CHECK_MS, echoPossible, meetingMic, readRoute, roomMic } from "../utils/route.js";

/**
 * @typedef {import("../App/types").Lane} Lane
 * @typedef {import("../App/types").LaneState} LaneState
 * @typedef {ReturnType<typeof import("../utils/notes.js").createRecorder>} Recorder
 */

/**
 * Tomar notas en una reunión en línea: el audio del Mac (las demás personas)
 * y tu micrófono ("Yo") a la vez, cada uno en su carril.
 * - Al empezar, el micrófono se elige según lo que hay conectado (`meetingMic`).
 * - Durante la reunión, si cambia la entrada por defecto (conectas o quitas
 *   unos AirPods) o se pierde el micrófono, se vuelve a abrir sin parar la nota.
 * - Si se pierde el audio del Mac, la nota termina: también tu micrófono.
 * - `wrapRecorder` pone el filtro de eco delante del grabador.
 * Sin reunión (`meeting` falso) solo se usa el carril del Mac, como siempre; si
 * es el micrófono (en persona), se elige con `roomMic`.
 * @param {{
 *   mode: import("../App/types").Mode,
 *   meeting: boolean,
 *   remoteLane: Lane, localLane: Lane,
 *   state: Record<string, LaneState>,
 *   lanesRef: React.MutableRefObject<Lane[]>,
 *   runtime: React.MutableRefObject<Record<string, { pending: number, capture?: import("../utils/audio").AutoCapture }>>,
 *   start: (lane: Lane) => Promise<void>,
 *   stop: (lane: Lane) => Promise<void>,
 *   stopping: React.MutableRefObject<Promise<void> | null>,
 * }} options
 */
export function useMeetingNotes({ mode, meeting, remoteLane, localLane, state, lanesRef, runtime, start, stop, stopping }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Si la toma de notas en marcha es una reunión en línea (se fija al empezar). */
  const meetingRef = useRef(false);
  /** Lo que hay conectado; null si no se sabe (se trata como altavoces). */
  const routeRef = useRef(/** @type {import("../utils/api").AudioRoute | null} */ (null));
  /** El audio del Mac llegó a arrancar en esta toma de notas (el micrófono se abre antes). */
  const macRan = useRef(false);

  const inMeeting = mode === "notes" && meetingRef.current;
  const remote = state.remote_to_local;
  const local = state.local_to_remote;

  /** El carril del micrófono con los ajustes de ahora. */
  const micLane = () => lanesRef.current.find((l) => l.direction === "local_to_remote") ?? localLane;

  /** Qué micrófono abrir con lo que hay conectado ahora. */
  const chooseMic = async () => {
    const route = await readRoute();
    routeRef.current = route;
    return meetingMic(route).catch(() => "");
  };

  /** Abre tu micrófono; `inputDeviceId`, si ya se eligió. @param {string} [inputDeviceId] */
  const startMic = async (inputDeviceId) => {
    await start({ ...micLane(), inputDeviceId: inputDeviceId ?? (await chooseMic()) });
  };

  const startNotes = async () => {
    meetingRef.current = meeting;
    macRan.current = false;
    if (!meeting) {
      if (remoteLane.inputDeviceId === SYSTEM_AUDIO) return start(remoteLane);
      // En persona, con unos auriculares Bluetooth, el micrófono del Mac (`roomMic`).
      return start({ ...remoteLane, inputDeviceId: await roomMic(await readRoute()).catch(() => "") });
    }
    // Tu micrófono se abre antes de capturar el audio del Mac: con la captura
    // recién creada y nada sonando, Core Audio no contesta hasta que suena algo.
    const mic = await chooseMic();
    await startMic(mic);
    await start(remoteLane);
    // Sin el audio del Mac no hay reunión; sin el micrófono, sí (solo los demás).
    // Se mira la captura, no el estado: React aún no ha repintado con `running`.
    if (runtime.current.remote_to_local.capture) macRan.current = true;
    else await stop(micLane());
  };

  const stopNotes = () => {
    stopping.current = Promise.all([stop(remoteLane), inMeeting && stop(localLane)]).then(() => {});
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
        // La salida puede cambiar sin tocar la entrada: el eco se decide con la de ahora.
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
    /** La toma de notas en marcha (o la última) es una reunión en línea. */
    inMeeting,
    startNotes,
    stopNotes,
    wrapRecorder,
    /** El error de tu micrófono, si no se pudo abrir y el Mac sigue. */
    micError: inMeeting && remote.running && !local.running && !local.starting ? local.error : null,
  };
}
