import { describe, expect, it } from "vitest";
import { notesListenCode } from "./lanes.js";

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
