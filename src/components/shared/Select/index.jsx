import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Desplegable de los ajustes y las notas. `label` va a `aria-label`.
 * @param {{ value: string, onChange: (value: string) => void, options: Array<{ value: string, label: string }>,
 *   label?: string, disabled?: boolean, className?: string }} props
 */
export default function Select({ value, onChange, options, label, disabled, className }) {
  return (
    <select className={cx(styles.prefsSelect, className)} value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
