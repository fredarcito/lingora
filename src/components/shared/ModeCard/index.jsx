import { ArrowIcon } from "@components/shared/icons";
import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * A card that starts a mode (Home): icon tile, title, one line and an action
 * button. `tone` picks the `--mode-*` color; `highlighted` outlines the card and
 * fills the button (the mode running); hovering any enabled card shows its border; `disabled` locks it, and `hint`
 * explains why (shown as a tooltip).
 * @param {{
 *   icon: import("react").ReactNode, title: string, description: string, action: string,
 *   tone: "audio" | "call" | "notes", highlighted?: boolean, disabled?: boolean,
 *   hint?: string, onClick: () => void,
 * }} props
 */
export default function ModeCard({ icon, title, description, action, tone, highlighted = false, disabled = false, hint, onClick }) {
  return (
    <div className={cx(styles.card, styles[tone], highlighted && styles.isHighlighted, disabled && styles.isDisabled)} title={hint}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      <button type="button" className={styles.action} onClick={onClick} disabled={disabled}>
        {action}
        <ArrowIcon />
      </button>
    </div>
  );
}
