import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Square button with only an icon (☰, floating panel, lane settings).
 * `active` marks it as on and `small` makes it smaller. `label` goes
 * to `aria-label` and `title`; a custom `title` replaces it.
 * @param {{ active?: boolean, small?: boolean, label?: string, className?: string } & import("react").ComponentProps<"button">} props
 */
export default function IconButton({ active = false, small = false, label, className, children, ...rest }) {
  return (
    <button className={cx(styles.iconButton, small && styles.small, className, active && styles.isActive)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
