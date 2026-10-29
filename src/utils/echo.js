import { api } from "./api";

/**
 * Reunión en línea con altavoces: el micrófono oye también a los demás, y sin
 * filtrar cada frase suya saldría dos veces, una como "Persona 1" y otra como
 * "Yo". Como el audio del Mac es exactamente lo que sonó, cada frase del
 * micrófono se compara con lo que se oyó a la misma hora:
 * 1. Texto: si casi todo coincide, es eco; si coincide una parte (hablasteis
 *    a la vez), se quita esa parte y se queda lo tuyo.
 * 2. Voz: si el texto no coincide pero sonaba alguien en el Mac y la voz se
 *    parece más a esa persona que a ti, también es eco.
 * Con auriculares no hay eco y las frases pasan sin esperar.
 */

/** Margen alrededor de una frase del micrófono para buscar lo que sonó (ms). */
const WINDOW_MS = 2000;
/** Tope de espera a que el audio del Mac entregue lo que sonó a esa hora (ms). */
const HOLD_MS = 8000;
/** Cada cuánto se mira si ya se puede decidir (ms). */
const CHECK_MS = 400;
/** Lo que sonó en el Mac se guarda este tiempo (ms). */
const KEEP_MS = 60_000;
/** Con esta parte de las palabras en lo que sonó, la frase entera es eco. */
const ECHO_SHARE = 0.5;
/** Lo que queda tras quitar el eco necesita al menos estas palabras. */
const MIN_LEFT_WORDS = 3;
/** Parecido (coseno) mínimo a una persona del Mac; el mismo umbral que separa personas en notes.js. */
const SAME_VOICE = 0.5;
/** Cuánto más se tiene que parecer a esa persona que a ti. */
const VOICE_MARGIN = 0.1;
/** Frases propias (sin nada sonando en el Mac) que hacen falta para conocer tu voz. */
const MIN_OWN = 3;
/** Con menos audio la huella no es fiable. */
const MIN_PRINT_SECS = 1.2;

/** Chino, japonés y coreano: sin espacios, cada carácter cuenta como palabra. */
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

/**
 * Las palabras de un texto, en minúsculas, sin acentos ni puntuación. Cada
 * una recuerda de qué palabra del original sale.
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
 * Qué palabras de `mine` aparecen, en el mismo orden, en `heard`: tres
 * seguidas, o dos si alguna es larga (las cortas como "de la" coinciden por
 * casualidad). En una frase de una o dos palabras, que estén todas.
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
 * Qué hacer con una frase del micrófono según lo que sonó en el Mac.
 * @param {string} text @param {string[]} heard
 * @returns {{ echo: true } | { echo: false, text: string, matched: boolean }}
 *   `matched`: algo coincidió (se quitó una parte).
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
  // Una palabra del original se quita si todas sus partes eran eco.
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
 * Pone el filtro de eco delante del grabador, con su misma forma: el resto de
 * la app no sabe que existe. Las frases del Mac pasan en el acto; las del
 * micrófono esperan a lo que sonó a la misma hora, salvo sin eco posible.
 * @param {Recorder} recorder
 * @param {{ echoPossible: () => boolean, macIdle: () => boolean }} options
 *   `echoPossible`: la salida actual puede oírse por el micrófono (no son
 *   auriculares). `macIdle`: el audio del Mac no está en mitad de una frase ni
 *   le queda nada en cola, así que ya entregó todo lo que sonó.
 * @returns {Recorder}
 */
export function withEchoFilter(recorder, { echoPossible, macIdle }) {
  /** Lo que sonó en el Mac. @type {Array<{ start: number, end: number, text: string, print: Promise<number[] | null> }>} */
  let heard = [];
  /** Lo que terminó más tarde de lo que llegó del Mac. */
  let heardUntil = 0;
  /** Frases del micrófono a la espera. @type {Array<{ sentence: Sentence, info: Info, since: number }>} */
  let waiting = [];
  /** Huellas de tu voz (frases sin nada sonando en el Mac). @type {number[][]} */
  const own = [];
  let timer = 0;
  // Las decisiones van en orden: una espera a la huella de la anterior.
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
    // Nada sonaba en el Mac: es tu voz seguro, y sirve para conocerla.
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

  /** Decide las frases para las que el Mac ya entregó lo que sonó (o todas, al terminar). */
  const check = (all = false) => {
    const now = performance.now();
    const idle = macIdle();
    // Parado justo al terminar la frase, el Mac aún puede estar cerrando la suya: un margen.
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
