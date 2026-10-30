import { useEffect, useRef } from "react";
import { useSummaryKey } from "../SummaryKey";
import { useT } from "../../i18n";
import { CloseIcon, IconButton, LockIcon, MenuIcon, NoteIcon, SettingsIcon, WaveIcon, cx } from "../shared";
import styles from "./styles.module.css";

/**
 * @typedef {"translate" | "notes" | "settings"} View
 */

/**
 * The ☰ in the top bar. The red dot warns that a lane is running
 * even when the menu is closed.
 * @param {{ onClick: () => void, recording: boolean }} props
 */
export function MenuButton({ onClick, recording }) {
  const t = useT();
  return (
    <IconButton className={styles.menuButton} onClick={onClick} label={t("sidebar.openMenu")} aria-haspopup="dialog" title={t("sidebar.menu")}>
      <MenuIcon />
      {recording && <span className={styles.menuDot} aria-hidden />}
    </IconButton>
  );
}

/** Menu sections: group and entries; the title and the line that says what is there are in `sidebar.<group>` and `sidebar.<entry>`. */
const SECTIONS = /** @type {const} */ ([
  ["translation", [["translate", WaveIcon]]],
  ["library", [["notes", NoteIcon]]],
  ["general", [["settings", SettingsIcon]]],
]);

/**
 * Panel that opens above the content without pushing it. It closes when
 * choosing, when clicking outside, with Esc or with the ✕. Focus goes to the first
 * entry when it opens and goes back to where it was when it closes.
 * @param {{ open: boolean, view: View, recording: boolean, onSelect: (view: View) => void, onClose: () => void }} props
 */
export default function Sidebar({ open, view, recording, onSelect, onClose }) {
  const t = useT();
  const first = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const opener = useRef(/** @type {Element | null} */ (null));

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    first.current?.focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  const { hasKey } = useSummaryKey();

  if (!open) return null;
  let index = 0;
  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <nav className={styles.drawer} aria-label={t("sidebar.menu")} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHead}>
          <span className={cx("logo", styles.drawerLogo)} aria-hidden>
            <WaveIcon />
          </span>
          <div className={styles.drawerBrand}>
            <strong>Lingora</strong>
            <span>{t("sidebar.tagline")}</span>
          </div>
          <button className={styles.drawerClose} onClick={onClose} aria-label={t("sidebar.closeMenu")} title={t("sidebar.close")}>
            <CloseIcon />
          </button>
        </div>
        {SECTIONS.map(([group, entries]) => (
          <div key={group} className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>{t(`sidebar.group.${group}`)}</p>
            {entries.map(([id, Icon]) => (
              <button
                key={id}
                ref={index++ === 0 ? first : undefined}
                className={cx(styles.drawerEntry, view === id && styles.isSelected)}
                aria-current={view === id ? "page" : undefined}
                onClick={() => {
                  onSelect(id);
                  onClose();
                }}
              >
                <span className={styles.drawerEntryIcon}>
                  <Icon />
                </span>
                <span className={styles.drawerEntryText}>
                  <span>{t(`sidebar.${id}`)}</span>
                  <small>{t(`sidebar.${id}.hint`)}</small>
                </span>
                {id === "translate" && recording && <span className={cx(styles.menuDot, styles.inline)} title={t("sidebar.translating")} />}
              </button>
            ))}
          </div>
        ))}
        <p className={styles.drawerFoot}>
          <LockIcon />
          {hasKey ? t("sidebar.privacyWithKey") : t("sidebar.privacy")}
        </p>
      </nav>
    </div>
  );
}
