// Splitting text into sentences for the voice: the translation arrives in
// pieces and each sentence is spoken as soon as it is complete.

/**
 * Fin de frase. Además de la puntuación latina: la china y japonesa (sin
 * espacio detrás; Whisper a veces pone la latina pegada al carácter
 * siguiente), el danda del hindi y el bengalí, la del árabe y el urdu, y la
 * birmana, tibetana y jemer.
 */
const SENTENCE_BREAK = /[.!?…]+["»”)]*\s+|[。！？।॥۔؟။།។]+[」』”）]*\s*|[.!?](?=[\u3040-\u30ff\u3400-\u9fff])/g;
/** Fin de cláusula: coma, punto y coma o dos puntos, también los chinos, árabes y birmanos. */
const CLAUSE_BREAK = /[,;:]\s+|[，、；：،؛၊]\s*|[,;:](?=[\u3040-\u30ff\u3400-\u9fff])/g;
/** Caracteres chinos y japoneses. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;

/**
 * Largo de una frase para los límites de abajo: un carácter chino o japonés
 * dice tanto como dos o tres letras, así que cuenta doble.
 * @param {string} text
 */
const phraseLength = (text) => text.length + (text.match(CJK)?.length ?? 0);

/** Frases por debajo de este largo se unen a la siguiente: la voz suena entrecortada. */
const MIN_PHRASE_CHARS = 25;
/** Frases por encima de este largo se parten por su última coma. */
const MAX_PHRASE_CHARS = 120;
/**
 * La primera frase decide cuándo se empieza a oír algo, así que se corta ya
 * en su primera coma a partir de este largo (Kokoro tarda ~1/4 de lo que
 * dura el audio).
 */
const FIRST_PHRASE_MIN_CHARS = 20;

/**
 * Parte en frases para la voz una traducción que llega a trozos. Cada frase
 * se entrega en cuanto se completa, para que la primera suene mientras el
 * traductor sigue escribiendo.
 * @param {(phrase: string) => void} emit
 */
export function phraseSplitter(emit) {
  let buffer = "";
  let first = true;
  const take = (n) => {
    const phrase = buffer.slice(0, n).trim();
    buffer = buffer.slice(n);
    if (phrase) {
      emit(phrase);
      first = false;
    }
  };
  /** Fin del primer separador que deja una frase de al menos `min` caracteres. */
  const cutAt = (/** @type {RegExp} */ re, min) => {
    for (const m of buffer.matchAll(re)) {
      const end = m.index + m[0].length;
      if (phraseLength(buffer.slice(0, end).trim()) >= min) return end;
    }
    return -1;
  };
  const scan = () => {
    for (;;) {
      const min = first ? FIRST_PHRASE_MIN_CHARS : MIN_PHRASE_CHARS;
      let cut = cutAt(SENTENCE_BREAK, min);
      if (cut < 0 && first) cut = cutAt(CLAUSE_BREAK, min);
      if (cut < 0 && phraseLength(buffer) > MAX_PHRASE_CHARS) {
        const commas = [...buffer.matchAll(CLAUSE_BREAK)];
        if (commas.length) cut = commas[commas.length - 1].index + commas[commas.length - 1][0].length;
      }
      if (cut < 0) return;
      take(cut);
    }
  };
  return {
    /** @param {string} delta */
    add(delta) {
      buffer += delta;
      scan();
    },
    flush() {
      take(buffer.length);
    },
  };
}

/**
 * Cola de frases de voz de un trozo: la traducción las va añadiendo y la
 * reproducción las consume en orden según están listas.
 * @template T
 */
export function phraseQueue() {
  /** @type {T[]} */
  const items = [];
  let done = false;
  /** @type {(() => void) | null} */
  let wake = null;
  return {
    /** @param {T} item */
    push(item) {
      items.push(item);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; ; ) {
        if (i < items.length) yield items[i++];
        else if (done) return;
        else await new Promise((resolve) => (wake = resolve));
      }
    },
  };
}

/**
 * Separa lo que se puede traducir ya de la última frase sin terminar. Whisper
 * suele poner punto al final del trozo aunque la frase siga, así que el final
 * del texto no cuenta como fin de frase: se busca el último fin de frase
 * interno, o en su defecto la última coma. Si no hay ninguno, el texto se
 * guarda entero una vez; a la segunda se traduce tal cual para no acumular
 * retraso.
 * @param {string} text
 * @param {boolean} alreadyCarried Si este texto ya incluye algo guardado antes.
 * @returns {{ head: string, tail: string }}
 */
export function splitAtSentenceEnd(text, alreadyCarried) {
  const body = text.replace(/[.…。]+\s*$/, "");
  const cut = (re) => {
    let last = -1;
    for (const m of body.matchAll(re)) last = m.index + m[0].length;
    return last;
  };
  let at = cut(SENTENCE_BREAK);
  if (at < 0) at = cut(CLAUSE_BREAK);
  if (at < 0) return alreadyCarried ? { head: text, tail: "" } : { head: "", tail: body };
  return { head: body.slice(0, at).trim(), tail: body.slice(at).trim() };
}
