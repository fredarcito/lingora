// Checks that splitting the CSS into files changed nothing: compares the
// original `styles.css` with the CSS that Vite bundles unminified.
//
//   LINGORA_CSS_CHECK=1 npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
//   node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
//
// `LINGORA_CSS_CHECK=1` leaves the module classes without a suffix, so that
// they can be compared with those in the original.
//
// It checks four things:
//   1. No rule is lost or duplicated (each selector in a group
//      `a, b { … }` counts separately).
//   2. Rules with the same selector stay in the same order.
//   3. Two rules that share a class, an attribute or the element, have
//      the same specificity and touch some common property, they stay in the
//      same order, even if one is inside a @media or @container: otherwise,
//      the one that wins may change.
//   5. Each global (non-module) class in the bundled CSS is still written as
//      it is in some `.jsx`: if its component already takes it out of the module, the rule
//      global no longer reaches it. Dead CSS that was already there is not counted.
//   4. Each `styles.module.css` matches the `.jsx` in its folder: each class
//      of the module is used (`s.noteAction`) and each `s.something` exists; otherwise,
//      React sets `class="undefined"` without raising an error.
// For point 3, two different classes that go on the same
// element (`note-action` and `note-more` on the ⋯ button) also count: the JSX of
// before the refactor, copied in `docs/refactor/jsx.original/`, says so.
// The selectors that had to be rewritten when moving to modules (a rule that
// crossed two components) are listed in `docs/refactor/renames.json` as
// `[{ "from": "…", "to": "…" }]`; they only count if the specificity does not change.
// Exits with 1 and lists the problems if it finds any.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The CSS rules, in order: `{ ctx, sel, body }`. `ctx` is the @media,
 * @supports or @container wrapping them; @keyframes and @font-face count
 * as one rule.
 * @param {string} css
 */
function parse(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {{ ctx: string, sel: string, body: string }[]} */
  const rules = [];
  const norm = (/** @type {string} */ s) => s.replace(/\s+/g, " ").trim();
  /** @param {number} from Index after the `{`. @returns {number} Index of its `}`. */
  const close = (from) => {
    let depth = 1;
    for (let i = from; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) return i;
    }
    throw new Error("llave sin cerrar");
  };
  /** @param {number} start @param {number} end @param {string} ctx */
  const walk = (start, end, ctx) => {
    let i = start;
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const prelude = norm(text.slice(i, open));
      const stop = close(open + 1);
      if (/^@(media|supports|container)/.test(prelude)) walk(open + 1, stop, `${ctx}${prelude} › `);
      else if (prelude.startsWith("@")) rules.push({ ctx, sel: prelude, body: norm(text.slice(open + 1, stop)) });
      else {
        const body = norm(text.slice(open + 1, stop))
          .split(";")
          .map(norm)
          .filter(Boolean)
          .join("; ");
        for (const sel of splitSelectors(prelude)) rules.push({ ctx, sel, body });
      }
      i = stop + 1;
    }
  };
  walk(0, text.length, "");
  return rules;
}

/** `a, b:not(.c, .d)` → ["a", "b:not(.c, .d)"]: commas inside parentheses do not split. @param {string} prelude */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of prelude) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Approximate specificity [ids, classes, elements]; enough for comparing. @param {string} sel */
function specificity(sel) {
  const s = sel.replace(/:(?:not|is|has)\(([^)]*)\)/g, " $1").replace(/:where\([^)]*\)/g, "");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return `${ids},${classes},${elements}`;
}

const key = (/** @type {{ ctx: string, sel: string, body: string }} */ r) => `${r.ctx}${r.sel} { ${r.body} }`;

