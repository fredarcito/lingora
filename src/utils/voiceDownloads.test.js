import { describe, expect, it } from "vitest";
import { NATURAL_MODEL, lightDownloads, lightSwitch, voiceOffer } from "./voiceDownloads.js";

/** @param {string} id @param {"female" | "male"} gender @param {boolean} [installed] */
const light = (id, gender, installed = false) => {
  const [, model] = id.split(":");
  return { id, model: `piper:${model}`, name: model, gender, detail: "", installed, bytes: 80 };
};

const SHARVARD_F = light("piper:sharvard:1", "female");
const SHARVARD_M = light("piper:sharvard:0", "male");
const DAVEFX = light("piper:davefx:0", "male");

/** @param {Partial<import("@utils/api").VoiceDownloads>} over @returns {import("@utils/api").VoiceDownloads} */
const downloads = (over) => ({
  light_recommended: false,
  natural: true,
  natural_installed: false,
  natural_bytes: 145,
  light: [SHARVARD_F, SHARVARD_M, DAVEFX],
  ...over,
});

describe("voiceOffer", () => {
  it("offers the natural voice on a good computer", () => {
    expect(voiceOffer(downloads({}), "female")).toEqual({ kind: "natural", model: NATURAL_MODEL, bytes: 145, voiceId: "" });
  });

  it("offers the light voice of the gender on a low-end computer", () => {
    expect(voiceOffer(downloads({ light_recommended: true }), "male")).toMatchObject({ kind: "light", model: "piper:sharvard" });
  });

  it("falls back to the other kind, or nothing", () => {
    // A language the natural voice doesn't speak.
    expect(voiceOffer(downloads({ natural: false }), "female")).toMatchObject({ kind: "light" });
    // Low-end computer, no light voice in the language: the natural one is better than nothing.
    expect(voiceOffer(downloads({ light_recommended: true, light: [] }), "female")).toMatchObject({ kind: "natural" });
    expect(voiceOffer(downloads({ natural: false, light: [] }), "female")).toBeNull();
  });
});

describe("lightSwitch", () => {
  it("uses a downloaded light voice of the gender without downloading", () => {
    const d = downloads({ light: [SHARVARD_F, { ...DAVEFX, installed: true }] });
    expect(lightSwitch(d, "male")).toEqual({ kind: "light", model: "", bytes: 0, voiceId: DAVEFX.id });
  });

  it("downloads one of the gender if the downloaded ones are of the other", () => {
    const d = downloads({ light: [{ ...SHARVARD_F, installed: true }, DAVEFX] });
    expect(lightSwitch(d, "male")).toMatchObject({ model: DAVEFX.model, voiceId: DAVEFX.id });
  });

  it("is null without light voices", () => {
    expect(lightSwitch(downloads({ light: [] }), "female")).toBeNull();
  });
});

describe("lightDownloads", () => {
  it("groups the voices that share a download", () => {
    const groups = lightDownloads([SHARVARD_F, SHARVARD_M, DAVEFX]);
    expect(groups.map((g) => [g.model, g.voices.length])).toEqual([
      ["piper:sharvard", 2],
      ["piper:davefx", 1],
    ]);
  });
});
