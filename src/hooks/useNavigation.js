import { useCallback, useState } from "react";

/**
 * Which screen is shown and the side menu.
 * - `goTo` is a pick in the side menu: the screen opens on its main page (the
 *   list of notes, not the note that was open; Settings, not its licenses).
 *   `home` counts those picks, for the screens to reset with.
 * - `openNote` shows a note in Notes; `openRequest` is that request.
 */
export function useNavigation() {
  const [view, setView] = useState(/** @type {import("@components/Sidebar").View} */ ("home"));
  const [home, setHome] = useState(0);
  const [openRequest, setOpenRequest] = useState(/** @type {{ id: string, nonce: number } | null} */ (null));
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /** @param {import("@components/Sidebar").View} next */
  const goTo = (next) => {
    setView(next);
    setHome((n) => n + 1);
  };

  /** @param {string} id */
  const openNote = (id) => {
    setView("notes");
    setOpenRequest({ id, nonce: Date.now() });
  };

  return { view, setView, home, goTo, openRequest, openNote, menuOpen, openMenu, closeMenu };
}
