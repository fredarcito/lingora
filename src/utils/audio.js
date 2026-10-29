import { api } from "./api";

// Utilidades de audio en el WebView: captura del micrófono, de BlackHole o del audio del Mac,
// conversión a WAV 16 kHz mono (lo que espera Whisper). La reproducción se
// hace en Rust: WKWebView no permite elegir el dispositivo de salida.

const TARGET_RATE = 16_000;
/**
 * `deviceId` especial: el audio del Mac capturado en Rust (Core Audio taps),
 * sin BlackHole y sin la voz de la propia Lingora.
 */
export const SYSTEM_AUDIO = "system";
/** Muestras por bloque del ScriptProcessor (~85 ms a 48 kHz). */
const BLOCK_SIZE = 4096;

/**
 * Codifica muestras float32 mono como WAV PCM 16 bits.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWavPcm16(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/**
 * Remuestrea a 16 kHz con un OfflineAudioContext.
 * @param {Float32Array} samples
 * @param {number} inputRate
 * @returns {Promise<Float32Array>}
 */
async function resampleTo16k(samples, inputRate) {
  if (inputRate === TARGET_RATE) return samples;
  const frames = Math.ceil((samples.length * TARGET_RATE) / inputRate);
  const ctx = new OfflineAudioContext(1, frames, TARGET_RATE);
  const buffer = ctx.createBuffer(1, samples.length, inputRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Sube el volumen in situ hasta un pico de -1 dBFS. Whisper pierde frases
 * enteras cuando la voz llega baja; la ganancia se limita a x20 para no
 * convertir el silencio en ruido.
 * @param {Float32Array} samples
 * @param {boolean} [log]
 */
function normalize(samples, log = true) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  // Por debajo de este pico el backend lo trata como silencio; amplificarlo
  // haría que Whisper alucinara frases sobre el ruido de fondo.
  if (peak < 0.005) return;
  const gain = Math.min(0.89 / peak, 20);
  if (gain <= 1) return;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  if (log) console.info(`[lingora] pico ${peak.toFixed(4)}, ganancia x${gain.toFixed(1)}`);
}

/**
 * Parámetros de la detección de voz. Cada segundo de trozo es un segundo de
 * retraso antes de traducir, así que se corta pronto: una pausa de 400 ms
 * cierra la frase, y quien habla sin pausas se corta cada 5 s como máximo. El
 * traductor recibe el trozo anterior como contexto para las frases partidas.
 */
const VAD = {
  /**
   * Umbral RMS absoluto por debajo del cual nunca se considera voz. Bajo a
   * propósito: el audio de un vídeo llega por BlackHole con poco nivel, y el
   * umbral adaptativo (`noiseFactor`) ya filtra el ruido del micrófono.
   */
  minSpeechRms: 0.002,
  /** La voz debe superar el ruido de fondo multiplicado por este factor. */
  noiseFactor: 3,
  silenceSecs: 0.4,
  minSegmentSecs: 0.7,
  maxSegmentSecs: 5,
  /** Audio previo que se conserva para no comerse el arranque de la frase. */
  preRollSecs: 0.3,
  /** Silencio final que se conserva al cerrar la frase. */
  tailSecs: 0.2,
  /** Con escucha local: cada cuánto audio nuevo se vuelve a escuchar la frase en curso. */
  listenEverySecs: 0.5,
  /**
   * Con escucha local, una frase que termina en punto se entrega tras este
   * silencio, sin esperar a la pausa completa (`silenceSecs`).
   */
  sentenceGapSecs: 0.2,
  /** Con escucha local, una frase sin punto se corta en su última coma pasado este largo. */
  clauseCutSecs: 4,
  /**
   * Con escucha local, si tampoco hay coma (pasa con quien habla de corrido),
   * se corta entre dos palabras pasado este largo. Sin esto el primer trozo
   * de un vídeo podía tardar 12 s. Largo a propósito: con trozos cortos la
   * voz dice frases sueltas con silencios entre ellas.
   */
  wordCutSecs: 4.5,
  /**
   * El primer trozo tras un silencio largo (`turnGapSecs`: empieza el vídeo o
   * cambia quien habla) se corta antes: aún no hay nada en cola, y es el que
   * decide cuándo empieza a oírse la traducción.
   */
  firstCutSecs: 2,
  turnGapSecs: 1.5,
  /**
   * Con escucha local las frases se cortan donde terminan, así que el corte
   * por largo queda como último recurso.
   */
  maxListenedSegmentSecs: 8,
};

/**
 * Muletillas y ruidos transcritos como palabra ("Mm.", "Uh,", "Ajá"): no vale
 * la pena traducirlos ni decirlos en voz alta.
 */
export const FILLER =
  /^(?:h?m+|mm-?hmm|(?:h?[aeiou]+h+)+|u+m+|e+m+|aj[aá]|uf+|ejem|h+)(?:[\s.!?,…-]+(?:h?m+|(?:h?[aeiou]+h+)+|aj[aá]|h+))*[\s.!?,…-]*$/i;

/**
 * Asentimiento suelto. Parakeet oye "Yeah." en respiraciones y ruidos de los
 * silencios, y la voz decía "Sí" sin que nadie hablara. Solo se descarta si es
 * todo el trozo; "Yes" queda fuera porque suele ser una respuesta real.
 */
const LONE_NOD = /^(?:yeah|yep|yup|uh-?huh)[\s.!?,…-]*$/i;

/** Palabra que cierra una frase o una cláusula, según la puntuación del modelo. */
const SENTENCE_END = /[.!?…。！？]["»”)」』]*$/;
const CLAUSE_END = /[,;:，、；：]$/;

/** Escrituras sin espacios entre palabras: china y japonesa. */
const NO_SPACES = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Une las palabras de la escucha local: con espacios, salvo entre caracteres
 * chinos o japoneses (SenseVoice da cada carácter como una palabra).
 * @param {string[]} words
 */
export function joinWords(words) {
  let out = "";
  for (const w of words) {
    const glued = out && (NO_SPACES.test(out.slice(-1)) || NO_SPACES.test(w[0] ?? ""));
    out += out && !glued ? ` ${w}` : w;
  }
  return out;
}
/** Palabras que suelen abrir una cláusula: buen sitio para cortar antes de ellas. */
const CLAUSE_START =
  /^(and|but|so|because|that|which|who|when|if|then|or|y|pero|así|porque|que|cuando|si|entonces|o)$/i;

/**
 * @typedef {Object} SegmentInfo
 * @property {number} secs Duración del trozo.
 * @property {number} endedAt `performance.now()` al cerrarse el trozo.
 * @property {boolean} final El trozo terminó en una pausa, en un fin de frase
 *   o al detener. Si es `false` se cortó por largo y puede acabar a mitad de frase.
 * @property {string} heard Lo que entendió la escucha local ("" sin ella);
 *   se muestra mientras llega la transcripción.
 * @property {Float32Array} [samples] El trozo en 16 kHz, solo con escucha
 *   local: el modo rápido lo transcribe en local en vez de con Whisper.
 * @property {boolean} [complete] `heard` ya cubre toda la voz del trozo: no
 *   hace falta volver a escucharlo.
 *
 * @typedef {Object} AutoCapture
 * @property {() => Promise<void>} stop Detiene la captura y entrega el trozo en curso.
 * @property {() => number} level Nivel actual (RMS) para el medidor de la UI.
 * @property {() => boolean} speaking Si ahora mismo se detecta voz.
 */

/**
 * Escucha un dispositivo de entrada de forma continua y entrega un WAV 16 kHz
 * mono por cada frase detectada. Las frases se entregan en orden.
 * `deviceId` es el ID que da el WebView (`enumerateDevices`), no el UID de
 * Core Audio: WKWebView rechaza los UIDs con "Invalid constraint".
 * `SYSTEM_AUDIO` captura el audio del Mac en Rust, sin pasar por el WebView.
 * @param {string} deviceId
 * @param {{
 *   autoGain?: boolean,
 *   onSegment: (wav: Uint8Array, info: SegmentInfo) => void,
 *   onEnded?: () => void,
 *   listen?: (samples: Float32Array) => Promise<import("./api").Word[]>,
 *   onPartial?: (text: string) => void,
 * }} options
 *   `autoGain` activa el control automático de ganancia; solo para micrófonos
 *   reales. `onEnded` avisa si el dispositivo deja de entregar audio (se
 *   desconectó o se reinició el audio del sistema). `listen` es la escucha
 *   local: con ella cada frase se entrega en cuanto termina, cortando entre dos
 *   palabras, y `onPartial` recibe el texto de la frase en curso.
 * @returns {Promise<AutoCapture>}
 */
export async function startAutoCapture(deviceId, { autoGain = false, onSegment, onEnded, listen, onPartial }) {
  /** Frecuencia de la entrada; 0 hasta saberla. */
  let inputRate = 0;
  /** Suelta la entrada. @type {() => Promise<void>} */
  let closeSource;
  /** Recibe cada bloque de audio; se define más abajo. @type {(samples: Float32Array) => void} */
  let onBlock = () => {};

  if (deviceId === SYSTEM_AUDIO) {
    // Pueden llegar bloques antes de saber la frecuencia: se descartan.
    inputRate = await api.systemAudioStart((samples) => inputRate && onBlock(samples));
    console.info(`[lingora] entrada: audio del Mac, ${inputRate} Hz`);
    closeSource = () => api.systemAudioStop();
  } else {
    // Procesamiento del sistema desactivado: con cancelación de eco o
    // supresión de ruido, WKWebView puede entregar silencio en dispositivos
    // virtuales como BlackHole. La ganancia automática sí se activa en el
    // micrófono: sin ella la voz llega demasiado baja para Whisper.
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: autoGain,
      channelCount: 1,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      // Algunos dispositivos rechazan channelCount; se reintenta sin él.
      console.warn("[lingora] reintento sin channelCount:", e.message);
      delete audio.channelCount;
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    }

    const track = stream.getAudioTracks()[0];
    if (track) track.onended = () => onEnded?.();
    console.info(
      `[lingora] entrada: ${track?.label ?? "?"} | settings:`,
      track?.getSettings?.() ?? {},
    );

    const ctx = new AudioContext();
    // WKWebView crea el contexto suspendido hasta que hay interacción. Si no se
    // reanuda, el ScriptProcessor no entrega audio y se pierde el principio.
    if (ctx.state === "suspended") await ctx.resume();
    console.info(`[lingora] AudioContext ${ctx.state}, ${ctx.sampleRate} Hz`);
    const source = ctx.createMediaStreamSource(stream);
    inputRate = ctx.sampleRate;
    const processor = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
    processor.onaudioprocess = (e) => onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(ctx.destination);
    closeSource = async () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    };
  }

  /** @typedef {{ samples: Float32Array, rms: number, voiced: boolean }} Block */
  /** @type {Block[]} */
  let segment = [];
  /** @type {Block[]} */
  const preRoll = [];
  let speaking = false;
  let silenceSecs = 0;
  let noiseFloor = 0.01;
  let currentLevel = 0;
  let capturedSamples = 0;
  // Las frases se codifican de forma asíncrona; la cadena mantiene el orden.
  let delivery = Promise.resolve();
  // Escucha local: se desactiva sola si falla. `generation` cambia cada vez
  // que se sustituye el trozo, para descartar respuestas de un trozo anterior.
  let listenFn = listen;
  let listening = false;
  let listenedSamples = 0;
  /** Hasta qué muestra del trozo en curso cubren `words`. */
  let heardSamples = 0;
  let generation = 0;
  /** Palabras del trozo en curso según la última escucha. @type {import("./api").Word[]} */
  let words = [];
  /** El trozo en curso es el primero del turno de habla. */
  let firstOfTurn = true;
  /** Bloques capturados desde la última voz, para medir el silencio entre turnos. */
  let quietSecs = Infinity;

  const samplesOf = (/** @type {Block[]} */ blocks) => blocks.reduce((n, b) => n + b.samples.length, 0);
  const secsOf = (/** @type {Block[]} */ blocks) => samplesOf(blocks) / inputRate;
  const heardText = () => joinWords(words.map((w) => w.text));
  /** Manda el texto de la frase en curso. */
  const showPartial = () => onPartial?.(heardText());
  /** Si hubo voz en el trozo en curso después de la última escucha. */
  const unheardVoice = () => {
    let offset = 0;
    for (const b of segment) {
      if (b.voiced && offset + b.samples.length > heardSamples) return true;
      offset += b.samples.length;
    }
    return false;
  };

  /** @param {Block[]} blocks */
  const mergeBlocks = (blocks) => {
    const merged = new Float32Array(samplesOf(blocks));
    let offset = 0;
    for (const b of blocks) {
      merged.set(b.samples, offset);
      offset += b.samples.length;
    }
    return merged;
  };

  /** Parte los bloques en la muestra `n`. @param {Block[]} blocks @param {number} n */
  const splitBlocks = (blocks, n) => {
    /** @type {Block[]} */
    const head = [];
    /** @type {Block[]} */
    const tail = [];
    let offset = 0;
    for (const b of blocks) {
      const len = b.samples.length;
      if (offset + len <= n) head.push(b);
      else if (offset >= n) tail.push(b);
      else {
        head.push({ ...b, samples: b.samples.subarray(0, n - offset) });
        tail.push({ ...b, samples: b.samples.subarray(n - offset) });
      }
      offset += len;
    }
    return [head, tail];
  };

  /** @param {Block[]} blocks */
  const resetSegment = (blocks) => {
    segment = blocks;
    generation += 1;
    listenedSamples = samplesOf(blocks);
    heardSamples = 0;
    words = [];
  };

  /**
   * @param {Block[]} blocks @param {boolean} final
   * @param {string} [heard] @param {number} [endedAt] Cuándo terminó la voz del trozo.
   * @param {boolean} [complete] `heard` cubre toda la voz de `blocks`.
   */
  const deliver = (blocks, final, heard = "", endedAt = performance.now(), complete = false) => {
    // Se recorta el silencio final salvo un margen: es latencia sin voz.
    let lastVoiced = blocks.length - 1;
    while (lastVoiced >= 0 && !blocks[lastVoiced].voiced) lastVoiced--;
    const tailBlocks = Math.ceil((VAD.tailSecs * inputRate) / BLOCK_SIZE);
    const kept = blocks.slice(0, lastVoiced + 1 + tailBlocks);
    let secs = secsOf(kept);
    if (secs < VAD.minSegmentSecs) {
      // Sin escucha local un trozo tan corto suele ser un golpe o un ruido.
      // Con ella se completa con silencio (Whisper rechaza audios de menos de
      // medio segundo) y la escucha decide abajo si había palabras.
      if (!listenFn) return;
      const missing = Math.ceil((VAD.minSegmentSecs - secs) * inputRate);
      kept.push({ samples: new Float32Array(missing), rms: 0, voiced: false });
      secs = secsOf(kept);
    }

    delivery = delivery.then(async () => {
      const merged = mergeBlocks(kept);
      normalize(merged);
      const samples = await resampleTo16k(merged, inputRate);
      // Filtro de ruido: si la escucha local no oye palabras, el trozo era
      // una respiración, música o un golpe. Whisper inventa texto con eso
      // ("Thank you." → "Gracias") y la voz lo diría.
      let text = heard;
      if (listenFn) {
        if (!text) {
          try {
            text = joinWords((await listenFn(samples)).map((w) => w.text));
            complete = true;
          } catch {
            text = "";
            // Si la escucha falla no se descarta nada: decide Whisper.
            listenFn = undefined;
          }
        }
        if (listenFn && (!text.trim() || FILLER.test(text.trim()) || LONE_NOD.test(text.trim()))) {
          console.info(`[lingora] descartado, sin palabras: "${text}" (${secs.toFixed(2)} s)`);
          return;
        }
      }
      const wav = encodeWavPcm16(samples, TARGET_RATE);
      console.info(`[lingora] frase detectada: ${secs.toFixed(2)} s`);
      onSegment(wav, { secs, endedAt, final, heard: text, samples: listenFn ? samples : undefined, complete });
    });
  };

  /**
   * Entrega la última frase terminada si ya empezó la siguiente: el corte va
   * entre las dos palabras, así que nunca parte una palabra. Una frase larga
   * sin punto se corta en su última coma.
   */
  const commitFinishedSentence = () => {
    const secs = secsOf(segment);
    const lastEnding = (/** @type {RegExp} */ re) => {
      // La última palabra no cuenta: Parakeet pone punto al final del audio
      // aunque la frase siga.
      for (let i = words.length - 2; i >= 0; i--) {
        if (words[i].end < VAD.minSegmentSecs) break;
        if (re.test(words[i].text)) return i;
      }
      return -1;
    };
    // La última palabra cierra frase y ya hay un silencio tras ella: se
    // entrega entera sin esperar a la pausa completa.
    const last = words[words.length - 1];
    if (last && SENTENCE_END.test(last.text) && silenceSecs >= VAD.sentenceGapSecs && last.end >= VAD.minSegmentSecs) {
      deliver(segment, true, heardText(), undefined, !unheardVoice());
      resetSegment([]);
      speaking = false;
      return;
    }

    let cut = lastEnding(SENTENCE_END);
    if (cut < 0 && secs >= (firstOfTurn ? VAD.firstCutSecs : VAD.clauseCutSecs)) cut = lastEnding(CLAUSE_END);
    if (cut < 0 && secs >= (firstOfTurn ? VAD.firstCutSecs : VAD.wordCutSecs)) cut = bestWordBoundary();
    if (cut < 0) return;
    firstOfTurn = false;

    const head = words.slice(0, cut + 1);
    const rest = words.slice(cut + 1);
    // Parakeet acierta más con el inicio de una palabra que con el final de
    // la anterior: el corte va pegado al inicio de la siguiente, para no
    // dejar la cola de una palabra en el trozo de después.
    const at = Math.max((head[head.length - 1].end + rest[0].start) / 2, rest[0].start - 0.1);
    const [done, pending] = splitBlocks(segment, Math.round(at * inputRate));
    const heardUntil = heardSamples;
    deliver(done, true, joinWords(head.map((w) => w.text)), performance.now() - (secs - at) * 1000, true);
    resetSegment(pending);
    words = rest.map((w) => ({ ...w, start: w.start - at, end: w.end - at }));
    heardSamples = Math.max(0, heardUntil - samplesOf(done));
  };

  /**
   * Mejor sitio para cortar entre dos palabras: el mayor hueco, con ventaja
   * para cortar antes de "and", "so", "that"… Se descartan el principio (deja
   * trozos demasiado cortos) y el último medio segundo (aún puede cambiar).
   */
  const bestWordBoundary = () => {
    const stableUntil = secsOf(segment) - 0.5;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].end < VAD.minSegmentSecs * 2 || words[i + 1].start > stableUntil) continue;
      const bare = words[i + 1].text.replace(/[^\p{L}']/gu, "");
      const score = words[i + 1].start - words[i].end + (CLAUSE_START.test(bare) ? 0.3 : 0);
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  };

  /** Escucha en local el trozo en curso. */
  const listenNow = async () => {
    listening = true;
    const gen = generation;
    const upTo = samplesOf(segment);
    listenedSamples = upTo;
    try {
      const merged = mergeBlocks(segment);
      normalize(merged, false);
      const heard = await listenFn(await resampleTo16k(merged, inputRate));
      // El trozo se entregó mientras tanto (pausa o corte): ya no aplica.
      if (gen !== generation) return;
      words = heard;
      heardSamples = upTo;
      commitFinishedSentence();
      showPartial();
    } catch (e) {
      console.warn("[lingora] escucha local desactivada:", e);
      listenFn = undefined;
      onPartial?.("");
    } finally {
      listening = false;
    }
  };

  /** Parte un trozo demasiado largo por el bloque más silencioso de su segunda mitad. */
  const splitLongSegment = () => {
    const from = Math.floor(segment.length / 2);
    let cut = from;
    for (let i = from; i < segment.length - 1; i++) {
      if (segment[i].rms < segment[cut].rms) cut = i;
    }
    deliver(segment.slice(0, cut + 1), false);
    resetSegment(segment.slice(cut + 1));
  };

  onBlock = (samples) => {
    capturedSamples += samples.length;
    let sum = 0;
    for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / samples.length);
    currentLevel = rms;
    const threshold = Math.max(VAD.minSpeechRms, noiseFloor * VAD.noiseFactor);
    const block = { samples, rms, voiced: rms > threshold };
    const blockSecs = samples.length / inputRate;

    if (!speaking) {
      // El ruido de fondo solo se estima fuera de la voz: baja de golpe y
      // sube despacio, para que la música de fondo no tape las frases.
      noiseFloor = rms < noiseFloor ? rms : noiseFloor + (rms - noiseFloor) * 0.02;
      if (!block.voiced) quietSecs += blockSecs;
      preRoll.push(block);
      while (secsOf(preRoll) > VAD.preRollSecs) preRoll.shift();
      if (block.voiced) {
        speaking = true;
        silenceSecs = 0;
        resetSegment(preRoll.splice(0));
        firstOfTurn = quietSecs >= VAD.turnGapSecs;
      }
      return;
    }

    segment.push(block);
    silenceSecs = block.voiced ? 0 : silenceSecs + blockSecs;
    quietSecs = silenceSecs;
    if (silenceSecs >= VAD.silenceSecs) {
      deliver(segment, true, heardText(), undefined, !unheardVoice());
      resetSegment([]);
      speaking = false;
      showPartial();
    } else if (secsOf(segment) >= (listenFn ? VAD.maxListenedSegmentSecs : VAD.maxSegmentSecs)) {
      splitLongSegment();
    } else if (
      listenFn &&
      !listening &&
      (samplesOf(segment) - listenedSamples >= VAD.listenEverySecs * inputRate ||
        // Al empezar un silencio se escucha ya, por si la frase acaba de terminar.
        (silenceSecs >= VAD.sentenceGapSecs && silenceSecs - blockSecs < VAD.sentenceGapSecs))
    ) {
      listenNow();
    }
  };
  const startedAt = performance.now();

  return {
    level: () => currentLevel,
    speaking: () => speaking,
    async stop() {
      onBlock = () => {};
      await closeSource();
      if (speaking) deliver(segment, true, heardText(), undefined, !unheardVoice());
      resetSegment([]);
      showPartial();
      // Diagnóstico: si el audio capturado es mucho más corto que el tiempo
      // transcurrido, el WebView no está entregando bloques.
      const captured = capturedSamples / inputRate;
      const wall = (performance.now() - startedAt) / 1000;
      console.info(`[lingora] capturado ${captured.toFixed(2)} s de ${wall.toFixed(2)} s reales`);
      await delivery;
    },
  };
}

