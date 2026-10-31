import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Single-line text field, for settings. `label` goes to `aria-label`;
 * `onCommit` is called when pressing Enter or when leaving the field.
 * @param {{ value: string, onChange: (value: string) => void, onCommit?: () => void,
 *   label?: string, placeholder?: string, maxLength?: number, disabled?: boolean, className?: string }} props
 */
export default function TextField({ value, onChange, onCommit, label, placeholder, maxLength, disabled, className }) {
  return (
    <input
      type="text"
      className={cx(styles.textField, className)}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
