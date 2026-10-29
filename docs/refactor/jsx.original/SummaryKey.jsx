import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { useT } from "./i18n";

/** Aviso entre vistas (Notas, Ajustes, menú) de que la clave cambió. */
const KEY_EVENT = "lingora:summary-key";

/**
 * Dónde está la clave de Groq. `status` es null mientras se consulta.
 * `hasKey` cuenta también la del entorno de desarrollo.
 * @returns {{ status: import("./api").SummaryKeyStatus | null, hasKey: boolean }}
 */
export function useSummaryKey() {
  const [status, setStatus] = useState(/** @type {import("./api").SummaryKeyStatus | null} */ (null));
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
 * Campo de contraseña y botón Guardar: Rust comprueba la clave antes de
 * guardarla y, si no vale, el error se ve aquí mismo.
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
    <form className="key-field" onSubmit={save}>
      <div className="key-field-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={label}
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="note-action primary" type="submit" disabled={!value.trim() || busy}>
          {busy ? t("summaryKey.checking") : t("summaryKey.save")}
        </button>
      </div>
      {error && (
        <p className="notes-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Lo que se ve en la pestaña Resumen cuando aún no hay clave. @param {{ onSaved: () => void }} props */
export function KeyPanel({ onSaved }) {
  const t = useT();
  return (
    <div className="key-panel">
      <p>{t("summaryKey.panelText")}</p>
      <KeyField onSaved={onSaved} />
      <button className="link" type="button" onClick={() => api.summaryKeyHelp().catch(() => {})}>
        {t("summaryKey.getKey")}
      </button>
      <p className="muted">{t("summaryKey.orCopy")}</p>
    </div>
  );
}
