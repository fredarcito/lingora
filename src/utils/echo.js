import { api } from "./api";

/**
 * Online meeting with speakers: the microphone also hears the others, and without
 * filtering each of its sentences, they would come out twice, once as "Person 1" and once as
 * "Me". Since the Mac audio is exactly what played, each sentence from the
 * microphone is compared with what was heard at the same time:
 * 1. Text: if almost all of it matches, it is echo; if part matches (you spoke
 *    at the same time), that part is removed and yours is kept.
 * 2. Voice: if the text does not match but someone was playing on the Mac and the voice
 *    sounds more like that person than like you, it is also echo.
 * With headphones there is no echo and sentences pass through without waiting.
 */

/** Margin around a microphone sentence to look for what played (ms). */
const WINDOW_MS = 2000;
/** Maximum wait for the Mac audio to deliver what played at that time (ms). */
const HOLD_MS = 8000;
/** How often to check whether a decision can be made (ms). */
const CHECK_MS = 400;
/** What played on the Mac is kept for this long (ms). */
const KEEP_MS = 60_000;
/** With this share of the words in what played, the whole sentence is echo. */
const ECHO_SHARE = 0.5;
/** What remains after removing the echo needs at least these words. */
const MIN_LEFT_WORDS = 3;
/** Minimum similarity (cosine) to a person on the Mac; the same threshold that separates speakers in notes.js. */
const SAME_VOICE = 0.5;
/** How much more it has to sound like that person than like you. */
const VOICE_MARGIN = 0.1;
/** Own sentences (with nothing playing on the Mac) needed to learn your voice. */
const MIN_OWN = 3;
/** With less audio the fingerprint is not reliable. */
const MIN_PRINT_SECS = 1.2;

/** Chinese, Japanese and Korean: no spaces, each character counts as a word. */
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

/**
 * The words of a text, in lowercase, without accents or punctuation. Each
 * one remembers which word of the original it comes from.
 * @param {string} text
 * @returns {{ words: string[], from: number[], original: string[] }}
 */
function tokenize(text) {
  const original = text.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const words = [];
  /** @type {number[]} */
  const from = [];
  original.forEach((raw, i) => {
    const clean = raw
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (!clean) return;
    for (const w of CJK.test(clean) ? [...clean] : [clean]) {
      words.push(w);
      from.push(i);
    }
  });
  return { words, from, original };
}

/**
 * Which words of `mine` appear, in the same order, in `heard`: three
 * in a row, or two if one is long (short ones like "de la" match by
 * chance). In a sentence of one or two words, all of them must be present.
 * @param {string[]} mine @param {string[][]} heard
 * @returns {boolean[]}
 */
function covered(mine, heard) {
  const pairs = new Set();
  const triples = new Set();
  const all = new Set();
  for (const ws of heard) {
    ws.forEach((w, i) => {
      all.add(w);
      if (i + 1 < ws.length) pairs.add(`${w} ${ws[i + 1]}`);
      if (i + 2 < ws.length) triples.add(`${w} ${ws[i + 1]} ${ws[i + 2]}`);
    });
  }
  if (mine.length <= 2) return mine.map(() => mine.every((w) => all.has(w)));
  const hit = mine.map(() => false);
  for (let i = 0; i + 1 < mine.length; i++) {
    const long = mine[i].length >= 4 || mine[i + 1].length >= 4;
    if (long && pairs.has(`${mine[i]} ${mine[i + 1]}`)) hit[i] = hit[i + 1] = true;
    if (i + 2 < mine.length && triples.has(`${mine[i]} ${mine[i + 1]} ${mine[i + 2]}`)) hit[i] = hit[i + 1] = hit[i + 2] = true;
  }
  return hit;
}

/**
 * What to do with a microphone sentence based on what played on the Mac.
 * @param {string} text @param {string[]} heard
 * @returns {{ echo: true } | { echo: false, text: string, matched: boolean }}
 *   `matched`: something matched (a part was removed).
 */
