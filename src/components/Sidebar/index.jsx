import { useEffect, useRef } from "react";
import { useT } from "@i18n";
import { CallIcon, CloseIcon, HomeIcon, IconButton, LockIcon, MenuIcon, NoteIcon, PenIcon, SettingsIcon, SwapIcon, WaveIcon, SparkIcon, cx } from "@components/shared";
import { useSummarySource } from "@hooks/useSummarySource";
import { providerOf } from "@utils/summarySource.js";
import styles from "./styles.module.css";

/**
 * @typedef {"home" | "translate" | "notes" | "settings"} View
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

/**
 * Menu entries, the same as Home's shortcuts. A `view` entry goes to that
 * screen; a `mode` entry opens Translate in that mode; `soon` is shown locked.
 * The names are in `sidebar.<id>`.
 * @typedef {{ id: string, icon: () => import("react").JSX.Element, view?: View, mode?: import("@app/types").Mode, soon?: boolean }} Entry
 */

/** @type {Entry[][]} Groups: the last one goes apart, at the bottom. */
const SECTIONS = [
  [
    { id: "home", icon: HomeIcon, view: "home" },
    { id: "video", icon: SwapIcon, mode: "video" },
    { id: "notesMode", icon: PenIcon, mode: "notes" },
    { id: "call", icon: CallIcon, mode: "call" },
    { id: "notes", icon: NoteIcon, view: "notes" },
    { id: "chat", icon: SparkIcon, soon: true },
  ],
  [{ id: "settings", icon: SettingsIcon, view: "settings" }],
];

/**
 * Panel that opens above the content without pushing it. It closes when
 * choosing, when clicking outside, with Esc or with the ✕. Focus goes to the first
 * entry when it opens and goes back to where it was when it closes.
 * With a lane running (`recording`) only the running mode can be picked, like Home's cards.
 * @param {{ open: boolean, view: View, mode: import("@app/types").Mode, callMode: boolean, recording: boolean,
 *   onSelect: (view: View) => void, onPickMode: (mode: import("@app/types").Mode) => void, onClose: () => void }} props
 */
export default function Sidebar({ open, view, mode, callMode, recording, onSelect, onPickMode, onClose }) {
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

  // Hooks before the early return.
  const service = providerOf(useSummarySource().source);

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
        {SECTIONS.map((entries, group) => (
          <div key={group} className={styles.drawerSection}>
            {entries.map(({ id, icon: Icon, view: target, mode: pick, soon }) => {
              const locked = soon || (pick === "call" && !callMode);
              const blocked = !locked && pick !== undefined && recording && pick !== mode;
              const selected = pick ? view === "translate" && mode === pick : view === target;
              return (
                <button
                  key={id}
                  ref={index++ === 0 ? first : undefined}
                  className={cx(styles.drawerEntry, selected && styles.isSelected)}
                  aria-current={selected ? "page" : undefined}
                  disabled={locked || blocked}
                  title={blocked ? t("app.mode.stopToChange") : pick === "call" && locked ? t("app.mode.callSoon.hint") : undefined}
                  onClick={() => {
                    if (pick) onPickMode(pick);
                    else if (target) onSelect(target);
                    onClose();
                  }}
                >
                  <span className={styles.drawerEntryIcon}>
                    <Icon />
                  </span>
                  <span className={styles.drawerEntryText}>
                    <span>{t(`sidebar.${id}`)}</span>
                  </span>
                  {soon && <span className={styles.drawerSoon}>{t("home.chat.soon")}</span>}
                  {pick === "call" && locked && <span className={styles.drawerSoon}>{t("home.chat.soon")}</span>}
                  {pick && pick === mode && recording && <span className={cx(styles.menuDot, styles.inline)} title={t("sidebar.translating")} />}
                </button>
              );
            })}
          </div>
        ))}
        <p className={styles.drawerFoot}>
          <LockIcon />
          {service
            ? t("sidebar.privacyWithKey", { name: service.custom ? t("summarySource.custom") : service.name })
            : t("sidebar.privacy")}
        </p>
      </nav>
    </div>
  );
}
