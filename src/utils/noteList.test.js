import { describe, expect, it } from "vitest";
import { daysAgo, dateFormats, fold, groupByLabel, groupLabel, inPeriod, langPair, monthKey, monthLabel, nameSuggestions, olderMonths } from "./noteList";

const now = new Date(2026, 9, 29, 15, 0); // Thursday, 29 Oct 2026
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();
const formats = dateFormats("es");
const t = (key, vars) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`;

describe("dates", () => {
  it("counts calendar days, not 24 h", () => {
    expect(daysAgo(new Date(2026, 9, 28, 23, 59), now)).toBe(1);
    expect(daysAgo(new Date(2026, 9, 29, 0, 1), now)).toBe(0);
  });

  it("labels months, with the year only when it is another one", () => {
    expect(monthKey(new Date(2026, 8, 3))).toBe("2026-09");
    expect(monthLabel("2026-09", formats, now)).toBe("Septiembre");
    expect(monthLabel("2025-09", formats, now)).toBe("Septiembre de 2025");
  });

  it("groups by today, yesterday, this week and then month", () => {
    expect(groupLabel(at(2026, 10, 29), formats, t, now)).toMatch(/^notes\.today/);
    expect(groupLabel(at(2026, 10, 28), formats, t, now)).toMatch(/^notes\.yesterday/);
    expect(groupLabel(at(2026, 10, 24), formats, t, now)).toBe("notes.thisWeek");
    expect(groupLabel(at(2026, 10, 2), formats, t, now)).toBe("Octubre");
  });

  it("filters by period", () => {
    expect(inPeriod(at(2026, 10, 23), "week", now)).toBe(true);
    expect(inPeriod(at(2026, 10, 22), "week", now)).toBe(false);
    expect(inPeriod(at(2026, 10, 1), "month", now)).toBe(true);
    expect(inPeriod(at(2026, 9, 30), "last", now)).toBe(true);
    expect(inPeriod(at(2026, 8, 5), "m:2026-08", now)).toBe(true);
    expect(inPeriod(at(2020, 1, 1), "all", now)).toBe(true);
  });

  it("lists older months, newest first, without this one and the last", () => {
    const notes = [at(2026, 10, 1), at(2026, 9, 1), at(2026, 7, 1), at(2025, 12, 1), at(2026, 7, 9)].map((created_at) => ({ created_at }));
    expect(olderMonths(/** @type {any} */ (notes), now)).toEqual(["2026-07", "2025-12"]);
  });
});

describe("list helpers", () => {
  it("folds accents for the search", () => {
    expect(fold("Sábado CAMIÓN")).toBe("sabado camion");
  });

  it("shows the language pair only for translations", () => {
    expect(langPair(/** @type {any} */ ({ source_lang: "es", target_lang: "en" }))).toBe("ES → EN");
    expect(langPair(/** @type {any} */ ({ source_lang: "es", target_lang: "es" }))).toBe("ES");
    expect(langPair(/** @type {any} */ ({ kind: "notes", source_lang: "es", target_lang: "en" }))).toBeNull();
  });

  it("groups consecutive notes with the same label", () => {
    const notes = ["a", "a", "b", "a"].map((created_at) => ({ created_at }));
    expect(groupByLabel(notes, (x) => x).map(([label, items]) => [label, items.length])).toEqual([
      ["a", 2],
      ["b", 1],
      ["a", 1],
    ]);
  });
});

describe("nameSuggestions", () => {
  const notes = /** @type {any[]} */ ([
    { speaker_names: ["Marta", "Juan"] },
    { speaker_names: ["Álvaro Pérez"] },
    { speaker_names: ["marta ", "Juan"] },
    { speaker_names: ["Juan"] },
    {},
  ]);

  it("puts the most used first and, on a tie, the most recent", () => {
    expect(nameSuggestions(notes, "", [])).toEqual(["Juan", "Marta", "Álvaro Pérez"]);
  });

  it("filters by the start of any word, without accents or case", () => {
    expect(nameSuggestions(notes, "alv", [])).toEqual(["Álvaro Pérez"]);
    expect(nameSuggestions(notes, "per", [])).toEqual(["Álvaro Pérez"]);
    expect(nameSuggestions(notes, "ta", [])).toEqual([]);
  });

  it("leaves out the people already in the note", () => {
    expect(nameSuggestions(notes, "", ["juan", "Marta"])).toEqual(["Álvaro Pérez"]);
  });
});
