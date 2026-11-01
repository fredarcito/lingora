// The note's mind map: the summary's Markdown as a tree (sections → items)
// and where each box goes. Pure functions; the drawing is in components/MindMap.

/**
 * @typedef {{ text: string, sub: string, secs: number | null }} MapItem
 * An item of the summary: its text, what goes below it, quieter (the context of
 * one of your notes, who does a task), and the second of the conversation it
 * points to, if it says so.
 * @typedef {{ title: string, items: MapItem[] }} MapBranch
 */

/** "[12:40]" or "[1:02:03]" → seconds. @param {string} clock */
export function clockSecs(clock) {
  return clock.split(":").reduce((total, n) => total * 60 + Number(n), 0);
}

const TIME_AT_START = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/;
/** `point [12:40]`, also `point [12:40].`: the model sometimes closes the sentence after the time. */
export const TIME_AT_END = /\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]([.;]?)$/;

/** One list item of the summary (without the "- "). @param {string} raw @returns {MapItem} */
function item(raw) {
  let text = raw.replace(/^\[[ xX]\]\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
  let secs = null;
  const start = text.match(TIME_AT_START) ?? text.match(TIME_AT_END);
  if (start) {
    secs = clockSecs(start[1]);
    text = text.replace(start[0], start[2] ?? "").trim();
  }
  // "«quote» — context" (My notes) or "task — who" (Tasks).
  const [main, ...rest] = text.split(/\s+—\s+/);
  return { text: main.replace(/^«(.*)»$/, "$1"), sub: rest.join(" — "), secs };
}

/**
 * The summary's sections that are lists, as branches. The ones that are
 * prose (the "Summary" paragraph) stay out: they are read in their own tab.
 * @param {string} markdown
 * @returns {MapBranch[]}
 */
export function summaryTree(markdown) {
  /** @type {MapBranch[]} */
  const out = [];
  /** @type {MapBranch | null} */
  let current = null;
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,4}\s+(.*)/);
    const listItem = line.match(/^\s*[-*]\s+(.*)/);
    if (heading) {
      current = { title: heading[1].replace(/\*\*/g, "").trim(), items: [] };
      out.push(current);
    } else if (listItem && current) {
      current.items.push(item(listItem[1]));
    }
  }
  return out.filter((b) => b.items.length > 0);
}

/**
 * The map's branches: the summary's lists, with the short version of each
 * (`map`, same section titles) where there is one. Without it, or for a section
 * it does not have (Highlighted moments, My notes), the summary's own items.
 * @param {string} text @param {string} [short]
 * @returns {MapBranch[]}
 */
export function mapTree(text, short) {
  const full = summaryTree(text);
  if (!short) return full;
  const key = (/** @type {string} */ title) => title.trim().toLocaleLowerCase();
  const brief = new Map(summaryTree(short).map((b) => [key(b.title), b.items]));
  return full.map((b) => ({ ...b, items: brief.get(key(b.title)) ?? b.items }));
}

/**
 * The paragraph of the transcript (index of `transcriptParts`) that was being
 * heard at that second: the last one that started before it. Null without paragraphs.
 * @param {ReturnType<typeof import("./notes").transcriptParts>} parts
 * @param {number} secs
 */
export function partAt(parts, secs) {
  let at = null;
  parts.forEach((p, i) => {
    if ("block" in p && (at === null || p.block[0].t <= secs)) at = i;
  });
  return at;
}

/**
 * Splits the text into lines no wider than `max`. A word longer than that
 * goes on its own line.
 * @param {string} text @param {number} max @param {(text: string) => number} measure
 */
