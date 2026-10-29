/**
 * Palabras y ritmo de aparición del texto en vivo. Es el mismo criterio que
 * usan los subtítulos (`Captions.jsx`, que no se toca); aquí lo reutiliza la
 * transcripción de Tomar notas para que el texto aparezca igual.
 */

/** Separa palabras donde no hay espacios. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
/** Escrituras sin espacios entre palabras: china, japonesa, tailandesa, lao, tibetana, birmana y jemer. */
const NO_SPACES = /[぀-ヿ㐀-鿿฀-໿ༀ-࿿က-႟ក-៿]/;

/**
 * Las palabras de una frase, cada una con el espacio que la sigue (si lo hay).
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  if (!segmenter || !NO_SPACES.test(text)) return text.split(/\s+/).filter(Boolean).map((w) => `${w} `);
  /** @type {string[]} */
  const words = [];
  for (const { segment } of segmenter.segment(text.trim())) {
    // Los espacios y la puntuación van pegados a la palabra anterior.
    if (words.length && !/[\p{L}\p{N}]/u.test(segment)) words[words.length - 1] += segment;
    else words.push(segment);
  }
  return words;
}

/**
 * Pausa entre palabras según las que esperan: a ritmo de lectura (~5 por
 * segundo) y más rápido si se acumulan, para no sumar más de ~1 s de retraso.
 * @param {number} waiting
 */
export const wordDelayMs = (waiting) => (waiting > 14 ? 50 : waiting > 7 ? 110 : 190);
