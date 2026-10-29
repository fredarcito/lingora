import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Botón cuadrado con solo un icono (☰, panel flotante, ajustes del carril).
 * `active` lo marca como encendido y `small` lo hace más pequeño. `label` va
 * a `aria-label` y a `title`; un `title` propio lo sustituye.
 * @param {{ active?: boolean, small?: boolean, label?: string, className?: string } & import("react").ComponentProps<"button">} props
 */
export default function IconButton({ active = false, small = false, label, className, children, ...rest }) {
  return (
    <button className={cx(styles.iconButton, small && styles.small, className, active && styles.isActive)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
