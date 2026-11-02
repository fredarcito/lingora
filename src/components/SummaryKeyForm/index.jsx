import { useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { useT } from "@i18n";
import { Button, LinkButton, LockIcon, Select, TextField } from "@components/shared";
import { notifySummarySource } from "@hooks/useSummarySource";
import {
  loadBaseUrl,
  modelFor,
  modelOrder,
  pickModel,
  PROVIDERS,
  providerOf,
  storeBaseUrl,
  storeModel,
  storeSummarySource,
} from "@utils/summarySource.js";
import styles from "./styles.module.css";

/**
 * The user's own AI key: service, key and model.
 * - A saved key shows as saved (with its last characters), with "Change" and
 *   "Remove" links; the field only opens to type a new one.
 * - The model is chosen from the models the account really has (they come
 *   with the key), with the recommended one preselected, so a mistyped name
 *   can't happen; only a custom server without a list takes a typed name.
 * - There is a button only when something needs confirming: a new key, or a
 *   saved one that is not the service in use. With the service in use and its
 *   key saved, picking another model saves it right away, like the other settings.
 * @param {{ provider?: string, active?: string, submitLabel?: string, onSaved?: (provider: string) => void,
 *   onRemove?: (provider: string) => void }} props `provider` the service to start with; `active` the
 *   one summaries use now ("local" if none); `submitLabel` the button for a new key; `onRemove` shows "Remove".
 */
export default function SummaryKeyForm({ provider: initial = PROVIDERS[0].id, active = "local", submitLabel, onSaved, onRemove }) {
  const t = useT();
  const [provider, setProvider] = useState(initial);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(() => modelFor(initial));
  // The account's models; null until known (a new key brings them when saving).
  const [models, setModels] = useState(/** @type {string[] | null} */ (null));
  const [baseUrl, setBaseUrl] = useState(loadBaseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The recommended one wasn't in the list: the user confirms the one preselected.
  const [confirmModel, setConfirmModel] = useState(false);
  // Whether the chosen service has a key in the keychain; null while checking.
  const [saved, setSaved] = useState(/** @type {boolean | null} */ (null));
  // Typing a new key over the saved one.
  const [editingKey, setEditingKey] = useState(false);
  // The saved key's last characters ("…a1B2").
  const [hint, setHint] = useState(/** @type {string | null} */ (null));
  const info = providerOf(provider);
  const custom = !!info?.custom;
  const recommended = info?.model ?? "";
  const keepKey = !custom && saved === true;
  const inUse = provider === active;
  const name = custom ? t("summarySource.custom") : info?.name ?? "";

  /** @param {string[]} list */
  const applyList = (list) => {
    setModels(list);
    setModel((current) => pickModel(list, current, recommended));
  };

  // Whether this service has a key; with one, its models and which key it is.
  useEffect(() => {
    let alive = true;
    if (custom) {
      setSaved(false);
      return;
    }
    setSaved(null);
    api
      .summaryKeyStatus(provider)
      .then((status) => {
        if (!alive) return;
        const has = status !== "none";
        setSaved(has);
        if (!has) return;
        api.summaryModels(provider).then((list) => alive && applyList(list)).catch(() => {});
        api.summaryKeyHint(provider).then((h) => alive && setHint(h)).catch(() => {});
      })
      .catch(() => alive && setSaved(false));
    return () => {
      alive = false;
    };
  }, [provider, custom]);

  /** @param {string} id */
  const choose = (id) => {
    setProvider(id);
    setModel(modelFor(id));
    setModels(null);
    setKey("");
    setHint(null);
    setError("");
    setConfirmModel(false);
    setEditingKey(false);
  };

  /** Makes this service (and model) the one summaries use. @param {string} chosen */
  const use = (chosen) => {
    storeModel(provider, chosen);
    if (custom) storeBaseUrl(baseUrl);
    storeSummarySource(provider);
    notifySummarySource();
    onSaved?.(provider);
  };

  /** With the service in use and its key saved, a new model is saved at once. @param {string} m */
  const changeModel = (m) => {
    setModel(m);
    if (keepKey && !editingKey && inUse) {
      storeModel(provider, m);
      notifySummarySource();
    }
  };

  /** @param {import("react").FormEvent} e */
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let list = models;
      const newKey = !keepKey || editingKey || custom;
      if (newKey) list = await api.summaryKeySet(provider, key, custom ? baseUrl : undefined);
      const chosen = pickModel(list ?? [], model, recommended);
      if (list) applyList(list);
      // A server without a list: its model is typed, once it is known there is no list.
      if (custom && !list?.length && !model.trim()) return;
      // A model the account doesn't have: the user sees the one picked before using it.
      if (list?.length && chosen !== model && !confirmModel) {
        setModel(chosen);
        setConfirmModel(true);
        return;
      }
      setKey("");
      setConfirmModel(false);
      setEditingKey(false);
      if (newKey && !custom) {
        setSaved(true);
        api.summaryKeyHint(provider).then(setHint).catch(() => {});
      }
      use(chosen);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const typing = !keepKey || editingKey;
  const canSave = custom
    ? !!baseUrl.trim() && (models === null || !!models.length || !!model.trim())
    : typing
      ? !!key.trim()
      : !!model.trim();
  // The button only when there is something to confirm.
  const button = typing ? submitLabel ?? t("summarySource.save") : !inUse ? t("summarySource.useService", { name }) : null;
  const keyLabel = custom ? t("summarySource.keyOptional") : editingKey ? t("summarySource.keyNew", { name }) : t("summarySource.key", { name });

  return (
    <form className={styles.summaryKeyForm} onSubmit={save}>
      <div className={styles.summaryKeyRow}>
        <Select
          label={t("summarySource.service")}
          value={provider}
          onChange={choose}
          options={PROVIDERS.map((p) => ({ value: p.id, label: p.custom ? t("summarySource.custom") : p.name }))}
        />
        {saved === null ? (
          <div className={styles.summaryKeySaved} />
        ) : keepKey && !editingKey ? (
          <div className={styles.summaryKeySaved}>
            <LockIcon />
            <span>{hint ? t("summarySource.keySavedEnd", { name, hint }) : t("summarySource.keySaved", { name })}</span>
            <LinkButton type="button" onClick={() => setEditingKey(true)}>
              {t("summarySource.changeKey")}
            </LinkButton>
            {onRemove && (
              <LinkButton type="button" onClick={() => onRemove(provider)}>
                {t("summarySource.removeKey")}
              </LinkButton>
            )}
          </div>
        ) : (
          <>
            <input
              className={styles.summaryKeyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={keyLabel}
              aria-label={keyLabel}
              value={key}
              autoFocus={editingKey}
              onChange={(e) => setKey(e.target.value)}
            />
            {editingKey && (
              <LinkButton
                type="button"
                onClick={() => {
                  setEditingKey(false);
                  setKey("");
                }}
              >
                {t("summarySource.cancel")}
              </LinkButton>
            )}
          </>
        )}
      </div>
      {custom && (
        <TextField value={baseUrl} onChange={setBaseUrl} label={t("summarySource.url")} placeholder="http://localhost:1234/v1" />
      )}
      {models?.length ? (
        <label className={styles.summaryKeyModel}>
          <span>{t("summarySource.model")}</span>
          <Select
            label={t("summarySource.model")}
            value={model}
            onChange={changeModel}
            options={modelOrder(models, recommended).map((m) => ({
              value: m,
              label: m === recommended ? t("summarySource.recommended", { model: m }) : m,
            }))}
          />
        </label>
      ) : custom && models ? (
        // A server that doesn't list its models: the name is typed.
        <TextField value={model} onChange={setModel} label={t("summarySource.model")} placeholder={t("summarySource.modelTyped")} />
      ) : (
        saved === false && <p className="muted">{t("summarySource.modelLater")}</p>
      )}
      {confirmModel && <p role="status">{t("summarySource.confirmModel")}</p>}
      <p className="muted">{t("summarySource.sendsTo", { name })}</p>
      {(button || (typing && !custom)) && (
        <div className={styles.summaryKeyActions}>
          {button && (
            <Button variant="primary" type="submit" disabled={!canSave || busy} busy={busy}>
              {busy ? t("summarySource.checking") : button}
            </Button>
          )}
          {typing && !custom && (
            <LinkButton type="button" onClick={() => api.summaryKeyHelp(provider).catch(() => {})}>
              {t("summarySource.getKey", { name })}
            </LinkButton>
          )}
        </div>
      )}
      {error && (
        <p className="notes-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
