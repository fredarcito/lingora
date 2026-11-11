import { describe, expect, it } from "vitest";
import { phraseQueue, phraseSplitter, splitAtSentenceEnd } from "./phrases.js";

/** The sentences the splitter gives for a translation that arrives in `deltas`. */
const split = (/** @type {string[]} */ deltas) => {
  /** @type {string[]} */
  const out = [];
  const splitter = phraseSplitter((phrase) => out.push(phrase));
  for (const d of deltas) splitter.add(d);
  splitter.flush();
  return out;
};

describe("phraseSplitter", () => {
  it("gives each sentence as soon as it is complete", () => {
    /** @type {string[]} */
    const out = [];
    const splitter = phraseSplitter((phrase) => out.push(phrase));
    splitter.add("This is the first sentence of the talk. And this");
    expect(out).toEqual(["This is the first sentence of the talk."]);
    splitter.add(" is the second one, a bit longer.");
    splitter.flush();
    expect(out).toEqual(["This is the first sentence of the talk.", "And this is the second one, a bit longer."]);
  });

  it("cuts the first sentence at its first comma, so the voice starts early", () => {
    expect(split(["Well, to be completely honest, I do not really know what happened"])).toEqual([
      "Well, to be completely honest,",
      "I do not really know what happened",
    ]);
  });

  it("joins short sentences to the next one", () => {
    expect(split(["This is the first sentence of the talk. Yes. No. And then we went home."])).toEqual([
      "This is the first sentence of the talk.",
      "Yes. No. And then we went home.",
    ]);
  });

  it("letter by letter, cuts the first sentence at its comma without waiting for the period", () => {
    const text = "La primera frase es bastante larga, con una coma. La segunda también lo es. Fin.";
    expect(split(text.split(""))).toEqual(["La primera frase es bastante larga,", "con una coma. La segunda también lo es.", "Fin."]);
  });

  it("ends sentences at Chinese punctuation, without a space after it", () => {
    expect(split(["这是第一句话，我们今天讨论这个问题。这是第二句话，谢谢大家。"])).toEqual(["这是第一句话，我们今天讨论这个问题。", "这是第二句话，谢谢大家。"]);
  });
});

describe("splitAtSentenceEnd", () => {
  it("keeps the unfinished last sentence for the next chunk", () => {
    expect(splitAtSentenceEnd("We went there. And then we", false)).toEqual({ head: "We went there.", tail: "And then we" });
  });

  it("does not count the final period as an end: the sentence may go on", () => {
    expect(splitAtSentenceEnd("We went there. And then we stopped.", false)).toEqual({ head: "We went there.", tail: "And then we stopped" });
  });

  it("falls back to the last comma", () => {
    expect(splitAtSentenceEnd("When we got there, it was", false)).toEqual({ head: "When we got there,", tail: "it was" });
  });

  it("with nowhere to cut, keeps the text once and then lets it through", () => {
    expect(splitAtSentenceEnd("no punctuation here", false)).toEqual({ head: "", tail: "no punctuation here" });
    expect(splitAtSentenceEnd("no punctuation here", true)).toEqual({ head: "no punctuation here", tail: "" });
  });
});

describe("phraseQueue", () => {
  it("gives the items in order, waiting for the ones still to come", async () => {
    const queue = phraseQueue();
    queue.push(1);
    const read = (async () => {
      const got = [];
      for await (const item of queue) got.push(item);
      return got;
    })();
    await Promise.resolve();
    queue.push(2);
    queue.end();
    expect(await read).toEqual([1, 2]);
  });
});
