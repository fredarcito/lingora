import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDITS } from "./credits.js";

/** @param {string} path */
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("credits", () => {
  it("has unique ids", () => {
    const ids = CREDITS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a non-empty license text for each entry", () => {
    for (const c of CREDITS) expect(read(`public/licenses/${c.licenseFile}`).trim().length, c.id).toBeGreaterThan(0);
  });

  it("has a purpose in es and en for each entry", () => {
    for (const lang of ["es", "en"]) {
      const strings = JSON.parse(read(`src/i18n/${lang}/credits.json`));
      for (const c of CREDITS) expect(strings[`purpose.${c.id}`], `${lang}:${c.id}`).toBeTruthy();
    }
  });

  it("lists the same espeak-ng version that the build script compiles", () => {
    const version = /^VERSION=(\S+)/m.exec(read("scripts/build-espeak.sh"))?.[1];
    const espeak = CREDITS.find((c) => c.id === "espeak");
    expect(espeak?.name).toContain(version);
    expect(espeak?.url).toContain(`/${version}.tar.gz`);
  });
});
