import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { useT } from "@i18n";
import { Button, LinkButton } from "@components/shared";
import styles from "./styles.module.css";

/** Notice between views (Notes, Settings, menu) that the key changed. */
const KEY_EVENT = "lingora:summary-key";

/**
 * Where the Groq key is. `status` is null while it is being checked.
 * `hasKey` also counts the key from the development environment.
 * @returns {{ status: import("@utils/api").SummaryKeyStatus | null, hasKey: boolean }}
 */
export function useSummaryKey() {
  const [status, setStatus] = useState(/** @type {import("@utils/api").SummaryKeyStatus | null} */ (null));
  const load = useCallback(() => {
    api
      .summaryKeyStatus()
      .then(setStatus)
      .catch(() => setStatus("none"));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(KEY_EVENT, load);
    return () => window.removeEventListener(KEY_EVENT, load);
  }, [load]);
  return { status, hasKey: status === "keychain" || status === "env" };
}

export const notifyKeyChanged = () => window.dispatchEvent(new Event(KEY_EVENT));

/**
 * Password field and Save button: Rust checks the key before
 * saving it and, if it is not valid, the error shows right here.
 * @param {{ placeholder?: string, onSaved?: () => void }} props
 */
export function KeyField({ placeholder, onSaved }) {
  const t = useT();
  const label = placeholder ?? t("summaryKey.placeholder");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** @param {import("react").FormEvent} e */
  const save = async (e) => {
    e.preventDefault();
    const key = value.trim();
    if (!key || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.summaryKeySet(key);
      setValue("");
      notifyKeyChanged();
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.keyField} onSubmit={save}>
      <div className={styles.keyFieldRow}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={label}
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button variant="primary" type="submit" disabled={!value.trim() || busy}>
          {busy ? t("summaryKey.checking") : t("summaryKey.save")}
        </Button>
      </div>
      {error && (
        <p className="notes-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** What is shown in the Summary tab when there is no key yet. @param {{ onSaved: () => void }} props */
export function KeyPanel({ onSaved }) {
  const t = useT();
  return (
    <div className={styles.keyPanel}>
      <p>{t("summaryKey.panelText")}</p>
      <KeyField onSaved={onSaved} />
      <LinkButton type="button" onClick={() => api.summaryKeyHelp().catch(() => {})}>
        {t("summaryKey.getKey")}
      </LinkButton>
      <p className="muted">{t("summaryKey.orCopy")}</p>
    </div>
  );
}
