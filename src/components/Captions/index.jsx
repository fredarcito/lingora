import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
// CSS global, no módulo: App, FloatingCaptions y Tomar notas también lo usan.
import "./styles.css";

/** Caracteres de lo que se oye ahora que caben al pie de los subtítulos. */
const LIVE_CHARS = 90;

/**
 * Frases que se mantienen montadas. Solo se ven las últimas; las de arriba
 * quedan bajo el desvanecido, así que la que se quita no se ve desaparecer.
 */
export const CAPTION_SENTENCES = 20;

/** Separa palabras donde no hay espacios. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
/** Escrituras sin espacios entre palabras: china, japonesa, tailandesa, lao, tibetana, birmana y jemer. */
const NO_SPACES = /[\u3040-\u30ff\u3400-\u9fff\u0e00-\u0eff\u0f00-\u0fff\u1000-\u109f\u1780-\u17ff]/;

/**
 * Las palabras de una frase, cada una con el espacio que la sigue (si lo
 * hay). En chino, japonés, tailandés… se separan con `Intl.Segmenter`: sin él una frase
 * entera sería una sola "palabra" y aparecería de golpe.
 * @param {string} text
 * @returns {string[]}
 */
function splitWords(text) {
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
const wordDelayMs = (waiting) => (waiting > 14 ? 50 : waiting > 7 ? 110 : 190);

/**
 * Subtítulos (con o sin voz), como los de la tele en directo: un solo texto continuo
 * anclado abajo, que aparece palabra a palabra aunque la traducción llegue
 * entera (la local tarda ~0,2 s por frase y la vista saltaba). Lo anterior
 * sube atenuado.
 * Al pie, lo que se está oyendo ahora (lo que entiende Parakeet), en vivo.
 * Con `showSource` («Ambos»), el original va en pequeño encima de cada frase.
 * En la ventana flotante (`floating`) solo van las frases: ni pie ni historial.
 * @param {{ state: import("../../App/types").LaneState, live?: string, showSource: boolean,
 *   onHistory?: () => void, floating?: boolean }} props
 */
export default function Captions({ state: s, live = "", showSource, onHistory, floating = false }) {
  const t = useT();
  const writing = s.draft?.text ?? "";
  // Clave estable por frase: el borrador y la entrada final comparten clave,
  // así una frase no se vuelve a animar al terminar de llegar.
  const sentences = s.history
    .slice(0, CAPTION_SENTENCES)
    .reverse()
    .map((h) => ({ key: h.captionKey ?? h.id, text: h.translation, source: h.transcript }));
  if (writing) sentences.push({ key: s.draft?.key ?? -1, text: writing, source: s.draft?.source ?? "" });
  const sourceOf = new Map(sentences.map((x) => [x.key, x.source]));

  // La actual en blanco; la anterior casi igual, porque al empezar la nueva
  // a menudo aún se está leyendo; las de antes, en gris.
  /** @type {Array<{ key: string, sentence: number, text: string, tone: string }>} */
  const words = [];
  sentences.forEach((sentence, i) => {
    const age = sentences.length - 1 - i;
    const tone = age === 0 ? "is-current" : age === 1 ? "is-previous" : "";
    splitWords(sentence.text).forEach((text, j) => {
      words.push({ key: `${sentence.key}:${j}`, sentence: sentence.key, text, tone });
    });
  });

  // Lo que ya estaba al abrir el panel se muestra sin animar.
  const shown = useRef(/** @type {Set<string> | null} */ (null));
  if (shown.current === null) shown.current = new Set(words.map((w) => w.key));
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const [, redraw] = useState(0);

  // Un reloj propio: la traducción llega a trozos cada pocos milisegundos y
  // reiniciaría cualquier temporizador atado al render.
  useEffect(() => {
    let last = 0;
    let tick = performance.now();
    const timer = window.setInterval(() => {
      const seen = /** @type {Set<string>} */ (shown.current);
      const waiting = wordsRef.current.filter((w) => !seen.has(w.key));
      const now = performance.now();
      // Con la ventana detrás de otra, macOS frena el reloj y las palabras se
      // acumulan: al volver se muestran de golpe en vez de correr para alcanzar.
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
      // Las claves de frases que ya salieron por arriba no hacen falta.
      if (seen.size > 600) shown.current = new Set(wordsRef.current.map((w) => w.key).filter((k) => seen.has(k)));
      redraw((n) => n + 1);
    }, 30);
    return () => window.clearInterval(timer);
  }, []);

  const visible = words.filter((w) => shown.current?.has(w.key));
  // Un bloque por frase: si todo fuera un párrafo, al quitar la frase más
  // vieja se volverían a partir todas las líneas y el texto "retrocedía".
  /** @type {Array<{ key: number, words: typeof words }>} */
  const lines = [];
  for (const w of visible) {
    const last = lines[lines.length - 1];
    if (last?.key === w.sentence) last.words.push(w);
    else lines.push({ key: w.sentence, words: [w] });
  }

  // Cuando el texto crece (una línea nueva), sube con una animación corta en
  // vez de saltar. Se mide cuánto subió la última frase que ya estaba, no la
  // altura total: al quitar una frase vieja arriba la altura casi no cambia,
  // pero lo de abajo sí sube.
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
      // Si llega otra línea a mitad de animación, se suma en vez de saltar.
      composite: "add",
    });
  });

  return (
    <div className={floating ? "captions is-floating" : "captions"}>
      <div className="captions-scroll" aria-live="polite">
        {lines.length === 0 ? (
          <p className="captions-empty">{s.running ? t("captions.empty.running") : t("captions.empty.idle")}</p>
        ) : (
          <div className="captions-text" ref={textRef}>
            {lines.map((line) => (
              <div key={line.key} className="caption-line" data-key={line.key}>
                {showSource && sourceOf.get(line.key) && <p className="caption-source" dir="auto">{sourceOf.get(line.key)}</p>}
                {/* "auto": el árabe, el hebreo y el urdu van de derecha a izquierda. */}
                <p dir="auto">
                  {line.words.map((w) => (
                    <span key={w.key} className={`word ${w.tone}`}>
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
        <div className="captions-foot">
          {s.running && (
            <span className={live ? "captions-status is-live" : "captions-status"}>
              <span className="live-dot" />
              <span className="captions-status-text" dir="auto">
                {live
                  ? // Lo último que se dijo es lo que importa: se recorta por el principio.
                    live.length > LIVE_CHARS
                    ? `…${live.slice(-LIVE_CHARS)}`
                    : live
                  : s.heard.length || writing
                    ? t("captions.translating")
                    : t("captions.listening")}
              </span>
            </span>
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
