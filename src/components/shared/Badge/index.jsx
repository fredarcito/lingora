import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Small label next to a title ("Note", "Summary"). `icon` goes in front of the
 * text; `muted` uses gray instead of the accent color, to tell kinds apart.
 * @param {{ children: import("react").ReactNode, icon?: import("react").ReactNode, muted?: boolean }} props
 */
export default function Badge({ children, icon, muted = false }) {
  return (
    <span className={cx(styles.badge, muted && styles.isMuted)}>
      {icon}
      {children}
    </span>
  );
}
