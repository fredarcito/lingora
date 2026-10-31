import { useEffect, useId, useRef } from "react";
import Button from "@components/shared/Button";
import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Custom confirmation (not `window.confirm`). Esc or clicking outside cancels; the
 * focus starts on Cancel so that Enter does not confirm by accident.
 * `danger` paints the confirm button red (delete).
 * @param {{ title: string, body: string, confirmLabel: string, cancelLabel: string, danger?: boolean,
 *   onConfirm: () => void, onCancel: () => void }} props
 */
export default function ConfirmDialog({ title, body, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }) {
  const titleId = useId();
  const cancel = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => {
    cancel.current?.focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className={styles.dialogBackdrop} onClick={onCancel}>
      <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId}>{title}</h3>
        <p className="muted">{body}</p>
        <div className={styles.dialogActions}>
          <Button ref={cancel} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} className={cx(styles.confirm, danger ? styles.isDanger : styles.isPrimary)} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
