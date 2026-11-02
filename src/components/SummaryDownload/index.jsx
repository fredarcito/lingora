import { useLang, useT } from "@i18n";
import { Button } from "@components/shared";
import { formatSize } from "@utils/storage";
import styles from "./styles.module.css";

/**
 * The local summary inside the note's options (`SummaryOptions`): what the
 * download costs and a button, then its progress with the time left. Once
 * downloaded, a button to summarize on the computer.
 * @param {{ model: import("@hooks/useSummaryModel").SummaryModelState, onDownload: () => void,
 *   onLocal: () => void, primary?: boolean }} props `primary` when it is the recommended option.
 */
export default function SummaryDownload({ model, onDownload, onLocal, primary = true }) {
  const t = useT();
  const { lang } = useLang();
  const percent = model.total ? Math.min(100, (model.downloaded / model.total) * 100) : 0;
  const left = !model.etaSecs
    ? ""
    : model.etaSecs < 60
      ? t("summaryModel.lessThanMinute")
      : t("summaryModel.minutes", { count: Math.round(model.etaSecs / 60) });
  const variant = primary ? "primary" : "default";

  return (
    <div className={styles.summaryDownload}>
      <strong>{t("summaryModel.title")}</strong>
      <p>{t("summaryModel.text", { size: formatSize(model.total, lang) })}</p>
      {model.installed ? (
        <Button variant={variant} onClick={onLocal}>
          {t("summaryModel.useLocal")}
        </Button>
      ) : model.downloading ? (
        <>
          <div
            className={styles.summaryDownloadBar}
            role="progressbar"
            aria-label={t("summaryModel.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="muted">
            {t("summaryModel.progress", { done: formatSize(model.downloaded, lang), total: formatSize(model.total, lang) })}
            {left && ` · ${left}`}
          </p>
          <p className="muted">{t("summaryModel.afterDownload")}</p>
        </>
      ) : (
        <Button variant={variant} onClick={onDownload}>
          {model.error || model.downloaded > 0
            ? t("summaryModel.resume")
            : t("summaryModel.download", { size: formatSize(model.total, lang) })}
        </Button>
      )}
      {model.error && (
        <p className="notes-error" role="alert">
          {model.error}
        </p>
      )}
    </div>
  );
}