const [originalPath, ...bundlePaths] = process.argv.slice(2);
if (!originalPath || bundlePaths.length === 0) {
  console.error("Uso: node scripts/css-check.mjs <styles.original.css> <css empaquetado…>");
  process.exit(2);
}
const problems = [];
const RENAMES = join(dirname(originalPath), "renames.json");
/** @type {Map<string, string>} */
const renames = new Map(
  existsSync(RENAMES)
    ? JSON.parse(readFileSync(RENAMES, "utf8")).map((/** @type {{ from: string, to: string }} */ r) => [r.from, r.to])
    : [],
);
for (const [from, to] of renames) {
  if (specificity(from) !== specificity(to))
    problems.push(`Renombre con otra especificidad: «${from}» (${specificity(from)}) → «${to}» (${specificity(to)})`);
}
// `from` keeps the original selector: a rewritten rule still lands on the
// same elements, so it is also compared by it.
const before = parse(readFileSync(originalPath, "utf8")).map((r) => ({ ...r, from: r.sel, sel: renames.get(r.sel) ?? r.sel }));
// In check mode the module classes carry their folder
// (`note-action__Button`): they are compared without it, but it is used to know that
// `.is-selected__Segmented` and `.is-selected__App` do not overwrite each other.
const SCOPE = /__[A-Z]\w*/g;
const after = bundlePaths
  .flatMap((p) => parse(readFileSync(p, "utf8")))
  .map((r) => ({ ...r, scoped: r.sel, sel: r.sel.replace(SCOPE, ""), body: r.body.replace(SCOPE, "") }));

// 1. Neither lost nor duplicated.
/** @type {Map<string, number>} */
const count = new Map();
for (const r of before) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
for (const r of after) count.set(key(r), (count.get(key(r)) ?? 0) - 1);
for (const [k, n] of count) {
  if (n > 0) problems.push(`Falta: ${k}`);
  if (n < 0) problems.push(`Sobra (o cambió): ${k}`);
}

// 2 and 3. The order of each pair that can overwrite each other. Identical rules are
// told apart by their occurrence number.
/** @param {{ ctx: string, sel: string, body: string }[]} rules */
const positions = (rules) => {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return rules.map((r, i) => {
    const n = (seen.get(key(r)) ?? 0) + 1;
    seen.set(key(r), n);
    return { ...r, id: `${key(r)} #${n}`, at: i };
  });
};
/** The property without browser prefix: `-webkit-mask-image` → `mask-image`. @param {string} p */
const unprefixed = (p) => p.replace(/^-\w+-/, "");
/** Shorthands whose parts do not start with their name. */
const LONGHANDS = {
  inset: ["top", "right", "bottom", "left"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  gap: ["row-gap", "column-gap"],
};
/**
 * Whether two properties overwrite each other: the same one, or a shorthand and one of its parts
 * (`margin` and `margin-left`, `border-color` and `border-left-color`, `inset` and
 * `top`). `margin-top` and `margin-left` do not overwrite each other.
 * @param {string} p @param {string} q
 */
const clash = (p, q) => {
  [p, q] = [unprefixed(p), unprefixed(q)];
  if (p === q || p === "all" || q === "all") return true;
  if (p.startsWith("--") || q.startsWith("--")) return false;
  if (p.startsWith(`${q}-`) || q.startsWith(`${p}-`)) return true;
  if (LONGHANDS[p]?.includes(q) || LONGHANDS[q]?.includes(p)) return true;
  const [ps, qs] = [p.split("-"), q.split("-")];
  if (ps[0] !== qs[0]) return false;
  // `border-color` and `border-left-color`; `margin-inline` with any margin.
  return ps[ps.length - 1] === qs[qs.length - 1] || /inline|block/.test(p) || /inline|block/.test(q);
};
/** The properties a rule declares. @param {string} body */
const propsOf = (body) =>
  body
    .split("; ")
    .map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase())
    .filter(Boolean);
/** Whether any property of one rule overwrites any of the other. @param {string[]} x @param {string[]} y */
const overlap = (x, y) => x.some((p) => y.some((q) => clash(p, q)));

