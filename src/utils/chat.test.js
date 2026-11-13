import { describe, expect, it } from "vitest";
import { MAX_HISTORY, messageTime, newMessage, requestTurns, splitTimes, streamingView, trailingTimes, unaskedSuggestions } from "./chat";

const m = (role, text) => ({ role, text, at: "2026-11-13T10:00:00.000Z" });

describe("newMessage", () => {
  it("stamps the time", () => {
    expect(newMessage("user", "hola", new Date("2026-11-13T10:00:00Z"))).toEqual(m("user", "hola"));
  });
});

describe("requestTurns", () => {
  it("sends the history word for word, without the time", () => {
    const chat = [m("user", "a"), m("assistant", "  b\n"), m("user", "c")];
    expect(requestTurns(chat)).toEqual([
      { role: "user", text: "a" },
      { role: "assistant", text: "  b\n" },
      { role: "user", text: "c" },
    ]);
  });

  it("leaves out a stopped answer with nothing written, with its question", () => {
    const chat = [m("user", "a"), m("assistant", ""), m("user", "b")];
    expect(requestTurns(chat)).toEqual([{ role: "user", text: "b" }]);
  });

  it("keeps the last messages of a very long chat, starting with a question", () => {
    const chat = Array.from({ length: MAX_HISTORY + 3 }, (_, i) => m(i % 2 === 0 ? "user" : "assistant", `t${i}`));
    const turns = requestTurns(chat);
    expect(turns.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(turns[0].role).toBe("user");
    expect(turns.at(-1)?.text).toBe(`t${MAX_HISTORY + 2}`);
  });
});

describe("splitTimes", () => {
  it("separates the cited times", () => {
    expect(splitTimes("Lo dijo Ana [12:40] y se acordó [1:02:03].")).toEqual([
      "Lo dijo Ana ",
      { clock: "12:40", secs: 760 },
      " y se acordó ",
      { clock: "1:02:03", secs: 3723 },
      ".",
    ]);
  });

  it("leaves other brackets as text", () => {
    expect(splitTimes("[ ] tarea [x]")).toEqual(["[ ] tarea [x]"]);
    expect(splitTimes("")).toEqual([]);
  });
});

describe("trailingTimes", () => {
  it("takes the times that close a line", () => {
    expect(trailingTimes("**Escucha frecuente**: ayuda mucho [00:40]")).toEqual({
      text: "**Escucha frecuente**: ayuda mucho",
      times: [{ clock: "00:40", secs: 40 }],
    });
    expect(trailingTimes("Lo repitió — [01:20], [02:05].")).toEqual({
      text: "Lo repitió",
      times: [
        { clock: "01:20", secs: 80 },
        { clock: "02:05", secs: 125 },
      ],
    });
  });

  it("leaves times in the middle and lines made only of times", () => {
    expect(trailingTimes("En [00:10] habló Ana.")).toEqual({ text: "En [00:10] habló Ana.", times: [] });
    expect(trailingTimes("[00:10]")).toEqual({ text: "[00:10]", times: [] });
  });
});

describe("unaskedSuggestions", () => {
  it("drops the ones already asked", () => {
    const options = [
      { id: "a", label: "Uno" },
      { id: "b", label: "Dos" },
    ];
    expect(unaskedSuggestions(options, [m("user", "Uno"), m("assistant", "Dos")])).toEqual([{ id: "b", label: "Dos" }]);
  });
});

describe("messageTime", () => {
  it("is empty without a valid date", () => {
    expect(messageTime(undefined)).toBe("");
    expect(messageTime("nope")).toBe("");
    expect(messageTime("2026-11-13T10:00:00.000Z")).toMatch(/\d/);
  });
});

describe("streamingView", () => {
  it("hides an open bold and a half-written time at the end", () => {
    expect(streamingView("Dijo **Ana")).toBe("Dijo Ana");
    expect(streamingView("**Ana** dijo")).toBe("**Ana** dijo");
    expect(streamingView("Lo dijo en [01:")).toBe("Lo dijo en ");
    expect(streamingView("Lo dijo en [01:20]")).toBe("Lo dijo en [01:20]");
  });
});
