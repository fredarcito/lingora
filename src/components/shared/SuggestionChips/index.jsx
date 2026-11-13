import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Ready-made questions for the empty state of a chat: each one is a button
 * that sends its own text.
 * @param {{ options: { id: string, label: string }[], onPick: (label: string) => void, disabled?: boolean, className?: string }} props
 */
export default function SuggestionChips({ options, onPick, disabled = false, className }) {
  return (
    <div className={cx(styles.suggestionChips, className)}>
      {options.map((o) => (
        <button key={o.id} type="button" className={styles.suggestionChip} disabled={disabled} onClick={() => onPick(o.label)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
