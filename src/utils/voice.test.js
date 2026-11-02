import { describe, expect, it } from "vitest";
import { SPEED_MAX, SPEED_MIN, SPEED_MODES, SPEED_STEP, speedMode, speedRange } from "./voice.js";

/** Every position the slider can take. */
const positions = Array.from({ length: Math.round((SPEED_MAX - SPEED_MIN) / SPEED_STEP) + 1 }, (_, i) => Math.round((SPEED_MIN + i * SPEED_STEP) * 100) / 100);

describe("speedRange", () => {
  it("keeps saved values up to 1.4 as the cap, from 1", () => {
    expect(speedRange(1)).toEqual({ base: 1, max: 1 });
    expect(speedRange(1.15)).toEqual({ base: 1, max: 1.15 });
    expect(speedRange(1.4)).toEqual({ base: 1, max: 1.4 });
  });

  it("raises the base in Agile, with the voice's own limit as the cap", () => {
    expect(speedRange(1.45)).toEqual({ base: 1.1, max: 1.5 });
    expect(speedRange(1.5)).toEqual({ base: 1.2, max: 1.5 });
    expect(speedRange(1.6)).toEqual({ base: 1.4, max: 1.5 });
  });

  it("never slows down as the slider moves right", () => {
    for (let i = 1; i < positions.length; i++) {
      const [before, after] = [speedRange(positions[i - 1]), speedRange(positions[i])];
      expect(after.base).toBeGreaterThanOrEqual(before.base);
      expect(after.max).toBeGreaterThanOrEqual(before.max);
      expect(after.max).toBeGreaterThanOrEqual(after.base);
    }
  });
});

describe("speedMode", () => {
  it("gives every slider position a mode, in order", () => {
    const modes = positions.map(speedMode);
    expect(modes[0]).toBe("natural");
    expect(modes.at(-1)).toBe("agile");
    expect(new Set(modes)).toEqual(new Set(["natural", "balanced", "agile"]));
  });

  it("puts each mode's recommended value inside its stretch, not on the edge", () => {
    for (const m of SPEED_MODES) {
      expect(speedMode(m.value)).toBe(m.id);
      expect(m.value).toBeGreaterThan(m.from);
      expect(m.value).toBeLessThan(m.to);
    }
  });

  it("keeps the default lane speed in Natural", () => {
    expect(speedMode(1.15)).toBe("natural");
  });
});
