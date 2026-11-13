// The chat with a note as data: the messages, the times in an answer and
// what is sent to the model. Pure functions; the state is in hooks/useNoteChat.

import { clockSecs } from "@utils/mindMap.js";

/** @typedef {{ role: "user" | "assistant", text: string, at: string }} ChatMessage */

/** The empty state's suggestions: each id has its text in `chat.suggest.<id>`. */
export const SUGGESTIONS = ["keyPoints", "tasks", "people"];

/** Above this many messages, the oldest are not sent (the service's context is not endless). */
export const MAX_HISTORY = 40;

/**
 * A message as it is saved in the note.
 * @param {"user" | "assistant"} role @param {string} text @param {Date} [now]
 * @returns {ChatMessage}
 */
export function newMessage(role, text, now = new Date()) {
  return { role, text, at: now.toISOString() };
}

/**
 * What goes to the model: the history word for word (so what it already read
 * is reused) and the new question last. A question whose answer was stopped
 * before it wrote anything goes out too, but without that empty answer, which
 * some services refuse.
 * @param {ChatMessage[]} messages The chat, ending with the new question.
 * @returns {{ role: "user" | "assistant", text: string }[]}
 */
export function requestTurns(messages) {
  const kept = messages.filter((m, i) => !(m.role === "assistant" && !m.text.trim()) && !(m.role === "user" && messages[i + 1]?.role === "assistant" && !messages[i + 1].text.trim()));
  let turns = kept.map(({ role, text }) => ({ role, text }));
  if (turns.length > MAX_HISTORY) {
    turns = turns.slice(-MAX_HISTORY);
    while (turns.length > 1 && turns[0].role !== "user") turns.shift();
  }
  return turns;
}

const TIME = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/**
 * The text of an answer split into plain pieces and the `[mm:ss]` times it
 * cites, with their seconds, so a time can be a link to the transcript.
 * @param {string} text
 * @returns {(string | { clock: string, secs: number })[]}
 */
export function splitTimes(text) {
  /** @type {(string | { clock: string, secs: number })[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TIME)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ clock: m[1], secs: clockSecs(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The times that close a line of an answer (`Escucha frecuente [00:40]`,
 * `… [01:20], [02:05].`), apart from its text, so they can be drawn at the
 * end of the line. A line made only of times keeps them in the text.
 * @param {string} text
 * @returns {{ text: string, times: { clock: string, secs: number }[] }}
 */
export function trailingTimes(text) {
  const tail = text.match(/(?:[\s,;]*\[\d{1,2}:\d{2}(?::\d{2})?\])+[.;]?\s*$/);
  if (!tail || tail.index === 0) return { text, times: [] };
  const times = [...tail[0].matchAll(TIME)].map((m) => ({ clock: m[1], secs: clockSecs(m[1]) }));
  return { text: text.slice(0, tail.index).replace(/[\s—–-]+$/, ""), times };
}

/**
 * The suggestions not asked yet in this chat, in their order.
 * @param {{ id: string, label: string }[]} options @param {ChatMessage[]} messages
 */
export function unaskedSuggestions(options, messages) {
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.text.trim()));
  return options.filter((o) => !asked.has(o.label));
}

/** The time of day of a message (`17:02`), in the system's format; empty if unknown. @param {string | undefined} at */
export function messageTime(at) {
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

/**
 * What to show of an answer still being written: without a `**` still open
 * (it would show the asterisks until it closes) nor a time half written at
 * the end (`[01:`), which becomes a link once complete.
 * @param {string} text
 */
export function streamingView(text) {
  let out = text.replace(/\[\d{0,2}(?::\d{0,2}){0,2}$/, "");
  const marks = out.match(/\*\*/g)?.length ?? 0;
  if (marks % 2 === 1) {
    const at = out.lastIndexOf("**");
    out = out.slice(0, at) + out.slice(at + 2);
  }
  return out;
}

// ---------- The chat with all the notes ----------

/**
 * An all-notes answer also keeps what it was built from, to show its sources.
 * @typedef {{ n: number, id: string, title: string, date: string }} UsedNote
 * @typedef {{ n: number, at: number | null }} Citation
 * @typedef {ChatMessage & { notes?: UsedNote[], citations?: Citation[], overview?: boolean,
 *   basis?: { shown: number, total: number } | null, notice?: string }} AllChatMessage
 * @typedef {{ id: string, title: string, created_at: string, updated_at: string, messages: AllChatMessage[] }} SavedChat
 */

/** The Chat page's suggestions: each id has its text in `chat.all.suggest.<id>`; one ending in «…» is completed by the user. */
export const ALL_SUGGESTIONS = ["week", "yesterday", "person"];

/** A chat's title is its first question, up to this many characters. */
export const TITLE_CHARS = 60;

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** The local date, `2026-11-13`: what «hoy», «ayer» and «esta semana» are counted from. @param {Date} [now] */
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A new chat's id: its local start time, `2026-11-13_18-55-02` (a file name, like the notes'). @param {Date} [now] */
export function newChatId(now = new Date()) {
  return `${localDate(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/** The title of a chat from its first question: one line, cut at a word. @param {string} question */
export function chatTitle(question) {
  const line = question.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:—–-]+$/, "")}…`;
}

/**
 * The saved chats in the side list's groups, keeping their order (newest first).
 * @template {{ updated_at: string }} C
 * @param {C[]} chats @param {Date} [now]
 * @returns {{ group: "today" | "yesterday" | "week" | "older", chats: C[] }[]}
 */
export function chatGroups(chats, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  /** @param {string} iso */
  const groupOf = (iso) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "older";
    if (t >= midnight) return "today";
    if (t >= midnight - day) return "yesterday";
    if (t >= midnight - 6 * day) return "week";
    return "older";
  };
  /** @type {{ group: "today" | "yesterday" | "week" | "older", chats: C[] }[]} */
  const out = [];
  for (const chat of chats) {
    const group = groupOf(chat.updated_at);
    const last = out[out.length - 1];
    if (last?.group === group) last.chats.push(chat);
    else out.push({ group, chats: [chat] });
  }
  return out;
}