/**
 * Lista los dispositivos tal como los ve el WebView. Las etiquetas solo
 * aparecen después de conceder el permiso de micrófono, así que se pide una
 * vez y se cierra en el acto.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listWebviewDevices() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Sin permiso, enumerateDevices devuelve etiquetas vacías; se sigue igual.
  }
  return navigator.mediaDevices.enumerateDevices();
}

/**
 * Empareja los dispositivos de Core Audio (nombres fiables) con los del
 * WebView (IDs usables en getUserMedia). El emparejamiento es por nombre,
 * que es lo único común entre ambas listas.
 * @param {import("./api").DeviceInfo[]} coreDevices
 * @param {MediaDeviceInfo[]} webDevices
 * @returns {{ inputs: Array<{name: string, uid: string, webId: string}>, outputs: Array<{name: string, uid: string, webId: string}> }}
 */
export function pairDevices(coreDevices, webDevices) {
  const webInputs = webDevices.filter((d) => d.kind === "audioinput");
  const webOutputs = webDevices.filter((d) => d.kind === "audiooutput");
  const findWeb = (list, name) => list.find((d) => d.label && d.label === name);

  const inputs = coreDevices
    .filter((d) => d.input_channels > 0)
    .map((d) => ({ name: d.name, uid: d.uid, webId: findWeb(webInputs, d.name)?.deviceId ?? "" }));

  const outputs = coreDevices
    .filter((d) => d.output_channels > 0)
    .map((d) => ({ name: d.name, uid: d.uid, webId: findWeb(webOutputs, d.name)?.deviceId ?? "" }));

  return { inputs, outputs };
}
