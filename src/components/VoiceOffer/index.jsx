import { useEffect, useState } from "react";
import { api } from "@utils/api";
import { formatSize } from "@utils/storage";
import { voiceOffer } from "@utils/voiceDownloads";
import { useVoiceDownload } from "@hooks/useVoiceDownload";
import { useLang, useT } from "@i18n";
import { Button, cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * In the lane's settings, when the translation language has no voice on this
 * computer: one button that downloads the voice this computer should use (the
 * light one on a low-end computer, docs/plan-voz-ligera.md). Nobody has to
 * choose; the other voices are in "More voices…". Without anything to
 * download, the old note (captions only).
 * @param {{ lang: import("@utils/api").Lang, gender: "female" | "male" }} props
 */
export default function VoiceOffer({ lang, gender }) {
  const t = useT();
  const { lang: ui } = useLang();
  /** @type {[import("@utils/api").VoiceDownloads | null, Function]} */
  const [downloads, setDownloads] = useState(null);
  const { busy, progress, error, download } = useVoiceDownload();

  useEffect(() => {
    api.voiceDownloads(lang).then(setDownloads).catch(() => setDownloads(null));
  }, [lang]);

  if (!downloads) return null;
  const offer = voiceOffer(downloads, gender);
  if (!offer) return <p className="settings-note">{t("app.lane.noVoicesNote")}</p>;
  const hint =
    offer.kind === "natural"
      ? "app.voices.offer.natural"
      : downloads.light_recommended
        ? "app.voices.offer.light.recommended"
        : "app.voices.offer.light";
  return (
    <div className={cx("settings-note", styles.offer)}>
      <Button variant="primary" busy={Boolean(busy)} disabled={Boolean(busy)} onClick={() => download(offer.model)}>
        {busy
          ? t("app.voices.offer.downloading", { percent: Math.round(progress * 100) })
          : t("app.voices.offer.turnOn", { size: formatSize(offer.bytes, ui) })}
      </Button>
      <p>{t(hint)}</p>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
