import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * Small switch, like the shadcn Switch. With `label` it is a label
 * with its text; without it, it is painted as a `<span>`, to go inside another label
 * (the Settings rows, which already have a title and help text).
 * @param {{ checked: boolean, onChange: (on: boolean) => void, label?: string, disabled?: boolean,
 *   className?: string, title?: string }} props
 */
export default function Switch({ checked, onChange, label, disabled, className, title }) {
  const input = <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
  if (!label) {
    return (
      <span className={cx(styles.notesSwitch, className)} title={title}>
        {input}
      </span>
    );
  }
  return (
    <label className={cx(styles.notesSwitch, className)} title={title}>
      {input}
      <span>{label}</span>
    </label>
  );
}
