// The note being written: the recorder that saves a conversation sentence by
// sentence, and the access to it for the screens that show or rename it live.

import { api } from "./api";
import { t } from "@i18n";
import { loadMyName } from "./notePrefs.js";
import { clock, dayMonth, localId, notesTitle, tidyNote } from "./notes.js";
import { createSpeakerTracker } from "./speakers.js";

/** Se emite en `window` cuando la nota que se está grabando cambia (frase nueva o persona asignada). */
export const NOTE_CHANGED_EVENT = "lingora-note-changed";
/** Tiempo máximo entre guardados mientras se graba. */
const SAVE_EVERY_MS = 5000;
/**
 * Al reanudar el guardado, lo que llega en este margen se descarta: es lo que
 * se dijo justo antes, aún sin guardar, y que tardó en traducirse.
 */
const RESUME_GRACE_MS = 2000;
/** Two bookmarks closer than this are one (a double ⌘B). */
const BOOKMARK_REPEAT_SECS = 3;

/**
 * Id de la nota que se está grabando ahora (null si aún no hay ninguna frase),
 * y el grabador que la escribe, para que la pantalla de notas no pelee con él
 * al renombrarla o borrarla.
 * @type {{ id: string, setTitle: (title: string) => void, setSummary: (summary: import("./api").Note["summary"]) => void, discard: () => void, get: () => import("./api").Note } | null}
 */
let active = null;

/** @returns {string | null} */
export const activeNoteId = () => active?.id ?? null;

/**
 * Copia de la nota que se está grabando (null si aún no hay ninguna frase).
 * Sigue ahí tras parar, para el resumen y las frases tardías: quien la lea
 * en vivo debe comprobar que es de su sesión (`created_at`).
 * @returns {import("./api").Note | null}
 */
export const getActiveNote = () => active?.get() ?? null;

/** @param {string} id @param {string} title */
export function renameActive(id, title) {
  if (active?.id === id) active.setTitle(title);
}

/**
 * El resumen lo guarda Rust directamente; el grabador, que reescribe la nota
 * desde su copia, tiene que enterarse para no perderlo.
 * @param {string} id @param {import("./api").Note["summary"]} summary
 */
export function setActiveSummary(id, summary) {
  if (active?.id === id) active.setSummary(summary);
}

/** @param {string} id */
export function discardActive(id) {
  if (active?.id === id) active.discard();
}
/**
 * Graba una conversación en disco, frase a frase. Sin frases no hay archivo.
 * Guarda como mucho cada 5 s; un fallo al guardar se avisa en consola y no
 * interrumpe la traducción. Tras `finish` sigue aceptando frases (la cola de
 * voz tarda en vaciarse): las añade y vuelve a guardar.
 * En modo `notes` (Tomar notas) la nota es `kind: "notes"`, con el idioma del
 * resumen en `summary_lang` y las frases sin traducir ni idioma fijo.
 * Con `paused` empieza sin guardar; `setSaving` lo pausa y reanuda a mitad, y
 * cada rato sin guardar queda en `note.gaps` para marcarlo en la transcripción.
 * @param {{ mode: "video" | "call" | "notes", summaryLang?: string, paused?: boolean }} options
 */
