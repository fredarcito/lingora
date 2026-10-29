import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Segmented } from "./ui";
import { useT } from "./i18n";
import {
  NOTE_CHANGED_EVENT,
  getActiveNote,
  loadNotesConsent,
  loadNotesLang,
  formatClock,
  loadSpeakers,
  paragraphs,
  storeNotesConsent,
} from "./notes.js";
import { splitWords, wordDelayMs } from "./words.js";

/** Distancia al final a partir de la cual se considera que el usuario subió a leer. */
const STICK_PX = 48;

/** Caracteres de lo que se oye ahora que caben al pie, como en los subtítulos. */
const LIVE_CHARS = 90;

/** "03:25", o "1:03:25" a partir de una hora. @param {number} secs */
function elapsedLabel(secs) {
  const s = Math.max(0, Math.floor(secs));
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * La pantalla de Tomar notas: antes de empezar, sus opciones; mientras graba,
 * la transcripción en vivo como un documento. La nota la escribe el grabador
 * (`notes.js`); aquí solo se lee su copia en memoria cuando avisa de un cambio.
 * @param {{
 *   running: boolean, starting: boolean, closing: boolean, error: string | null,
 *   heard: Array<{ key: number, text: string }>, partial: string, noSignal: boolean,
 *   input: "system" | "mic", onInput: (value: "system" | "mic") => void,
 *   listen: "EN" | "ZH", onListen: (value: "EN" | "ZH") => void,
 *   systemAudio: boolean, languages: import("./api").LanguageInfo[],
 *   onOpenSettings: () => void, onStart: () => void, onStop: () => void,
 * }} props
 */
export default function NoteTaking({
  running,
  starting,
  closing,
  error,
  heard,
  partial,
  noSignal,
  input,
  onInput,
  listen,
  onListen,
  systemAudio,
  languages,
  onOpenSettings,
  onStart,
  onStop,
}) {
  const t = useT();
  // Se elige en Ajustes; al volver aquí la pantalla se pinta de nuevo y lo lee.
  const summaryLang = loadNotesLang();
  const [askConsent, setAskConsent] = useState(false);
  const [note, setNote] = useState(/** @type {import("./api").Note | null} */ (null));
  const [elapsed, setElapsed] = useState(0);
  // El usuario subió a leer: no se le arrastra abajo y se ofrece volver.
  const [away, setAway] = useState(false);
  const stick = useRef(true);
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Sin Audio del Mac (macOS anterior a 14.2) solo queda el micrófono.
  const effectiveInput = systemAudio ? input : "mic";

  useEffect(() => {
    if (!running) return;
    const since = new Date().toISOString();
    const startedAt = performance.now();
    setNote(null);
    setElapsed(0);
    stick.current = true;
    setAway(false);
    // El grabador conserva la nota anterior hasta la primera frase: solo vale una de esta sesión.
    const sync = () => {
      const current = getActiveNote();
      setNote(current && current.created_at >= since ? current : null);
    };
    window.addEventListener(NOTE_CHANGED_EVENT, sync);
    const timer = window.setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 1000);
    return () => {
      window.removeEventListener(NOTE_CHANGED_EVENT, sync);
      window.clearInterval(timer);
    };
  }, [running]);

  const live = [...heard.map((h) => h.text), partial].filter(Boolean).join(" ");

  // Baja sola, con suavidad, mientras el usuario esté abajo.
  const follow = () => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: calm ? "auto" : "smooth" });
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    setAway(!stick.current);
  };

  const toEnd = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const begin = () => (loadNotesConsent() ? onStart() : setAskConsent(true));

  if (running) {
    // En vivo las personas son provisionales (el repaso las junta al terminar):
    // se muestra el texto sin ellas y los párrafos se parten solo por pausas.
    const anonymous = note && { ...note, sentences: note.sentences.map((x) => ({ ...x, speaker: null })) };
    return (
      <div className="note-taking">
        <div className="taking-live">
          <div className="taking-bar">
            <span className="note-live">{t("noteTaking.recording")}</span>
            <span className="taking-time">{elapsedLabel(elapsed)}</span>
            <p className="taking-people muted">{loadSpeakers() ? t("noteTaking.peopleLater") : ""}</p>
            <button className="note-action" onClick={onStop}>
              {t("noteTaking.stop")}
            </button>
          </div>
          {noSignal && <p className="taking-warning">{t("noteTaking.noSignal")}</p>}
          <div className="taking-scroll" ref={scroller} onScroll={onScroll}>
            {anonymous && anonymous.sentences.length > 0 ? (
              <LiveTranscript note={anonymous} onReveal={follow} />
            ) : (
              <p className="muted notes-empty">{t("noteTaking.listeningHere")}</p>
            )}
          </div>
          {away && (
            <button className="note-action taking-end" onClick={toEnd}>
              {t("noteTaking.toEnd")}
            </button>
          )}
          <div className="captions-foot taking-heard">
            <span className={live ? "captions-status is-live" : "captions-status"}>
              <span className="live-dot" />
              <span className="captions-status-text" dir="auto">
                {live ? (live.length > LIVE_CHARS ? `…${live.slice(-LIVE_CHARS)}` : live) : t("noteTaking.listening")}
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="note-taking">
      <div className="notes-scroll">
        <div className="notes-column">
          <section className="prefs-section">
            <div className="prefs-section-head">
              <p>{t("noteTaking.intro")}</p>
            </div>
            <div className="prefs-card">
              <div className="prefs-fields">
                <div className="field">
                  <span>{t("noteTaking.whatToListen")}</span>
                  <Segmented
                    value={effectiveInput}
                    onChange={(v) => onInput(/** @type {"system" | "mic"} */ (v))}
                    options={[
                      {
                        value: "system",
                        label: t("noteTaking.system"),
                        hint: systemAudio ? t("noteTaking.system.hint") : t("noteTaking.system.need"),
                        disabled: !systemAudio,
                      },
                      { value: "mic", label: t("noteTaking.mic"), hint: t("noteTaking.mic.hint") },
                    ]}
                  />
                  <small className="field-hint">
                    {effectiveInput === "system" ? t("noteTaking.hint.system") : t("noteTaking.hint.mic")}
                    {!systemAudio && t("noteTaking.hint.need")}
                  </small>
                </div>
                <div className="field">
                  <span>{t("noteTaking.meetingLang")}</span>
                  <Segmented
                    value={listen}
                    onChange={(v) => onListen(/** @type {"EN" | "ZH"} */ (v))}
                    options={[
                      { value: "EN", label: t("noteTaking.auto"), hint: t("noteTaking.auto.hint") },
                      { value: "ZH", label: t("noteTaking.zh"), hint: t("noteTaking.zh.hint") },
                    ]}
                  />
                </div>
                <div className="field">
                  <span>{t("noteTaking.summaryLang")}</span>
                  <p className="taking-summary-lang">
                    <strong>{languages.find((l) => l.code === summaryLang)?.name ?? summaryLang}</strong>
                    <button className="link" onClick={onOpenSettings}>
                      {t("noteTaking.changeInSettings")}
                    </button>
                  </p>
                  <small className="field-hint">{t("noteTaking.summaryLangHint")}</small>
                </div>
              </div>
              {error && (
                <p className="notes-error" role="alert">
                  {error}
                </p>
              )}
              <div className="taking-actions">
                <button className="note-action primary taking-start" disabled={starting || closing} onClick={begin}>
                  {(starting || closing) && <span className="spinner small" aria-hidden />}
                  {closing ? t("noteTaking.finishing") : starting ? t("noteTaking.preparing") : t("noteTaking.start")}
                </button>
                <p className="muted taking-privacy">{t("noteTaking.privacy")}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      {askConsent && (
        <ConfirmRecord
          onCancel={() => setAskConsent(false)}
          onConfirm={() => {
            storeNotesConsent();
            setAskConsent(false);
            onStart();
          }}
        />
      )}
    </div>
  );
}

