// A note as data: its dates and names as text, its paragraphs, the user's
// marks and what its summary needs. What writes it is in `noteRecorder.js`.

import { langName, t } from "@i18n";
import { splitWords } from "./words.js";
import { loadMyName } from "./notePrefs.js";

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/** Id de archivo con la fecha local: "2026-10-29_10-32-05". @param {Date} d */
export function localId(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** "29 oct" @param {Date} d */
export const dayMonth = (d) => t("notesLib.dayMonth", { day: d.getDate(), month: t("notesLib.months").split(",")[d.getMonth()] });

/** "10:32" @param {Date} d */
export const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

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

/** Summary templates, in the order of the selector. Same ids as `SUMMARY_TEMPLATES` in `notes.rs`. */
export const SUMMARY_TEMPLATES = ["general", "team", "one_on_one", "client", "interview", "class", "executive"];

/**
 * The template for the next summary: the one chosen for this note, else
 * General. Unknown ids (from a newer version) count as General, like in `notes.rs`.
 * @param {import("./api").Note} note
 */
export function summaryTemplateOf(note) {
  const id = note.summary_template;
  return id && SUMMARY_TEMPLATES.includes(id) ? id : "general";
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
