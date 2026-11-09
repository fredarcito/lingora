import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * A row of a short list: icon, title, one line below and an action at the end
 * (Home's recent activity). The whole row is a button; `action` is only the
 * label shown at the end, not a second button. `tone` tints the icon with a `--mode-*` color.
 * @param {{
 *   icon: import("react").ReactNode, title: string, subtitle?: string,
 *   meta?: string, action?: string, tone?: "audio" | "call" | "notes", onClick: () => void, className?: string,
 * }} props
 */
export default function ActivityRow({ icon, title, subtitle, meta, action, tone, onClick, className }) {
  return (
    <button type="button" className={cx(styles.row, tone && styles[tone], className)} onClick={onClick}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {meta && <span className={styles.meta}>{meta}</span>}
      {action && <span className={styles.action}>{action}</span>}
    </button>
  );
}
