import { useEffect, useState } from "react";
import { api } from "@utils/api";
import { lightSwitch } from "@utils/voiceDownloads";
import { useVoiceDownload } from "@hooks/useVoiceDownload";
import { useT } from "@i18n";
import { Button, cx } from "@components/shared";
import styles from "./styles.module.css";

/** "Keep" was chosen once: the notice doesn't come back. */
const KEPT_KEY = "lingora.lightVoiceKept";
/** How often Rust is asked while the lane speaks. */
const POLL_MS = 10_000;

const kept = () => {
  try {
    return localStorage.getItem(KEPT_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * On the lane's card: the natural voice can't keep up on this computer (it
 * takes more than 0.6× of each sentence's length to make it, `tts.rs`), so
 * sentences get skipped. It offers the light voice (docs/plan-voz-ligera.md),
 * downloading it if needed, or keeping the natural one; once kept, it doesn't
 * come back. `className` gives the card's notice look.
 * @param {{ lang: import("@utils/api").Lang, gender: "female" | "male", active: boolean,
 *   className?: string, onUse: (voiceId: string) => void }} props
 */
export default function VoiceStruggleNotice({ lang, gender, active, className, onUse }) {
  const t = useT();
  const [struggling, setStruggling] = useState(false);
  const [hidden, setHidden] = useState(kept);
  const { busy, progress, error, download } = useVoiceDownload();

  useEffect(() => {
    if (!active || hidden) return;
    const check = () => api.voiceStruggling().then(setStruggling).catch(() => {});
    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, [active, hidden]);

  if (!struggling || hidden) return null;

  const use = async () => {
    const offer = lightSwitch(await api.voiceDownloads(lang), gender);
    if (!offer) return setHidden(true);
    if (offer.model && !(await download(offer.model))) return;
    onUse(offer.voiceId);
    setStruggling(false);
  };
  const keep = () => {
    try {
      localStorage.setItem(KEPT_KEY, "1");
    } catch {
      // Without storage it only goes away until the app restarts.
    }
    setHidden(true);
  };

  return (
    <div className={cx(className, styles.notice)}>
      <p>
        {t("app.lane.struggle")}
        {error && <span className={styles.error}>{error}</span>}
      </p>
      <Button onClick={use} busy={Boolean(busy)} disabled={Boolean(busy)}>
        {busy ? t("app.voices.downloading", { percent: Math.round(progress * 100) }) : t("app.lane.struggle.use")}
      </Button>
      <Button onClick={keep} disabled={Boolean(busy)}>
        {t("app.lane.struggle.keep")}
      </Button>
    </div>
  );
}
