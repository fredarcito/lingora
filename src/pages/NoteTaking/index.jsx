import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  ChoiceCards,
  ConfirmDialog,
  LinkButton,
  MicIcon,
  MonitorIcon,
  PlayIcon,
  Segmented,
  ShieldIcon,
  StopIcon,
  VideoIcon,
  cx,
} from "../../components/shared";
import LiveStatus from "../../components/LiveStatus";
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
import { echoPossible, prefersMacMic, prefersRoomMic } from "../../utils/route.js";
import { splitWords, wordDelayMs } from "../../utils/words.js";
import styles from "./styles.module.css";

/** Distance from the bottom beyond which the user is considered to have scrolled up to read. */
const STICK_PX = 48;

/** "03:25", or "1:03:25" from one hour on. @param {number} secs */
function elapsedLabel(secs) {
  const s = Math.max(0, Math.floor(secs));
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * The Take notes screen: before starting, its options; while recording,
 * the live transcript as a document. The recorder writes the note
 * (`notes.js`); here its in-memory copy is only read when it reports a change.
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
  // It is chosen in Settings; when coming back here, the screen is repainted and reads it.
  const summaryLang = loadNotesLang();
  const [askConsent, setAskConsent] = useState(false);
  const [note, setNote] = useState(/** @type {import("../../utils/api").Note | null} */ (null));
  const [elapsed, setElapsed] = useState(0);
  // The user scrolled up to read: they are not dragged back down and a way back is offered.
  const [away, setAway] = useState(false);
  const stick = useRef(true);
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Without Mac audio (macOS before 14.2) only the microphone is left.
  const effectiveInput = systemAudio ? input : "mic";

  useEffect(() => {
    if (!running) return;
    const since = new Date().toISOString();
    const startedAt = performance.now();
    setNote(null);
    setElapsed(0);
    stick.current = true;
    setAway(false);
    // The recorder keeps the previous note until the first sentence: only one from this session counts.
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

  // Scrolls down by itself, smoothly, while the user is at the bottom.
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

  // While the note is being finished the transcript stays: the options would flash before the note opens.
  if (running || closing) {
    // Live, people are provisional (the review merges them when it finishes):
    // the text is shown without them and paragraphs are split only by pauses.
    // "Yo" (your microphone in an online meeting) is reliable and gets marked.
    const anonymous = note && { ...note, sentences: note.sentences.map((x) => ({ ...x, speaker: x.speaker === 0 ? 0 : null })) };
    return (
      <div className={styles.noteTaking}>
        <div className={styles.takingLive}>
          <div className={styles.takingBar}>
            <span className="note-live">{t("noteTaking.recording")}</span>
            <span className={styles.takingTime}>{elapsedLabel(elapsed)}</span>
            {/* Where it is recorded from, in case the wrong one was chosen. */}
            <Badge>{t(`noteTaking.${effectiveInput}`)}</Badge>
            <p className={cx(styles.takingPeople, "muted")}>{loadSpeakers() ? t("noteTaking.peopleLater") : ""}</p>
            {closing ? (
              <Button busy disabled>
                {t("noteTaking.finishing")}
              </Button>
            ) : (
              <Button variant="stop" onClick={onStop}>
                <StopIcon />
                {t("noteTaking.stop")}
              </Button>
            )}
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
          <div className={styles.takingHeard}>
            <LiveStatus live={live} idle={t(closing ? "noteTaking.finishing" : "noteTaking.listening")} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.noteTaking}>
      <div className="notes-scroll">
        <div className="notes-column">
          <div className={styles.setup}>
            <section className={styles.setupSection}>
              <h3 className={styles.setupLabel}>{t("noteTaking.whatToListen")}</h3>
              <ChoiceCards
                value={effectiveInput}
                onChange={(v) => onInput(/** @type {import("../../utils/notes.js").NotesInput} */ (v))}
                options={[
                  {
                    value: "meeting",
                    label: t("noteTaking.meeting"),
                    hint: systemAudio ? t("noteTaking.meeting.hint") : t("noteTaking.system.need"),
                    icon: <VideoIcon />,
                    disabled: !systemAudio,
                  },
                  {
                    value: "system",
                    label: t("noteTaking.system"),
                    hint: systemAudio ? t("noteTaking.system.hint") : t("noteTaking.system.need"),
                    icon: <MonitorIcon />,
                    disabled: !systemAudio,
                  },
                  { value: "mic", label: t("noteTaking.mic"), hint: t("noteTaking.mic.hint"), icon: <MicIcon /> },
                ]}
              />
              {/* Below the cards, what they don't say: what gets noted and what is connected. */}
              <p className={styles.setupHint}>
                {t(`noteTaking.hint.${effectiveInput}`)}
                {effectiveInput === "meeting" && route && <RouteHint route={route} />}
                {effectiveInput === "mic" && prefersRoomMic(route) && t("noteTaking.route.roomMic")}
                {!systemAudio && t("noteTaking.hint.need")}
              </p>
            </section>
            <section className={styles.setupSection}>
              <h3 className={styles.setupLabel}>{t("noteTaking.meetingLang")}</h3>
              <div className={styles.setupLang}>
                <Segmented
                  value={listen}
                  onChange={(v) => onListen(/** @type {"EN" | "ZH"} */ (v))}
                  options={[
                    { value: "EN", label: t("noteTaking.auto"), hint: t("noteTaking.auto.hint") },
                    { value: "ZH", label: t("noteTaking.zh"), hint: t("noteTaking.zh.hint") },
                  ]}
                />
              </div>
              {/* The hint of the chosen option, in view instead of only on hover. */}
              <p className={styles.setupHint}>{t(listen === "ZH" ? "noteTaking.zh.hint" : "noteTaking.auto.hint")}</p>
            </section>
            <section className={styles.setupSection}>
              <h3 className={styles.setupLabel}>{t("noteTaking.summaryLang")}</h3>
              <div className={styles.setupSummary}>
                <p className={styles.takingSummaryLang}>
                  <strong>{languages.find((l) => l.code === summaryLang)?.name ?? summaryLang}</strong>
                  <LinkButton onClick={onOpenSettings}>{t("noteTaking.changeInSettings")}</LinkButton>
                </p>
                <p className={styles.setupHint}>{t("noteTaking.summaryLangHint")}</p>
              </div>
            </section>
            {error && (
              <p className="notes-error" role="alert">
                {error}
              </p>
            )}
            <div className={styles.takingActions}>
              {/* A last look at what was chosen, before recording. */}
              <p className={styles.setupRecap}>
                <strong>{t(`noteTaking.${effectiveInput}`)}</strong>
                {" · "}
                {t("noteTaking.recap.lang")} <strong>{t(listen === "ZH" ? "noteTaking.zh" : "noteTaking.auto")}</strong>
                {" · "}
                {t("noteTaking.recap.summary")} <strong>{languages.find((l) => l.code === summaryLang)?.name ?? summaryLang}</strong>
              </p>
              <Button variant="primary" className={styles.takingStart} busy={starting} disabled={starting} onClick={begin}>
                {starting ? t("noteTaking.preparing") : <><PlayIcon />{t("noteTaking.start")}</>}
              </Button>
            </div>
            <p className={styles.setupPermission}>
              <ShieldIcon />
              {t(`noteTaking.permission.${effectiveInput}`)}
            </p>
          </div>
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
 * What will happen with what is connected now in an online meeting: whether your voice
 * stays separate (headphones) and which microphone will be used (see `utils/route.js`).
 * @param {{ route: import("../../utils/api").AudioRoute }} props
 */
function RouteHint({ route }) {
  const t = useT();
  return (
    <>
      {!echoPossible(route) && t("noteTaking.route.headphones")}
      {route.input_bluetooth && t(prefersMacMic(route) ? "noteTaking.route.macMic" : "noteTaking.route.bluetoothMic")}
    </>
  );
}

/**
 * The live transcript: sentences arrive whole, but the text appears
 * word by word, at the pace of the Translate audio subtitles, so that
 * it does not look jumpy. Each paragraph is a row, as on the note page.
 * @param {{ note: import("../../utils/api").Note, onReveal: () => void }} props
 */
function LiveTranscript({ note, onReveal }) {
  const t = useT();
  /** @type {Map<import("../../utils/api").NoteSentence, number>} */
  const index = new Map(note.sentences.map((x, i) => [x, i]));
  /**
   * The words of each sentence, with a stable key (sentence:word). The sentence
   * is not identified by its position: in an online meeting a sentence can
   * slip in before another one that is already visible.
   */
  const byIndex = note.sentences.map((x) =>
    splitWords(x.translation ?? x.source).map((text, j) => ({ key: `${x.t}:${x.direction}:${x.source.length}:${j}`, text })),
  );
  const all = byIndex.flat();
  const allRef = useRef(all);
  allRef.current = all;
  const shown = useRef(/** @type {Set<string>} */ (new Set()));
  const [, redraw] = useState(0);

  // Its own clock: sentences arrive in chunks and would restart a timer tied to the render.
  useEffect(() => {
    let last = 0;
    let tick = performance.now();
    const timer = window.setInterval(() => {
      const waiting = allRef.current.filter((w) => !shown.current.has(w.key));
      const now = performance.now();
      // With the window behind another one, macOS slows the clock: when it comes back, it jumps at once.
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
                  <span key={w.key} className={styles.word}>
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
