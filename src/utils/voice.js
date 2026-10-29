// La voz que sale por los altavoces: lo comparten la reproducción (App) y la
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
