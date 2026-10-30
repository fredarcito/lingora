/**
 * Words and pacing of the live text. It is the same criterion
 * the subtitles use (`Captions.jsx`, which is not touched); here the
 * Take notes transcript reuses it so the text appears the same way.
 */

/** Splits words where there are no spaces. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
/** Scripts without spaces between words: Chinese, Japanese, Thai, Lao, Tibetan, Burmese and Khmer. */
const NO_SPACES = /[぀-ヿ㐀-鿿฀-໿ༀ-࿿က-႟ក-៿]/;

/**
 * The words of a sentence, each one with the space that follows it (if any).
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  if (!segmenter || !NO_SPACES.test(text)) return text.split(/\s+/).filter(Boolean).map((w) => `${w} `);
  /** @type {string[]} */
  const words = [];
  for (const { segment } of segmenter.segment(text.trim())) {
    // Spaces and punctuation stay attached to the previous word.
    if (words.length && !/[\p{L}\p{N}]/u.test(segment)) words[words.length - 1] += segment;
    else words.push(segment);
  }
  return words;
}

/**
 * Pause between words depending on how many are waiting: at reading pace (~5 per
 * second) and faster if they pile up, so as not to add more than ~1 s of delay.
 * @param {number} waiting
 */
export const wordDelayMs = (waiting) => (waiting > 14 ? 50 : waiting > 7 ? 110 : 190);
