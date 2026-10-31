import { describe, expect, it } from "vitest";
import cases from "../../tests/fixtures/paragraphs.json";
import { createSpeakerTracker, paragraphs, speakerShares, transcriptParts } from "./notes";

describe("paragraphs", () => {
  // Same fixture as `paragraphs_match_shared_fixture` in src-tauri/src/notes.rs:
  // both sides must group the same way.
  for (const c of cases) {
    it(c.name, () => {
      const groups = paragraphs(c.sentences).map((block) => block.map((s) => c.sentences.indexOf(s)));
      expect(groups).toEqual(c.groups);
    });
  }
});

describe("transcriptParts", () => {
  it("puts unsaved gaps where they fall and adds up repeated ones", () => {
    const sentences = [
      { t: 1, speaker: 1, source: "a", translation: null },
      { t: 2, speaker: 1, source: "b", translation: null },
      { t: 3, speaker: 1, source: "c", translation: null },
    ];
    const note = /** @type {any} */ ({ sentences, gaps: [{ at: 1, secs: 10 }, { at: 1, secs: 5 }] });
    expect(transcriptParts(note)).toEqual([{ block: [sentences[0]] }, { gap: 15 }, { block: [sentences[1], sentences[2]] }]);
  });
});

/** Deterministic noise, so the tests always see the same voices. */
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32 - 0.5;
  };
}

/** A voice print near one axis of an 8-dim space, like a real embedding cluster. */
function voice(axis, noise) {
  return () => Array.from({ length: 8 }, (_, i) => (i === axis ? 1 : 0) + noise() * 0.3);
}

/** Feeds `[voice, secs]` pairs to a tracker and returns the speaker of each one. */
function track(turns, refine = true) {
  const tracker = createSpeakerTracker();
  const entries = turns.map(([print, secs]) => {
    const entry = /** @type {any} */ ({ speaker: null });
    tracker.add(entry, print(), secs);
    return entry;
  });
  if (refine) tracker.refine();
  return entries.map((e) => e.speaker);
}

describe("createSpeakerTracker", () => {
  const noise = rng(7);
  const a = voice(0, noise);
  const b = voice(1, noise);
  const c = voice(2, noise);

  it("tells two people apart, numbered in order of appearance", () => {
    const turns = [[b, 4], [a, 3], [b, 5], [a, 2.5], [b, 3], [a, 6], [b, 2], [a, 4]];
    expect(track(turns)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });

  it("gives a short sentence to the closest person instead of a new one", () => {
    expect(track([[a, 3], [b, 1]], false)).toEqual([1, 1]);
  });

  it("starts a new person live for a different voice that lasts enough", () => {
    expect(track([[a, 3], [b, 2]], false)).toEqual([1, 2]);
  });

  it("folds someone who barely spoke into the closest person on refine", () => {
    const turns = [];
    for (let i = 0; i < 10; i++) turns.push([a, 6], [b, 6]);
    turns.push([c, 2]);
    const speakers = track(turns);
    expect(new Set(speakers)).toEqual(new Set([1, 2]));
  });
});

describe("speakerShares", () => {
  /** @param {Array<[number | null, string]>} said */
  const note = (said) => /** @type {any} */ ({ sentences: said.map(([speaker, source]) => ({ speaker, source })) });

  it("splits by words and adds up to 100", () => {
    const shares = speakerShares(note([[1, "one two"], [2, "one"], [3, "one two three"], [null, "not counted at all"]]));
    expect(Object.fromEntries(shares)).toEqual({ 1: 33, 2: 17, 3: 50 });
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("thirds still add up to 100", () => {
    const shares = speakerShares(note([[1, "a"], [2, "b"], [3, "c"]]));
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });
});