const b = positions(before);
const afterRules = positions(after);
const a = new Map(afterRules.map((r) => [r.id, r.at]));
/** The selector as it ended up, with the folder of each module class. */
const scoped = new Map(afterRules.map((r) => [r.id, /** @type {string} */ (r.scoped)]));
/** `.note-action` → the classes with folder that appear this way in the bundled CSS. */
/** @type {Map<string, Set<string>>} */
const scopes = new Map();
for (const r of afterRules)
  for (const c of r.scoped.match(/\.[\w-]+/g) ?? []) {
    const plain = c.replace(SCOPE, "");
    if (!scopes.has(plain)) scopes.set(plain, new Set());
    scopes.get(plain)?.add(c);
  }
/**
 * What can make two rules land on the same element: their classes,
 * attributes and ids, and `el:` + the element of the last part
 * (`.a button:hover` → `el:button`).
 * @param {string} sel
 */
const tokensOf = (sel) => {
  const tokens = new Set(sel.match(/\.[\w-]+|\[[^\]]*\]|#[\w-]+/g) ?? []);
  const last = sel.replace(/\[[^\]]*\]|\([^)]*\)/g, "").split(/[\s>+~]+/).pop() ?? "";
  const element = last.match(/^[a-z][\w-]*/i);
  if (element) tokens.add(`el:${element[0]}`);
  return tokens;
};
/** The classes of each `className` in the original JSX (all its branches together). */
/** @type {Set<string>[]} */
const together = [];
/** All the classes written in some `className` of the original JSX. */
const known = new Set();
const JSX = join(dirname(originalPath), "jsx.original");
if (existsSync(JSX)) {
  for (const f of readdirSync(JSX).filter((n) => n.endsWith(".jsx"))) {
    const code = readFileSync(join(JSX, f), "utf8");
    for (const m of code.matchAll(/className=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/g)) {
      const names = (m[1].match(/["'`][^"'`]*["'`]/g) ?? []).flatMap((lit) => lit.slice(1, -1).split(/\s+|\$\{[^}]*\}/)).filter(Boolean);
      for (const n of names) known.add(n);
      if (names.length > 1) together.push(new Set(names));
    }
  }
}
/** The classes of the last part, without folder: `.a .b.c:hover` → b, c. @param {string} sel */
const subjectClasses = (sel) =>
  (sel.replace(/\([^)]*\)/g, "").split(/[\s>+~]+/).pop()?.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1).replace(SCOPE, ""));
/**
 * Whether in the original JSX some element carried at the same time the classes of the last
 * part of `x` and those of `y` (`note-action` and `note-more` on the ⋯ button).
 * @param {string} x @param {string} y
 */
const share = (x, y) => {
  const xs = subjectClasses(x);
  const ys = subjectClasses(y);
  // If they share a name, `meet` already decides, which tells which module each class belongs to.
  if (!xs.length || !ys.length || xs.some((c) => ys.includes(c))) return false;
  return together.some((g) => [...xs, ...ys].every((c) => g.has(c)));
};
/**
 * Whether the same element can carry the classes of the last part of `x` and of
 * `y` (by their original selector). `primary` and `danger` never go together in the
 * original JSX: their rules do not overwrite each other. If a class is set from a
 * variable (`lane-${…}`) it is not known, and it is taken as possible.
 * @param {typeof b[number]} x @param {typeof b[number]} y
 */
const canMeet = (x, y) => {
  const all = new Set([...subjectClasses(x.from), ...subjectClasses(y.from)]);
  if (all.size < 2 || ![...all].every((c) => known.has(c))) return true;
  return together.some((g) => [...all].every((c) => g.has(c)));
};
/**
 * Whether two selectors can land on the same element. The element only counts
 * if one of the two has no classes (`button:disabled` and `.segmented button`):
 * `.a span` and `.b span` almost never match and would give false warnings.
 * @param {Set<string>} x @param {Set<string>} y
 */
const meet = (x, y) => {
  const bare = (/** @type {Set<string>} */ t) => [...t].every((k) => k.startsWith("el:"));
  return [...y].some((k) => x.has(k) && (!k.startsWith("el:") || bare(x) || bare(y)));
};
/**
 * What a rule touches in the new CSS. If it was rewritten, also what
 * its original selector touched, in any module where that class is.
 * @param {{ id: string, sel: string, from: string }} r
 */
const reach = (r) => {
  const tokens = tokensOf(scoped.get(r.id) ?? r.sel);
  if (r.from !== r.sel)
    for (const k of tokensOf(r.from)) for (const c of scopes.get(k) ?? [k]) tokens.add(c);
  return tokens;
};
/** `{ property: value }` of a rule. @param {string} body */
const declsOf = (body) =>
  new Map(
    body
      .split("; ")
      .filter((d) => d.includes(":"))
      .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()]),
  );
/**
 * What a selector requires apart from the classes of its last part: what comes
 * before (`.dialog `) and the pseudo-classes (`:hover`, `:not(:disabled)`).
 * @param {string} sel
 */
const conditionOf = (sel) => {
  const parts = sel.replace(SCOPE, "").split(/(\s*[\s>+~]\s*)/);
  const last = /** @type {string} */ (parts.pop());
  return { before: parts.join(""), pseudos: last.replace(/\.[\w-]+/g, "").match(/:+[\w-]+(?:\([^)]*\))?|^[a-z][\w-]*/gi) ?? [] };
};
/**
 * Whether swapping the order of `x` and `y` changes nothing: for each property that
 * both declare, the value that wins on its element is the same in both
 * orders. It counts only the rules that surely apply to it when `x` and
 * `y` apply (same classes or fewer, same condition, no @media or the one of `x` or `y`);
 * those that might apply have their own order check.
 * @param {typeof b[number]} x @param {typeof b[number]} y
 */
const sameResult = (x, y) => {
  const dx = declsOf(x.body);
  const dy = declsOf(y.body);
  // Shorthand against one of its parts (`border` and `border-color`): cannot be ensured.
  for (const [p] of dx) for (const [q] of dy) if (p !== q && clash(p, q)) return false;
  /** The classes of its last part, with those of its original selector if it was rewritten. @param {typeof b[number]} r */
  const classesOf = (r) => [...subjectClasses(r.sel), ...subjectClasses(r.from)];
  const classes = new Set([...classesOf(x), ...classesOf(y)]);
  const [cx, cy] = [conditionOf(x.sel), conditionOf(y.sel)];
  const befores = new Set(["", cx.before, cy.before]);
  const pseudos = new Set([...cx.pseudos, ...cy.pseudos]);
  const contexts = new Set(["", x.ctx, y.ctx]);
  const sure = b.filter((r) => {
    if (!a.has(r.id) || r.sel.startsWith("@") || !contexts.has(r.ctx)) return false;
    const cr = conditionOf(r.sel);
    return befores.has(cr.before) && cr.pseudos.every((p) => pseudos.has(p)) && classesOf(r).every((c) => classes.has(c));
  });
  for (const [prop] of dx) {
    if (!dy.has(prop)) continue;
    /** @param {(r: typeof b[number]) => number} at */
    const winner = (at) => {
      let best = null;
      for (const r of sure) {
        const value = declsOf(r.body).get(prop);
        if (value === undefined) continue;
        // !important wins, then specificity, then the one that comes later.
        const rank = [value.endsWith("!important") ? 1 : 0, ...specificity(r.sel).split(",").map(Number), at(r)];
        const k = best ? rank.findIndex((v, n) => v !== best.rank[n]) : 0;
        if (!best || (k >= 0 && rank[k] > best.rank[k])) best = { rank, value };
      }
      return best?.value;
    };
    if (winner((r) => b.indexOf(r)) !== winner((r) => /** @type {number} */ (a.get(r.id)))) return false;
  }
  return true;
};
for (let i = 0; i < b.length; i++) {
  const x = b[i];
  if (!a.has(x.id) || x.sel.startsWith("@")) continue;
  const xt = reach(x);
  const xp = propsOf(x.body);
  const xs = specificity(x.sel);
  for (let j = i + 1; j < b.length; j++) {
    const y = b[j];
    if (!a.has(y.id) || y.sel.startsWith("@")) continue;
    const related =
      overlap(xp, propsOf(y.body)) &&
      canMeet(x, y) &&
      (x.sel === y.sel || (xs === specificity(y.sel) && (meet(xt, reach(y)) || share(scoped.get(x.id) ?? x.sel, scoped.get(y.id) ?? y.sel))));
    if (related && /** @type {number} */ (a.get(x.id)) > /** @type {number} */ (a.get(y.id)) && !sameResult(x, y)) {
      problems.push(`Orden: «${x.ctx}${x.sel}» tiene que ir antes que «${y.ctx}${y.sel}»`);
    }
  }
}

// 4. The modules and their .jsx.
/** Like the lodash `camelCase` that Vite uses: `lane-local_to_remote` → `laneLocalToRemote`. @param {string} name */
const camel = (name) =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
/** @param {string} dir @returns {string[]} */
const modulesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? modulesIn(join(dir, e.name)) : e.name.endsWith(".module.css") ? [join(dir, e.name)] : [],
  );
for (const mod of modulesIn("src")) {
  const css = readFileSync(mod, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/:global\([^)]*\)/g, "");
  const defined = new Set((css.replace(/\{[^{}]*\}/g, "{}").match(/\.[a-zA-Z][\w-]*/g) ?? []).map((c) => camel(c.slice(1))));
  const file = mod.split("/").pop();
  const users = readdirSync(dirname(mod))
    .filter((f) => /\.jsx?$/.test(f))
    .map((f) => readFileSync(join(dirname(mod), f), "utf8"))
    .filter((code) => code.includes(`"./${file}"`));
  if (!users.length) {
    problems.push(`Módulo sin importar: ${mod}`);
    continue;
  }
  const code = users.join("\n");
  const name = code.match(new RegExp(`import (\\w+) from "\\./${file.replace(".", "\\.")}"`))?.[1] ?? "styles";
  const body = code.replace(/^import .*$/gm, "");
  const used = new Set([...body.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"))].map((m) => m[1]));
  const dynamic = new RegExp(`\\b${name}\\[`).test(body);
  for (const key of used) if (!defined.has(key)) problems.push(`${mod}: ${name}.${key} no existe en el módulo`);
  if (!dynamic) for (const key of defined) if (!used.has(key)) problems.push(`${mod}: .${key} no la usa nadie`);
}

// 5. Global classes are still written in some .jsx.
/** @param {string} dir @returns {string[]} */
const jsxIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsxIn(join(dir, e.name)) : /\.jsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
/** The words of the quoted texts in a code. @param {string} code */
const literalWords = (code) =>
  new Set(
    (code.replace(/^import .*$/gm, "").match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []).flatMap((lit) =>
      lit.slice(1, -1).split(/\s+|\$\{[^}]*\}/),
    ),
  );
const now = new Set(jsxIn("src").flatMap((f) => [...literalWords(readFileSync(f, "utf8"))]));
const then = existsSync(JSX)
  ? new Set(readdirSync(JSX).flatMap((f) => [...literalWords(readFileSync(join(JSX, f), "utf8"))]))
  : now;
const globalClasses = new Set(after.flatMap((r) => (r.scoped.match(/\.[a-zA-Z][\w-]*/g) ?? []).filter((c) => !/__[A-Z]/.test(c)).map((c) => c.slice(1))));
for (const c of [...globalClasses].sort()) {
  if (then.has(c) && !now.has(c)) problems.push(`Clase global que ya no está en ningún .jsx (¿pasó a un módulo?): .${c}`);
}

if (problems.length) {
  console.log(`${problems.length} problemas:\n`);
  for (const p of problems.slice(0, 40)) console.log(`- ${p}`);
  if (problems.length > 40) console.log(`… y ${problems.length - 40} más`);
  process.exit(1);
}
console.log(`Bien: ${before.length} reglas, ninguna perdida ni fuera de orden.`);
