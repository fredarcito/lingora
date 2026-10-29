// Comprueba que repartir el CSS en archivos no cambió nada: compara el
// `styles.css` original con el CSS que empaqueta Vite sin minificar.
//
//   LINGORA_CSS_CHECK=1 npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
//   node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
//
// `LINGORA_CSS_CHECK=1` deja las clases de los módulos sin sufijo, para que
// se puedan comparar con las del original.
//
// Mira cuatro cosas:
//   1. Ninguna regla se perdió ni se duplicó (cada selector de un grupo
//      `a, b { … }` cuenta por separado).
//   2. Las reglas de un mismo selector siguen en el mismo orden.
//   3. Dos reglas que comparten una clase, un atributo o el elemento, tienen
//      la misma especificidad y tocan alguna propiedad en común siguen en el
//      mismo orden, aunque una esté dentro de un @media o @container: si no,
//      la que gana puede cambiar.
//   5. Cada clase global (sin módulo) del CSS empaquetado sigue escrita tal
//      cual en algún `.jsx`: si su componente ya la saca del módulo, la regla
//      global ya no le llega. No cuenta el CSS que ya estaba muerto.
//   4. Cada `styles.module.css` casa con el `.jsx` de su carpeta: cada clase
//      del módulo se usa (`s.noteAction`) y cada `s.algo` existe; si no,
//      React pone `class="undefined"` sin dar error.
// Para el punto 3 también cuentan dos clases distintas que van en el mismo
// elemento (`note-action` y `note-more` en el botón ⋯): lo dice el JSX de
// antes del refactor, copiado en `docs/refactor/jsx.original/`.
// Los selectores que hubo que reescribir al pasar a módulos (una regla que
// cruzaba dos componentes) se apuntan en `docs/refactor/renames.json` como
// `[{ "from": "…", "to": "…" }]`; solo valen si la especificidad no cambia.
// Sale con 1 y lista los problemas si encuentra alguno.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Las reglas del CSS, en orden: `{ ctx, sel, body }`. `ctx` son los @media,
 * @supports o @container que la envuelven; @keyframes y @font-face cuentan
 * como una regla.
 * @param {string} css
 */
function parse(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {{ ctx: string, sel: string, body: string }[]} */
  const rules = [];
  const norm = (/** @type {string} */ s) => s.replace(/\s+/g, " ").trim();
  /** @param {number} from Índice tras la `{`. @returns {number} Índice de su `}`. */
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

/** `a, b:not(.c, .d)` → ["a", "b:not(.c, .d)"]: las comas dentro de paréntesis no parten. @param {string} prelude */
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

/** Especificidad aproximada [ids, clases, elementos]; basta para comparar. @param {string} sel */
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
// `from` guarda el selector original: una regla reescrita sigue cayendo en los
// mismos elementos, así que se compara también por él.
const before = parse(readFileSync(originalPath, "utf8")).map((r) => ({ ...r, from: r.sel, sel: renames.get(r.sel) ?? r.sel }));
// En el modo de comprobación las clases de módulo llevan su carpeta
// (`note-action__Button`): se compara sin ella, pero se usa para saber que
// `.is-selected__Segmented` y `.is-selected__App` no se pisan.
const SCOPE = /__[A-Z]\w*/g;
const after = bundlePaths
  .flatMap((p) => parse(readFileSync(p, "utf8")))
  .map((r) => ({ ...r, scoped: r.sel, sel: r.sel.replace(SCOPE, ""), body: r.body.replace(SCOPE, "") }));

// 1. Ni perdidas ni duplicadas.
/** @type {Map<string, number>} */
const count = new Map();
for (const r of before) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
for (const r of after) count.set(key(r), (count.get(key(r)) ?? 0) - 1);
for (const [k, n] of count) {
  if (n > 0) problems.push(`Falta: ${k}`);
  if (n < 0) problems.push(`Sobra (o cambió): ${k}`);
}

// 2 y 3. El orden de cada par que puede pisarse. Las reglas idénticas se
// distinguen por su número de aparición.
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
/** La propiedad sin prefijo de navegador: `-webkit-mask-image` → `mask-image`. @param {string} p */
const unprefixed = (p) => p.replace(/^-\w+-/, "");
/** Abreviadas cuyas partes no empiezan por su nombre. */
const LONGHANDS = {
  inset: ["top", "right", "bottom", "left"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  gap: ["row-gap", "column-gap"],
};
/**
 * Si dos propiedades se pisan: la misma, o una abreviada y una de sus partes
 * (`margin` y `margin-left`, `border-color` y `border-left-color`, `inset` y
 * `top`). `margin-top` y `margin-left` no se pisan.
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
  // `border-color` y `border-left-color`; `margin-inline` con cualquier margen.
  return ps[ps.length - 1] === qs[qs.length - 1] || /inline|block/.test(p) || /inline|block/.test(q);
};
/** Las propiedades que declara una regla. @param {string} body */
const propsOf = (body) =>
  body
    .split("; ")
    .map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase())
    .filter(Boolean);
/** Si alguna propiedad de una regla pisa alguna de la otra. @param {string[]} x @param {string[]} y */
const overlap = (x, y) => x.some((p) => y.some((q) => clash(p, q)));

const b = positions(before);
const afterRules = positions(after);
const a = new Map(afterRules.map((r) => [r.id, r.at]));
/** El selector tal como quedó, con la carpeta de cada clase de módulo. */
const scoped = new Map(afterRules.map((r) => [r.id, /** @type {string} */ (r.scoped)]));
/** `.note-action` → las clases con carpeta que salen así en el CSS empaquetado. */
/** @type {Map<string, Set<string>>} */
const scopes = new Map();
for (const r of afterRules)
  for (const c of r.scoped.match(/\.[\w-]+/g) ?? []) {
    const plain = c.replace(SCOPE, "");
    if (!scopes.has(plain)) scopes.set(plain, new Set());
    scopes.get(plain)?.add(c);
  }
/**
 * Lo que puede hacer que dos reglas caigan en el mismo elemento: sus clases,
 * atributos e ids, y `el:` + el elemento del último tramo
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
/** Las clases de cada `className` del JSX original (todas sus ramas juntas). */
/** @type {Set<string>[]} */
const together = [];
/** Todas las clases que salen escritas en algún `className` del JSX original. */
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
/** Las clases del último tramo, sin carpeta: `.a .b.c:hover` → b, c. @param {string} sel */
const subjectClasses = (sel) =>
  (sel.replace(/\([^)]*\)/g, "").split(/[\s>+~]+/).pop()?.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1).replace(SCOPE, ""));
