import { cx } from "@components/shared/cx";
import { ChevronIcon } from "@components/shared/icons";
import styles from "./styles.module.css";

/**
 * Light dropdown that reads as inline text ("Resumen en Español ⌄"): the chosen
 * option and its arrow on a soft background. The real select sits on top,
 * invisible: on its own it would be as wide as the longest option.
 * `label` goes to `aria-label`.
 * @param {{ value: string, onChange: (value: string) => void, options: Array<{ value: string, label: string }>,
 *   label?: string, disabled?: boolean, className?: string }} props
 */
export default function InlineSelect({ value, onChange, options, label, disabled, className }) {
  return (
    <span className={cx(styles.inlineSelect, className)}>
      <span aria-hidden>{options.find((o) => o.value === value)?.label ?? value}</span>
      <ChevronIcon />
      <select value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
