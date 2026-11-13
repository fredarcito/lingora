import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  TITLE_CHARS,
  chatGroups,
  chatTitle,
  isCheckedCitation,
  localDate,
  messageTime,
  newChatId,
  newMessage,
  requestTurns,
  sourceChips,
  splitCitations,
  splitTimes,
  streamingCitesView,
  trailingCitations,
  streamingView,
  trailingTimes,
  unaskedSuggestions,
} from "./chat";

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

describe("all-notes chat helpers", () => {
  const now = new Date(2026, 10, 13, 18, 5, 9);

  it("dates and ids are local", () => {
    expect(localDate(now)).toBe("2026-11-13");
    expect(newChatId(now)).toBe("2026-11-13_18-05-09");
  });

  it("titles are the first question, cut at a word", () => {
    expect(chatTitle("  ¿Qué dijo   Ana?\n")).toBe("¿Qué dijo Ana?");
    const long = chatTitle("Dame un resumen de todas las reuniones con Jeff Chen sobre el proyecto Atlas y sus retrasos");
    expect(long.length).toBeLessThanOrEqual(TITLE_CHARS + 1);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it("groups chats by day, keeping their order", () => {
    const chats = [
      { id: "a", updated_at: new Date(2026, 10, 13, 9).toISOString() },
      { id: "b", updated_at: new Date(2026, 10, 12, 23).toISOString() },
      { id: "c", updated_at: new Date(2026, 10, 9, 10).toISOString() },
      { id: "d", updated_at: new Date(2026, 9, 1).toISOString() },
      { id: "e", updated_at: "raro" },
    ];
    expect(chatGroups(chats, now).map((g) => [g.group, g.chats.map((c) => c.id).join("")])).toEqual([
      ["today", "a"],
      ["yesterday", "b"],
      ["week", "c"],
      ["older", "de"],
    ]);
  });

  it("finds every form of citation", () => {
    const parts = splitCitations("Ana [Nota 2, 12:40] y [note 1 · 1:02:03], ver [Nota 3]; luego [00:05] y [enlace].");
    expect(parts.filter((p) => typeof p !== "string")).toEqual([
      { raw: "[Nota 2, 12:40]", n: 2, clock: "12:40", secs: 760 },
      { raw: "[note 1 · 1:02:03]", n: 1, clock: "1:02:03", secs: 3723 },
      { raw: "[Nota 3]", n: 3, clock: null, secs: null },
      { raw: "[00:05]", n: null, clock: "00:05", secs: 5 },
    ]);
    expect(parts.filter((p) => typeof p === "string").join("|")).toBe("Ana | y |, ver |; luego | y [enlace].");
  });

  it("only checked citations count", () => {
    const checked = [{ n: 2, at: 760 }, { n: 3, at: null }];
    expect(isCheckedCitation(checked, 2, 760)).toBe(true);
    expect(isCheckedCitation(checked, 2, 800)).toBe(false);
    expect(isCheckedCitation(checked, 3, null)).toBe(true);
    expect(isCheckedCitation(checked, 1, null)).toBe(false);
  });

  it("shows every note given, by its cited moments or once", () => {
    const notes = [
      { n: 1, id: "a", title: "A", date: "2026-11-01" },
      { n: 2, id: "b", title: "B", date: "2026-11-02" },
    ];
    const chips = sourceChips(notes, [{ n: 2, at: 90 }, { n: 2, at: 30 }, { n: 2, at: 90 }, { n: 2, at: null }]);
    expect(chips.map((c) => `${c.id}@${c.at}`)).toEqual(["a@null", "b@30", "b@90"]);
  });

  it("hides a citation still being written", () => {
    expect(streamingCitesView("Lo dijo Ana [Nota 2, 12:")).toBe("Lo dijo Ana ");
    expect(streamingCitesView("Lo dijo Ana [No")).toBe("Lo dijo Ana ");
    expect(streamingCitesView("Lo dijo Ana [Nota 2, 12:40]")).toBe("Lo dijo Ana [Nota 2, 12:40]");
  });
});

describe("trailingCitations", () => {
  it("takes the citations that close a line", () => {
    const { text, cites } = trailingCitations("Bocetos de las pantallas [Nota 1, 01:10], [Nota 2].");
    expect(text).toBe("Bocetos de las pantallas");
    expect(cites.map((c) => c.raw)).toEqual(["[Nota 1, 01:10]", "[Nota 2]"]);
  });

  it("leaves a line without them, or made only of them, as it is", () => {
    expect(trailingCitations("Sin citas.")).toEqual({ text: "Sin citas.", cites: [] });
    expect(trailingCitations("[Nota 1, 00:10]").cites).toEqual([]);
    expect(trailingCitations("Un [enlace]").cites).toEqual([]);
  });
});
