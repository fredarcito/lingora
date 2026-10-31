import { useEffect, useState } from "react";
import { api, errorMessage } from "../../utils/api";
import { SYSTEM_AUDIO } from "../../utils/audio";
import { NO_SIGNAL_SECS, apiLang } from "../../utils/lanes";
import { trimSilence } from "../../utils/voice";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { t, useT } from "../../i18n";
import Captions from "../Captions";
import {
  ArrowIcon,
  FloatIcon,
  IconButton,
  LinkButton,
  PlayIcon,
  Segmented,
  SlidersIcon,
  Spinner,
  StopIcon,
  Switch,
  VolumeIcon,
  cx,
} from "../shared";
import styles from "./styles.module.css";

/** The lane direction's class: its color. */
const LANE_CLASS = { local_to_remote: styles.laneLocalToRemote };

/** Height of each level bar (share of the full height): uneven, like a sound wave. */
const BAR_SHAPE = [0.4, 0.8, 0.55, 0.95, 0.45, 0.7];

/** Sample sentence to test a voice, in its language. For the others, the Spanish one is translated. */
const VOICE_SAMPLES = {
  es: "Hola, así sonará la traducción con esta voz.",
  en: "Hi, this is how the translation will sound with this voice.",
  fr: "Bonjour, voici comment la traduction sonnera avec cette voix.",
  it: "Ciao, ecco come suonerà la traduzione con questa voce.",
  pt: "Olá, é assim que a tradução vai soar com esta voz.",
};

/**
 * Lane card: header, main control, collapsible settings and the
 * translations as subtitles (the most recent one at the bottom, highlighted).
 */