export function wrap(text, max, measure) {
  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Sizes of the map, in px. */
export const MAP = {
  padX: 12,
  padY: 9,
  line: 18,
  subLine: 16,
  /** Between the ideas of a section. */
  rowGap: 8,
  branchGap: 22,
  /** Between the title and the sections, and between a section and its ideas. */
  colGap: 44,
  rootMax: 180,
  branchMin: 130,
  /** Every idea the same width, so their times line up. */
  leafW: 360,
  /** Room for the time on the right of an idea. */
  timeW: 44,
  /** A section: its title and, below, how many ideas. */
  branchH: 50,
  moreW: 76,
  moreH: 24,
  /** Ideas shown per section before "+N". */
  maxItems: 4,
};

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * @typedef {Box & { lines: string[] }} RootBox
 * @typedef {Box & { index: number, title: string, subtitle: string, open: boolean }} BranchBox
 * @typedef {Box & { branch: number, lines: string[], subLines: string[], secs: number | null }} LeafBox
 * @typedef {Box & { branch: number, hidden: number }} MoreBox
 * @typedef {{ branch: number, x1: number, y1: number, x2: number, y2: number }} Edge
 * @typedef {{ width: number, height: number, root: RootBox, branches: BranchBox[], leaves: LeafBox[], more: MoreBox[], edges: Edge[] }} MapLayout
 */

/**
 * Where each box goes: the title on the left, the sections in the middle,
 * each centered on its ideas, and one box per idea on the right.
 * @param {string} title
 * @param {MapBranch[]} branches
 * @param {string[]} subtitles Below each section's title ("5 puntos").
 * @param {{ open: boolean, all: boolean }[]} state Per section: unfolded, and with all its ideas.
 * @param {(text: string, kind: "root" | "branch" | "item" | "sub") => number} measure Width of a text in px.
 * @returns {MapLayout}
 */
export function layoutMap(title, branches, subtitles, state, measure) {
  const { padX, padY, line, subLine, rowGap, branchGap, colGap, leafW, timeW, branchH } = MAP;
  const rootLines = wrap(title, MAP.rootMax, (s) => measure(s, "root"));
  const rootW = Math.max(...rootLines.map((l) => measure(l, "root"))) + padX * 2;
  const rootH = rootLines.length * line + padY * 2;
  // Chevron on the left of the title.
  const branchW = Math.max(MAP.branchMin, ...branches.map((b, i) => Math.max(measure(b.title, "branch"), measure(subtitles[i] ?? "", "sub")) + 16 + padX * 2));
  const xB = rootW + colGap;
  const xL = xB + branchW + colGap;
  const textW = leafW - padX * 2 - timeW;

  /** @type {BranchBox[]} */
  const branchBoxes = [];
  /** @type {LeafBox[]} */
  const leaves = [];
  /** @type {MoreBox[]} */
  const more = [];
  /** @type {Edge[]} */
  const edges = [];
  let y = 0;

  branches.forEach((b, i) => {
    const { open, all } = state[i] ?? { open: true, all: false };
    const shown = !open ? [] : all ? b.items : b.items.slice(0, MAP.maxItems);
    const top = y;
    for (const it of shown) {
      const lines = wrap(it.text, textW, (s) => measure(s, "item"));
      const subLines = it.sub ? wrap(it.sub, textW, (s) => measure(s, "sub")) : [];
      const h = lines.length * line + subLines.length * subLine + padY * 2 + (subLines.length ? 2 : 0);
      leaves.push({ x: xL, y, w: leafW, h, branch: i, lines, subLines, secs: it.secs });
      y += h + rowGap;
    }
    if (open && shown.length < b.items.length) {
      more.push({ x: xL, y, w: MAP.moreW, h: MAP.moreH, branch: i, hidden: b.items.length - shown.length });
      y += MAP.moreH + rowGap;
    }
    // Folded, or its ideas shorter than the section itself.
    const ideas = y - top - (y > top ? rowGap : 0);
    if (ideas < branchH) {
      const pad = (branchH - ideas) / 2;
      for (const box of [...leaves, ...more]) if (box.branch === i) box.y += pad;
      y = top + branchH + (y > top ? rowGap : 0);
    }
    const end = y - (y > top ? rowGap : 0);
    branchBoxes.push({ x: xB, y: (top + end) / 2 - branchH / 2, w: branchW, h: branchH, index: i, title: b.title, subtitle: subtitles[i] ?? "", open });
    y = end + branchGap;
  });
  const sectionsH = Math.max(0, y - branchGap);
  const height = Math.max(rootH, sectionsH);

  const rootY = (height - rootH) / 2;
  const shift = (height - sectionsH) / 2;
  for (const box of [...branchBoxes, ...leaves, ...more]) box.y += shift;
  const root = { x: 0, y: rootY, w: rootW, h: rootH, lines: rootLines };

  for (const b of branchBoxes) edges.push({ branch: b.index, x1: rootW, y1: rootY + rootH / 2, x2: xB, y2: b.y + b.h / 2 });
  for (const l of [...leaves, ...more]) {
    const b = branchBoxes[l.branch];
    edges.push({ branch: l.branch, x1: xB + branchW, y1: b.y + b.h / 2, x2: xL, y2: l.y + l.h / 2 });
  }
  return { width: leaves.length || more.length ? xL + leafW : xB + branchW, height, root, branches: branchBoxes, leaves, more, edges };
}
