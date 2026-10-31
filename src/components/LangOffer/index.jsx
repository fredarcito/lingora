import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { nativeName } from "@components/LanguagePicker";
import { OFFER_KEY, generatedLangs, rawSystemLang, useLang, useT } from "@i18n";
import { generateLanguage } from "@i18n/generate";
import { Button } from "@components/shared";
import styles from "./styles.module.css";

/** @returns {boolean} */
function alreadyDecided() {
  try {
    return !!localStorage.getItem(OFFER_KEY) || !!localStorage.getItem("lingora.uiLang");
  } catch {
    return true;
  }
}

/**
 * One-time notice: if the system is set to a language that Lingora does not ship but
 * can translate, it offers to generate the interface in that language with the local model.
 */
export default function LangOffer() {
  const t = useT();
  const { setLang } = useLang();
  const [offer, setOffer] = useState(/** @type {{ code: string, name: string } | null} */ (null));
  const [progress, setProgress] = useState(/** @type {{ done: number, total: number } | null} */ (null));
  const [error, setError] = useState("");
  const control = useRef({ cancelled: false });

  useEffect(() => {
    const code = rawSystemLang();
    if (code === "es" || code === "en" || alreadyDecided() || generatedLangs().includes(code)) return;
    api
      .languages()
      .then((list) => {
        const found = list.find((l) => l.code === code);
        if (found) setOffer({ code, name: nativeName(code, found.name) });
      })
      .catch(() => {});
  }, []);

  if (!offer) return null;

  const dismiss = () => {
    control.current.cancelled = true;
    try {
      localStorage.setItem(OFFER_KEY, "1");
    } catch {
      // It will ask again next time.
    }
    setOffer(null);
  };

  const generate = async () => {
    setError("");
    control.current = { cancelled: false };
    setProgress({ done: 0, total: 1 });
    try {
      const result = await generateLanguage(offer.code, (done, total) => setProgress({ done, total }), control.current);
      if (result) {
        setLang(offer.code);
        dismiss();
      }
    } catch (e) {
      setError(e instanceof Error && e.message === "local-model-missing" ? t("languagePicker.noModel") : errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className={styles.langOffer} role="dialog" aria-label={t("langOffer.title", { language: offer.name })}>
      <p>
        <strong>{t("langOffer.title", { language: offer.name })}</strong>
        <span>{progress ? t("languagePicker.progress", { done: progress.done, total: progress.total }) : error || t("langOffer.hint")}</span>
      </p>
      <div className={styles.langOfferActions}>
        <Button onClick={progress ? () => (control.current.cancelled = true) : generate}>
          {progress ? t("languagePicker.cancel") : t("languagePicker.generate")}
        </Button>
        {!progress && <Button onClick={dismiss}>{t("langOffer.no")}</Button>}
      </div>
    </div>
  );
}
