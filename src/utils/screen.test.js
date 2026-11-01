import { describe, expect, it } from "vitest";
import { isOnScreen } from "./screen.js";

const LAPTOP = { position: { x: 0, y: 0 }, size: { width: 3024, height: 1964 } };
const EXTERNAL = { position: { x: 3024, y: 0 }, size: { width: 3840, height: 2160 } };
const rect = (x, y) => ({ x, y, width: 1520, height: 300 });

describe("isOnScreen", () => {
  it("accepts a window on a connected screen", () => {
    expect(isOnScreen(rect(750, 1500), [LAPTOP])).toBe(true);
    expect(isOnScreen(rect(4000, 1500), [LAPTOP, EXTERNAL])).toBe(true);
  });

  it("rejects one left on a monitor that is no longer connected", () => {
    expect(isOnScreen(rect(4000, 1500), [LAPTOP])).toBe(false);
    expect(isOnScreen(rect(-2000, 300), [LAPTOP])).toBe(false);
  });

  it("needs enough of it in view to drag it back", () => {
    expect(isOnScreen(rect(3000, 1500), [LAPTOP])).toBe(false);
    expect(isOnScreen(rect(2900, 1500), [LAPTOP])).toBe(true);
  });
});
