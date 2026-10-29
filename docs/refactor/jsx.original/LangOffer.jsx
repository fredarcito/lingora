import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { nativeName } from "./LanguagePicker";
import { OFFER_KEY, generatedLangs, rawSystemLang, useLang, useT } from "./i18n";
import { generateLanguage } from "./i18n/generate";

/** @returns {boolean} */
function alreadyDecided() {
  try {
    return !!localStorage.getItem(OFFER_KEY) || !!localStorage.getItem("lingora.uiLang");
  } catch {
    return true;
  }
}

/**
 * Aviso de una sola vez: si el sistema está en un idioma que Lingora no trae pero
 * sabe traducir, ofrece generar la interfaz en él con el modelo local.
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
      // Volverá a preguntar la próxima vez.
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
    <div className="lang-offer" role="dialog" aria-label={t("langOffer.title", { language: offer.name })}>
      <p>
        <strong>{t("langOffer.title", { language: offer.name })}</strong>
        <span>{progress ? t("languagePicker.progress", { done: progress.done, total: progress.total }) : error || t("langOffer.hint")}</span>
      </p>
      <div className="lang-offer-actions">
        <button className="note-action" onClick={progress ? () => (control.current.cancelled = true) : generate}>
          {progress ? t("languagePicker.cancel") : t("languagePicker.generate")}
        </button>
        {!progress && (
          <button className="note-action" onClick={dismiss}>
            {t("langOffer.no")}
          </button>
        )}
      </div>
    </div>
  );
}