/**
 * Aviso de la primera vez: hay que decirle a la gente que se transcribe.
 * Esc cancela; el foco empieza en Cancelar.
 * @param {{ onCancel: () => void, onConfirm: () => void }} props
 */
function ConfirmRecord({ onCancel, onConfirm }) {
  const t = useT();
  const cancel = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => {
    cancel.current?.focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="record-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="record-title">{t("noteTaking.consentTitle")}</h3>
        <p className="muted">{t("noteTaking.consentBody")}</p>
        <div className="dialog-actions">
          <button className="note-action" ref={cancel} onClick={onCancel}>
            {t("noteTaking.cancel")}
          </button>
          <button className="note-action primary" onClick={onConfirm}>
            {t("noteTaking.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La transcripción en vivo: las frases llegan enteras, pero el texto aparece
 * palabra a palabra, al ritmo de los subtítulos de Traducir audio, para que
 * no se vea a saltos. Cada párrafo es una fila como en la página de la nota.
 * @param {{ note: import("./api").Note, onReveal: () => void }} props
 */
function LiveTranscript({ note, onReveal }) {
  /** @type {Map<import("./api").NoteSentence, number>} */
  const index = new Map(note.sentences.map((x, i) => [x, i]));
  /** Las palabras de cada frase, con clave estable (frase:palabra). */
  const byIndex = note.sentences.map((x, i) => splitWords(x.translation ?? x.source).map((text, j) => ({ key: `${i}:${j}`, text })));
  const all = byIndex.flat();
  const allRef = useRef(all);
  allRef.current = all;
  const shown = useRef(/** @type {Set<string>} */ (new Set()));
  const [, redraw] = useState(0);

  // Un reloj propio: las frases llegan a trozos y reiniciarían un temporizador atado al render.
  useEffect(() => {
    let last = 0;
    let tick = performance.now();
    const timer = window.setInterval(() => {
      const waiting = allRef.current.filter((w) => !shown.current.has(w.key));
      const now = performance.now();
      // Con la ventana detrás de otra macOS frena el reloj: al volver, de golpe.
      const throttled = now - tick > 500;
      tick = now;
      if (throttled && waiting.length) {
        for (const w of waiting) shown.current.add(w.key);
        redraw((n) => n + 1);
        return;
      }
      if (!waiting.length || now - last < wordDelayMs(waiting.length)) return;
      last = now;
      shown.current.add(waiting[0].key);
      redraw((n) => n + 1);
    }, 30);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    onReveal();
  });

  return (
    <ol className="note-lines">
      {paragraphs(note.sentences).map((block) => {
        const first = /** @type {number} */ (index.get(block[0]));
        const words = block.flatMap((x) => byIndex[/** @type {number} */ (index.get(x))]).filter((w) => shown.current.has(w.key));
        if (words.length === 0) return null;
        return (
          <li key={first} className="note-line">
            <span className="note-time">{formatClock(block[0].t)}</span>
            <span className="note-text">
              <span dir="auto">
                {words.map((w) => (
                  <span key={w.key} className="word is-current">
                    {w.text}
                  </span>
                ))}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
