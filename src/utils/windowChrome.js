import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The window chrome. On macOS the page extends under the title bar ("overlay"):
 * only the traffic lights remain, over the page, and the top `--titlebar-h`
 * is reserved and draggable (see `.titlebar-overlay` in `styles.css`). Everywhere,
 * the window color is the theme's `--bg` and the window theme (buttons and title
 * text) is light or dark like the app. Without Tauri (plain browser) or without
 * the permissions it does nothing.
 */

/** Inside Tauri on a Mac: the page goes under the title bar. */
export const TITLEBAR_OVERLAY = "__TAURI_INTERNALS__" in window && /Mac/i.test(navigator.platform);

/** @type {import("@utils/prefs.js").Theme} */
let current = "system";

/** @param {import("@utils/prefs.js").Theme} theme */
export async function syncWindowChrome(theme) {
  current = theme;
  let win;
  try {
    win = getCurrentWindow();
  } catch {
    return; // Not running inside Tauri.
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  // One by one: the title bar style is macOS only, and a platform that
  // lacks one of these must not stop the others.
  /** @param {() => Promise<void>} change */
  const tryTo = (change) => change().catch(() => {});
  if (TITLEBAR_OVERLAY) {
    await tryTo(() => win.setTitleBarStyle("overlay"));
    await tryTo(() => win.setTitle("")); // The page is under the bar: no title text over it.
  }
  await tryTo(() => win.setTheme(theme === "system" ? null : theme));
  if (bg) await tryTo(() => win.setBackgroundColor(bg));
}

// Following macOS: when it switches between light and dark the window color changes too.
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (current === "system") syncWindowChrome(current);
});
