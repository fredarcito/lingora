import { api } from "./api";
import { langName, t } from "@i18n";
import { splitWords } from "./words.js";

const SAVE_NOTES_KEY = "lingora.saveNotes";
const SUMMARY_CONSENT_KEY = "lingora.summaryConsent";
const SPEAKERS_KEY = "lingora.speakers";
const NOTES_INPUT_KEY = "lingora.notesInput";
const NOTES_LISTEN_KEY = "lingora.notesListen";
const NOTES_LANG_KEY = "lingora.notesLang";
const NOTES_CAPTIONS_KEY = "lingora.notesCaptions";
const NOTES_CONSENT_KEY = "lingora.notesConsent";
const MY_NAME_KEY = "lingora.myName";
/** Se emite en `window` cuando la nota que se está grabando cambia (frase nueva o persona asignada). */
export const NOTE_CHANGED_EVENT = "lingora-note-changed";
/**
 * Parecido (coseno) a partir del cual dos frases son de la misma persona.
 * En pruebas con 4 voces del Mac en inglés y en español, 0,5 las separó
 * todas; con 0,4 juntaba voces distintas y con 0,6 partía una voz en dos.
 */
const SAME_SPEAKER = 0.5;
/** Con menos audio la huella es poco fiable ("sí", "vale"): va a la persona más parecida. */
const SHORT_SECS = 1.2;
/** Una frase más corta no crea una persona nueva: con audio real, las sueltas eran casi siempre falsas. */
const NEW_SPEAKER_SECS = 2;
/**
 * El repaso al terminar. Con una entrevista real de 55 min (2 personas), en
 * vivo salían 6 "personas" (las de más eran frases sueltas con risas, ruido
 * o dos voces a la vez); tras el repaso, 2, con el 94 % de las frases bien.
 * Quien habla menos de `MIN_SHARE` del tiempo se une a la más parecida, y dos
 * personas cuyas medias se parecen más de `MERGE` son la misma.
 */
const MIN_SHARE = 0.03;
const MERGE = 0.6;
/**
 * En una nota corta el 3 % es poco más de un segundo y el repaso no unía a
 * nadie (1 min de vídeo con 2 personas salía con 7). Quien hable menos que
 * esto en total también se une; a partir de unos 5 min manda `MIN_SHARE`.
 */
const MIN_SPEAKER_SECS = 8;
/** Tiempo máximo entre guardados mientras se graba. */
const SAVE_EVERY_MS = 5000;
/**
 * Al reanudar el guardado, lo que llega en este margen se descarta: es lo que
 * se dijo justo antes, aún sin guardar, y que tardó en traducirse.
 */
const RESUME_GRACE_MS = 2000;
/** Two bookmarks closer than this are one (a double ⌘B). */
const BOOKMARK_REPEAT_SECS = 3;

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

/** Si ya se aceptó que el resumen envíe la transcripción a Groq. */
export function loadSummaryConsent() {
  try {
    return localStorage.getItem(SUMMARY_CONSENT_KEY) === "true";
  } catch {
    return false;
  }
}

