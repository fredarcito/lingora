import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_MODE, loadLaneSettings, loadMode, loadPair, loadVolumes, storeLaneSettings, storeMode, storeNoTranslate, storePair, storeVolumes } from "./prefs";

/** @type {Map<string, string>} */
let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  });
});

describe("prefs", () => {
  // These keys hold the settings of people who already use the app: they must not change.
  it("keeps the saved keys", () => {
    storeMode("notes");
    storeNoTranslate(true);
    storePair({ you: "ES", them: "FR" });
    storeVolumes({ remote_to_local: 0.5, local_to_remote: 1 });
    storeLaneSettings(/** @type {any} */ ([{ direction: "remote_to_local", maxSpeed: 1.3, speak: false, showSource: true, voiceIds: { ES: "x" }, voiceHq: true }]), {
      maxSpeed: 1.3,
      speak: false,
      showSource: true,
      voiceIds: {},
      voiceHq: true,
    });
    expect([...store.keys()].sort()).toEqual([
      "lingora.maxSpeed",
      "lingora.mode",
      "lingora.noTranslate",
      "lingora.pair",
      "lingora.showSource",
      "lingora.speak",
      "lingora.voiceHq",
      "lingora.voiceIds",
      "lingora.volume",
    ]);
    expect(store.get("lingora.noTranslate")).toBe("1");
    expect(store.get("lingora.speak")).toBe('{"remote_to_local":false}');
  });

  it("reads them back", () => {
    storeMode("notes");
    storePair({ you: "ES", them: "FR" });
    storeVolumes({ remote_to_local: 0.5, local_to_remote: 1 });
    store.set("lingora.maxSpeed", '{"remote_to_local":1.3}');
    expect(loadMode()).toBe("notes");
    expect(loadPair()).toEqual({ you: "ES", them: "FR" });
    expect(loadVolumes().remote_to_local).toBe(0.5);
    expect(loadLaneSettings().find((l) => l.direction === "remote_to_local")?.maxSpeed).toBe(1.3);
  });

  it("only saves the fields that changed", () => {
    storeLaneSettings(/** @type {any} */ ([{ direction: "remote_to_local", maxSpeed: 1.3 }]), { maxSpeed: 1.3 });
    expect([...store.keys()]).toEqual(["lingora.maxSpeed"]);
  });

  it("falls back to defaults without storage or with bad data", () => {
    store.set("lingora.pair", '{"you":"ES","them":"ES"}');
    expect(loadPair()).toEqual({ you: "ES", them: "EN" });
    // «Translate call» only comes back when the build allows it.
    store.set("lingora.mode", "call");
    expect(loadMode()).toBe(CALL_MODE ? "call" : "video");
    vi.stubGlobal("localStorage", undefined);
    expect(loadMode()).toBe("video");
    expect(() => storeMode("notes")).not.toThrow();
  });
});
