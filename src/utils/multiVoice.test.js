import { describe, expect, it } from "vitest";
import { addToMean, closest, cosine, estimatePitch, genderFromPitch, nextVoice } from "./multiVoice.js";

/** A voiced-like tone: a fundamental plus two harmonics. @param {number} hz */
const tone = (hz, secs = 1, sampleRate = 16000) =>
  Float32Array.from({ length: secs * sampleRate }, (_, i) => {
    const t = i / sampleRate;
    return 0.5 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t);
  });

/** @param {number} sid @param {"female" | "male"} gender */
const voice = (sid, gender) => ({ id: `supertonic:${sid}`, name: String(sid), engine: /** @type {const} */ ("supertonic"), gender, detail: "" });
const VOICES = [voice(0, "female"), voice(1, "female"), voice(5, "male"), voice(6, "male")];

describe("multiVoice", () => {
  it("estimates the pitch of a voice", () => {
    expect(estimatePitch(tone(120))).toBeCloseTo(120, -1);
    expect(estimatePitch(tone(200))).toBeCloseTo(200, -1);
    expect(estimatePitch(new Float32Array(16000))).toBe(0);
  });

  it("tells women and men apart by pitch", () => {
    expect(genderFromPitch(estimatePitch(tone(210)))).toBe("female");
    expect(genderFromPitch(estimatePitch(tone(110)))).toBe("male");
  });

  it("gives each new person a free voice of their gender, then repeats", () => {
    expect(nextVoice(VOICES, [], "male")).toBe("supertonic:5");
    expect(nextVoice(VOICES, ["supertonic:5"], "male")).toBe("supertonic:6");
    expect(nextVoice(VOICES, ["supertonic:5", "supertonic:6"], "male")).toBe("supertonic:5");
    expect(nextVoice(VOICES, ["supertonic:5"], "female")).toBe("supertonic:0");
    expect(nextVoice([{ ...VOICES[0], engine: "system" }], [], "female")).toBeNull();
  });

  it("finds the most similar person", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(closest([0.9, 0.1], [[0, 1], null, [1, 0]])).toBe(2);
    expect(closest([1, 0], [null])).toBe(-1);
    expect(addToMean([1, 1], 1, [3, 3])).toEqual([2, 2]);
  });
});
