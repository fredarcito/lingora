import { describe, expect, it } from "vitest";
import { notesListenCode, originalText } from "./lanes.js";

describe("notesListenCode", () => {
  it("keeps the family when the captions are in another language", () => {
    expect(notesListenCode("EN", "ES")).toBe("EN");
    expect(notesListenCode("ZH", "EN")).toBe("ZH");
  });

  it("uses another code of the same engine when they match", () => {
    expect(notesListenCode("EN", "EN")).toBe("ES");
    expect(notesListenCode("ZH", "ZH")).toBe("JA");
  });
});

describe("originalText", () => {
  it("shows what was said in place of the translation", () => {
    const state = /** @type {any} */ ({ running: true, history: [{ id: 1, transcript: "Hello there", translation: "Hola" }] });
    const shown = originalText(state);
    expect(shown.history[0].translation).toBe("Hello there");
    expect(shown.running).toBe(true);
    expect(state.history[0].translation).toBe("Hola");
  });
});
