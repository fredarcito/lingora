import { cx } from "../cx";
import Spinner from "../Spinner";
import styles from "./styles.module.css";

/**
 * El botón de las notas y los ajustes (estilo shadcn).
 * `variant`: "default", "primary" (la acción principal), "danger" (borrar) o
 * "stop" (detener una grabación; lleva `<StopIcon />` delante del texto).
 * `busy` pone un spinner pequeño delante del texto. El resto de props, incluido
 * `ref`, va al `<button>`.
 * @param {{ variant?: "default" | "primary" | "danger" | "stop", busy?: boolean, className?: string }
 *   & import("react").ComponentProps<"button">} props
 */
export default function Button({ variant = "default", busy = false, className, children, ...rest }) {
  return (
    <button className={cx(styles.noteAction, variant !== "default" && styles[variant], className)} {...rest}>
      {busy && <Spinner small />}
      {children}
    </button>
  );
}
