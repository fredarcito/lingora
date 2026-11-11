// La voz que sale por los altavoces: lo comparten la reproducción
// (`useTranslationPipeline`) y la
// prueba de voz de la tarjeta del carril.

/** Nivel por debajo del cual el principio y el final de la voz son silencio. */
const VOICE_SILENCE = 0.003;

/**
 * Quita el silencio que Kokoro deja al principio y al final de cada frase
 * (deja 40 ms): entre frases seguidas se oía como un hueco.
 * @param {number[]} audio @param {number} sampleRate
 */
export function trimSilence(audio, sampleRate) {
  const margin = Math.round(sampleRate * 0.04);
  let start = 0;
  let end = audio.length;
  while (start < end && Math.abs(audio[start]) < VOICE_SILENCE) start++;
  while (end > start && Math.abs(audio[end - 1]) < VOICE_SILENCE) end--;
  return audio.slice(Math.max(0, start - margin), Math.min(audio.length, end + margin));
}

/** The lane card's speed slider: its range and step. */
export const SPEED_MIN = 1;
export const SPEED_MAX = 1.6;
export const SPEED_STEP = 0.05;

/** The fastest the voice can go: Rust clamps the speed to 0.8–1.5 (`Pipeline::speak`). */
const VOICE_SPEED_LIMIT = 1.5;

/** Where the slider stops being "up to" and starts raising the base speed (Agile). */
const AGILE_FROM = 1.45;

/**
 * Named stretches of the slider. Picking one moves the slider to its `value`;
 * moving the slider selects the stretch it lands in. Measured on a fast English
 * speaker (docs/experimentos/2026-11-retraso): Natural lets the delay grow to
 * ~10 s, Balanced holds it at ~6.5 s, Agile is always faster.
 * @typedef {"natural" | "balanced" | "agile"} SpeedMode
 * @type {{ id: SpeedMode, from: number, to: number, value: number }[]}
 */
export const SPEED_MODES = [
  { id: "natural", from: 1, to: 1.2, value: 1.15 },
  { id: "balanced", from: 1.25, to: 1.4, value: 1.35 },
  { id: "agile", from: AGILE_FROM, to: SPEED_MAX, value: 1.5 },
];

/**
 * The voice speeds that a slider position means. Up to 1.4 it is the cap that
 * `speedFor` climbs to when the voice falls behind, from 1 (as it always was,
 * so saved values keep working). From 1.45 on (Agile) the cap is the most the
 * voice allows and the slider raises the base: the voice never goes below it.
 * Supertonic speaks slowly at 1 (~5.7 syllables/s in Spanish; natural speech is
 * ~7), but speeding it up flattens the intonation at the end of sentences.
 * @param {number} value The lane's `maxSpeed`.
 * @returns {{ base: number, max: number }}
 */
export function speedRange(value) {
  if (value < AGILE_FROM - SPEED_STEP / 2) return { base: 1, max: value };
  const base = Math.min(VOICE_SPEED_LIMIT, 1 + (value - 1.4) * 2);
  return { base: Math.round(base * 100) / 100, max: VOICE_SPEED_LIMIT };
}

/**
 * The stretch a slider position falls in (between two stretches, the nearer one).
 * @param {number} value
 * @returns {SpeedMode}
 */
export function speedMode(value) {
  const distance = (/** @type {(typeof SPEED_MODES)[number]} */ m) => (value < m.from ? m.from - value : value > m.to ? value - m.to : 0);
  return SPEED_MODES.reduce((best, m) => (distance(m) < distance(best) ? m : best)).id;
}

/**
 * Velocidad de la voz según el retraso. Un vídeo no espera a la traducción, y
 * el español dura un 15-25 % más que el inglés: si la voz no acelera, el
 * retraso crece sin límite. `lag` es el retraso medido en la última frase
 * que sonó; `pending`, los trozos en cola; `max`, el tope que elige el
 * usuario (más rápido alcanza antes, pero suena menos natural).
 * @param {number} pending @param {number} lag @param {number} max
 */
export function speedFor(pending, lag, max) {
  // Acelerar con poco retraso solo deja silencios esperando al trozo siguiente.
  const byLag = lag > 6 ? 1 : lag > 4.5 ? 0.7 : lag > 3.5 ? 0.4 : lag > 2.5 ? 0.2 : 0;
  const byQueue = pending >= 4 ? 1 : pending === 3 ? 0.5 : 0;
  return 1 + (max - 1) * Math.max(byLag, byQueue);
}

/**
 * Con más retraso que esto la voz ya no sirve en una conversación: se omite
 * y solo se muestra el texto, para alcanzar al original.
 */
export const MAX_VOICE_LAG_SECS = 10;
