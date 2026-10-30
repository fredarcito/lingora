import { useCallback, useLayoutEffect, useRef } from "react";
import { cx } from "../cx";
import Spinner from "../Spinner";
import styles from "./styles.module.css";

/**
 * El botón de las notas y los ajustes (estilo shadcn).
 * `variant`: "default", "primary" (la acción principal), "danger" (borrar) o
 * "stop" (detener una grabación; lleva `<StopIcon />` delante del texto).
 * `busy` pone un spinner pequeño delante del texto. El resto de props, incluido
 * `ref`, va al `<button>`.
 * El botón no encoge: al cambiar el texto («Preparando…», «Resumiendo…»)
 * conserva el ancho más grande que tuvo, para que nada salte a su alrededor.
 * @param {{ variant?: "default" | "primary" | "danger" | "stop", busy?: boolean, className?: string }
 *   & import("react").ComponentProps<"button">} props
 */
export default function Button({ variant = "default", busy = false, className, children, ref, ...rest }) {
  const own = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const widest = useRef(0);

  // Se mide el ancho de su contenido, no el que le da el contenedor: así un
  // botón estirado no se queda ancho al estrechar la ventana.
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
