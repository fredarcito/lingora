import { cx } from "../cx";
import { SearchIcon } from "../icons";
import styles from "./styles.module.css";

/**
 * Buscador con lupa. Escape lo vacía. `shortcut` (⌘K) se ve mientras está
 * vacío; `placeholder` sirve también de `aria-label`.
 * @param {{ value: string, onChange: (value: string) => void, placeholder: string, shortcut?: string,
 *   inputRef?: import("react").Ref<HTMLInputElement>, className?: string }} props
 */
export default function SearchBox({ value, onChange, placeholder, shortcut, inputRef, className }) {
  return (
    <label className={cx(styles.notesSearchbox, className)}>
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
      />
      {shortcut && !value && (
        <kbd className={styles.notesKbd} aria-hidden>
          {shortcut}
        </kbd>
      )}
    </label>
  );
}