/**
 * Si en el JSX original algún elemento llevaba a la vez las clases del último
 * tramo de `x` y las de `y` (`note-action` y `note-more` en el botón ⋯).
 * @param {string} x @param {string} y
 */
const share = (x, y) => {
  const xs = subjectClasses(x);
  const ys = subjectClasses(y);
  // Si comparten un nombre, ya decide `meet`, que distingue de qué módulo es cada clase.
  if (!xs.length || !ys.length || xs.some((c) => ys.includes(c))) return false;
  return together.some((g) => [...xs, ...ys].every((c) => g.has(c)));
};
/**
 * Si un mismo elemento puede llevar las clases del último tramo de `x` y de
 * `y` (por su selector original). `primary` y `danger` nunca van juntas en el
 * JSX original: sus reglas no se pisan. Si alguna clase se pone desde una
 * variable (`lane-${…}`) no se sabe, y se da por posible.
 * @param {typeof b[number]} x @param {typeof b[number]} y
 */
const canMeet = (x, y) => {
  const all = new Set([...subjectClasses(x.from), ...subjectClasses(y.from)]);
  if (all.size < 2 || ![...all].every((c) => known.has(c))) return true;
  return together.some((g) => [...all].every((c) => g.has(c)));
};
/**
 * Si dos selectores pueden caer en el mismo elemento. El elemento solo cuenta
 * si uno de los dos no tiene clases (`button:disabled` y `.segmented button`):
 * `.a span` y `.b span` casi nunca coinciden y darían falsos avisos.
 * @param {Set<string>} x @param {Set<string>} y
 */
const meet = (x, y) => {
  const bare = (/** @type {Set<string>} */ t) => [...t].every((k) => k.startsWith("el:"));
  return [...y].some((k) => x.has(k) && (!k.startsWith("el:") || bare(x) || bare(y)));
};
/**
 * Lo que toca una regla en el CSS nuevo. Si se reescribió, también lo que
 * tocaba su selector original, en cualquier módulo donde esté esa clase.
 * @param {{ id: string, sel: string, from: string }} r
 */
const reach = (r) => {
  const tokens = tokensOf(scoped.get(r.id) ?? r.sel);
  if (r.from !== r.sel)
    for (const k of tokensOf(r.from)) for (const c of scopes.get(k) ?? [k]) tokens.add(c);
  return tokens;
};
/** `{ propiedad: valor }` de una regla. @param {string} body */
const declsOf = (body) =>
  new Map(
    body
      .split("; ")
      .filter((d) => d.includes(":"))
      .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()]),
  );
/**
 * Lo que pide un selector aparte de las clases de su último tramo: lo de
 * delante (`.dialog `) y las pseudoclases (`:hover`, `:not(:disabled)`).
 * @param {string} sel
 */
const conditionOf = (sel) => {
  const parts = sel.replace(SCOPE, "").split(/(\s*[\s>+~]\s*)/);
  const last = /** @type {string} */ (parts.pop());
  return { before: parts.join(""), pseudos: last.replace(/\.[\w-]+/g, "").match(/:+[\w-]+(?:\([^)]*\))?|^[a-z][\w-]*/gi) ?? [] };
};
/**
 * Si cambiar de orden `x` e `y` no cambia nada: para cada propiedad que
 * declaran las dos, el valor que gana en su elemento es el mismo en los dos
 * órdenes. Cuenta solo las reglas que seguro le aplican cuando aplican `x` e
 * `y` (mismas clases o menos, misma condición, sin @media o el de `x` o `y`);
 * las que quizá le apliquen tienen su propia comprobación de orden.
 * @param {typeof b[number]} x @param {typeof b[number]} y
 */
const sameResult = (x, y) => {
  const dx = declsOf(x.body);
  const dy = declsOf(y.body);
  // Abreviada contra una de sus partes (`border` y `border-color`): no se puede asegurar.
  for (const [p] of dx) for (const [q] of dy) if (p !== q && clash(p, q)) return false;
  /** Las clases de su último tramo, con las de su selector original si se reescribió. @param {typeof b[number]} r */
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
        // Gana !important, luego la especificidad y luego la que va después.
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

// 4. Los módulos y su .jsx.
/** Como el `camelCase` de lodash que usa Vite: `lane-local_to_remote` → `laneLocalToRemote`. @param {string} name */
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

// 5. Las clases globales siguen escritas en algún .jsx.
/** @param {string} dir @returns {string[]} */
const jsxIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsxIn(join(dir, e.name)) : /\.jsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
/** Las palabras de los textos entre comillas de un código. @param {string} code */
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
