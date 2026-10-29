import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Campo de texto de una línea, para los ajustes. `label` va a `aria-label`;
 * `onCommit` se llama al pulsar Enter o al salir del campo.
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