export function createRecorder({ mode, summaryLang = "es", paused = false }) {
  const notes = mode === "notes";
  /** @type {import("./api").Note | null} */
  let note = null;
  let startedAt = 0;
  /** @type {number | null} */
  let timer = null;
  let discarded = false;
  const speakers = createSpeakerTracker();
  // Las huellas llegan en orden: cada frase espera a la anterior para que
  // "Persona 1" sea siempre la primera que habló.
  let labeling = Promise.resolve();
  // Desde cuándo no se guarda y cuándo se reanudó (para el margen de reanudar).
  let pausedAt = performance.now();
  let resumedAt = -Infinity;

  const changed = () => window.dispatchEvent(new Event(NOTE_CHANGED_EVENT));

  // Deja en la nota el rato sin guardar. Antes de la primera frase no hay nota
  // ni nada que marcar.
  const closeGap = () => {
    if (!note) return;
    (note.gaps ??= []).push({ at: note.sentences.length, secs: Math.max(1, Math.round((performance.now() - pausedAt) / 1000)) });
  };

  const save = async () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (!note || discarded) return;
    try {
      await api.noteSave(note);
    } catch (e) {
      console.warn("[lingora] no se pudo guardar la nota:", e);
    }
  };

  // The note is created with the first sentence or, in Take notes, with the
  // user's first note or bookmark. `heardAt` (performance.now()) is its zero.
  /** @param {Date} now @param {number} heardAt */
  const ensureNote = (now, heardAt) => {
    if (note) return;
    startedAt = heardAt;
    note = {
      version: 1,
      id: localId(now),
      title: notes ? notesTitle(now) : t("notesLib.convTitle", { date: dayMonth(now), time: clock(now) }),
      created_at: now.toISOString(),
      ended_at: now.toISOString(),
      mode,
      ...(notes && { kind: "notes", summary_lang: summaryLang }),
      // Tu nombre va en la nota: así lo usan también la exportación y el resumen.
      speakers: loadMyName() ? { 0: loadMyName() } : {},
      sentences: [],
      summary: null,
    };
    active = {
      id: note.id,
      setTitle: (title) => note && (note.title = title),
      setSummary: (summary) => note && (note.summary = summary),
      discard: () => (discarded = true),
      get: () => ({
        ...note,
        sentences: note.sentences.map((s) => ({ ...s })),
        ...(note.my_notes && { my_notes: note.my_notes.map((n) => ({ ...n })) }),
        ...(note.bookmarks && { bookmarks: note.bookmarks.map((b) => ({ ...b })) }),
      }),
    };
  };

  /** Seconds since the note's zero, one decimal. @param {number} when performance.now() */
  const secsAt = (when) => Math.max(0, Math.round((when - startedAt) / 100) / 10);

  // A change by the user: saved with the same timer as sentences.
  const touched = () => {
    if (note) note.ended_at = new Date().toISOString();
    if (timer === null) timer = window.setTimeout(save, SAVE_EVERY_MS);
    changed();
  };

  return {
    /**
     * `voice`: la huella de la frase y su duración, para saber quién habla.
     * Sin ella (o si falla) la frase queda sin persona.
     * `info`: el trozo de audio; con él la hora es la de cuando terminó de
     * oírse, no la de cuando llega el texto, y la frase se coloca en su sitio
     * (con dos fuentes a la vez, una corta puede llegar antes que otra
     * anterior).
     * @param {Omit<import("./api").NoteSentence, "t" | "speaker">} sentence
     * @param {{ print: Promise<number[]>, secs: number } | null} [voice]
     * @param {import("./audio").SegmentInfo} [info]
     */
    add(sentence, voice = null, info) {
      if (discarded || paused || performance.now() - resumedAt < RESUME_GRACE_MS) return;
      const now = new Date();
      const heardAt = info?.endedAt ?? performance.now();
      ensureNote(now, heardAt);
      if (!note) return;
      /** @type {import("./api").NoteSentence} */
      // Tomar notas no fija el idioma: "auto" (escucha europea) o "zh".
      // With Chinese captions the Chinese family listens as "ja" (see `notesListenCode`).
      if (notes) {
        const lang = sentence.source_lang === "zh" || sentence.source_lang === "ja" ? "zh" : "auto";
        sentence = { ...sentence, source_lang: lang, target_lang: lang, translation: null };
      }
      const entry = { ...sentence, t: secsAt(heardAt), speaker: null };
      let at = note.sentences.length;
      while (at > 0 && note.sentences[at - 1].t > entry.t) at--;
      note.sentences.splice(at, 0, entry);
      // Los ratos sin guardar se marcan por posición: los de después se corren uno.
      for (const gap of note.gaps ?? []) if (gap.at > at) gap.at++;
      note.ended_at = now.toISOString();
      // Lo que dices tú (el micrófono, en una llamada) es siempre "Yo".
      if (sentence.direction === "local_to_remote") entry.speaker = 0;
      else if (voice) {
        labeling = labeling.then(() =>
          voice.print.then(
            (print) => {
              speakers.add(entry, print, voice.secs);
              changed();
              if (timer === null) timer = window.setTimeout(save, SAVE_EVERY_MS);
            },
            () => {},
          ),
        );
      }
      if (timer === null) timer = window.setTimeout(save, SAVE_EVERY_MS);
      changed();
    },
    /**
     * Guarda ya; una nota vacía no escribe nada. Devuelve el id de la nota,
     * o null si quedó vacía.
     * @returns {Promise<string | null>}
     */
    /**
     * One of the user's notes (Take notes). Its time is `startedTyping`
     * (performance.now()): they write about what was just said.
     * @param {string} text @param {number} startedTyping
     */
    addMyNote(text, startedTyping) {
      const clean = tidyNote(text);
      if (discarded || !clean) return;
      ensureNote(new Date(), startedTyping);
      if (!note) return;
      const entry = { t: secsAt(startedTyping), text: clean };
      const list = (note.my_notes ??= []);
      let at = list.length;
      while (at > 0 && list[at - 1].t > entry.t) at--;
      list.splice(at, 0, entry);
      touched();
    },
    /** Empty text deletes it. @param {number} index @param {string} text */
    editMyNote(index, text) {
      const entry = note?.my_notes?.[index];
      if (discarded || !entry) return;
      const clean = tidyNote(text);
      if (clean) entry.text = clean;
      else note?.my_notes?.splice(index, 1);
      touched();
    },
    /** @param {number} index */
    removeMyNote(index) {
      if (discarded || !note?.my_notes?.[index]) return;
      note.my_notes.splice(index, 1);
      touched();
    },
    /** Marks this moment; a second one within `BOOKMARK_REPEAT_SECS` is ignored (double ⌘B). */
    addBookmark() {
      if (discarded) return;
      const at = performance.now();
      ensureNote(new Date(), at);
      if (!note) return;
      const t = secsAt(at);
      const list = (note.bookmarks ??= []);
      if (list.some((b) => Math.abs(b.t - t) < BOOKMARK_REPEAT_SECS)) return;
      list.push({ t });
      list.sort((a, b) => a.t - b.t);
      touched();
    },
    /** @param {number} index */
    removeBookmark(index) {
      if (discarded || !note?.bookmarks?.[index]) return;
      note.bookmarks.splice(index, 1);
      touched();
    },
    /** Si se está guardando lo que llega. */
    get saving() {
      return !paused;
    },
    /**
     * Pausa o reanuda el guardado. Al pausar se descarta también lo que aún
     * se está traduciendo; al reanudar sigue la misma nota.
     * @param {boolean} on
     */
    setSaving(on) {
      if (on === !paused) return;
      if (on) {
        closeGap();
        resumedAt = performance.now();
        if (note && timer === null) timer = window.setTimeout(save, SAVE_EVERY_MS);
      } else pausedAt = performance.now();
      paused = !on;
      changed();
    },
    finish() {
      if (paused) {
        closeGap();
        pausedAt = performance.now();
      }
      if (note) note.ended_at = new Date().toISOString();
      return labeling.then(async () => {
        speakers.refine();
        changed();
        await save();
        return note && !discarded ? note.id : null;
      });
    },
  };
}
