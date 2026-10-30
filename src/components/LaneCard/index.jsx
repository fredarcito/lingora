import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../utils/api";
import { SYSTEM_AUDIO } from "../../utils/audio";
import { NO_SIGNAL_SECS, apiLang } from "../../utils/lanes";
import { trimSilence } from "../../utils/voice";
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

/** La clase de la dirección del carril: su color. */
const LANE_CLASS = { local_to_remote: styles.laneLocalToRemote };

/** Frase para probar una voz, en su idioma. Para los demás se traduce la española. */
const VOICE_SAMPLES = {
  es: "Hola, así sonará la traducción con esta voz.",
  en: "Hi, this is how the translation will sound with this voice.",
  fr: "Bonjour, voici comment la traduction sonnera avec cette voix.",
  it: "Ciao, ecco come suonerà la traduzione con questa voce.",
  pt: "Olá, é assim que a tradução vai soar com esta voz.",
};

/**
 * Tarjeta de un carril: cabecera, control principal, ajustes plegables y las
 * traducciones como subtítulos (la más reciente abajo y destacada).
 */
export default function LaneCard({ lane, compact, original, onOriginal, state: s, meter, volume, inputs, onToggle, onChange, onVolume, saveNotes, onSaveNotes, floating, onFloating, onOpenSettings }) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  /** @type {[import("../../utils/api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  const feed = useRef(null);
  const target = apiLang(lane.targetLang);

  // Las voces del idioma; se vuelven a mirar al volver a la app por si se descargó alguna.
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

  // Sigue la última traducción y lo que se está oyendo, como unos subtítulos.
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [latestId, live]);

  const status = s.starting
    ? t("app.lane.status.preparing")
    : !s.running
      ? t("app.lane.status.paused")
      : meter?.speaking
        ? t("app.lane.status.detecting")
        : t("app.lane.status.listening");
  const noSignal = s.running && meter && meter.silentSecs > NO_SIGNAL_SECS;
  // Raíz cuadrada: la voz por BlackHole llega con poco nivel.
  const level = s.running && meter ? Math.min(1, Math.sqrt(meter.level) * 3) : 0;
  const entries = [...s.history].reverse();
  const same = lane.sourceLang === lane.targetLang;
  const speaks = lane.speak && !same;
  // Si el género elegido no tiene voz en este idioma, Rust usa el otro.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  const showSource = !same && (lane.showSource ?? speaks);
  // Un solo ajuste para qué texto se ve: la traducción, el original sin
  // traducir (solo en Traducir audio) o los dos.
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
          {/* Lo esencial: qué ves y qué oyes. */}
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
                  // Una voz concreta de otro género deja de valer: vuelve a la automática.
                  const chosen = voiceList.find((v) => v.id === voiceId);
                  const { [target]: _, ...rest } = lane.voiceIds;
                  onChange({ speak: true, voice: value, ...(chosen && chosen.gender !== value ? { voiceIds: rest } : {}) });
                }}
                options={[
                  { value: "off", label: t("app.lane.voice.off"), hint: t("app.lane.voice.off.hint") },
                  // Se lee en cada frase: se puede cambiar con el carril en marcha.
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
          {/* La voz concreta y la velocidad, a mano; los dispositivos, en Ajustes. */}
          {speaks && <VoiceControls lane={lane} volume={volume} onChange={onChange} />}
          {!same && !lane.voices.female && !lane.voices.male && (
            <p className="settings-note">
              {t("app.lane.noVoicesNote")}
            </p>
          )}

          {/* Dispositivos: la app los elige sola; se cambian en Ajustes. */}
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
        <div className={cx(styles.bars, meter?.speaking && styles.isSpeaking)} aria-hidden>
          {[0.55, 0.85, 1, 0.75, 0.5].map((f, i) => (
            <span key={i} style={{ transform: `scaleY(${Math.max(0.12, level * f)})` }} />
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
        <Captions state={s} live={live} showSource={showSource} onHistory={() => setShowHistory(true)} />
      )}
      {/* Fuera de la lista: la lista baja sola hasta la última frase y el botón quedaba oculto arriba. */}
      {!compact && showHistory && (
        <div className={styles.feedBar}>
          <span>{t("app.lane.history")}</span>
          <LinkButton onClick={() => setShowHistory(false)}>{t("app.lane.backToCaptions")}</LinkButton>
        </div>
      )}
      {!compact && showHistory && (
      <div className={styles.feed} ref={feed}>
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
                {/* Datos técnicos: aparecen al pasar el ratón; "voz omitida" sí se ve siempre. */}
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
 * La voz concreta (con prueba) y la velocidad máxima, en la tarjeta del
 * carril: se cambian a menudo y tienen que estar a mano.
 * @param {{ lane: import("../../App/types").Lane & { voices: { female: boolean, male: boolean } }, volume: number,
 *   onChange: (patch: Partial<import("../../App/types").Lane>) => void }} props
 */
function VoiceControls({ lane, volume, onChange }) {
  const t = useT();
  /** @type {[import("../../utils/api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  /** Ya llegó la lista de voces del idioma; hasta entonces el selector está desactivado. */
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const target = apiLang(lane.targetLang);

  // Las voces del idioma; se vuelven a mirar al volver a la app por si se descargó alguna.
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

  // Si el género elegido no tiene voz en este idioma, Rust usa el otro.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  /** @param {string} id "" = automática. */
  const chooseVoice = (id) => {
    const { [target]: _, ...rest } = lane.voiceIds;
    const chosen = voiceList.find((v) => v.id === id);
    onChange({ voiceIds: id ? { ...rest, [target]: id } : rest, ...(chosen?.gender ? { voice: chosen.gender } : {}) });
  };
  /** Dice una frase de ejemplo con la voz elegida, por la salida del carril. */
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
      {/* Siempre a la vista, para que la tarjeta no salte al llegar las voces:
          desactivado mientras cargan o si el idioma solo tiene una. */}
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
