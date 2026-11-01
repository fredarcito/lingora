import { describe, expect, it } from "vitest";
import { formatSize, itemNameKey, totalBytes, warningKey } from "./storage.js";

/** @param {Partial<import("@utils/api").OnDisk>} over @returns {import("@utils/api").OnDisk} */
const item = (over) => ({ id: "translator", obsolete: false, was: "", required: true, partial: false, bytes: 1, ...over });

describe("storage", () => {
  it("formats sizes in the interface language", () => {
    expect(formatSize(1_312_164_352, "es")).toBe("1,3 GB");
    expect(formatSize(1_312_164_352, "en")).toBe("1.3 GB");
    expect(formatSize(145_000_000, "es")).toBe("145 MB");
    // Something tiny still shows a size, not "0 MB".
    expect(formatSize(1200, "es")).toBe("1 MB");
  });

  it("adds up the total", () => {
    expect(totalBytes([item({ bytes: 2 }), item({ bytes: 3 })])).toBe(5);
    expect(totalBytes([])).toBe(0);
  });

  it("names current models and leftovers without model names", () => {
    expect(itemNameKey(item({}))).toBe("storage.item.translator");
    expect(itemNameKey(item({ id: "Hy-MT2-1.8B-Q4_K_M.gguf", obsolete: true, was: "translator" }))).toBe(
      "storage.item.old.translator",
    );
    expect(itemNameKey(item({ id: "kokoro-multi-lang-v1_0", obsolete: true, was: "voice" }))).toBe("storage.item.old.voice");
    expect(itemNameKey(item({ id: "whatever.bin", obsolete: true }))).toBe("storage.item.old.unknown");
  });

  it("warns about what stops working", () => {
    expect(warningKey(item({}))).toBe("storage.warn.translator");
    expect(warningKey(item({ id: "speakers" }))).toBe("storage.warn.speakers");
    expect(warningKey(item({ partial: true }))).toBe("storage.warn.partial");
    expect(warningKey(item({ id: "kokoro-multi-lang-v1_0", obsolete: true, was: "voice" }))).toBe("storage.warn.obsolete");
  });
});
