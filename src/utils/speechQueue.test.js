import { describe, expect, it } from "vitest";
import { createSpeechQueue } from "./speechQueue";

/** A task that finishes when `finish` is called, recording when it starts. */
function controlled(/** @type {string[]} */ log, /** @type {string} */ name) {
  /** @type {(value: string) => void} */
  let finish = () => {};
  const task = () => {
    log.push(name);
    return new Promise((resolve) => (finish = resolve));
  };
  return { task, finish: () => finish(name) };
}

describe("createSpeechQueue", () => {
  it("runs at most two at a time, in order", async () => {
    const queue = createSpeechQueue();
    const log = [];
    const [a, b, c] = ["a", "b", "c"].map((n) => controlled(log, n));
    const results = [a, b, c].map((t) => queue.run(t.task));
    await Promise.resolve();
    expect(log).toEqual(["a", "b"]);
    a.finish();
    expect(await results[0]).toBe("a");
    await new Promise((r) => setTimeout(r));
    expect(log).toEqual(["a", "b", "c"]);
    b.finish();
    c.finish();
    expect(await Promise.all(results)).toEqual(["a", "b", "c"]);
  });

  it("asks skip right before starting, not when queued", async () => {
    const queue = createSpeechQueue(1);
    const log = [];
    const a = controlled(log, "a");
    let late = false;
    const first = queue.run(a.task);
    const second = queue.run(async () => (log.push("b"), "b"), () => late);
    late = true;
    await new Promise((r) => setTimeout(r));
    a.finish();
    expect(await first).toBe("a");
    expect(await second).toBeNull();
    expect(log).toEqual(["a"]);
  });

  it("keeps going after a failure", async () => {
    const queue = createSpeechQueue(1);
    const failed = queue.run(() => Promise.reject(new Error("no")));
    const next = queue.run(async () => "ok");
    await expect(failed).rejects.toThrow("no");
    expect(await next).toBe("ok");
  });
});
