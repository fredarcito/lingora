import { useEffect, useRef } from "react";
import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Cierra algo abierto (un menú, un panel) al pulsar en cualquier otro sitio o
 * con Escape. Quien lo abre tiene que parar su propio clic
 * (`e.stopPropagation()`), o se cerraría en el acto.
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
 * Menú desplegable bajo un botón; el contenedor lo coloca (`position: relative`).
 * `align="end"` lo pega al borde derecho. El resto de props (`role`…) va al `<div>`.
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
 * Una opción del menú. `danger` la pinta en rojo (borrar).
 * @param {{ danger?: boolean } & import("react").ComponentProps<"button">} props
 */
export function MenuItem({ danger = false, ...rest }) {
  return <button role="menuitem" className={danger ? styles.noteMenuDanger : undefined} {...rest} />;
}

/** Línea entre grupos de opciones. */
export function MenuSeparator() {
  return <hr className={styles.noteMenuSep} />;
}
