import { useEffect, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { formatSize, itemNameKey, totalBytes, warningKey } from "@utils/storage";
import { useLang, useT } from "@i18n";
import { Badge, Button, ConfirmDialog, Spinner, cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * Settings → Disk space: everything Lingora downloaded, with its size, to
 * delete what is not used. Each deletion is confirmed with what stops
 * working; what older versions left behind is listed as "no longer used".
 * Nothing can be deleted while translating or taking notes (`recording`):
 * the models in use are released before deleting.
 * @param {{ recording: boolean, onRemoved: () => void }} props
 */
export default function Storage({ recording, onRemoved }) {
  const t = useT();
  const { lang } = useLang();
  const [items, setItems] = useState(/** @type {import("@utils/api").OnDisk[] | null} */ (null));
  const [asking, setAsking] = useState(/** @type {import("@utils/api").OnDisk | null} */ (null));
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .storageStatus()
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  /** @param {import("@utils/api").OnDisk} item */
  const remove = async (item) => {
    setAsking(null);
    setError("");
    setRemoving(item.id);
    try {
      setItems(await api.removeDownload(item.id));
      onRemoved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRemoving("");
    }
  };

  if (!items) {
    return (
      <div className="prefs-card">
        {error ? <p className="notes-error">{error}</p> : <p className="muted">{t("storage.loading")}</p>}
      </div>
    );
  }

  return (
    <div className={cx("prefs-card", styles.storage)}>
      {items.length === 0 ? (
        <p className="muted">{t("storage.empty")}</p>
      ) : (
        <p className={styles.storageTotal}>{t("storage.total", { size: formatSize(totalBytes(items), lang) })}</p>
      )}
      {items.map((item) => (
        <div key={item.id} className="prefs-row prefs-row-static">
          <span>
            <strong>{t(itemNameKey(item))}</strong>
            <small className={styles.storageMeta}>
              {formatSize(item.bytes, lang)}
              {item.obsolete && <Badge muted>{t("storage.unused")}</Badge>}
              {item.partial && <Badge muted>{t("storage.partial")}</Badge>}
              {item.required && !item.partial && <Badge muted>{t("storage.required")}</Badge>}
            </small>
          </span>
          <Button
            variant={item.obsolete ? "default" : "danger"}
            disabled={recording || !!removing}
            onClick={() => setAsking(item)}
          >
            {removing === item.id ? (
              <>
                <Spinner small /> {t("storage.deleting")}
              </>
            ) : (
              t("storage.delete")
            )}
          </Button>
        </div>
      ))}
      {recording && items.length > 0 && <p className="muted">{t("storage.busy")}</p>}
      {error && <p className="notes-error">{error}</p>}
      {asking && (
        <ConfirmDialog
          title={t("storage.confirmTitle", { name: t(itemNameKey(asking)) })}
          body={t(warningKey(asking), { size: formatSize(asking.bytes, lang) })}
          confirmLabel={t("storage.delete")}
          cancelLabel={t("storage.cancel")}
          danger
          onConfirm={() => remove(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>
  );
}
