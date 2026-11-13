import { cx } from "@components/shared/cx";
import { CloseIcon, NoteIcon } from "@components/shared/icons";
import styles from "./styles.module.css";

/**
 * Where an answer comes from, as small chips under it: each opens its source
 * (`onOpen(key)`). With `onRemove` each chip has a «×» (`removeLabel(item)`
 * is its name for screen readers) so the user can change the sources; a
 * `disabled` chip (a deleted note) shows but does nothing. `label` goes
 * before the chips; `children` after them (an «add» button…).
 * @param {{ items: { key: string, label: string, title?: string, disabled?: boolean }[], onOpen: (key: string) => void,
 *   onRemove?: (key: string) => void, removeLabel?: (item: { key: string, label: string }) => string, label?: string,
 *   className?: string, children?: import("react").ReactNode }} props
 */
export default function SourceChips({ items, onOpen, onRemove, removeLabel = (item) => item.label, label, className, children }) {
  return (
    <div className={cx(styles.sourceChips, className)}>
      {label && <span className={styles.sourceChipsLabel}>{label}</span>}
      {items.map((item) => (
        <span key={item.key} className={cx(styles.sourceChip, item.disabled && styles.isDisabled)}>
          <button type="button" className={styles.sourceChipOpen} disabled={item.disabled} title={item.title} onClick={() => onOpen(item.key)}>
            <NoteIcon />
            <span className={styles.sourceChipText}>{item.label}</span>
          </button>
          {onRemove && (
            <button type="button" className={styles.sourceChipRemove} aria-label={removeLabel(item)} title={removeLabel(item)} onClick={() => onRemove(item.key)}>
              <CloseIcon />
            </button>
          )}
        </span>
      ))}
      {children}
    </div>
  );
}
