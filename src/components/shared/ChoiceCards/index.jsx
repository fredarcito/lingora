import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Single choice as cards: icon, title and a short description in view. For a
 * decision made once (what to record), where the options need explaining;
 * for quick switches use `Segmented`. The selected one gets a ✓.
 * @param {{ value: string, onChange: (value: string) => void,
 *   options: Array<{ value: string, label: string, hint?: string, icon?: import("react").ReactNode, disabled?: boolean }> }} props
 */
export default function ChoiceCards({ value, onChange, options }) {
  return (
    <div className={styles.choiceCards} role="radiogroup">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={selected}
            className={cx(styles.choice, selected && styles.isSelected)}
            onClick={() => onChange(o.value)}
            disabled={o.disabled && !selected}
          >
            <span className={styles.choiceHead}>
              {o.icon && <span className={styles.choiceIcon}>{o.icon}</span>}
              <span className={styles.choiceLabel}>{o.label}</span>
              {selected && (
                <span className={styles.choiceCheck} aria-hidden>
                  ✓
                </span>
              )}
            </span>
            {o.hint && <span className={styles.choiceHint}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
