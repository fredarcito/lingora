import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Single-choice buttons ("segmented control").
 * The selected option gets a ✓: the state does not depend on color alone.
 * `check={false}` leaves it out where it works as a view switch (a filter), not a setting.
 * @param {{ value: string, onChange: (value: string) => void, small?: boolean, check?: boolean,
 *   options: Array<{ value: string, label: string, hint?: string, disabled?: boolean }> }} props
 */
export default function Segmented({ value, onChange, options, small, check = true }) {
  return (
    <div
      className={cx(styles.segmented, small && styles.small)}
      role="radiogroup"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? styles.isSelected : ""}
          onClick={() => onChange(o.value)}
          disabled={o.disabled && value !== o.value}
          title={o.hint}
        >
          {o.label}
          {check && value === o.value && (
            <span className={styles.segCheck} aria-hidden>
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
