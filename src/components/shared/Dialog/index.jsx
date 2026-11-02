import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import IconButton from "@components/shared/IconButton";
import { CloseIcon } from "@components/shared/icons";
import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Generic modal with a title, free content and a close ✕ in the corner, rendered in `body` so no
 * ancestor (a container query, an overflow) can clip it. Esc or clicking outside
 * closes it; the focus starts on the ✕ (`closeLabel` is its name). `light` dims the page only a little,
 * for settings that are adjusted while watching what is behind.
 * @param {{ title: import("react").ReactNode, children: import("react").ReactNode, closeLabel: string, onClose: () => void, light?: boolean }} props
 */
export default function Dialog({ title, children, closeLabel, onClose, light = false }) {
  const titleId = useId();
  const close = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => {
    close.current?.focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={cx(styles.dialogBackdrop, light && styles.isLight)} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHead}>
          <h3 id={titleId}>{title}</h3>
          <IconButton ref={close} small className={styles.dialogClose} label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