export function storeSummaryConsent() {
  try {
    localStorage.setItem(SUMMARY_CONSENT_KEY, "true");
  } catch {
    // Sin almacenamiento se vuelve a preguntar la próxima vez.
  }
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

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/** Id de archivo con la fecha local: "2026-10-29_10-32-05". @param {Date} d */
function localId(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** "29 oct" @param {Date} d */
const dayMonth = (d) => t("notesLib.dayMonth", { day: d.getDate(), month: t("notesLib.months").split(",")[d.getMonth()] });

/** "10:32" @param {Date} d */
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "29 oct · 10:32" @param {string} iso */
export function formatWhen(iso) {
  const d = new Date(iso);
  return `${dayMonth(d)} · ${clock(d)}`;
}

/** "29 oct 2026 · 10:32–11:07 · 35 min" @param {import("./api").Note} note */
export function formatSpan(note) {
  const start = new Date(note.created_at);
  const end = note.ended_at ? new Date(note.ended_at) : null;
  return [`${dayMonth(start)} ${start.getFullYear()}`, end ? `${clock(start)}–${clock(end)}` : clock(start), formatDuration(note)]
    .filter(Boolean)
    .join(" · ");
}

/** "35 min", "45 s" o "" si aún no hay fin. @param {{ created_at: string, ended_at: string | null }} note */
export function formatDuration(note) {
  if (!note.ended_at) return "";
  return formatSecs(Math.max(0, Math.round((Date.parse(note.ended_at) - Date.parse(note.created_at)) / 1000)));
}

/** "35 min" o "45 s". @param {number} secs */
const formatSecs = (secs) => (secs < 60 ? t("notesLib.secs", { n: secs }) : t("notesLib.mins", { n: Math.round(secs / 60) }));

/** "Sin guardar · 2 min": la marca de un rato que no se guardó. @param {number} secs */
export const gapLabel = (secs) => t("notesLib.gap", { time: formatSecs(secs) });

/** "Notas del 29 oct, 10:32" @param {Date} d */
export const notesTitle = (d) => t("notesLib.notesTitle", { date: dayMonth(d), time: clock(d) });

/** "03:25"; los minutos no pasan a horas. @param {number} t */
export function formatClock(t) {
  const s = Math.max(0, Math.floor(t));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
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

/**
 * El nombre que se edita de una persona: el que se le puso, o "" si no tiene.
 * Tú (0) sin nombre en la nota usas el de Ajustes (las notas de antes de ponerlo).
 * @param {import("./api").Note} note @param {number} n
 */
export function speakerName(note, n) {
  return note.speakers?.[n] ?? (n === 0 ? loadMyName() : "");
}

/**
 * Quién habla: nada si no hay personas detectadas; si no, su nombre o
 * "Persona n". Tú (0) eres "Yo", o "Freddy (Yo)" con nombre.
 * @param {import("./api").Note} note @param {import("./api").NoteSentence} s
 */
export function speakerLabel(note, s) {
  if (s.speaker === null || s.speaker === undefined) return "";
  const name = speakerName(note, s.speaker);
  if (s.speaker === 0) return name ? `${name} (${t("notesLib.me")})` : t("notesLib.me");
  return name || t("notesLib.person", { n: s.speaker });
}

/**
 * How much each person said: their share of the words of the note, in whole
 * percents that add up to 100 (largest remainder). Words, not time: the note
 * does not keep how long each sentence lasted, and the words are exact.
 * People not yet told apart (`speaker: null`) are left out.
 * @param {import("./api").Note} note
 * @returns {Map<number, number>}
 */
export function speakerShares(note) {
  /** @type {Map<number, number>} */
  const words = new Map();
  for (const s of note.sentences) {
    if (s.speaker === null || s.speaker === undefined) continue;
    words.set(s.speaker, (words.get(s.speaker) ?? 0) + splitWords(s.source).length);
  }
  const total = [...words.values()].reduce((a, b) => a + b, 0);
  /** @type {Map<number, number>} */
  const shares = new Map();
  if (!total) {
    for (const n of words.keys()) shares.set(n, 0);
    return shares;
  }
  const exact = [...words].map(([n, w]) => ({ n, value: (w / total) * 100 }));
  for (const e of exact) shares.set(e.n, Math.floor(e.value));
  let left = 100 - [...shares.values()].reduce((a, b) => a + b, 0);
  for (const e of [...exact].sort((a, b) => (b.value % 1) - (a.value % 1))) {
    if (left-- <= 0) break;
    shares.set(e.n, /** @type {number} */ (shares.get(e.n)) + 1);
  }
  return shares;
}

/**
 * La nota como texto, igual que el que escribe Rust al exportar (sin `#`
 * en el título): sirve para pegarla en un chat de IA. The user's notes go
 * only with `summary_with_notes`, as in the summary; bookmarks always.
 * @param {import("./api").Note} note
 */
export function noteToText(note) {
  const lines = [note.title, formatSpan(note), ""];
  if (note.summary?.text) lines.push("## Resumen", note.summary.text, "");
  const marks = userMarks(note).filter((m) => m.kind === "bookmark" || note.summary_with_notes);
  if (marks.length) {
    lines.push("## Mis notas");
    for (const m of marks) lines.push(`[${formatClock(m.t)}] ${m.text ?? "(momento marcado)"}`);
    lines.push("");
  }
  lines.push("## Transcripción");
  for (const part of transcriptParts(note)) {
    if ("gap" in part) {
      lines.push(`— ${gapLabel(part.gap)} —`, "");
      continue;
    }
    const block = part.block;
    const who = speakerLabel(note, block[0]);
    lines.push(`[${formatClock(block[0].t)}] ${who ? `${who}: ` : ""}${block.map((s) => s.translation ?? s.source).join(" ")}`);
    if (block.some((s) => s.translation !== null)) lines.push(`(${block.map((s) => s.source).join(" ")})`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Pausa a partir de la cual empieza otro párrafo aunque hable la misma persona. */
const PARAGRAPH_GAP_SECS = 12;
/** Largo a partir del cual se parte un párrafo, para que se pueda leer. */
const PARAGRAPH_CHARS = 700;

/**
 * Junta las frases seguidas de una misma persona en párrafos: la escucha
 * corta por pausas, no por ideas, y una frase por línea se leía a trozos.
 * Empieza otro párrafo al cambiar quien habla, tras una pausa larga o si se
 * hace muy largo. Las mismas reglas que `paragraphs` en notes.rs (exportar).
 * @param {import("./api").NoteSentence[]} sentences
 */
export function paragraphs(sentences) {
  /** @type {import("./api").NoteSentence[][]} */
  const out = [];
  let chars = 0;
  sentences.forEach((s, i) => {
    const prev = sentences[i - 1];
    const text = s.translation ?? s.source;
    const split = !prev || s.speaker !== prev.speaker || s.t - prev.t > PARAGRAPH_GAP_SECS || chars + text.length > PARAGRAPH_CHARS;
    if (split) {
      out.push([s]);
      chars = 0;
    } else out[out.length - 1].push(s);
    chars += text.length + 1;
  });
  return out;
}

/**
 * Los párrafos con los ratos sin guardar en su sitio: un hueco parte el
 * párrafo en el que cae. Igual que `transcript_text` en notes.rs.
 * @param {import("./api").Note} note
 * @returns {({ block: import("./api").NoteSentence[] } | { gap: number })[]}
 */
export function transcriptParts(note) {
  /** @type {Map<number, number>} */
  const gaps = new Map();
  for (const g of note.gaps ?? []) gaps.set(g.at, (gaps.get(g.at) ?? 0) + g.secs);
  /** @type {({ block: import("./api").NoteSentence[] } | { gap: number })[]} */
  const out = [];
  let i = 0;
  for (const block of paragraphs(note.sentences)) {
    /** @type {import("./api").NoteSentence[]} */
    let part = [];
    for (const s of block) {
      if (gaps.has(i)) {
        if (part.length) out.push({ block: part });
        out.push({ gap: /** @type {number} */ (gaps.get(i)) });
        part = [];
      }
      part.push(s);
      i++;
    }
    out.push({ block: part });
  }
  if (gaps.has(i)) out.push({ gap: /** @type {number} */ (gaps.get(i)) });
  return out;
}

/**
 * A note of the user, trimmed and with its first letter in capitals (after an
 * opening "¿", "¡", quote or parenthesis). The rest is left as they wrote it,
 * and so is a word like "iPhone" (second letter in capitals).
 * @param {string} text
 */
export function tidyNote(text) {
  return text.trim().replace(/^([¿¡"'«“(]*)(\p{Ll})(?!\p{Lu})/u, (_, open, letter) => open + letter.toLocaleUpperCase());
}

/**
 * @typedef {{ t: number, kind: "note" | "bookmark", index: number, text: string | null }} UserMark
 * One of the user's notes (`text`) or bookmarks (`text: null`); `index` is its
 * position in `my_notes` or `bookmarks`, to edit or delete it.
 */

/**
 * The user's notes and bookmarks together, in time order. Like
 * `user_marks_text` in notes.rs (export and summary).
 * @param {import("./api").Note} note
 * @returns {UserMark[]}
 */
export function userMarks(note) {
  return [
    ...(note.my_notes ?? []).map((n, index) => ({ t: n.t, kind: /** @type {const} */ ("note"), index, text: n.text })),
    ...(note.bookmarks ?? []).map((b, index) => ({ t: b.t, kind: /** @type {const} */ ("bookmark"), index, text: null })),
  ].sort((a, b) => a.t - b.t);
}

/**
 * The user's marks under the paragraph that was being heard when they were
 * made: from its start until the next one starts. Those before the first
 * paragraph go with it. One list per part of `transcriptParts`; with no
 * paragraphs, all are empty (show `userMarks` on its own).
 * @param {import("./api").Note} note
 * @param {ReturnType<typeof transcriptParts>} parts
 * @returns {UserMark[][]}
 */
export function marksByPart(note, parts) {
  /** @type {UserMark[][]} */
  const out = parts.map(() => []);
  const starts = parts.flatMap((p, i) => ("block" in p ? [{ i, t: p.block[0].t }] : []));
  if (!starts.length) return out;
  for (const mark of userMarks(note)) {
    let at = starts[0].i;
    for (const s of starts) if (s.t <= mark.t) at = s.i;
    out[at].push(mark);
  }
  return out;
}

/**
 * Idioma en que sale el resumen, como lo elige `summary_language` en `notes.rs`:
 * `summary_lang`, si no el de la traducción y, sin ninguno, español.
 * @param {import("./api").Note} note
 * @param {import("./api").LanguageInfo[]} languages
 */
export function summaryLangOf(note, languages) {
  const known = (/** @type {string | undefined} */ code) => (languages.some((l) => l.code === code) ? code : undefined);
  return known(note.summary_lang) ?? known(note.sentences[0]?.target_lang) ?? "es";
}

/**
 * Instrucciones que acompañan a la transcripción al copiarla: piden el resumen en
 * el mismo idioma que el de Lingora.
 * @param {import("./api").Note} note
 * @param {import("./api").LanguageInfo[]} languages
 */
export function summaryPrompt(note, languages) {
  const code = summaryLangOf(note, languages);
  const fallback = languages.find((l) => l.code === code)?.name ?? code;
  return t("notesLib.summaryPrompt", { language: langName(code, fallback, true) });
}

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

/** @param {number[]} a @param {number[]} b */
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** La media normalizada de unas huellas. @param {number[][]} prints */
function centroid(prints) {
  const mean = prints[0].map((_, i) => prints.reduce((n, p) => n + p[i], 0) / prints.length);
  const norm = Math.hypot(...mean) || 1;
  return mean.map((x) => x / norm);
}

/**
 * Agrupa las huellas de voz de una conversación en personas.
 * - En vivo (`add`): cada frase va a la persona más parecida si pasa
 *   `SAME_SPEAKER`; si no, y dura lo bastante, es una persona nueva.
 * - Al terminar (`refine`): con toda la conversación se corrige lo que se
 *   partió de más y se renumera por orden de aparición.
 * Escribe la persona directamente en cada frase de la nota.
 */
export function createSpeakerTracker() {
  /** @type {Array<{ mean: number[], n: number }>} */
  let people = [];
  /** @type {Array<{ entry: import("./api").NoteSentence, print: number[], secs: number }>} */
  const items = [];

  /** La persona más parecida (índice) y cuánto se parece. @param {number[]} print */
  const closest = (print) => {
    let best = -1;
    let score = -Infinity;
    people.forEach((p, i) => {
      const s = cosine(p.mean, print);
      if (s > score) [best, score] = [i, s];
    });
    return { best, score };
  };

  return {
    /** @param {import("./api").NoteSentence} entry @param {number[]} print @param {number} secs */
    add(entry, print, secs) {
      items.push({ entry, print, secs });
      const { best, score } = closest(print);
      if (best >= 0 && secs < SHORT_SECS) {
        entry.speaker = best + 1;
        return;
      }
      if (best >= 0 && score >= SAME_SPEAKER) {
        const p = people[best];
        p.mean = p.mean.map((x, i) => (x * p.n + print[i]) / (p.n + 1));
        p.n += 1;
      } else if (best < 0 || secs >= NEW_SPEAKER_SECS) {
        people.push({ mean: print, n: 1 });
        entry.speaker = people.length;
        return;
      }
      // Parecido a medias o frase corta: a la más parecida, sin moverle la media.
      entry.speaker = best + 1;
    },

    /** Repaso con toda la conversación. */
    refine() {
      if (items.length === 0) return;
      const total = items.reduce((n, x) => n + x.secs, 0) || 1;
      /** @type {number[]} */
      const label = items.map((x) => /** @type {number} */ (x.entry.speaker));
      const groups = () => {
        /** @type {Map<number, { prints: number[][], secs: number }>} */
        const g = new Map();
        items.forEach((x, i) => {
          const k = label[i];
          if (!g.has(k)) g.set(k, { prints: [], secs: 0 });
          const v = /** @type {{ prints: number[][], secs: number }} */ (g.get(k));
          v.prints.push(x.print);
          v.secs += x.secs;
        });
        return [...g].map(([k, v]) => ({ k, secs: v.secs, mean: centroid(v.prints) }));
      };
      /** @param {number} from @param {number} into */
      const relabel = (from, into) => label.forEach((k, i) => k === from && (label[i] = into));

      for (let round = 0; round < 20; round++) {
        const all = groups();
        const big = all.filter((g) => g.secs >= Math.max(MIN_SHARE * total, MIN_SPEAKER_SECS));
        const keep = big.length ? big : [all.reduce((a, b) => (b.secs > a.secs ? b : a))];
        const small = all.filter((g) => !keep.includes(g));
        // Quien casi no habla se une a la persona más parecida.
        if (small.length) {
          for (const g of small) {
            const into = keep.reduce((a, b) => (cosine(g.mean, b.mean) > cosine(g.mean, a.mean) ? b : a));
            relabel(g.k, into.k);
          }
          continue;
        }
        // Dos personas casi iguales son la misma.
        let pair = null;
        for (let i = 0; i < keep.length; i++)
          for (let j = i + 1; j < keep.length; j++) {
            const s = cosine(keep[i].mean, keep[j].mean);
            if (s > MERGE && (!pair || s > pair.s)) pair = { s, a: keep[i].k, b: keep[j].k };
          }
        if (!pair) break;
        relabel(pair.b, pair.a);
      }

      // Cada frase con audio suficiente, a la persona más cercana.
      for (let pass = 0; pass < 2; pass++) {
        const all = groups();
        items.forEach((x, i) => {
          if (x.secs < SHORT_SECS) return;
          label[i] = all.reduce((a, b) => (cosine(x.print, b.mean) > cosine(x.print, a.mean) ? b : a)).k;
        });
      }

      // Persona 1 es la primera que habló.
      /** @type {Map<number, number>} */
      const order = new Map();
      for (const k of label) if (!order.has(k)) order.set(k, order.size + 1);
      items.forEach((x, i) => (x.entry.speaker = /** @type {number} */ (order.get(label[i]))));
      // Lo que llegue después (la cola de voz) sigue con la numeración nueva.
      people = [...order.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => {
          const prints = items.filter((_, i) => label[i] === k).map((x) => x.print);
          return { mean: centroid(prints), n: prints.length };
        });
    },
  };
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
      if (notes) {
        const lang = sentence.source_lang === "zh" ? "zh" : "auto";
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
