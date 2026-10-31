import { useEffect, useId, useRef } from "react";
import Button from "@components/shared/Button";
import styles from "./styles.module.css";

/**
 * Generic modal with a title, free content and a close button. Esc or clicking outside
 * closes it; the focus starts on the close button.
 * @param {{ title: string, children: import("react").ReactNode, closeLabel: string, onClose: () => void }} props
 */
export default function Dialog({ title, children, closeLabel, onClose }) {
  const titleId = useId();
  const close = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => {
    close.current?.focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId}>{title}</h3>
        <div className={styles.dialogBody}>{children}</div>
        <div className={styles.dialogActions}>
          <Button ref={close} onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