export function compareEcho(text, heard) {
  const mine = tokenize(text);
  if (!mine.words.length || !heard.length) return { echo: false, text, matched: false };
  const hit = covered(
    mine.words,
    heard.map((h) => tokenize(h).words),
  );
  const share = hit.filter(Boolean).length / hit.length;
  if (share === 0) return { echo: false, text, matched: false };
  if (share >= ECHO_SHARE) return { echo: true };
  // A word of the original is removed if all its parts were echo.
  const keep = mine.original.map((_, i) => mine.from.every((f, j) => f !== i || !hit[j]));
  const left = mine.original.filter((_, i) => keep[i]);
  if (left.length < MIN_LEFT_WORDS) return { echo: true };
  return { echo: false, text: left.join(" "), matched: true };
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

/**
 * @typedef {Omit<import("./api").NoteSentence, "t" | "speaker">} Sentence
 * @typedef {{ print: Promise<number[]>, secs: number } | null} Voice
 * @typedef {import("./audio").SegmentInfo} Info
 * @typedef {ReturnType<typeof import("./notes.js").createRecorder>} Recorder
 */

/**
 * Puts the echo filter in front of the recorder, with the same shape: the rest of
 * the app does not know it exists. Mac sentences pass immediately; the
 * microphone ones wait for what played at the same time, unless no echo is possible.
 * @param {Recorder} recorder
 * @param {{ echoPossible: () => boolean, macIdle: () => boolean }} options
 *   `echoPossible`: the current output can be heard by the microphone (they are not
 *   headphones). `macIdle`: the Mac audio is not in the middle of a sentence nor
 *   has anything left in the queue, so it has already delivered everything that played.
 * @returns {Recorder}
 */
export function withEchoFilter(recorder, { echoPossible, macIdle }) {
  /** What played on the Mac. @type {Array<{ start: number, end: number, text: string, print: Promise<number[] | null> }>} */
  let heard = [];
  /** What ended later than what arrived from the Mac. */
  let heardUntil = 0;
  /** Microphone sentences waiting. @type {Array<{ sentence: Sentence, info: Info, since: number }>} */
  let waiting = [];
  /** Fingerprints of your voice (sentences with nothing playing on the Mac). @type {number[][]} */
  const own = [];
  let timer = 0;
  // Decisions go in order: one waits for the fingerprint of the previous one.
  let deciding = Promise.resolve();

  /** @param {Info} info */
  const span = (info) => ({ start: info.endedAt - info.secs * 1000, end: info.endedAt });
  /** @param {Info} info */
  const printOf = (info) =>
    info.samples && info.secs >= MIN_PRINT_SECS ? api.voicePrint(info.samples).catch(() => null) : Promise.resolve(null);

  /** @param {{ sentence: Sentence, info: Info }} item */
  const decide = async ({ sentence, info }) => {
    const { start, end } = span(info);
    const near = heard.filter((h) => h.start <= end + WINDOW_MS && h.end >= start - WINDOW_MS);
    const mine = printOf(info);
    // Nothing was playing on the Mac: it is surely your voice, and it helps learn it.
    if (!near.length) {
      const print = await mine;
      if (print) own.push(print);
      recorder.add(sentence, null, info);
      return;
    }
    const result = compareEcho(
      sentence.source,
      near.map((h) => h.text),
    );
    if (result.echo) {
      console.info("[lingora] eco descartado:", sentence.source);
      return;
    }
    if (!result.matched && own.length >= MIN_OWN) {
      const [print, others] = await Promise.all([mine, Promise.all(near.map((h) => h.print))]);
      if (print) {
        const me = Math.max(...own.map((p) => cosine(p, print)));
        const them = Math.max(-1, ...others.filter(Boolean).map((p) => cosine(/** @type {number[]} */ (p), print)));
        if (them >= SAME_VOICE && them > me + VOICE_MARGIN) {
          console.info("[lingora] eco descartado por la voz:", sentence.source);
          return;
        }
      }
    }
    recorder.add({ ...sentence, source: result.text }, null, info);
  };

  /** Decides the sentences for which the Mac has already delivered what played (or all of them, at the end). */
  const check = (all = false) => {
    const now = performance.now();
    const idle = macIdle();
    // Stopped right after the sentence ends, the Mac may still be closing its own: a margin.
    const ready = waiting.filter(
      (w) =>
        all ||
        (idle && now - w.info.endedAt >= WINDOW_MS) ||
        heardUntil >= w.info.endedAt + WINDOW_MS ||
        now - w.since >= HOLD_MS,
    );
    waiting = waiting.filter((w) => !ready.includes(w));
    for (const item of ready) deciding = deciding.then(() => decide(item)).catch(() => {});
    if (!waiting.length) {
      window.clearInterval(timer);
      timer = 0;
    }
    heard = heard.filter((h) => now - h.end < KEEP_MS);
    return deciding;
  };

  return {
    get saving() {
      return recorder.saving;
    },
    setSaving: (on) => recorder.setSaving(on),
    /** @param {Sentence} sentence @param {Voice} [voice] @param {Info} [info] */
    add(sentence, voice = null, info) {
      if (!info) return recorder.add(sentence, voice, info);
      if (sentence.direction === "remote_to_local") {
        const { start, end } = span(info);
        const print = voice ? voice.print.catch(() => null) : printOf(info);
        heard.push({ start, end, text: sentence.source, print });
        heardUntil = Math.max(heardUntil, end);
        recorder.add(sentence, voice, info);
        if (waiting.length) check();
        return;
      }
      if (!echoPossible()) return recorder.add(sentence, voice, info);
      waiting.push({ sentence, info, since: performance.now() });
      if (!timer) timer = window.setInterval(check, CHECK_MS);
    },
    async finish() {
      await check(true);
      return recorder.finish();
    },
  };
}
