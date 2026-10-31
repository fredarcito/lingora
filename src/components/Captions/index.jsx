import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import LiveStatus from "../LiveStatus";
import { cx } from "../shared";
import styles from "./styles.module.css";

/**
 * Sentences kept mounted. Only the latest are visible; the ones above sit
 * under the fade, so the one removed is not seen disappearing.
 */
export const CAPTION_SENTENCES = 20;

/** Splits words where there are no spaces. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
/** Scripts without spaces between words: Chinese, Japanese, Thai, Lao, Tibetan, Burmese and Khmer. */
const NO_SPACES = /[\u3040-\u30ff\u3400-\u9fff\u0e00-\u0eff\u0f00-\u0fff\u1000-\u109f\u1780-\u17ff]/;

/**
 * The words of a sentence, each with the space that follows it (if any).
 * In Chinese, Japanese, Thai… they are split with `Intl.Segmenter`: without it a whole
 * sentence would be a single "word" and would appear all at once.
 * @param {string} text
 * @returns {string[]}
 */
function splitWords(text) {
  if (!segmenter || !NO_SPACES.test(text)) return text.split(/\s+/).filter(Boolean).map((w) => `${w} `);
  /** @type {string[]} */
  const words = [];
  for (const { segment } of segmenter.segment(text.trim())) {
    // Spaces and punctuation stick to the previous word.
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
const wordDelayMs = (waiting) => (waiting > 14 ? 50 : waiting > 7 ? 110 : 190);

/**
 * Subtitles (with or without voice), like live TV ones: one continuous text
 * anchored at the bottom, that appears word by word even if the translation
 * arrives whole (the local one takes ~0.2 s per sentence and the view jumped).
 * Older text rises, dimmed.
 * At the foot, what is being heard now (what the listener understands), live.
 * With `showSource` ("Both"), the original goes small above each sentence.
 * In the floating window (`floating`) only the sentences: no foot, no history.
 * `className` places it from outside; App sets the text size with `--captions-size`.
 * @param {{ state: import("../../App/types").LaneState, live?: string, showSource: boolean,
 *   onHistory?: () => void, floating?: boolean, className?: string }} props
 */
export default function Captions({ state: s, live = "", showSource, onHistory, floating = false, className }) {
  const t = useT();
  const writing = s.draft?.text ?? "";
  // Stable key per sentence: the draft and the final entry share a key,
  // so a sentence is not animated again when it finishes arriving.
  const sentences = s.history
    .slice(0, CAPTION_SENTENCES)
    .reverse()
    .map((h) => ({ key: h.captionKey ?? h.id, text: h.translation, source: h.transcript }));
  if (writing) sentences.push({ key: s.draft?.key ?? -1, text: writing, source: s.draft?.source ?? "" });
  const sourceOf = new Map(sentences.map((x) => [x.key, x.source]));

  // The current one in white; the previous one almost the same, because when the
  // new one starts it is often still being read; older ones, in gray.
  /** @type {Array<{ key: string, sentence: number, text: string, tone: string }>} */
  const words = [];
  sentences.forEach((sentence, i) => {
    const age = sentences.length - 1 - i;
    const tone = age === 0 ? styles.isCurrent : age === 1 ? styles.isPrevious : "";
    splitWords(sentence.text).forEach((text, j) => {
      words.push({ key: `${sentence.key}:${j}`, sentence: sentence.key, text, tone });
    });
  });

  // What was already there when the panel opened is shown without animation.
  const shown = useRef(/** @type {Set<string> | null} */ (null));
  if (shown.current === null) shown.current = new Set(words.map((w) => w.key));
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const [, redraw] = useState(0);

  // Its own clock: the translation arrives in chunks every few milliseconds and
  // would restart any timer tied to the render.
  useEffect(() => {
    let last = 0;
    let tick = performance.now();
    const timer = window.setInterval(() => {
      const seen = /** @type {Set<string>} */ (shown.current);
      const waiting = wordsRef.current.filter((w) => !seen.has(w.key));
      const now = performance.now();
      // With the window behind another one, macOS slows the clock and words pile
      // up: when it comes back they show at once instead of racing to catch up.
      const throttled = now - tick > 500;
      tick = now;
      if (throttled && waiting.length) {
        for (const w of waiting) seen.add(w.key);
        redraw((n) => n + 1);
        return;
      }
      if (!waiting.length || now - last < wordDelayMs(waiting.length)) return;
      last = now;
      seen.add(waiting[0].key);
      // Keys of sentences that already left at the top are not needed.
      if (seen.size > 600) shown.current = new Set(wordsRef.current.map((w) => w.key).filter((k) => seen.has(k)));
      redraw((n) => n + 1);
    }, 30);
    return () => window.clearInterval(timer);
  }, []);

  const visible = words.filter((w) => shown.current?.has(w.key));
  // One block per sentence: if it were all one paragraph, removing the oldest
  // sentence would re-wrap every line and the text would "go back".
  /** @type {Array<{ key: number, words: typeof words }>} */
  const lines = [];
  for (const w of visible) {
    const last = lines[lines.length - 1];
    if (last?.key === w.sentence) last.words.push(w);
    else lines.push({ key: w.sentence, words: [w] });
  }

  // When the text grows (a new line), it rises with a short animation instead
  // of jumping. It measures how much the last sentence already there rose, not
  // the total height: removing an old sentence at the top barely changes the
  // height, but what is below does rise.
  const textRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const anchor = useRef(/** @type {{ key: string, fromBottom: number } | null} */ (null));
  useLayoutEffect(() => {
    const el = textRef.current;
    const last = /** @type {HTMLElement | null} */ (el?.lastElementChild ?? null);
    if (!el || !last) return;
    const fromBottom = (/** @type {HTMLElement} */ line) => el.offsetHeight - line.offsetTop;
    const prev = anchor.current;
    const same = prev && /** @type {HTMLElement | null} */ (el.querySelector(`[data-key="${prev.key}"]`));
    anchor.current = { key: last.dataset.key ?? "", fromBottom: fromBottom(last) };
    const rose = same && prev ? fromBottom(same) - prev.fromBottom : 0;
    if (rose <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ transform: `translateY(${rose}px)` }, { transform: "translateY(0)" }], {
      duration: 350,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      // If another line arrives mid-animation, it adds up instead of jumping.
      composite: "add",
    });
  });

  return (
    <div className={cx(styles.captions, floating && styles.isFloating, className)}>
      <div className={styles.captionsScroll} aria-live="polite">
        {lines.length === 0 ? (
          <p className={styles.captionsEmpty}>{s.running ? t("captions.empty.running") : t("captions.empty.idle")}</p>
        ) : (
          <div className={styles.captionsText} ref={textRef}>
            {lines.map((line) => (
              <div key={line.key} className={styles.captionLine} data-key={line.key}>
                {showSource && sourceOf.get(line.key) && <p className={styles.captionSource} dir="auto">{sourceOf.get(line.key)}</p>}
                {/* "auto": Arabic, Hebrew and Urdu go right to left. */}
                <p dir="auto">
                  {line.words.map((w) => (
                    <span key={w.key} className={cx(styles.word, w.tone)}>
                      {w.text}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      {!floating && (
        <div className={styles.captionsFoot}>
          {s.running && (
            <LiveStatus live={live} idle={s.heard.length || writing ? t("captions.translating") : t("captions.listening")} />
          )}
          {s.history.length > 0 && onHistory && (
            <button className="link" onClick={onHistory}>
              {t("captions.history")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
