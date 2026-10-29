import { cx } from "../cx";
import styles from "./styles.module.css";

/**
 * Interruptor pequeño, como el Switch de shadcn. Con `label` es una etiqueta
 * con su texto; sin él se pinta como `<span>`, para ir dentro de otra etiqueta
 * (las filas de Ajustes, que ya llevan título y ayuda).
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
