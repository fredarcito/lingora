import { useEffect, useRef } from "react";
import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Closes something open (a menu, a panel) when clicking anywhere else or
 * with Escape. Whoever opens it must stop its own click
 * (`e.stopPropagation()`), or it would close right away.
 * @param {boolean} open @param {() => void} onClose
 */
export function useDismiss(open, onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onClick = () => close.current();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && close.current();
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

/**
 * Dropdown menu under a button; the container positions it (`position: relative`).
 * `align="end"` pins it to the right edge. The rest of the props (`role`…) go to the `<div>`.
 * @param {{ align?: "start" | "end", className?: string } & import("react").ComponentProps<"div">} props
 */
export default function Menu({ align = "start", className, children, ...rest }) {
  return (
    <div className={cx(styles.noteMenu, align === "end" && styles.noteMenuEnd, className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * A menu option. `danger` paints it red (delete).
 * @param {{ danger?: boolean } & import("react").ComponentProps<"button">} props
 */
export function MenuItem({ danger = false, ...rest }) {
  return <button role="menuitem" className={danger ? styles.noteMenuDanger : undefined} {...rest} />;
}

/** Line between groups of options. */
export function MenuSeparator() {
  return <hr className={styles.noteMenuSep} />;
}
