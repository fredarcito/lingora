import { useCallback, useLayoutEffect, useRef } from "react";
import { cx } from "@components/shared/cx";
import Spinner from "@components/shared/Spinner";
import styles from "./styles.module.css";

/**
 * The button used for notes and settings (shadcn style).
 * `variant`: "default", "primary" (the main action), "danger" (delete) or
 * "stop" (stops a recording; has `<StopIcon />` in front of the text).
 * `busy` shows a small spinner in front of the text. The rest of the props, including
 * `ref`, is passed to the `<button>`.
 * The button does not shrink: when the text changes ("Preparing…", "Summarizing…")
 * it keeps the widest width it had, so nothing jumps around it.
 * @param {{ variant?: "default" | "primary" | "danger" | "stop", busy?: boolean, className?: string }
 *   & import("react").ComponentProps<"button">} props
 */
export default function Button({ variant = "default", busy = false, className, children, ref, ...rest }) {
  const own = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const widest = useRef(0);

  // Its content width is measured, not the one the container gives it, so a
  // stretched button does not stay wide when the window is narrowed.
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.minWidth = "";
    el.style.width = "max-content";
    widest.current = Math.max(widest.current, el.offsetWidth);
    el.style.width = "";
    el.style.minWidth = `${widest.current}px`;
  });

  const setRef = useCallback(
    (/** @type {HTMLButtonElement | null} */ el) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  return (
    <button ref={setRef} className={cx(styles.noteAction, variant !== "default" && styles[variant], className)} {...rest}>
      {busy && <Spinner small />}
      {children}
    </button>
  );
}
