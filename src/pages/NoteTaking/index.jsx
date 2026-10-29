import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, LinkButton, Segmented, cx } from "../../components/shared";
import { useT } from "../../i18n";
import {
  NOTE_CHANGED_EVENT,
  getActiveNote,
  loadNotesConsent,
  loadNotesLang,
  formatClock,
  loadSpeakers,
  paragraphs,
  storeNotesConsent,
} from "../../utils/notes.js";
import { echoPossible, prefersMacMic } from "../../utils/route.js";
import { splitWords, wordDelayMs } from "../../utils/words.js";
import styles from "./styles.module.css";

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
 *   micError: string | null,
 *   heard: Array<{ key: number, text: string }>, partial: string, noSignal: boolean,
 *   input: import("../../utils/notes.js").NotesInput,
 *   onInput: (value: import("../../utils/notes.js").NotesInput) => void,
 *   listen: "EN" | "ZH", onListen: (value: "EN" | "ZH") => void,
 *   systemAudio: boolean, languages: import("../../utils/api").LanguageInfo[],
 *   route: import("../../utils/api").AudioRoute | null,
 *   onOpenSettings: () => void, onStart: () => void, onStop: () => void,
 * }} props
 */
export default function NoteTaking({
  running,
  starting,
  closing,
  error,
  micError,
  heard,
  partial,
  noSignal,
  input,
  onInput,
  listen,
  onListen,
  systemAudio,
  languages,
  route,
  onOpenSettings,
  onStart,
  onStop,
}) {
  const t = useT();
  // Se elige en Ajustes; al volver aquí la pantalla se pinta de nuevo y lo lee.
  const summaryLang = loadNotesLang();
  const [askConsent, setAskConsent] = useState(false);
  const [note, setNote] = useState(/** @type {import("../../utils/api").Note | null} */ (null));
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
    // "Yo" (tu micrófono en una reunión en línea) sí es seguro y se marca.
    const anonymous = note && { ...note, sentences: note.sentences.map((x) => ({ ...x, speaker: x.speaker === 0 ? 0 : null })) };
    return (
      <div className={styles.noteTaking}>
        <div className={styles.takingLive}>
          <div className={styles.takingBar}>
            <span className="note-live">{t("noteTaking.recording")}</span>
            <span className={styles.takingTime}>{elapsedLabel(elapsed)}</span>
            <p className={cx(styles.takingPeople, "muted")}>{loadSpeakers() ? t("noteTaking.peopleLater") : ""}</p>
            <Button onClick={onStop}>{t("noteTaking.stop")}</Button>
          </div>
          {noSignal && <p className={styles.takingWarning}>{t("noteTaking.noSignal")}</p>}
          {micError && <p className={styles.takingWarning}>{t("noteTaking.micError", { error: micError })}</p>}
          <div className={styles.takingScroll} ref={scroller} onScroll={onScroll}>
            {anonymous && anonymous.sentences.length > 0 ? (
              <LiveTranscript note={anonymous} onReveal={follow} />
            ) : (
              <p className="muted notes-empty">{t("noteTaking.listeningHere")}</p>
            )}
          </div>
          {away && (
            <Button className="taking-end" onClick={toEnd}>
              {t("noteTaking.toEnd")}
            </Button>
          )}
          <div className={cx("captions-foot", styles.takingHeard)}>
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
    <div className={styles.noteTaking}>
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
                    onChange={(v) => onInput(/** @type {import("../../utils/notes.js").NotesInput} */ (v))}
                    options={[
                      {
                        value: "meeting",
                        label: t("noteTaking.meeting"),
                        hint: systemAudio ? t("noteTaking.meeting.hint") : t("noteTaking.system.need"),
                        disabled: !systemAudio,
                      },
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
                    {t(`noteTaking.hint.${effectiveInput}`)}
                    {effectiveInput === "meeting" && route && <RouteHint route={route} />}
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
                  <p className={styles.takingSummaryLang}>
                    <strong>{languages.find((l) => l.code === summaryLang)?.name ?? summaryLang}</strong>
                    <LinkButton onClick={onOpenSettings}>{t("noteTaking.changeInSettings")}</LinkButton>
                  </p>
                  <small className="field-hint">{t("noteTaking.summaryLangHint")}</small>
                </div>
              </div>
              {error && (
                <p className="notes-error" role="alert">
                  {error}
                </p>
              )}
              <div className={styles.takingActions}>
                <Button variant="primary" className={styles.takingStart} busy={starting || closing} disabled={starting || closing} onClick={begin}>
                  {closing ? t("noteTaking.finishing") : starting ? t("noteTaking.preparing") : t("noteTaking.start")}
                </Button>
                <p className={cx("muted", styles.takingPrivacy)}>{t("noteTaking.privacy")}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      {askConsent && (
        <ConfirmDialog
          title={t("noteTaking.consentTitle")}
          body={t("noteTaking.consentBody")}
          cancelLabel={t("noteTaking.cancel")}
          confirmLabel={t("noteTaking.confirm")}
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
 * Qué pasará con lo que hay conectado ahora en una reunión en línea: si puede
 * haber eco y qué micrófono se usará (ver `utils/route.js`).
 * @param {{ route: import("../../utils/api").AudioRoute }} props
 */
function RouteHint({ route }) {
  const t = useT();
  return (
    <>
      {t(echoPossible(route) ? "noteTaking.route.speakers" : "noteTaking.route.headphones")}
      {route.input_bluetooth && t(prefersMacMic(route) ? "noteTaking.route.macMic" : "noteTaking.route.bluetoothMic")}
    </>
  );
}

/**
 * La transcripción en vivo: las frases llegan enteras, pero el texto aparece
 * palabra a palabra, al ritmo de los subtítulos de Traducir audio, para que
 * no se vea a saltos. Cada párrafo es una fila como en la página de la nota.
 * @param {{ note: import("../../utils/api").Note, onReveal: () => void }} props
 */
function LiveTranscript({ note, onReveal }) {
  const t = useT();
  /** @type {Map<import("../../utils/api").NoteSentence, number>} */
  const index = new Map(note.sentences.map((x, i) => [x, i]));
  /**
   * Las palabras de cada frase, con clave estable (frase:palabra). La frase
   * no se identifica por su posición: en una reunión en línea una frase puede
   * colarse antes de otra que ya se ve.
   */
  const byIndex = note.sentences.map((x) =>
    splitWords(x.translation ?? x.source).map((text, j) => ({ key: `${x.t}:${x.direction}:${x.source.length}:${j}`, text })),
  );
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
        const words = block.flatMap((x) => byIndex[/** @type {number} */ (index.get(x))]).filter((w) => shown.current.has(w.key));
        if (words.length === 0) return null;
        const me = block[0].speaker === 0;
        return (
          <li key={words[0].key} className={me ? "note-line has-who" : "note-line"}>
            <span className="note-time">{formatClock(block[0].t)}</span>
            <span className="note-text">
              {me && (
                <b className="note-who" style={{ "--who": "var(--accent)" }}>
                  {t("notesLib.me")}
                </b>
              )}
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
