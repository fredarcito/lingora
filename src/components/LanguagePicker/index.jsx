import { useRef, useState } from "react";
import { errorMessage } from "../../utils/api";
import { BUNDLED_LANGS, generatedLangs, removeGenerated, systemLang, useLang, useT } from "../../i18n";
import { generateLanguage } from "../../i18n/generate";
import { Button, Select, cx } from "../shared";
import styles from "./styles.module.css";

const NEW = "__new";

/** Name of a language written in that same language; if the system does not know it, the one the app provides. @param {string} code @param {string} fallback */
export function nativeName(code, fallback) {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // Code that Intl does not recognize.
  }
  return fallback;
}

/**
 * Interface language selector: the built-in ones, the ones generated on this device
 * and "Generate another language…", which translates the interface with the local model.
 * @param {{ languages: import("../../utils/api").LanguageInfo[] }} props
 */
export default function LanguagePicker({ languages }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const [generated, setGenerated] = useState(generatedLangs);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState("");
  const [progress, setProgress] = useState(/** @type {{ done: number, total: number } | null} */ (null));
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const control = useRef({ cancelled: false });

  const names = new Map(languages.map((l) => [l.code, l.name]));
  const nameOf = (/** @type {string} */ code) => nativeName(code, names.get(code) ?? code);
  const bundled = new Set(BUNDLED_LANGS.map((l) => l.code));
  const candidates = languages.filter((l) => !bundled.has(l.code));
  const isGenerated = generated.includes(lang);

  const run = async (/** @type {string} */ code) => {
    setMessage("");
    setIsError(false);
    control.current = { cancelled: false };
    setProgress({ done: 0, total: 1 });
    try {
      const result = await generateLanguage(code, (done, total) => setProgress({ done, total }), control.current);
      setGenerated(generatedLangs());
      if (result) {
        setCreating(false);
        setLang(code);
        if (result.missing > 0) setMessage(t("languagePicker.partial", { count: result.missing }));
      }
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error && e.message === "local-model-missing" ? t("languagePicker.noModel") : errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  /** @param {string} value */
  const choose = (value) => {
    setMessage("");
    if (value === NEW) {
      setCreating(true);
      setTarget((c) => c || candidates.find((l) => !generated.includes(l.code))?.code || "");
    } else {
      setCreating(false);
      setLang(value);
    }
  };

  const remove = () => {
    removeGenerated(lang);
    setGenerated(generatedLangs());
    setLang(systemLang());
  };

  return (
    <>
      <label className="prefs-row">
        <span>
          <strong>{t("languagePicker.title")}</strong>
          <small>{t("languagePicker.hint")}</small>
        </span>
        <Select
          value={creating ? NEW : lang}
          disabled={!!progress}
          onChange={choose}
          options={[
            ...BUNDLED_LANGS.map((l) => ({ value: l.code, label: l.name })),
            ...generated.map((code) => ({ value: code, label: `${nameOf(code)} · ${t("languagePicker.auto")}` })),
            { value: NEW, label: t("languagePicker.generateOption") },
          ]}
        />
      </label>

      {creating && (
        <div className={cx("prefs-row prefs-row-static", styles.langGenerate)}>
          <span>
            <strong>{t("languagePicker.generateTitle")}</strong>
            <small>{progress ? t("languagePicker.progress", { done: progress.done, total: progress.total }) : t("languagePicker.generateHint")}</small>
            {progress && <progress value={progress.done} max={progress.total} />}
          </span>
          {!progress ? (
            <span className={styles.langGenerateActions}>
              <Select value={target} onChange={setTarget} options={candidates.map((l) => ({ value: l.code, label: nameOf(l.code) }))} />
              <Button disabled={!target} onClick={() => run(target)}>
                {t("languagePicker.generate")}
              </Button>
            </span>
          ) : (
            <Button onClick={() => (control.current.cancelled = true)}>{t("languagePicker.cancel")}</Button>
          )}
        </div>
      )}

      {isGenerated && !creating && (
        <div className="prefs-row prefs-row-static">
          <span>
            <small>{t("languagePicker.autoNote")}</small>
          </span>
          <span className={styles.langGenerateActions}>
            <Button disabled={!!progress} onClick={() => run(lang)}>
              {t("languagePicker.regenerate")}
            </Button>
            <Button disabled={!!progress} onClick={remove}>
              {t("languagePicker.remove")}
            </Button>
          </span>
        </div>
      )}

      {message && <p className={isError ? "notes-error" : "muted"}>{message}</p>}
    </>
  );
}
