// Where windows can go: the screens that are connected now.

/** Pixels of a window that must be on a screen to count as visible: enough to
 * see it and drag it back (the floating captions have no title bar). */
const MIN_VISIBLE = 60;

/**
 * Whether a window at `rect` would be seen on one of `screens`. A position
 * saved on a monitor that is no longer connected is not.
 * Both in physical pixels, as Tauri gives them.
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {Array<{ position: { x: number, y: number }, size: { width: number, height: number } }>} screens
 */
export function isOnScreen(rect, screens) {
  return screens.some(({ position, size }) => {
    const width = Math.min(rect.x + rect.width, position.x + size.width) - Math.max(rect.x, position.x);
    const height = Math.min(rect.y + rect.height, position.y + size.height) - Math.max(rect.y, position.y);
    return width >= Math.min(MIN_VISIBLE, rect.width) && height >= Math.min(MIN_VISIBLE, rect.height);
  });
}
