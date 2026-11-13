import { useCallback, useState } from "react";

/**
 * Which screen is shown and the side menu.
 * - `goTo` is a pick in the side menu: the screen opens on its main page (the
 *   list of notes, not the note that was open; Settings, not its licenses).
 *   `home` counts those picks, for the screens to reset with.
 * - `openNote` shows a note in Notes; `openRequest` is that request. With
 *   `at` it opens on the transcript at that second; with `fromChat` the note
 *   offers to go back to the chat (a source of an answer was opened).
 * - `openChat` goes to the Chat page; with a question (typed on Home) it is
 *   asked there: `chatRequest`.
 */
export function useNavigation() {
  const [view, setView] = useState(/** @type {import("@components/Sidebar").View} */ ("home"));
  const [home, setHome] = useState(0);
  const [openRequest, setOpenRequest] = useState(/** @type {OpenRequest | null} */ (null));
  const [chatRequest, setChatRequest] = useState(/** @type {{ question: string, nonce: number } | null} */ (null));
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /** @param {import("@components/Sidebar").View} next */
  const goTo = (next) => {
    setView(next);
    setHome((n) => n + 1);
  };

  /** @param {string} id @param {{ at?: number, fromChat?: boolean }} [options] */
  const openNote = (id, { at, fromChat = false } = {}) => {
    setView("notes");
    setOpenRequest({ id, nonce: Date.now(), at, fromChat });
  };

  /** @param {string} [question] */
  const openChat = (question) => {
    setView("chat");
    if (question?.trim()) setChatRequest({ question: question.trim(), nonce: Date.now() });
  };

  return { view, setView, home, goTo, openRequest, openNote, chatRequest, openChat, menuOpen, openMenu, closeMenu };
}

/** @typedef {{ id: string, nonce: number, at?: number, fromChat?: boolean }} OpenRequest */