export default function LaneCard({ lane, compact, original, onOriginal, state: s, meter, volume, inputs, onToggle, onChange, onVolume, saveNotes, onSaveNotes, floating, onFloating, onOpenSettings }) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  /** @type {[import("../../utils/api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  const target = apiLang(lane.targetLang);

  // The voices of the language; they are checked again when returning to the app in case one was downloaded.
  useEffect(() => {
    if (!settingsOpen) return;
    const load = () =>
      api
        .voices(target)
        .then(setVoiceList)
        .catch(() => setVoiceList([]));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [settingsOpen, target]);
  const latestId = s.history[0]?.id;
  const live = [...s.heard.map((h) => h.text), s.partial].filter(Boolean).join(" ");

  // Follows the latest translation and what is being heard, unless the user scrolled up to reread.
  const feed = useStickToBottom([latestId, live, showHistory]);
  const { toBottom } = feed;
  // When the history opens, it starts at the latest.
  useEffect(() => {
    if (showHistory) toBottom("instant");
  }, [showHistory, toBottom]);

  const status = s.starting
    ? t("app.lane.status.preparing")
    : !s.running
      ? t("app.lane.status.paused")
      : meter?.speaking
        ? t("app.lane.status.detecting")
        : t("app.lane.status.listening");
  const noSignal = s.running && meter && meter.silentSecs > NO_SIGNAL_SECS;
  // Square root: the voice through BlackHole comes in at a low level.
  const level = s.running && meter ? Math.min(1, Math.sqrt(meter.level) * 3) : 0;
  const barsMode = !s.running || noSignal ? null : meter?.speaking ? "isSpeaking" : "isListening";
  const entries = [...s.history].reverse();
  const same = lane.sourceLang === lane.targetLang;
  const speaks = lane.speak && !same;
  // If the chosen gender has no voice in this language, Rust uses the other one.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  const showSource = !same && (lane.showSource ?? speaks);
  // A single setting for which text is shown: the translation, the original without
  // translating (only in Translate audio) or both.
  const subtitles = same ? "original" : showSource ? "both" : "translated";
  const subtitleOptions = [
    ["translated", t("app.lane.subtitles.translated"), t("app.lane.subtitles.translated.hint")],
    ...(original !== undefined ? [["original", t("app.lane.subtitles.original"), t("app.lane.subtitles.original.hint")]] : []),
    ["both", t("app.lane.subtitles.both"), t("app.lane.subtitles.both.hint")],
  ];
  const tapsMac = lane.inputDeviceId === SYSTEM_AUDIO;
  const inputName = tapsMac
    ? t("app.lane.input.mac")
    : (inputs.find((d) => d.webId && d.webId === lane.inputDeviceId)?.name ?? t("app.lane.input.default"));
  /** @param {string} value */
  const chooseSubtitles = (value) => {
    if (original !== undefined) onOriginal(value === "original");
    if (value !== "original") onChange({ showSource: value === "both" });
  };

  return (
    <section className={cx(styles.lane, LANE_CLASS[lane.direction], s.running && styles.isRunning, compact && styles.isCompact)}>
      <header className={styles.laneHead}>
        <div>
          <div className={styles.langs}>
            <span>{lane.sourceLang}</span>
            {same ? (
              <span className={styles.langsNote}>{t("app.lane.sameLang")}</span>
            ) : (
              <>
                <ArrowIcon />
                <span>{lane.targetLang}</span>
              </>
            )}
          </div>
          <h2>{lane.title}</h2>
          <p className="muted">{lane.subtitle}</p>
        </div>
        <div className={styles.laneHeadActions}>
          {floating !== undefined && (
            <IconButton
              active={floating}
              onClick={onFloating}
              title={floating ? t("app.lane.floatClose") : t("app.lane.floatOpen")}
              aria-pressed={floating}
            >
              <FloatIcon />
            </IconButton>
          )}
          <IconButton
            active={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
            title={t("app.lane.settings")}
            aria-expanded={settingsOpen}
          >
            <SlidersIcon />
          </IconButton>
        </div>
      </header>

      {settingsOpen && (
        <div className={styles.settings}>
          {/* The essentials: what you see and what you hear. */}
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>{t("app.lane.subtitles")}</span>
            <Segmented
              value={subtitles}
              onChange={chooseSubtitles}
              options={subtitleOptions.map(([value, label, hint]) => ({ value, label, hint }))}
            />
          </div>
          {!same && (
            <div className={styles.settingRow}>
              <span className={styles.settingLabel}>{t("app.lane.voice")}</span>
              <Segmented
                value={speaks ? voice : "off"}
                onChange={(value) => {
                  if (value === "off") return onChange({ speak: false });
                  // A specific voice of another gender no longer applies: it goes back to automatic.
                  const chosen = voiceList.find((v) => v.id === voiceId);
                  const { [target]: _, ...rest } = lane.voiceIds;
                  onChange({ speak: true, voice: value, ...(chosen && chosen.gender !== value ? { voiceIds: rest } : {}) });
                }}
                options={[
                  { value: "off", label: t("app.lane.voice.off"), hint: t("app.lane.voice.off.hint") },
                  // It is read in every sentence: it can be changed while the lane is running.
                  {
                    value: "female",
                    label: t("app.lane.voice.female"),
                    disabled: !lane.voices.female,
                    hint: lane.voices.female ? undefined : t("app.lane.voice.female.missing"),
                  },
                  {
                    value: "male",
                    label: t("app.lane.voice.male"),
                    disabled: !lane.voices.male,
                    hint: lane.voices.male ? undefined : t("app.lane.voice.male.missing"),
                  },
                ]}
              />
            </div>
          )}
          {/* The specific voice and the speed, at hand; the devices, in Settings. */}
          {speaks && <VoiceControls lane={lane} volume={volume} onChange={onChange} />}
          {!same && !lane.voices.female && !lane.voices.male && (
            <p className="settings-note">
              {t("app.lane.noVoicesNote")}
            </p>
          )}

          {/* Devices: the app chooses them by itself; they are changed in Settings. */}
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>{t("app.lane.audio")}</span>
            <button className={styles.settingSummary} onClick={onOpenSettings}>
              <span className={styles.settingSummaryText}>
                {inputName}
                {speaks && ` → ${lane.outputDevice || t("app.lane.output.default")}`}
              </span>
              <span className={styles.settingMore}>{t("app.lane.audio.change")}</span>
            </button>
          </div>
        </div>
      )}

      <div className={styles.control}>
        <button
          className={cx(styles.toggle, s.running && styles.isRunning)}
          onClick={onToggle}
          disabled={s.starting}
          title={s.running ? t("app.lane.stop") : t("app.lane.start")}
        >
          {s.starting ? <Spinner /> : s.running ? <StopIcon /> : <PlayIcon />}
        </button>
        <div className={styles.controlStatus}>
          <span className={styles.statusText}>{status}</span>
          <span className={styles.statusSub}>
            {s.pending > 0 ? t("app.lane.queued", { count: s.pending }) : s.running ? t("app.lane.autoTranslating") : t("app.lane.pressToStart")}
          </span>
        </div>
        {saveNotes !== undefined && (
          <Switch
            className={styles.laneSave}
            title={saveNotes ? t("app.lane.saveNotes.on") : t("app.lane.saveNotes.off")}
            checked={saveNotes}
            onChange={onSaveNotes}
            label={t("app.lane.saveNotes")}
          />
        )}
        {/* The wave shape is always visible; the real level only stretches it, and the
            pulse inside says "someone is speaking" or, softer, "listening". Still when
            paused or without signal. */}
        <div className={cx(styles.bars, barsMode && styles[barsMode])} aria-hidden>
          {BAR_SHAPE.map((f, i) => (
            <span key={i} style={{ height: `${f * (s.running ? 0.6 + 0.4 * level : 0.5) * 100}%` }}>
              <i />
            </span>
          ))}
        </div>
        {speaks ? (
        <label className={styles.volume} title={t("app.lane.volume")}>
          <VolumeIcon />
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            style={{ "--fill": `${(volume / 2) * 100}%` }}
          />
          <span className={styles.volumeValue}>{Math.round(volume * 100)}%</span>
        </label>
        ) : (
          <span className={styles.subtitlesOnly} title={t("app.lane.captionsOnly.hint")}>
            {t("app.lane.captionsOnly")}
          </span>
        )}
      </div>

      {noSignal && (
        <p className={cx(styles.notice, styles.noticeWarn)}>
          {lane.direction === "remote_to_local"
            ? tapsMac
              ? t("app.lane.noSignal.mac")
              : t("app.lane.noSignal.blackhole")
            : t("app.lane.noSignal.mic")}
        </p>
      )}
      {s.error && <p className={cx(styles.notice, styles.noticeError)}>{s.error}</p>}

      {!compact && !showHistory && (
        <Captions className={styles.captions} state={s} live={live} showSource={showSource} onHistory={() => setShowHistory(true)} />
      )}
      {/* Outside the list: the list scrolls down by itself to the last sentence, and the button would stay hidden at the top. */}
      {!compact && showHistory && (
        <div className={styles.feedBar}>
          <span>{t("app.lane.history")}</span>
          <LinkButton onClick={() => setShowHistory(false)}>{t("app.lane.backToCaptions")}</LinkButton>
        </div>
      )}
      {!compact && showHistory && (
      <div className={styles.feedWrap}>
      <div className={styles.feed} ref={feed.ref} onScroll={feed.onScroll}>
        {entries.length === 0 && !live ? (
          <div className={styles.empty}>
            <p>{t("app.lane.empty1")}</p>
            <p>{t("app.lane.empty2")}</p>
          </div>
        ) : (
          entries.map((h) => {
            const latest = h.id === latestId;
            return (
              <article key={h.id} className={cx(styles.line, latest && styles.isLatest)}>
                {showSource && <p className={styles.lineSource} dir="auto">{h.transcript}</p>}
                <p className={styles.lineTarget} dir="auto">{h.translation}</p>
                {/* Technical data: shown on hover; "voice skipped" is always visible. */}
                <button
                  className={cx(styles.lineMeta, (h.skipped || detailsId === h.id) && styles.isVisible)}
                  onClick={() => setDetailsId(detailsId === h.id ? null : h.id)}
                >
                  {h.lagSecs === null
                    ? t("app.lane.soon")
                    : t(h.skipped ? "app.lane.lagSkipped" : "app.lane.lag", { secs: h.lagSecs.toFixed(1) })}
                </button>
                {detailsId === h.id && (
                  <div className={styles.details}>
                    <p>
                      {t("app.lane.details", { dur: h.source_duration_secs.toFixed(1), stt: h.stt_ms, tr: h.translate_ms })}
                    </p>
                    <audio controls src={`data:audio/wav;base64,${h.source_wav_base64}`} preload="none" />
                  </div>
                )}
              </article>
            );
          })
        )}
        {live && (
          <div className={styles.live} aria-live="polite">
            <span className="live-dot" />
            <p className={styles.liveText} dir="auto">
              {live}
              <span className={styles.caret} />
            </p>
          </div>
        )}
      </div>
      {feed.away && (
        <button className={styles.jump} onClick={() => toBottom()}>
          <ArrowIcon />
          {t("app.lane.jumpToLatest")}
        </button>
      )}
      </div>
      )}
    </section>
  );
}

