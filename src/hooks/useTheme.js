import { useEffect, useState } from "react";
import { loadTheme, storeTheme } from "@utils/prefs.js";
import { syncWindowChrome } from "@utils/windowChrome.js";

/**
 * Sets the root `data-theme` from a theme: `"light"` / `"dark"` force it, and
 * `"system"` removes it so the CSS follows macOS.
 * @param {import("@utils/prefs.js").Theme} theme
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // The floating captions window has no title bar to match.
  if (!root.classList.contains("view-captions")) syncWindowChrome(theme);
}

/** Tells every `useTheme` on screen (Home's quick toggle, Settings) that the theme changed. */
const CHANGED = "lingora:theme";

/**
 * The theme being shown right now, resolving `"system"` with macOS.
 * @param {import("@utils/prefs.js").Theme} theme @returns {"light" | "dark"}
 */
export function effectiveTheme(theme) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The saved appearance and a setter that stores it and applies it at once;
 * every screen using the hook stays in sync.
 * @returns {[import("@utils/prefs.js").Theme, (theme: import("@utils/prefs.js").Theme) => void]}
 */
export function useTheme() {
  const [theme, setTheme] = useState(loadTheme);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const sync = () => setTheme(loadTheme());
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  return [
    theme,
    (next) => {
      storeTheme(next);
      setTheme(next);
      window.dispatchEvent(new Event(CHANGED));
    },
  ];
}
