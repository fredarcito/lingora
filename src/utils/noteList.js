import { formatWhen } from "./notes.js";

/**
 * Pure helpers for the notes list: dates, grouping, filters and search.
 * They used to live in `pages/Notes`.
 */

/** How often what is being recorded is refreshed (list and open note). */
export const NOTES_REFRESH_MS = 3000;

/**
 * "ES → EN", or "ES" if it was not translated. Take notes has no fixed language and the
 * notes saved before do not have it: then null.
 * @param {import("./api").NoteSummary} n
 */
export function langPair(n) {
  const { source_lang: from, target_lang: to } = n;
  if (n.kind === "notes" || !from || !to) return null;
  return from === to ? from.toUpperCase() : `${from.toUpperCase()} → ${to.toUpperCase()}`;
}

/**
 * Days between the date and today, counting calendar days (today = 0).
 * @param {Date} date @param {Date} [now]
 */
export function daysAgo(date, now = new Date()) {
  const day = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(now) - day(date)) / 86_400_000);
}

/** "2026-09": the month of a date, to group and filter. @param {Date} d */
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** @param {string} text */
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Without accents and in lowercase, so that «sabado» finds «sábado». @param {string} text */
export const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * @typedef {Object} DateFormats
 * @property {Intl.DateTimeFormat} weekday "jueves, 29 de octubre"
 * @property {Intl.DateTimeFormat} day "lunes"
 * @property {Intl.DateTimeFormat} short "28 sept"
 * @property {Intl.DateTimeFormat} month "octubre"
 * @property {Intl.DateTimeFormat} monthYear "septiembre de 2026"
 */

/** The date formats of the list, in the interface language. @param {string} lang @returns {DateFormats} */
export function dateFormats(lang) {
  return {
    weekday: new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }),
    day: new Intl.DateTimeFormat(lang, { weekday: "long" }),
    short: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }),
    month: new Intl.DateTimeFormat(lang, { month: "long" }),
    monthYear: new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }),
  };
}

/**
 * Name of a month for the separator and the filter: "Octubre" or, if it is from another
 * year, "Septiembre de 2025".
 * @param {string} key "2026-09" @param {DateFormats} formats @param {Date} [now]
 */
export function monthLabel(key, formats, now = new Date()) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return capitalize((year === now.getFullYear() ? formats.month : formats.monthYear).format(date));
}

/**
 * The note separator: "Hoy · jueves, 29 de octubre", "Ayer · …",
 * "Esta semana" and, from there back, the month. This way a list of months does not
 * fill up with day headers.
 * @param {string} iso @param {DateFormats} formats @param {import("../i18n").t} t @param {Date} [now]
 */
export function groupLabel(iso, formats, t, now = new Date()) {
  const date = new Date(iso);
  const diff = daysAgo(date, now);
  const full = formats.weekday.format(date);
  if (diff === 0) return t("notes.today", { date: full });
  if (diff === 1) return t("notes.yesterday", { date: full });
  if (diff < 7) return t("notes.thisWeek");
  return monthLabel(monthKey(date), formats, now);
}

/**
 * Whether the note falls in the chosen period: "all", "week" (the last 7 days),
 * "month" (this month), "last" (last month) or "m:2026-08".
 * @param {string} iso @param {string} period @param {Date} [now]
 */
export function inPeriod(iso, period, now = new Date()) {
  const date = new Date(iso);
  if (period === "week") return daysAgo(date, now) < 7;
  if (period === "month") return monthKey(date) === monthKey(now);
  if (period === "last") return monthKey(date) === monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (period.startsWith("m:")) return monthKey(date) === period.slice(2);
  return true;
}

/** "10:32 – 11:07", or just "10:32" if it is still recording. @param {import("./api").NoteSummary} n @param {boolean} live */
export function timeRange(n, live) {
  const start = formatWhen(n.created_at).split(" · ")[1];
  if (live || !n.ended_at) return start;
  return `${start} – ${formatWhen(n.ended_at).split(" · ")[1]}`;
}

/**
 * What the search box finds for a note: title, text and its date written
 * in several ways ("jueves", "28 oct", "septiembre de 2026"), folded.
 * @param {import("./api").NoteSummary} n @param {DateFormats} formats
 */
export function haystack(n, formats) {
  const d = new Date(n.created_at);
  return fold(`${n.title} ${n.preview} ${n.summary_line ?? ""} ${formats.weekday.format(d)} ${formats.short.format(d)} ${formats.monthYear.format(d)}`);
}

/**
 * Months with notes, from newest to oldest, leaving out this one and last month (they
 * already have their option).
 * @param {import("./api").NoteSummary[]} notes @param {Date} [now]
 */
export function olderMonths(notes, now = new Date()) {
  const recent = [monthKey(now), monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
  return [...new Set(notes.map((n) => monthKey(new Date(n.created_at))))].filter((k) => !recent.includes(k)).sort().reverse();
}

/**
 * Consecutive notes with the same separator label, in the order given.
 * @template {{ created_at: string }} N
 * @param {N[]} notes @param {(iso: string) => string} labelOf
 * @returns {[string, N[]][]}
 */
export function groupByLabel(notes, labelOf) {
  /** @type {[string, N[]][]} */
  const groups = [];
  for (const n of notes) {
    const label = labelOf(n.created_at);
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(n);
    else groups.push([label, [n]]);
  }
  return groups;
}
