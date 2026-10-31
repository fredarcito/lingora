import { describe, expect, it } from "vitest";
import { trimSilence } from "./voice";
import { splitWords, wordDelayMs } from "./words";

describe("splitWords", () => {
  it("keeps the following space with each word", () => {
    expect(splitWords("Hola  qué tal")).toEqual(["Hola ", "qué ", "tal "]);
  });

  it("splits scripts without spaces and keeps punctuation with the previous word", () => {
    const words = splitWords("你好，世界。");
    expect(words.join("")).toBe("你好，世界。");
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((w) => /\p{L}/u.test(w))).toBe(true);
  });
});

describe("wordDelayMs", () => {
  it("speeds up as words pile up", () => {
    expect([0, 7, 8, 14, 15].map(wordDelayMs)).toEqual([190, 190, 110, 110, 50]);
  });
});

describe("trimSilence", () => {
  it("leaves 40 ms of margin around the voice", () => {
    const rate = 1000;
    const audio = [...Array(100).fill(0), 0.5, 0.5, ...Array(100).fill(0.001)];
    const out = trimSilence(audio, rate);
    expect(out.length).toBe(40 + 2 + 40);
    expect(out[40]).toBe(0.5);
  });

  it("keeps only the 40 ms margin for pure silence", () => {
    expect(trimSilence(Array(50).fill(0), 1000)).toEqual(Array(40).fill(0));
  });
});
