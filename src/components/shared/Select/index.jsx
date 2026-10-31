import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Dropdown for settings and notes. `label` goes to `aria-label`.
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