const CITE = /\[(?:(?:nota|note)\s*(\d+)\s*(?:[,·:;–—-]\s*)?)?(\d{1,2}:\d{2}(?::\d{2})?)?\]/gi;

/**
 * An all-notes answer split into plain text and the citations in it:
 * `[Nota 2, 12:40]` (a moment of a note), `[Nota 2]` (the note) and a bare
 * `[12:40]` (no note: only usable when the answer had one note).
 * @param {string} text
 * @returns {(string | { raw: string, n: number | null, clock: string | null, secs: number | null })[]}
 */
export function splitCitations(text) {
  /** @type {(string | { raw: string, n: number | null, clock: string | null, secs: number | null })[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    if (!m[1] && !m[2]) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ raw: m[0], n: m[1] ? Number(m[1]) : null, clock: m[2] ?? null, secs: m[2] ? clockSecs(m[2]) : null });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Whether a citation in the text is one the app checked (it was given to the model).
 * @param {Citation[]} citations @param {number} n @param {number | null} secs
 */
export function isCheckedCitation(citations, n, secs) {
  return citations.some((c) => c.n === n && (secs === null ? c.at === null : c.at !== null && Math.abs(c.at - secs) < 1));
}

/**
 * The source chips under an answer: one per checked moment, and one per
 * note given that it didn't cite (the sources show even if the model forgot).
 * @param {UsedNote[]} notes @param {Citation[]} citations
 * @returns {(UsedNote & { at: number | null })[]}
 */
export function sourceChips(notes, citations) {
  return notes.flatMap((note) => {
    const times = [...new Set(citations.filter((c) => c.n === note.n && c.at !== null).map((c) => /** @type {number} */ (c.at)))].sort((a, b) => a - b);
    return times.length ? times.map((at) => ({ ...note, at })) : [{ ...note, at: null }];
  });
}

/** `[Nota 2, 12:` half written at the end of an answer: hidden until complete. @param {string} text */
export function streamingCitesView(text) {
  return streamingView(text.replace(/\[(?:n|no|not|nota?|note)(?:\s*\d*\s*[,·]?\s*\d{0,2}(?::\d{0,2}){0,2})?$/i, ""));
}

/**
 * The citations that close a line of an all-notes answer (`Bocetos [Nota 1, 01:10]`,
 * `… [Nota 2, 00:20], [Nota 3].`), apart from its text, so they can be drawn
 * at the end of the line like the note chat's times. A line made only of
 * citations keeps them in the text.
 * @param {string} text
 * @returns {{ text: string, cites: { raw: string, n: number | null, clock: string | null, secs: number | null }[] }}
 */
export function trailingCitations(text) {
  const tail = text.match(/(?:[\s,;]*\[(?:(?:nota|note)\s*\d+\s*(?:[,·:;–—-]\s*)?)?(?:\d{1,2}:\d{2}(?::\d{2})?)?\])+[.;]?\s*$/i);
  if (!tail || tail.index === 0) return { text, cites: [] };
  const cites = splitCitations(tail[0]).filter((p) => typeof p !== "string");
  if (cites.length === 0) return { text, cites: [] };
  return { text: text.slice(0, tail.index).replace(/[\s—–-]+$/, ""), cites: /** @type {any} */ (cites) };
}
