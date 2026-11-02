import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudRequest, hasConsent, isLowMemory, loadSummarySource, modelFor, modelOrder, pickModel, storeBaseUrl, storeConsent, storeModel, storeSummarySource } from "./summarySource.js";

/** @type {Map<string, string>} */
let store;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  });
});

describe("summary source", () => {
  it("is local by default and ignores unknown services", () => {
    expect(loadSummarySource()).toBe("local");
    store.set("lingora.summarySource", "otro");
    expect(loadSummarySource()).toBe("local");
    storeSummarySource("anthropic");
    expect(loadSummarySource()).toBe("anthropic");
  });

  it("keeps a model per service, with the default otherwise", () => {
    expect(modelFor("openai")).toBe("gpt-5.4-nano");
    storeModel("openai", " gpt-x ");
    expect(modelFor("openai")).toBe("gpt-x");
    expect(modelFor("gemini")).toBe("gemini-3.5-flash-lite");
  });

  it("builds the request, with the URL only for a custom server", () => {
    expect(cloudRequest("local")).toBeNull();
    expect(cloudRequest("groq")).toEqual({ provider: "groq", model: "qwen/qwen3.8-27b" });
    storeBaseUrl(" http://localhost:1234/v1 ");
    storeModel("custom", "qwen");
    expect(cloudRequest("custom")).toEqual({ provider: "custom", model: "qwen", base_url: "http://localhost:1234/v1" });
  });

  it("asks consent once per service", () => {
    expect(hasConsent("openai")).toBe(false);
    storeConsent("openai");
    expect(hasConsent("openai")).toBe(true);
    expect(hasConsent("anthropic")).toBe(false);
    expect([...store.keys()]).toEqual(["lingora.summaryConsent.openai"]);
  });

  it("recommends a key below 8 GB, not when unknown", () => {
    expect(isLowMemory(4.2)).toBe(true);
    expect(isLowMemory(8.6)).toBe(false);
    expect(isLowMemory(null)).toBe(false);
  });

  it("preselects a model the account really has", () => {
    const list = ["a", "rec", "z"];
    expect(pickModel(list, "z", "rec")).toBe("z");
    expect(pickModel(list, "typo", "rec")).toBe("rec");
    expect(pickModel(["a", "b"], "typo", "rec")).toBe("a");
    expect(pickModel([], "typed", "rec")).toBe("typed");
    expect(modelOrder(list, "rec")).toEqual(["rec", "a", "z"]);
    expect(modelOrder(["a"], "rec")).toEqual(["a"]);
  });
});
