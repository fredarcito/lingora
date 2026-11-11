// Who is speaking: groups the voice prints of a conversation into people.
// Tuned with real audio (see CLAUDE.md): the constants and the logic stay as they are.

/**
 * Parecido (coseno) a partir del cual dos frases son de la misma persona.
 * En pruebas con 4 voces del Mac en inglés y en español, 0,5 las separó
 * todas; con 0,4 juntaba voces distintas y con 0,6 partía una voz en dos.
 */
const SAME_SPEAKER = 0.5;
/** Con menos audio la huella es poco fiable ("sí", "vale"): va a la persona más parecida. */
const SHORT_SECS = 1.2;
/** Una frase más corta no crea una persona nueva: con audio real, las sueltas eran casi siempre falsas. */
const NEW_SPEAKER_SECS = 2;
/**
 * El repaso al terminar. Con una entrevista real de 55 min (2 personas), en
 * vivo salían 6 "personas" (las de más eran frases sueltas con risas, ruido
 * o dos voces a la vez); tras el repaso, 2, con el 94 % de las frases bien.
 * Quien habla menos de `MIN_SHARE` del tiempo se une a la más parecida, y dos
 * personas cuyas medias se parecen más de `MERGE` son la misma.
 */
const MIN_SHARE = 0.03;
const MERGE = 0.6;
/**
 * En una nota corta el 3 % es poco más de un segundo y el repaso no unía a
 * nadie (1 min de vídeo con 2 personas salía con 7). Quien hable menos que
 * esto en total también se une; a partir de unos 5 min manda `MIN_SHARE`.
 */
const MIN_SPEAKER_SECS = 8;

/** @param {number[]} a @param {number[]} b */
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** La media normalizada de unas huellas. @param {number[][]} prints */
function centroid(prints) {
  const mean = prints[0].map((_, i) => prints.reduce((n, p) => n + p[i], 0) / prints.length);
  const norm = Math.hypot(...mean) || 1;
  return mean.map((x) => x / norm);
}

/**
 * Agrupa las huellas de voz de una conversación en personas.
 * - En vivo (`add`): cada frase va a la persona más parecida si pasa
 *   `SAME_SPEAKER`; si no, y dura lo bastante, es una persona nueva.
 * - Al terminar (`refine`): con toda la conversación se corrige lo que se
 *   partió de más y se renumera por orden de aparición.
 * Escribe la persona directamente en cada frase de la nota.
 */
export function createSpeakerTracker() {
  /** @type {Array<{ mean: number[], n: number }>} */
  let people = [];
  /** @type {Array<{ entry: import("./api").NoteSentence, print: number[], secs: number }>} */
  const items = [];

  /** La persona más parecida (índice) y cuánto se parece. @param {number[]} print */
  const closest = (print) => {
    let best = -1;
    let score = -Infinity;
    people.forEach((p, i) => {
      const s = cosine(p.mean, print);
      if (s > score) [best, score] = [i, s];
    });
    return { best, score };
  };

  return {
    /** @param {import("./api").NoteSentence} entry @param {number[]} print @param {number} secs */
    add(entry, print, secs) {
      items.push({ entry, print, secs });
      const { best, score } = closest(print);
      if (best >= 0 && secs < SHORT_SECS) {
        entry.speaker = best + 1;
        return;
      }
      if (best >= 0 && score >= SAME_SPEAKER) {
        const p = people[best];
        p.mean = p.mean.map((x, i) => (x * p.n + print[i]) / (p.n + 1));
        p.n += 1;
      } else if (best < 0 || secs >= NEW_SPEAKER_SECS) {
        people.push({ mean: print, n: 1 });
        entry.speaker = people.length;
        return;
      }
      // Parecido a medias o frase corta: a la más parecida, sin moverle la media.
      entry.speaker = best + 1;
    },

    /** Repaso con toda la conversación. */
    refine() {
      if (items.length === 0) return;
      const total = items.reduce((n, x) => n + x.secs, 0) || 1;
      /** @type {number[]} */
      const label = items.map((x) => /** @type {number} */ (x.entry.speaker));
      const groups = () => {
        /** @type {Map<number, { prints: number[][], secs: number }>} */
        const g = new Map();
        items.forEach((x, i) => {
          const k = label[i];
          if (!g.has(k)) g.set(k, { prints: [], secs: 0 });
          const v = /** @type {{ prints: number[][], secs: number }} */ (g.get(k));
          v.prints.push(x.print);
          v.secs += x.secs;
        });
        return [...g].map(([k, v]) => ({ k, secs: v.secs, mean: centroid(v.prints) }));
      };
      /** @param {number} from @param {number} into */
      const relabel = (from, into) => label.forEach((k, i) => k === from && (label[i] = into));

      for (let round = 0; round < 20; round++) {
        const all = groups();
        const big = all.filter((g) => g.secs >= Math.max(MIN_SHARE * total, MIN_SPEAKER_SECS));
        const keep = big.length ? big : [all.reduce((a, b) => (b.secs > a.secs ? b : a))];
        const small = all.filter((g) => !keep.includes(g));
        // Quien casi no habla se une a la persona más parecida.
        if (small.length) {
          for (const g of small) {
            const into = keep.reduce((a, b) => (cosine(g.mean, b.mean) > cosine(g.mean, a.mean) ? b : a));
            relabel(g.k, into.k);
          }
          continue;
        }
        // Dos personas casi iguales son la misma.
        let pair = null;
        for (let i = 0; i < keep.length; i++)
          for (let j = i + 1; j < keep.length; j++) {
            const s = cosine(keep[i].mean, keep[j].mean);
            if (s > MERGE && (!pair || s > pair.s)) pair = { s, a: keep[i].k, b: keep[j].k };
          }
        if (!pair) break;
        relabel(pair.b, pair.a);
      }

      // Cada frase con audio suficiente, a la persona más cercana.
      for (let pass = 0; pass < 2; pass++) {
        const all = groups();
        items.forEach((x, i) => {
          if (x.secs < SHORT_SECS) return;
          label[i] = all.reduce((a, b) => (cosine(x.print, b.mean) > cosine(x.print, a.mean) ? b : a)).k;
        });
      }

      // Persona 1 es la primera que habló.
      /** @type {Map<number, number>} */
      const order = new Map();
      for (const k of label) if (!order.has(k)) order.set(k, order.size + 1);
      items.forEach((x, i) => (x.entry.speaker = /** @type {number} */ (order.get(label[i]))));
      // Lo que llegue después (la cola de voz) sigue con la numeración nueva.
      people = [...order.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => {
          const prints = items.filter((_, i) => label[i] === k).map((x) => x.print);
          return { mean: centroid(prints), n: prints.length };
        });
    },
  };
}
