import { useEffect, useRef } from "react";
import { useSummaryKey } from "./SummaryKey";
import { useT } from "./i18n";

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

/**
 * @typedef {"translate" | "notes" | "settings"} View
 */

function MenuIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...svg}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TranslateIcon() {
  return (
    <svg {...svg}>
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2" />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg {...svg}>
      <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />
    </svg>
  );
}

/**
 * El ☰ de la barra superior. El punto rojo avisa de que hay un carril en
 * marcha aunque el menú esté cerrado.
 * @param {{ onClick: () => void, recording: boolean }} props
 */
export function MenuButton({ onClick, recording }) {
  const t = useT();
  return (
    <button className="icon-button menu-button" onClick={onClick} aria-label={t("sidebar.openMenu")} aria-haspopup="dialog" title={t("sidebar.menu")}>
      <MenuIcon />
      {recording && <span className="menu-dot" aria-hidden />}
    </button>
  );
}

function SettingsIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...svg} width={14} height={14}>
      <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 017 0v3" />
    </svg>
  );
}

/** Secciones del menú: grupo y entradas; el título y la línea que dice qué hay están en `sidebar.<grupo>` y `sidebar.<entrada>`. */
const SECTIONS = /** @type {const} */ ([
  ["translation", [["translate", TranslateIcon]]],
  ["library", [["notes", NotesIcon]]],
  ["general", [["settings", SettingsIcon]]],
]);

/**
 * Panel que se abre por encima del contenido, sin empujarlo. Se cierra al
 * elegir, al pulsar fuera, con Esc o con la ✕. El foco va a la primera
 * entrada al abrir y vuelve a donde estaba al cerrar.
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
    <div className="drawer-backdrop" onClick={onClose}>
      <nav className="drawer" aria-label={t("sidebar.menu")} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="logo drawer-logo" aria-hidden>
            <TranslateIcon />
          </span>
          <div className="drawer-brand">
            <strong>Lingora</strong>
            <span>{t("sidebar.tagline")}</span>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label={t("sidebar.closeMenu")} title={t("sidebar.close")}>
            <CloseIcon />
          </button>
        </div>
        {SECTIONS.map(([group, entries]) => (
          <div key={group} className="drawer-section">
            <p className="drawer-section-title">{t(`sidebar.group.${group}`)}</p>
            {entries.map(([id, Icon]) => (
              <button
                key={id}
                ref={index++ === 0 ? first : undefined}
                className={view === id ? "drawer-entry is-selected" : "drawer-entry"}
                aria-current={view === id ? "page" : undefined}
                onClick={() => {
                  onSelect(id);
                  onClose();
                }}
              >
                <span className="drawer-entry-icon">
                  <Icon />
                </span>
                <span className="drawer-entry-text">
                  <span>{t(`sidebar.${id}`)}</span>
                  <small>{t(`sidebar.${id}.hint`)}</small>
                </span>
                {id === "translate" && recording && <span className="menu-dot inline" title={t("sidebar.translating")} />}
              </button>
            ))}
          </div>
        ))}
        <p className="drawer-foot">
          <LockIcon />
          {hasKey ? t("sidebar.privacyWithKey") : t("sidebar.privacy")}
        </p>
      </nav>
    </div>
  );
}
