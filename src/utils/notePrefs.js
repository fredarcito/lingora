// What the user chose for the notes, kept in `localStorage` (`lingora.*`).
// The keys must not be renamed: the settings of whoever already uses the app would be lost.

import { api } from "./api";

const SAVE_NOTES_KEY = "lingora.saveNotes";
const SPEAKERS_KEY = "lingora.speakers";
const NOTES_INPUT_KEY = "lingora.notesInput";
const NOTES_LISTEN_KEY = "lingora.notesListen";
const NOTES_LANG_KEY = "lingora.notesLang";
const NOTES_CAPTIONS_KEY = "lingora.notesCaptions";
const NOTES_CONSENT_KEY = "lingora.notesConsent";
const MY_NAME_KEY = "lingora.myName";

/** Guardar las conversaciones, sí o no (sí por defecto); el almacenamiento puede no estar disponible. */
export function loadSaveNotes() {
  try {
    return localStorage.getItem(SAVE_NOTES_KEY) !== "false";
  } catch {
    return true;
  }
}

/** @param {boolean} on */
export function storeSaveNotes(on) {
  try {
    localStorage.setItem(SAVE_NOTES_KEY, String(on));
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}

/** Distinguir personas en las notas, sí o no (sí por defecto). */
export function loadSpeakers() {
  try {
    return localStorage.getItem(SPEAKERS_KEY) !== "false";
  } catch {
    return true;
  }
}

/** @param {boolean} on */
export function storeSpeakers(on) {
  try {
    localStorage.setItem(SPEAKERS_KEY, String(on));
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}

/** @type {Promise<void> | null} */
let speakersDownload = null;

/**
 * Downloads the speakers add-on in the background if it is on and missing
 * (the welcome screen was skipped, or it predates the add-on). Only one
 * download at a time; if it fails, the next call tries again.
 * @returns {Promise<void>}
 */
export function ensureSpeakers() {
  if (!loadSpeakers()) return Promise.resolve();
  speakersDownload ??= api
    .setupStatus()
    .then((list) => {
      if (list.some((m) => m.id === "speakers" && !m.installed)) return api.downloadModel("speakers", () => {});
    })
    .catch((e) => console.warn("[lingora] could not download the speakers add-on:", e))
    .finally(() => (speakersDownload = null));
  return speakersDownload;
}

/**
 * Tomar notas: qué se escucha. `"meeting"` (reunión en línea: el audio del
 * Mac y tu micrófono a la vez, por defecto), `"system"` (solo el audio del
 * Mac) o `"mic"`.
 * @typedef {"meeting" | "system" | "mic"} NotesInput
 * @returns {NotesInput}
 */
export function loadNotesInput() {
  try {
    const saved = localStorage.getItem(NOTES_INPUT_KEY);
    return saved === "mic" || saved === "system" ? saved : "meeting";
  } catch {
    return "meeting";
  }
}

/** @param {NotesInput} value */
export function storeNotesInput(value) {
  try {
    localStorage.setItem(NOTES_INPUT_KEY, value);
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}

/**
 * Tomar notas: la familia de idiomas de la reunión; `"EN"` es la escucha
 * europea (detecta sola) y `"ZH"` la de chino, japonés, coreano y cantonés.
 * @returns {"EN" | "ZH"}
 */
export function loadNotesListen() {
  try {
    return localStorage.getItem(NOTES_LISTEN_KEY) === "ZH" ? "ZH" : "EN";
  } catch {
    return "EN";
  }
}

/** @param {"EN" | "ZH"} value */
export function storeNotesListen(value) {
  try {
    localStorage.setItem(NOTES_LISTEN_KEY, value);
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}

/** Tomar notas: el idioma del resumen (español por defecto). */
export function loadNotesLang() {
  try {
    return localStorage.getItem(NOTES_LANG_KEY) || "es";
  } catch {
    return "es";
  }
}

/** @param {string} code */
export function storeNotesLang(code) {
  try {
    localStorage.setItem(NOTES_LANG_KEY, code);
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}

/**
 * Take notes: the language of the floating captions. `"original"` (what is
 * heard, untranslated, by default) or the code of a language to translate
 * the others into. The note always keeps the original.
 * @typedef {"original" | string} NotesCaptions
 * @returns {NotesCaptions}
 */
export function loadNotesCaptions() {
  try {
    const saved = localStorage.getItem(NOTES_CAPTIONS_KEY);
    return saved && saved !== "off" ? saved : "original";
  } catch {
    return "original";
  }
}

/** @param {NotesCaptions} value */
export function storeNotesCaptions(value) {
  try {
    localStorage.setItem(NOTES_CAPTIONS_KEY, value);
  } catch {
    // Without storage it only lasts this session.
  }
}

/** Si ya se mostró el aviso de privacidad de Tomar notas. */
export function loadNotesConsent() {
  try {
    return localStorage.getItem(NOTES_CONSENT_KEY) === "true";
  } catch {
    return false;
  }
}

export function storeNotesConsent() {
  try {
    localStorage.setItem(NOTES_CONSENT_KEY, "true");
  } catch {
    // Sin almacenamiento se vuelve a avisar la próxima vez.
  }
}
/**
 * Tu nombre, para marcar tu micrófono en las notas ("Freddy (Yo)"); "" sin él.
 * @returns {string}
 */
export function loadMyName() {
  try {
    return localStorage.getItem(MY_NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** @param {string} name */
export function storeMyName(name) {
  try {
    localStorage.setItem(MY_NAME_KEY, name.trim());
  } catch {
    // Sin almacenamiento solo dura esta sesión.
  }
}
