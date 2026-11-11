import { useEffect, useLayoutEffect, useState } from "react";
import { createRecorder } from "@utils/noteRecorder.js";
import { loadNotesLang, loadSaveNotes, storeSaveNotes } from "@utils/notePrefs.js";

/** @typedef {ReturnType<typeof createRecorder>} Recorder */

/** Tope de espera a que termine la cola de Tomar notas antes de cerrar la nota. */
const NOTES_SETTLE_MS = 20_000;

/**
 * The note of what is being translated or heard: a new one starts each time
 * something starts running, and it is saved when everything stops.
 * - `saveNotes` / `changeSaveNotes`: the card's "Save to notes" switch.
 * - `notesActions`: what the My notes panel of Take notes asks of the recorder.
 * - `closing`: Take notes is waiting for the queue to close its note.
 * @param {{
 *   recorderRef: React.MutableRefObject<Recorder | null>,
 *   mode: import("@app/types").Mode,
 *   anyRunning: boolean,
 *   anyRunningRef: React.MutableRefObject<boolean>,
 *   view: import("@components/Sidebar").View,
 *   runtime: React.MutableRefObject<Record<string, { texting: Promise<unknown>, playback: Promise<unknown> }>>,
 *   stopping: React.MutableRefObject<Promise<void> | null>,
 *   wrapRecorder: (recorder: Recorder) => Recorder,
 *   onSaved: (id: string) => void,
 * }} options `stopping` is the stop in progress of Take notes; `wrapRecorder`, from
 *   `useMeetingNotes`; `onSaved` gets the note that Take notes just closed.
 */
export function useNoteRecorder({ recorderRef, mode, anyRunning, anyRunningRef, view, runtime, stopping, wrapRecorder, onSaved }) {
  // Stable, for ⌘B.
  const [notesActions] = useState(() => ({
    /** @param {string} text @param {number} startedTyping */
    addMyNote: (text, startedTyping) => recorderRef.current?.addMyNote(text, startedTyping),
    /** @param {number} index @param {string} text */
    editMyNote: (index, text) => recorderRef.current?.editMyNote(index, text),
    /** @param {number} index */
    removeMyNote: (index) => recorderRef.current?.removeMyNote(index),
    addBookmark: () => recorderRef.current?.addBookmark(),
    /** @param {number} index */
    removeBookmark: (index) => recorderRef.current?.removeBookmark(index),
  }));
  // Cerrando la nota de Tomar notas (esperando a la cola).
  const [closing, setClosing] = useState(false);
  // «Guardar en notas» de la tarjeta: parado es el ajuste de siempre; en marcha
  // pausa y reanuda la nota en curso sin cambiar el ajuste.
  const [saveNotes, setSaveNotes] = useState(loadSaveNotes);
  /** @param {boolean} on */
  const changeSaveNotes = (on) => {
    setSaveNotes(on);
    if (recorderRef.current && anyRunningRef.current) recorderRef.current.setSaving(on);
    else storeSaveNotes(on);
  };

  // Al parar (o al volver de Ajustes), el interruptor vuelve al ajuste guardado.
  useEffect(() => {
    if (!anyRunning) setSaveNotes(loadSaveNotes());
  }, [anyRunning, view]);

  // Cada vez que algo se pone en marcha empieza una nota nueva; al parar se
  // guarda (las frases que aún suenan en la cola se añaden después).
  // En Tomar notas la nota se graba siempre, y al parar se espera a que la cola
  // termine (con tope) para cerrarla y abrirla ya completa y con las personas repasadas.
  // Antes de pintar: si no, al parar asoman un instante las opciones de Tomar notas.
  useLayoutEffect(() => {
    if (anyRunning) {
      const recorder = createRecorder({ mode, summaryLang: loadNotesLang(), paused: mode !== "notes" && !loadSaveNotes() });
      // Reunión en línea: lo que tu micrófono oyó de los demás no es tuyo.
      recorderRef.current = wrapRecorder(recorder);
      return;
    }
    const recorder = recorderRef.current;
    if (mode !== "notes") {
      recorder?.finish();
      return;
    }
    if (!recorder) return;
    // En una reunión en línea también el micrófono.
    const rts = [runtime.current.remote_to_local, runtime.current.local_to_remote];
    setClosing(true);
    const settled = (async () => {
      // `capture.stop()` entrega el último trozo; después, lo que ya encadena el carril.
      await stopping.current;
      await Promise.all(rts.flatMap((rt) => [rt.texting, rt.playback]));
    })();
    let timer = 0;
    const cap = new Promise((resolve) => (timer = window.setTimeout(resolve, NOTES_SETTLE_MS)));
    Promise.race([settled, cap])
      .then(() => {
        window.clearTimeout(timer);
        return recorder.finish();
      })
      .then((id) => {
        // Sin frases no hay nota: se queda en la pantalla del modo.
        if (!id) return;
        onSaved(id);
      })
      // Después de cambiar de pantalla: si no, las opciones de Tomar notas asoman un instante.
      .finally(() => setClosing(false));
  }, [anyRunning]);

  return { notesActions, saveNotes, changeSaveNotes, closing };
}