/** "Paulina · mujer, México · Premium" @param {import("../../utils/api").VoiceInfo} v */
const voiceLabel = (v) =>
  [v.name, [v.gender === "female" ? t("app.voices.gender.female") : v.gender === "male" ? t("app.voices.gender.male") : "", v.detail].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");

/**
 * The specific voice (with preview) and the maximum speed, on the lane's card:
 * they are changed often and must be at hand.
 * @param {{ lane: import("../../App/types").Lane & { voices: { female: boolean, male: boolean } }, volume: number,
 *   onChange: (patch: Partial<import("../../App/types").Lane>) => void }} props
 */
function VoiceControls({ lane, volume, onChange }) {
  const t = useT();
  /** @type {[import("../../utils/api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  /** The voice list for the language has arrived; until then the selector is disabled. */
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const target = apiLang(lane.targetLang);

  // The voices of the language; they are checked again when returning to the app in case one was downloaded.
  useEffect(() => {
    const load = () =>
      api
        .voices(target)
        .then(setVoiceList)
        .catch(() => setVoiceList([]))
        .finally(() => setVoicesLoaded(true));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [target]);

  // If the chosen gender has no voice in this language, Rust uses the other one.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  /** @param {string} id "" = automatic. */
  const chooseVoice = (id) => {
    const { [target]: _, ...rest } = lane.voiceIds;
    const chosen = voiceList.find((v) => v.id === id);
    onChange({ voiceIds: id ? { ...rest, [target]: id } : rest, ...(chosen?.gender ? { voice: chosen.gender } : {}) });
  };
  /** Speaks a sample sentence with the chosen voice, through the lane's output. */
  const previewVoice = async () => {
    setPreviewing(true);
    setPreviewError("");
    try {
      const text =
        VOICE_SAMPLES[target] ?? (await api.translate(VOICE_SAMPLES.es, "es", target, "", () => {}, false, true)).translation;
      const speech = await api.speak(text, target, voice, 1, voiceId || null);
      await api.playAudio(trimSilence(speech.audio, speech.sample_rate), speech.sample_rate, lane.outputDevice, volume);
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      {/* Always in view, so the card does not jump when the voices arrive:
          disabled while they load or if the language has only one. */}
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} />
        <div className={styles.voicePick}>
          <select
            value={voiceId}
            onChange={(e) => chooseVoice(e.target.value)}
            disabled={!voicesLoaded || voiceList.length <= 1}
            aria-label={t("app.voices.specific")}
          >
            <option value="">{t(voice === "female" ? "app.voices.auto.female" : "app.voices.auto.male")}</option>
            {[
              ["kokoro", t("app.voices.group.kokoro")],
              ["system", t("app.voices.group.system")],
            ].map(([engine, label]) => {
              const list = voiceList.filter((v) => v.engine === engine);
              return (
                list.length > 0 && (
                  <optgroup key={engine} label={label}>
                    {list.map((v) => (
                      <option key={v.id} value={v.id}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
          <button className={styles.voicePreview} onClick={previewVoice} disabled={previewing} title={t("app.voices.preview.hint")}>
            {previewing ? <Spinner /> : t("app.voices.preview")}
          </button>
        </div>
      </div>
      {previewError && <p className="settings-note">{previewError}</p>}
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>{t("app.voices.speed")}</span>
        <label className={styles.speedPick} title={t("app.voices.speed.hint")}>
          <input
            type="range"
            className={styles.wide}
            min="1"
            max="1.4"
            step="0.05"
            value={lane.maxSpeed}
            onChange={(e) => onChange({ maxSpeed: Number(e.target.value) })}
            style={{ "--fill": `${((lane.maxSpeed - 1) / 0.4) * 100}%` }}
            aria-label={t("app.voices.speed.aria")}
          />
          <strong className={styles.fieldValue}>{t("app.voices.speed.upTo", { speed: lane.maxSpeed.toFixed(2) })}</strong>
        </label>
      </div>
    </>
  );
}
