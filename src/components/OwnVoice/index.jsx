import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { announceVoices } from "@utils/voiceDownloads";
import { trimSilence } from "@utils/voice";
import { useVoiceDownload } from "@hooks/useVoiceDownload";
import { useVoiceRecorder } from "@hooks/useVoiceRecorder";
import { englishStrings, useLang, useT } from "@i18n";
import { Button, ConfirmDialog, LinkButton, Spinner } from "@components/shared";
import { formatSize } from "@utils/storage";
import styles from "./styles.module.css";

/** Same limits as `own_voice.rs`: shorter clones badly, longer is cut. */
const MIN_SECS = 8;
const MAX_SECS = 30;
/** The model id for `downloadModel` (`Model::OwnVoice`). */
const MODEL = "own_voice";

/**
 * Settings → Speak: "Your voice". Downloads its model, records a short reading
 * with the lane's microphone and lets you hear it, record it again or delete
 * it. The Speak card then offers "Your voice" (`own_voice.rs`). Only your own
 * voice: the model's licence forbids cloning anyone else's.
 * @param {{ running: boolean, inputDeviceId: string }} props
 */
export default function OwnVoice({ running, inputDeviceId }) {
  const t = useT();
  const { lang } = useLang();
  const [status, setStatus] = useState(/** @type {import("@utils/api").OwnVoiceStatus | null} */ (null));
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  /** What is playing: "recording" (what you read) or "clone" (how they will hear you); "" = nothing. */
  const [playing, setPlaying] = useState("");
  const [asking, setAsking] = useState(false);
  const voiceDownload = useVoiceDownload();
  const recorder = useVoiceRecorder();

  const refresh = useCallback(() => api.ownVoiceStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** @param {() => Promise<void>} action */
  const attempt = async (action) => {
    setProblem("");
    try {
      await action();
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  const record = () => attempt(() => recorder.start(inputDeviceId));

  const finish = useCallback(async () => {
    const taken = await recorder.stop();
    if (!taken) return;
    setSaving(true);
    try {
      const refused = await api.saveOwnVoice(taken.samples, taken.sampleRate);
      if (refused) setProblem(t(`ownVoice.problem.${refused}`, { secs: MIN_SECS }));
      else announceVoices();
      await refresh();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [recorder, refresh, t]);

  // At the limit it stops by itself.
  useEffect(() => {
    if (recorder.recording && recorder.secs >= MAX_SECS) finish();
  }, [recorder.recording, recorder.secs, finish]);

  /**
   * Plays through your speakers or headphones, not the call's microphone.
   * @param {"recording" | "clone"} what
   */
  const listen = (what) =>
    attempt(async () => {
      setPlaying(what);
      try {
        // The clone says, in English (the language it speaks for now), the text you read.
        const speech =
          what === "recording" ? await api.ownVoiceSample() : await api.speak(englishStrings()["ownVoice.script"], "en", "female", 1, "own");
        await api.playAudio(trimSilence(speech.audio, speech.sample_rate), speech.sample_rate, "");
      } finally {
        setPlaying("");
      }
    });

  const remove = () =>
    attempt(async () => {
      setAsking(false);
      await api.deleteOwnVoice();
      announceVoices();
      await refresh();
    });

  const download = async () => {
    setProblem("");
    if (await voiceDownload.download(MODEL)) await refresh();
  };

  if (!status) return null;
  const recorded = status.sample_secs > 0;
  const languages = status.langs.map((code) => new Intl.DisplayNames([lang], { type: "language" }).of(code)).join(", ");
  const hint = !status.model_installed
    ? t("ownVoice.hint.download", { languages })
    : recorder.recording
      ? recorder.secs < MIN_SECS
        ? t("ownVoice.hint.keepReading")
        : t("ownVoice.hint.canFinish")
      : recorded
        ? t("ownVoice.hint.ready", { secs: Math.round(status.sample_secs), languages })
        : t("ownVoice.hint.record", { languages });
  const downloading = voiceDownload.busy === MODEL;

  return (
    <div className={styles.ownVoice}>
      <div className="prefs-row prefs-row-static">
        <span>
          <strong>{t("ownVoice.title")}</strong>
          <small>{hint}</small>
        </span>
        <span className={styles.actions}>
          {!status.model_installed ? (
            <Button variant="primary" onClick={download} busy={downloading} disabled={Boolean(voiceDownload.busy)}>
              {downloading
                ? t("ownVoice.downloading", { percent: Math.round(voiceDownload.progress * 100) })
                : t("ownVoice.download", { size: formatSize(status.model_bytes, lang) })}
            </Button>
          ) : recorder.recording ? (
            <>
              <LinkButton onClick={recorder.cancel}>{t("ownVoice.cancel")}</LinkButton>
              <Button variant="stop" onClick={finish} disabled={recorder.secs < MIN_SECS}>
                {t("ownVoice.finish")}
              </Button>
            </>
          ) : recorded ? (
            <>
              <Button onClick={record} busy={saving} disabled={running || saving}>
                {t("ownVoice.again")}
              </Button>
              <Button variant="danger" onClick={() => setAsking(true)} disabled={saving}>
                {t("ownVoice.delete")}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={record} busy={saving} disabled={running || saving}>
              {t("ownVoice.record")}
            </Button>
          )}
        </span>
      </div>
      {recorder.recording && (
        <div className={styles.recorder}>
          <p className={styles.script}>{t("ownVoice.script")}</p>
          <div className={styles.meter} aria-hidden>
            <span style={{ width: `${recorder.level * 100}%` }} />
          </div>
          <small className={styles.secs}>{t("ownVoice.secs", { secs: Math.floor(recorder.secs), max: MAX_SECS })}</small>
        </div>
      )}
      {recorded && !recorder.recording && (
        // Light, as links: the buttons of the row above are the actions.
        <div className={styles.listen}>
          {/** @type {const} */ (["recording", "clone"]).map((what) => (
            <LinkButton key={what} onClick={() => listen(what)} disabled={Boolean(playing) || saving}>
              {playing === what ? <Spinner small /> : <span aria-hidden>▶</span>}
              {t(`ownVoice.listen.${what}`, { language: languages })}
            </LinkButton>
          ))}
        </div>
      )}
      {status.model_installed && !recorder.recording && <small className={styles.consent}>{t("ownVoice.consent")}</small>}
      {running && !recorder.recording && !recorded && status.model_installed && (
        <p className="settings-note">{t("ownVoice.stopToRecord")}</p>
      )}
      {(problem || voiceDownload.error) && <p className="notes-error">{problem || voiceDownload.error}</p>}
      {asking && (
        <ConfirmDialog
          danger
          title={t("ownVoice.confirmTitle")}
          body={t("ownVoice.confirmBody")}
          confirmLabel={t("ownVoice.delete")}
          cancelLabel={t("ownVoice.cancel")}
          onConfirm={remove}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
