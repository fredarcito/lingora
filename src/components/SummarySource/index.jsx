import { useState } from "react";
import { api, errorMessage } from "@utils/api";
import { useT } from "@i18n";
import { Select, cx } from "@components/shared";
import SummaryKeyForm from "@components/SummaryKeyForm";
import { notifySummarySource, useSummarySource } from "@hooks/useSummarySource";
import { isLowMemory, PROVIDERS, providerOf, storeSummarySource } from "@utils/summarySource.js";
import styles from "./styles.module.css";

/**
 * Settings → Notes: where summaries are made. On the computer (the default)
 * or with the user's AI key, with the form to set it (and to remove it).
 */
export default function SummarySource() {
  const t = useT();
  const { source, keyStatus, memoryGb } = useSummarySource();
  // "key" while choosing a service, before saving one.
  const [mode, setMode] = useState(/** @type {"local" | "key" | null} */ (null));
  const [error, setError] = useState("");
  // Bumped after removing a key, so the form checks again what is saved.
  const [removals, setRemovals] = useState(0);
  const shown = mode ?? (source === "local" ? "local" : "key");
  const info = providerOf(source);
  const name = info?.custom ? t("summarySource.custom") : info?.name ?? "";

  /** @param {string} value */
  const change = (value) => {
    setError("");
    if (value === "local") {
      storeSummarySource("local");
      notifySummarySource();
      setMode(null);
    } else {
      setMode("key");
    }
  };

  /** Removing the key of the service in use takes summaries back to the computer. @param {string} provider */
  const clear = async (provider) => {
    setError("");
    try {
      await api.summaryKeyClear(provider);
      if (provider === source) {
        storeSummarySource("local");
        setMode(null);
      }
      notifySummarySource();
      setRemovals((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className={styles.summarySource}>
      <label className="prefs-row">
        <span>
          <strong>{t("summarySource.whereTitle")}</strong>
          <small>
            {shown === "local"
              ? isLowMemory(memoryGb)
                ? t("summarySource.whereLocalLow")
                : t("summarySource.whereLocal")
              : source !== "local"
                ? t(keyStatus === "env" ? "summarySource.whereKeyEnv" : "summarySource.whereKey", { name })
                : t("summarySource.whereKeyNew")}
          </small>
        </span>
        <Select
          value={shown}
          onChange={change}
          options={[
            { value: "local", label: t("summarySource.optionLocal") },
            { value: "key", label: t("summarySource.optionKey") },
          ]}
        />
      </label>
      {shown === "key" && (
        <div className={cx("prefs-row prefs-row-static", styles.summarySourceForm)}>
          <SummaryKeyForm
            key={`${source}:${removals}`}
            provider={source !== "local" ? source : PROVIDERS[0].id}
            active={source}
            onSaved={() => setMode(null)}
            onRemove={clear}
          />
          {error && <p className="notes-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
