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
