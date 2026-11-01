import { describe, expect, it } from "vitest";
import { clockSecs, layoutMap, mapTree, partAt, summaryTree, wrap } from "./mindMap";

const SUMMARY = `## Resumen
Ana y Luis hablaron del lanzamiento.

## Puntos clave
- El precio será **49 €**.
- La beta empieza en diciembre [18:05]

## Tareas
- [ ] Página de descarga — Ana
- [x] Firma de Apple

## Mis notas
- [01:52] «me encantó esta parte» — hablaban del parque

## Momentos destacados
- [1:02:03] Pikachu`;

describe("summaryTree", () => {
  const tree = summaryTree(SUMMARY);

  it("keeps only the sections that are lists", () => {
    expect(tree.map((b) => b.title)).toEqual(["Puntos clave", "Tareas", "Mis notas", "Momentos destacados"]);
  });

  it("cleans bold and checkboxes and splits off who or the context", () => {
    expect(tree[0].items[0]).toEqual({ text: "El precio será 49 €.", sub: "", secs: null });
    expect(tree[1].items).toEqual([
      { text: "Página de descarga", sub: "Ana", secs: null },
      { text: "Firma de Apple", sub: "", secs: null },
    ]);
    expect(tree[2].items[0]).toEqual({ text: "me encantó esta parte", sub: "hablaban del parque", secs: 112 });
  });

  it("reads the time at the start or at the end", () => {
    expect(tree[0].items[1]).toEqual({ text: "La beta empieza en diciembre", sub: "", secs: 1085 });
    expect(tree[3].items[0].secs).toBe(3723);
  });

  it("is empty without lists", () => {
    expect(summaryTree("## Resumen\nSolo texto.")).toEqual([]);
  });
});

describe("mapTree", () => {
  it("uses the short version of each list and keeps the rest", () => {
    const short = "## Puntos clave\n- Precio: 49 €\n- Beta en diciembre [18:05]\n\n## tareas\n- Página de descarga — Ana";
    const tree = mapTree(SUMMARY, short);
    expect(tree.map((b) => b.title)).toEqual(["Puntos clave", "Tareas", "Mis notas", "Momentos destacados"]);
    expect(tree[0].items).toEqual([
      { text: "Precio: 49 €", sub: "", secs: null },
      { text: "Beta en diciembre", sub: "", secs: 1085 },
    ]);
    expect(tree[1].items).toEqual([{ text: "Página de descarga", sub: "Ana", secs: null }]);
    expect(tree[2]).toEqual(summaryTree(SUMMARY)[2]);
  });

  it("is the summary's own lists without a short version", () => {
    expect(mapTree(SUMMARY)).toEqual(summaryTree(SUMMARY));
  });
});

describe("clockSecs and partAt", () => {
  it("reads mm:ss and h:mm:ss", () => {
    expect(clockSecs("12:40")).toBe(760);
    expect(clockSecs("1:00:05")).toBe(3605);
  });

  it("finds the paragraph that was being heard, skipping gaps", () => {
    const parts = /** @type {any} */ ([{ block: [{ t: 5 }] }, { gap: 30 }, { block: [{ t: 60 }] }, { block: [{ t: 120 }] }]);
    expect(partAt(parts, 0)).toBe(0);
    expect(partAt(parts, 59)).toBe(0);
    expect(partAt(parts, 61)).toBe(2);
    expect(partAt(parts, 999)).toBe(3);
    expect(partAt([], 10)).toBe(null);
  });
});

// One px per character: easy to reason about.
const measure = (/** @type {string} */ s) => s.length;

describe("wrap", () => {
  it("breaks between words without passing the width", () => {
    expect(wrap("uno dos tres cuatro", 8, measure)).toEqual(["uno dos", "tres", "cuatro"]);
    expect(wrap("palabramuylarga y", 5, measure)).toEqual(["palabramuylarga", "y"]);
  });
});

describe("layoutMap", () => {
  const tree = summaryTree(SUMMARY);
  const subtitles = tree.map((b) => `${b.items.length}`);
  const open = tree.map(() => ({ open: true, all: false }));

  it("puts sections right of the title and one box per idea right of them", () => {
    const map = layoutMap("Reunión", tree, subtitles, open, measure);
    expect(map.branches).toHaveLength(4);
    expect(map.leaves).toHaveLength(6);
    expect(map.branches[0].x).toBeGreaterThan(map.root.x + map.root.w);
    expect(map.leaves[0].x).toBeGreaterThan(map.branches[0].x + map.branches[0].w);
    // Title → section, and section → each idea.
    expect(map.edges).toHaveLength(4 + 6);
    for (const box of [map.root, ...map.branches, ...map.leaves]) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.h).toBeLessThanOrEqual(map.height);
    }
    // No section overlaps the next one.
    for (let i = 1; i < map.branches.length; i++) expect(map.branches[i].y).toBeGreaterThan(map.branches[i - 1].y + map.branches[i - 1].h);
  });

  it("folds a section and shows «+N» past the limit", () => {
    const many = [{ title: "Tareas", items: Array.from({ length: 6 }, (_, i) => ({ text: `t${i}`, sub: "", secs: null })) }];
    expect(layoutMap("R", many, ["6"], [{ open: true, all: false }], measure).more).toEqual([expect.objectContaining({ hidden: 2 })]);
    expect(layoutMap("R", many, ["6"], [{ open: true, all: true }], measure).leaves).toHaveLength(6);
    const folded = layoutMap("R", many, ["6"], [{ open: false, all: false }], measure);
    expect(folded.leaves).toHaveLength(0);
    expect(folded.more).toHaveLength(0);
    expect(folded.edges).toHaveLength(1);
  });
});
