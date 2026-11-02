import { useEffect, useState } from "react";
import { api } from "@utils/api";
import { formatSize } from "@utils/storage";
import { NATURAL_MODEL, VOICES_CHANGED, lightDownloads } from "@utils/voiceDownloads";
import { useVoiceDownload } from "@hooks/useVoiceDownload";
import { useLang, useT } from "@i18n";
import { Badge, Button } from "@components/shared";
import styles from "./styles.module.css";

/**
 * "More voices…" in the lane's settings: what can be downloaded for the
 * language, in two kinds, the one recommended for this computer first
 * (docs/plan-voz-ligera.md). The natural voice is one download with all its
 * voices; each light one is its own. After a download, `onPick` gets the voice
 * to use ("" = automatic).
 * @param {{ lang: import("@utils/api").Lang, gender: "female" | "male", onPick: (voiceId: string) => void }} props
 */
export default function MoreVoices({ lang, gender, onPick }) {
  const t = useT();
  const { lang: ui } = useLang();
  /** @type {[import("@utils/api").VoiceDownloads | null, Function]} */
  const [downloads, setDownloads] = useState(null);
  const { busy, progress, error, download } = useVoiceDownload();

  useEffect(() => {
    const load = () => api.voiceDownloads(lang).then(setDownloads).catch(() => setDownloads(null));
    load();
    window.addEventListener(VOICES_CHANGED, load);
    return () => window.removeEventListener(VOICES_CHANGED, load);
  }, [lang]);

  if (!downloads) return null;
  /** @param {string} model @param {number} bytes @param {boolean} installed @param {string} voiceId */
  const action = (model, bytes, installed, voiceId) =>
    installed ? (
      <span className={styles.ready}>{t("app.voices.downloaded")}</span>
    ) : (
      <Button
        busy={busy === model}
        disabled={Boolean(busy)}
        onClick={async () => {
          if (await download(model)) onPick(voiceId);
        }}
      >
        {busy === model
          ? t("app.voices.downloading", { percent: Math.round(progress * 100) })
          : t("app.voices.download", { size: formatSize(bytes, ui) })}
      </Button>
    );

  const natural = downloads.natural && (
    <section key="natural" className={styles.kind}>
      <header>
        <strong>{t("app.voices.natural.title")}</strong>
        {!downloads.light_recommended && <Badge>{t("app.voices.recommended")}</Badge>}
      </header>
      <p>{t("app.voices.natural.text")}</p>
      <div className={styles.row}>
        <span>{t("app.voices.natural.all")}</span>
        {action(NATURAL_MODEL, downloads.natural_bytes, downloads.natural_installed, "")}
      </div>
    </section>
  );
  const light = downloads.light.length > 0 && (
    <section key="light" className={styles.kind}>
      <header>
        <strong>{t("app.voices.light.title")}</strong>
        {downloads.light_recommended && <Badge>{t("app.voices.recommended")}</Badge>}
      </header>
      <p>{t("app.voices.light.text")}</p>
      {lightDownloads(downloads.light).map((group) => {
        const pick = group.voices.find((v) => v.gender === gender) ?? group.voices[0];
        return (
          <div key={group.model} className={styles.row}>
            <span>
              {group.voices
                .map((v) => `${v.name} · ${t(`app.voices.gender.${v.gender}`)}, ${v.detail}`)
                .join(" / ")}
            </span>
            {action(group.model, group.bytes, group.installed, pick.id)}
          </div>
        );
      })}
    </section>
  );

  return (
    <div className={styles.panel}>
      {downloads.light_recommended ? [light, natural] : [natural, light]}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
