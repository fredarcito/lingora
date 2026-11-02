import { useState } from "react";
import { useT } from "@i18n";
import { Button } from "@components/shared";
import SummaryDownload from "@components/SummaryDownload";
import SummaryKeyForm from "@components/SummaryKeyForm";
import { isLowMemory, PROVIDERS } from "@utils/summarySource.js";
import styles from "./styles.module.css";

/**
 * How to summarize, when the note can't yet: on the computer (download the
 * summary) or with the user's AI key. Both are always offered; with little
 * memory the key goes first, as the recommended one.
 * @param {{ model: import("@hooks/useSummaryModel").SummaryModelState, memoryGb: number | null,
 *   source: string, onDownload: () => void, onLocal: () => void,
 *   onKeySaved: (provider: string) => void }} props
 */
export default function SummaryOptions({ model, memoryGb, source, onDownload, onLocal, onKeySaved }) {
  const t = useT();
  const low = isLowMemory(memoryGb);
  // Open right away if a service was chosen and its key is missing.
  const [keyOpen, setKeyOpen] = useState(source !== "local");
  const services = PROVIDERS.map((p) => (p.custom ? t("summarySource.other") : p.name)).join(" · ");

  const local = <SummaryDownload key="local" model={model} onDownload={onDownload} onLocal={onLocal} primary={!low} />;
  const key = (
    <div key="key" className={styles.summaryOptionsKey}>
      <strong>{t("summarySource.useKey")}</strong>
      <p className="muted">{services}</p>
      <p>{t("summarySource.useKeyText")}</p>
      {keyOpen ? (
        <SummaryKeyForm
          provider={source !== "local" ? source : undefined}
          active={source}
          submitLabel={t("summarySource.saveAndSummarize")}
          onSaved={onKeySaved}
        />
      ) : (
        <Button variant={low ? "primary" : "default"} onClick={() => setKeyOpen(true)}>
          {t("summarySource.useKeyButton")}
        </Button>
      )}
    </div>
  );

  return (
    <div className={styles.summaryOptions}>
      {low && <p className={styles.summaryOptionsLow}>{t("summarySource.lowMemory")}</p>}
      <p>{t("summarySource.chooseHow")}</p>
      {low ? [key, local] : [local, key]}
    </div>
  );
}
