import { cx } from "@components/shared/cx";
import { SearchIcon } from "@components/shared/icons";
import styles from "./styles.module.css";

/**
 * Search box with a magnifier. Escape empties it. `shortcut` (⌘K) is shown while it is
 * empty; `placeholder` also serves as `aria-label`.
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
