import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { api, errorMessage } from "./api";
import Captions, { CAPTION_SENTENCES } from "./Captions";
import Diagnostics from "./Diagnostics";
// Con extensión: sin ella, en macOS "./Notes" se confunde con notes.js.
import NoteTaking from "./NoteTaking.jsx";
import Notes from "./Notes.jsx";
import { Segmented } from "./ui";
import Settings from "./Settings";
import Sidebar, { MenuButton } from "./Sidebar";
import { createRecorder, loadNotesInput, loadNotesLang, loadNotesListen, loadSaveNotes, loadSpeakers, storeNotesInput, storeNotesListen, storeSaveNotes } from "./notes.js";
import { langName, t, useLang, useT } from "./i18n";
import { FILLER, SYSTEM_AUDIO, joinWords, listWebviewDevices, pairDevices, startAutoCapture } from "./audio";

/**
 * @typedef {"remote_to_local" | "local_to_remote"} Direction
 *
 * @typedef {Object} Lane
 * @property {Direction} direction
 * @property {string} title
 * @property {string} subtitle
 * @property {string} sourceLang Código del idioma de origen ("EN"); lo elige el usuario.
 * @property {string} targetLang Código del idioma de destino ("ES"); lo elige el usuario.
 * @property {string} inputDeviceId ID del WebView para la entrada (BlackHole o micrófono), o
 *   `SYSTEM_AUDIO` para el audio del Mac sin BlackHole.
 * @property {string} outputDevice Nombre de Core Audio de la salida donde se oye la traducción.
 * @property {"female" | "male"} voice Voz de la traducción.
 * @property {Record<string, string>} voiceIds Voz concreta elegida por idioma
 *   de destino (`VoiceInfo.id`); sin ella, la mejor del género.
 * @property {number} maxSpeed Velocidad máxima de la voz cuando hay retraso (1 = nunca acelera).
 * @property {boolean} speak Decir la traducción en voz alta. Sin voz solo hay
 *   subtítulos: se oye el original y no se acumula retraso (el español dura
 *   más que el inglés). Se lee en cada trozo.
 * @property {boolean} [canListen] El idioma que se oye se puede escuchar en local (Parakeet o SenseVoice).
 * @property {{ female: boolean, male: boolean }} [voices] Qué voces hay en este equipo para el idioma de la traducción.
 * @property {boolean} [notes] Es el carril de Tomar notas: sin traducir, sin voz y sin precargar la voz.
 * @property {boolean} [showSource] Mostrar el texto original encima de cada
 *   traducción. Sin elegir, se muestra solo con voz: con solo subtítulos se
 *   quiere leer la traducción, no el original.
 *
 * @typedef {import("./api").Transcription & import("./api").Translation & { id: number, lagSecs: number | null, skipped?: boolean, silent?: boolean, captionKey?: number }} Entry
 *
 * @typedef {Object} LaneState
 * @property {boolean} running
 * @property {boolean} starting Cargando el modelo de voz y abriendo la entrada.
 * @property {string | null} error
 * @property {number} pending Frases detectadas que aún no han terminado de sonar.
 * @property {Entry[]} history Más reciente primero.
 * @property {Array<{ key: number, text: string }>} heard Frases ya cortadas que
 *   se están traduciendo, tal como las entendió la escucha local.
 * @property {string} partial La frase en curso, mientras se habla.
 * @property {{ key: number, text: string, source?: string } | null} draft Sin voz: la
 *   traducción que se está escribiendo, para que el subtítulo avance palabra
 *   a palabra en vez de aparecer de golpe.
 */

/**
 * Velocidad de la voz según el retraso. Un vídeo no espera a la traducción, y
 * el español dura un 15-25 % más que el inglés: si la voz no acelera, el
 * retraso crece sin límite. `lag` es el retraso medido en la última frase
 * que sonó; `pending`, los trozos en cola; `max`, el tope que elige el
 * usuario (más rápido alcanza antes, pero suena menos natural).
 * @param {number} pending @param {number} lag @param {number} max
 */
function speedFor(pending, lag, max) {
  // Acelerar con poco retraso solo deja silencios esperando al trozo siguiente.
  const byLag = lag > 6 ? 1 : lag > 4.5 ? 0.7 : lag > 3.5 ? 0.4 : lag > 2.5 ? 0.2 : 0;
  const byQueue = pending >= 4 ? 1 : pending === 3 ? 0.5 : 0;
  return 1 + (max - 1) * Math.max(byLag, byQueue);
}

/**
 * Idiomas mientras llega la lista de Rust (`api.languages`), que dice cuáles
 * entiende Parakeet y qué voces hay en este equipo. Ver docs/plan-idiomas.md.
 * @type {import("./api").LanguageInfo[]}
 */
const FALLBACK_LANGUAGES = [
  { code: "es", name: "Español", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
  { code: "en", name: "Inglés", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
];

/** @param {string} code @returns {import("./api").Lang} */
const apiLang = (code) => /** @type {import("./api").Lang} */ (code.toLowerCase());

const MODE_KEY = "lingora.mode";
/**
 * «Traducir llamada» sigue en desarrollo (falta un micrófono virtual): sale
 * bloqueada salvo con `VITE_CALL_MODE=true` en el entorno al compilar o en `.env`.
 */
const CALL_MODE = import.meta.env.VITE_CALL_MODE === "true";
const SPEAK_KEY = "lingora.speak";
const VOICE_IDS_KEY = "lingora.voiceIds";
const SHOW_SOURCE_KEY = "lingora.showSource";
/**
 * Vídeo: solo se traduce lo que se oye. Llamada: también tu micrófono, para
 * la otra persona. Notas: se transcribe lo que se oye sin traducir ni hablar.
 * @typedef {"video" | "call" | "notes"} Mode
 * @returns {Mode}
 */
function loadMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "notes") return "notes";
    return CALL_MODE && saved === "call" ? "call" : "video";
  } catch {
    return "video";
  }
}

/** Voz sí o no por carril; el almacenamiento puede no estar disponible. */
function loadSpeak() {
  try {
    return JSON.parse(localStorage.getItem(SPEAK_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Voz elegida por carril e idioma; el almacenamiento puede no estar disponible. */
function loadVoiceIds() {
  try {
    return JSON.parse(localStorage.getItem(VOICE_IDS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Frase para probar una voz, en su idioma. Para los demás se traduce la española. */
const VOICE_SAMPLES = {
  es: "Hola, así sonará la traducción con esta voz.",
  en: "Hi, this is how the translation will sound with this voice.",
  fr: "Bonjour, voici comment la traduction sonnera avec cette voix.",
  it: "Ciao, ecco come suonerà la traduzione con questa voce.",
  pt: "Olá, é assim que a tradução vai soar com esta voz.",
};

/** Si se muestra el original, por carril; el almacenamiento puede no estar disponible. */
function loadShowSource() {
  try {
    return JSON.parse(localStorage.getItem(SHOW_SOURCE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const NO_TRANSLATE_KEY = "lingora.noTranslate";

/** Subtítulos en el idioma original, sin traducir; el almacenamiento puede no estar disponible. */
function loadNoTranslate() {
  try {
    return localStorage.getItem(NO_TRANSLATE_KEY) === "1";
  } catch {
    return false;
  }
}

const PAIR_KEY = "lingora.pair";

/**
 * Los idiomas de la conversación: el tuyo y el de la otra persona. Los dos
 * carriles los usan, uno en cada sentido, así que no pueden contradecirse.
 * @typedef {{ you: string, them: string }} LangPair
 * @returns {LangPair}
 */
function loadPair() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAIR_KEY) ?? "{}");
    // Los códigos se comprueban al llegar la lista de idiomas.
    const valid = (c) => typeof c === "string" && c.length > 0;
    if (valid(saved.you) && valid(saved.them) && saved.you !== saved.them) return saved;
  } catch {
    // Sin almacenamiento se usa el par por defecto.
  }
  return { you: "ES", them: "EN" };
}

/**
 * Idiomas de un carril según el par: "Escuchar" va de la otra persona a ti y
 * "Hablar", al revés.
 * @param {Direction} direction @param {LangPair} pair
 */
const langsFor = (direction, pair) =>
  direction === "remote_to_local"
    ? { sourceLang: pair.them, targetLang: pair.you }
    : { sourceLang: pair.you, targetLang: pair.them };

const MAX_SPEED_KEY = "lingora.maxSpeed";
/**
 * Tope por defecto: medido con Kokoro, 1,15x aún suena natural y 1,3x ya
 * suena apurado (y solo acorta la voz un 17 %: las pausas no se aceleran).
 */
const DEFAULT_MAX_SPEED = 1.15;

/** Tope de velocidad guardado por carril; el almacenamiento puede no estar disponible. */
function loadMaxSpeeds() {
  try {
    return JSON.parse(localStorage.getItem(MAX_SPEED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Nivel por debajo del cual el principio y el final de la voz son silencio. */
const VOICE_SILENCE = 0.003;

/**
 * Quita el silencio que Kokoro deja al principio y al final de cada frase
 * (deja 40 ms): entre frases seguidas se oía como un hueco.
 * @param {number[]} audio @param {number} sampleRate
 */
function trimSilence(audio, sampleRate) {
  const margin = Math.round(sampleRate * 0.04);
  let start = 0;
  let end = audio.length;
  while (start < end && Math.abs(audio[start]) < VOICE_SILENCE) start++;
  while (end > start && Math.abs(audio[end - 1]) < VOICE_SILENCE) end--;
  return audio.slice(Math.max(0, start - margin), Math.min(audio.length, end + margin));
}

/**
 * Con más retraso que esto la voz ya no sirve en una conversación: se omite
 * y solo se muestra el texto, para alcanzar al original.
 */
const MAX_VOICE_LAG_SECS = 10;

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
function phraseSplitter(emit) {
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
function phraseQueue() {
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
function splitAtSentenceEnd(text, alreadyCarried) {
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

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Transcripción en local (Parakeet o SenseVoice, según el idioma) sobre el
 * trozo entero, ~0,1–0,3 s; sin coste si la escucha en vivo ya lo oyó entero.
 * @param {Lane} lane @param {Uint8Array} wav @param {import("./audio").SegmentInfo} info
 * @returns {Promise<import("./api").Transcription>}
 */
async function transcribeLocally(lane, wav, info) {
  const t0 = performance.now();
  // La escucha en vivo ya oyó toda la voz del trozo: se reaprovecha.
  const transcript = info.complete
    ? info.heard
    : joinWords((await api.listen(/** @type {Float32Array} */ (info.samples), apiLang(lane.sourceLang))).map((w) => w.text));
  return {
    direction: lane.direction,
    source_lang: apiLang(lane.sourceLang),
    target_lang: apiLang(lane.targetLang),
    transcript,
    stt_ms: Math.round(performance.now() - t0),
    source_wav_base64: toBase64(wav),
    source_duration_secs: info.secs,
  };
}

let entryId = 0;

const VOLUME_KEY = "lingora.volume";

/** Volumen guardado por carril; el almacenamiento puede no estar disponible. */
function loadVolumes() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}");
    return { remote_to_local: 1, local_to_remote: 1, ...saved };
  } catch {
    return { remote_to_local: 1, local_to_remote: 1 };
  }
}

/** Título y subtítulo salen de `lanes.<dirección>.*` al pintar. @type {Omit<Lane, "title" | "subtitle">[]} */
const LANES = [
  {
    direction: "remote_to_local",
    sourceLang: "EN",
    targetLang: "ES",
    inputDeviceId: "",
    outputDevice: "",
    voice: "female",
    speak: true,
    maxSpeed: DEFAULT_MAX_SPEED,
  },
  {
    direction: "local_to_remote",
    sourceLang: "ES",
    targetLang: "EN",
    inputDeviceId: "",
    outputDevice: "",
    voice: "male",
    speak: true,
    maxSpeed: DEFAULT_MAX_SPEED,
  },
];

/**
 * Salidas que acaban en BlackHole. Reproducir ahí la traducción la vuelve a
 * meter en la captura y la app se traduce a sí misma en bucle.
 * @param {string} name
 */
const feedsCapture = (name) => /blackhole 2ch|^lingora$|salida múltiple|multi-output/i.test(name);

/** Tiempo parado tras el que se liberan los modelos de la memoria. */
const RELEASE_MODELS_MS = 3 * 60_000;

/** Tope de espera a que termine la cola de Tomar notas antes de cerrar la nota. */
const NOTES_SETTLE_MS = 20_000;

/** Nivel RMS por debajo del cual se considera que no llega sonido. */
const SILENCE_RMS = 0.0005;
/** Segundos sin sonido antes de avisar. */
const NO_SIGNAL_SECS = 8;

const EMPTY_RUNTIME = {
  texting: Promise.resolve(),
  playback: Promise.resolve(),
  pending: 0,
  lag: 0,
  context: "",
  carry: "",
};

/** @type {LaneState} */
const EMPTY_STATE = { running: false, starting: false, error: null, pending: 0, history: [], heard: [], partial: "", draft: null };

export default function App() {
  // Repinta al cambiar de idioma; los textos se piden con `t` del módulo.
  useT();
  const [devices, setDevices] = useState({ inputs: [], outputs: [] });
  // Si se puede oír el audio del Mac sin BlackHole (macOS 14.2+).
  const [systemAudio, setSystemAudio] = useState(false);
  const [pair, setPair] = useState(loadPair);
  const [mode, setMode] = useState(loadMode);
  // Solo en Traducir audio: en una llamada la otra persona necesita oírte traducido.
  const [noTranslate, setNoTranslate] = useState(loadNoTranslate);
  // Tomar notas: qué se escucha y la familia de idiomas; no tocan los ajustes de Escuchar.
  const [notesInput, setNotesInput] = useState(loadNotesInput);
  const [notesListen, setNotesListen] = useState(loadNotesListen);
  const [laneSettings, setLanes] = useState(() => {
    const saved = loadMaxSpeeds();
    const speak = loadSpeak();
    const showSource = loadShowSource();
    const voiceIds = loadVoiceIds();
    return LANES.map((l) => ({
      ...l,
      maxSpeed: saved[l.direction] ?? l.maxSpeed,
      speak: speak[l.direction] ?? l.speak,
      showSource: showSource[l.direction],
      voiceIds: voiceIds[l.direction] ?? {},
    }));
  });
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
  const languagesRef = useRef(languages);
  languagesRef.current = languages;
  /** @param {string} code */
  const langInfo = (code) => languages.find((l) => l.code.toUpperCase() === code);
  useEffect(() => {
    const load = () => api.languages().then(setLanguages).catch(() => {});
    load();
    // Las voces se pueden descargar con la app abierta: se vuelve a mirar al volver a ella.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  // Rust nombra los idiomas en español: en pantalla van en el de la interfaz.
  const { lang: uiLang } = useLang();
  const shownLanguages = useMemo(() => languages.map((l) => ({ ...l, name: langName(l.code, l.name) })), [languages, uiLang]);

  const lanes = laneSettings.map((l) => {
    const langs = langsFor(l.direction, pair);
    // Sin traducir: el destino es el mismo idioma que se oye.
    if (mode === "video" && noTranslate) langs.targetLang = langs.sourceLang;
    // Tomar notas: Escuchar sin traducir ni hablar, con la entrada que se eligió allí.
    const taking = mode === "notes" && l.direction === "remote_to_local";
    if (taking) langs.sourceLang = langs.targetLang = notesListen;
    // Local por defecto, pero solo si el modelo está instalado; si no, la nube.
    const source = langInfo(langs.sourceLang);
    const target = langInfo(langs.targetLang);
    const voices = { female: target?.female_voice ?? true, male: target?.male_voice ?? true };
    return {
      ...l,
      title: t(`lanes.${l.direction}.title`),
      subtitle: t(`lanes.${l.direction}.subtitle`),
      ...langs,
      ...(taking && { notes: true, inputDeviceId: notesInput === "mic" || !systemAudio ? "" : SYSTEM_AUDIO }),
      canListen: source?.can_listen ?? true,
      voices,
      // Sin voz del sistema para el idioma, solo hay subtítulos.
      speak: !taking && l.speak && (voices.female || voices.male),
    };
  });
  // El modo rápido se lee en cada trozo: se puede comparar sin detener el carril.
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  // La conversación que se está guardando (ver notes.js) y el menú ☰.
  const recorderRef = useRef(/** @type {ReturnType<typeof createRecorder> | null} */ (null));
  const [view, setView] = useState(/** @type {import("./Sidebar").View} */ ("translate"));
  // Al terminar Tomar notas se abre la nota; `stopping` es la parada en curso.
  const [openRequest, setOpenRequest] = useState(/** @type {{ id: string, nonce: number } | null} */ (null));
  const stopping = useRef(/** @type {Promise<void> | null} */ (null));
  // Cerrando la nota de Tomar notas (esperando a la cola).
  const [closing, setClosing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /** @param {Mode} next */
  const changeMode = (next) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Sin almacenamiento el modo solo dura esta sesión.
    }
  };

  /** @param {"system" | "mic"} next */
  const changeNotesInput = (next) => {
    setNotesInput(next);
    storeNotesInput(next);
  };

  /** @param {"EN" | "ZH"} next */
  const changeNotesListen = (next) => {
    setNotesListen(next);
    storeNotesListen(next);
  };

  /** @param {boolean} next */
  const changeNoTranslate = (next) => {
    setNoTranslate(next);
    try {
      localStorage.setItem(NO_TRANSLATE_KEY, next ? "1" : "0");
    } catch {
      // Sin almacenamiento solo dura esta sesión.
    }
  };

  /** @param {LangPair} next */
  const changePair = (next) => {
    setPair(next);
    try {
      localStorage.setItem(PAIR_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento los idiomas solo duran esta sesión.
    }
  };
  const [state, setState] = useState({
    remote_to_local: EMPTY_STATE,
    local_to_remote: EMPTY_STATE,
  });
  /**
   * Por carril: la captura activa, las cadenas que mantienen el orden
   * (texto, voz y reproducción), cuántos trozos quedan por sonar, y el texto
   * que se arrastra entre trozos: `prompt` para Whisper, `context` para el
   * traductor y `carry` con la frase sin terminar.
   * @type {React.MutableRefObject<Record<string, typeof EMPTY_RUNTIME & { capture?: import("./audio").AutoCapture }>>}
   */
  const runtime = useRef({
    remote_to_local: { ...EMPTY_RUNTIME },
    local_to_remote: { ...EMPTY_RUNTIME },
  });
  const [meters, setMeters] = useState({ remote_to_local: null, local_to_remote: null });
  const [volumes, setVolumes] = useState(loadVolumes);
  // La cola de reproducción lee el volumen en cada frase: así el control
  // funciona mientras traduce, sin reiniciar el carril.
  const volumesRef = useRef(volumes);

  /** @param {Direction} direction @param {number} value */
  const changeVolume = (direction, value) => {
    const next = { ...volumesRef.current, [direction]: value };
    volumesRef.current = next;
    setVolumes(next);
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento el volumen solo dura esta sesión.
    }
  };
  // «Guardar en notas» de la tarjeta: parado es el ajuste de siempre; en marcha
  // pausa y reanuda la nota en curso sin cambiar el ajuste.
  const [saveNotes, setSaveNotes] = useState(loadSaveNotes);
  /** @param {boolean} on */
  const changeSaveNotes = (on) => {
    setSaveNotes(on);
    if (recorderRef.current && anyRunningRef.current) recorderRef.current.setSaving(on);
    else storeSaveNotes(on);
  };
  /** Último instante con señal por carril, para avisar si no llega audio. */
  const lastSignal = useRef({ remote_to_local: 0, local_to_remote: 0 });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const read = (d) => {
        const c = runtime.current[d].capture;
        if (!c) return null;
        const level = c.level();
        const now = performance.now();
        if (level > SILENCE_RMS || !lastSignal.current[d]) lastSignal.current[d] = now;
        return { level, speaking: c.speaking(), silentSecs: (now - lastSignal.current[d]) / 1000 };
      };
      setMeters({ remote_to_local: read("remote_to_local"), local_to_remote: read("local_to_remote") });
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  // Core Audio da los nombres fiables; el WebView da los IDs que acepta
  // getUserMedia. Se emparejan por nombre.
  const loadDevices = useCallback(() => {
    Promise.all([api.listAudioDevices(), listWebviewDevices(), api.systemAudioSupported().catch(() => false)])
      .then(([core, web, canTap]) => {
        const paired = pairDevices(core, web);
        setDevices(paired);
        setSystemAudio(canTap);
        // Por defecto, la primera salida segura (las bocinas, normalmente).
        const safe = paired.outputs.find((d) => !feedsCapture(d.name));
        // Escuchar oye la llamada o el vídeo del audio del Mac (sin la voz de
        // Lingora) o, en Macs antiguos, por BlackHole. Con el micrófono por
        // defecto oiría su propia voz por las bocinas y la repetiría en bucle.
        const blackhole = paired.inputs.find((d) => d.webId && /blackhole 2ch/i.test(d.name));
        const listenFrom = canTap ? SYSTEM_AUDIO : (blackhole?.webId ?? "");
        setLanes((prev) =>
          prev.map((l) => ({
            ...l,
            outputDevice: l.outputDevice || safe?.name || "",
            inputDeviceId: l.inputDeviceId || (l.direction === "remote_to_local" ? listenFrom : ""),
          })),
        );
      })
      .catch(() => setDevices({ inputs: [], outputs: [] }));
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  /** @param {Direction} direction @param {Partial<Lane>} patch */
  const updateLane = (direction, patch) => {
    setLanes((prev) => {
      const next = prev.map((l) => (l.direction === direction ? { ...l, ...patch } : l));
      if ("maxSpeed" in patch) {
        try {
          localStorage.setItem(MAX_SPEED_KEY, JSON.stringify(Object.fromEntries(next.map((l) => [l.direction, l.maxSpeed]))));
        } catch {
          // Sin almacenamiento el tope solo dura esta sesión.
        }
      }
      if ("showSource" in patch) {
        try {
          localStorage.setItem(SHOW_SOURCE_KEY, JSON.stringify(Object.fromEntries(next.map((l) => [l.direction, l.showSource]))));
        } catch {
          // Sin almacenamiento solo dura esta sesión.
        }
      }
      if ("voiceIds" in patch) {
        try {
          localStorage.setItem(VOICE_IDS_KEY, JSON.stringify(Object.fromEntries(next.map((l) => [l.direction, l.voiceIds]))));
        } catch {
          // Sin almacenamiento solo dura esta sesión.
        }
      }
      if ("speak" in patch) {
        try {
          localStorage.setItem(SPEAK_KEY, JSON.stringify(Object.fromEntries(next.map((l) => [l.direction, l.speak]))));
        } catch {
          // Sin almacenamiento solo dura esta sesión.
        }
      }
      return next;
    });
  };

  /** @param {Direction} direction @param {Partial<LaneState>} patch */
  const patchState = (direction, patch) => {
    setState((prev) => ({ ...prev, [direction]: { ...prev[direction], ...patch } }));
  };

  /** @param {Direction} direction @param {number} id @param {Partial<Entry>} patch */
  const patchEntry = (direction, id, patch) => {
    setState((prev) => ({
      ...prev,
      [direction]: {
        ...prev[direction],
        history: prev[direction].history.map((h) => (h.id === id ? { ...h, ...patch } : h)),
      },
    }));
  };

  /**
   * Encola un trozo de audio. Tres etapas encadenadas para que nada espere
   * de más:
   * 1. La transcripción arranca en el acto (varios trozos pueden ir en paralelo).
   * 2. El texto se procesa en orden: si el trozo se cortó por largo, la última
   *    frase sin terminar se guarda y se junta con el trozo siguiente. La
   *    traducción llega en streaming y cada frase se manda a la voz en cuanto
   *    se completa.
   * 3. La reproducción suena cada frase en cuanto está lista.
   * @param {Lane} lane @param {Uint8Array} wav @param {import("./audio").SegmentInfo} info
   */
  const enqueue = (lane, wav, info) => {
    const rt = runtime.current[lane.direction];
    rt.pending += 1;
    patchState(lane.direction, { pending: rt.pending });

    // Lo que entendió la escucha local se ve hasta que aparece la traducción.
    const heardKey = ++entryId;
    /** @param {(heard: LaneState["heard"]) => LaneState["heard"]} update */
    const setHeard = (update) =>
      setState((prev) => ({
        ...prev,
        [lane.direction]: { ...prev[lane.direction], heard: update(prev[lane.direction].heard) },
      }));
    if (info.heard) setHeard((heard) => [...heard, { key: heardKey, text: info.heard }]);
    const dropHeard = () => setHeard((heard) => heard.filter((h) => h.key !== heardKey));

    // Voz y tope de velocidad se leen en cada trozo: se pueden cambiar sin
    // detener el carril. Los idiomas también: «Original» se puede elegir en
    // marcha.
    const current = lanesRef.current.find((l) => l.direction === lane.direction) ?? lane;
    const stt = transcribeLocally(current, wav, info);
    stt.catch(() => {});

    /** @type {ReturnType<typeof phraseQueue<Promise<import("./api").Speech>>>} */
    const phrases = phraseQueue();
    /** Lo que la reproducción necesita para mostrar la frase antes de que acabe la traducción. */
    const draft = { transcription: null, transcript: "", translation: "" };

    const texted = rt.texting.then(async () => {
      try {
        const t = await stt;
        const said = t.transcript.trim();
        const heard = FILLER.test(said) ? "" : t.transcript;
        const full = [rt.carry, heard].filter(Boolean).join(" ");
        const { head, tail } = info.final ? { head: full, tail: "" } : splitAtSentenceEnd(full, rt.carry !== "");
        rt.carry = tail;
        if (!head) return { ...t, transcript: "", translation: "", translate_ms: 0 };
        Object.assign(draft, { transcription: t, transcript: head });

        // Sin traducir: lo transcrito es el subtítulo.
        if (t.source_lang === t.target_lang) {
          patchState(lane.direction, { draft: { key: heardKey, text: head } });
          rt.context = head;
          return { ...t, transcript: head, translation: head, translate_ms: 0 };
        }

        const speed = speedFor(rt.pending, rt.lag, current.maxSpeed);
        const splitter = phraseSplitter((phrase) => {
          // "Mmm", "Ajá": la voz los pronuncia como un resoplido.
          if (!current.speak || FILLER.test(phrase)) return;
          const speech = api.speak(phrase, t.target_lang, current.voice, speed, current.voiceIds[t.target_lang] ?? null);
          // Si falla una frase anterior, esta no se llega a esperar.
          speech.catch(() => {});
          phrases.push(speech);
        });
        const tr = await api.translate(
          head,
          t.source_lang,
          t.target_lang,
          rt.context,
          (delta) => {
            draft.translation += delta;
            splitter.add(delta);
            if (!current.speak) patchState(lane.direction, { draft: { key: heardKey, text: draft.translation, source: head } });
          },
          false,
          true,
        );
        splitter.flush();
        rt.context = head;
        return { ...t, transcript: head, ...tr };
      } finally {
        phrases.end();
      }
    });
    rt.texting = texted.catch(() => {});

    rt.playback = rt.playback.then(async () => {
      try {
        /** @type {number | null} */
        let id = null;
        const showEntry = () => {
          if (id !== null) return;
          id = ++entryId;
          const entry = { ...draft.transcription, transcript: draft.transcript, translation: draft.translation, translate_ms: 0, id, lagSecs: null };
          setState((prev) => ({
            ...prev,
            [lane.direction]: {
              ...prev[lane.direction],
              error: null,
              history: [entry, ...prev[lane.direction].history].slice(0, 30),
              heard: prev[lane.direction].heard.filter((h) => h.key !== heardKey),
            },
          }));
        };
        let first = true;
        for await (const part of phrases) {
          const speech = await part;
          showEntry();
          if (first) {
            first = false;
            const lag = (performance.now() - info.endedAt) / 1000;
            rt.lag = lag;
            patchEntry(lane.direction, id, { lagSecs: lag });
            // Se omite el trozo entero o nada: cortarlo a medias suena a
            // palabras sueltas.
            if (lag > MAX_VOICE_LAG_SECS) {
              patchEntry(lane.direction, id, { skipped: true });
              // Lo siguiente en la cola ya no arrastra este retraso.
              rt.lag = 0;
              break;
            }
          }
          const audio = trimSilence(speech.audio, speech.sample_rate);
          await api.playAudio(audio, speech.sample_rate, lane.outputDevice, volumesRef.current[lane.direction]);
        }
        const result = await texted;
        // Todo el texto quedó a la espera del trozo siguiente.
        if (!result.translation) return;
        const silent = id === null;
        showEntry();
        // Sin voz, el retraso es hasta que aparece el subtítulo.
        if (silent) {
          patchEntry(lane.direction, id, {
            lagSecs: (performance.now() - info.endedAt) / 1000,
            silent: true,
            captionKey: heardKey,
          });
        }
        patchEntry(lane.direction, id, {
          translation: result.translation,
          translate_ms: result.translate_ms,
        });
        // Sin traducir (mismo idioma) no hay traducción que guardar.
        // La huella de voz va aparte y no retrasa nada: la nota la espera.
        const voice =
          recorderRef.current?.saving && info.samples && lane.direction === "remote_to_local" && loadSpeakers()
            ? { print: api.voicePrint(info.samples), secs: info.secs }
            : null;
        recorderRef.current?.add(
          {
            direction: lane.direction,
            source_lang: result.source_lang,
            target_lang: result.target_lang,
            source: result.transcript,
            translation: result.source_lang === result.target_lang ? null : result.translation,
          },
          voice,
        );
      } catch (e) {
        // Un trozo fallido no detiene el carril: se muestra y se sigue.
        patchState(lane.direction, { error: errorMessage(e) });
      } finally {
        dropHeard();
        // Solo si sigue siendo el de este trozo: el siguiente puede estar escribiéndose ya.
        setState((prev) =>
          prev[lane.direction].draft?.key === heardKey
            ? { ...prev, [lane.direction]: { ...prev[lane.direction], draft: null } }
            : prev,
        );
        rt.pending -= 1;
        patchState(lane.direction, { pending: rt.pending });
      }
    });
  };

  const start = useCallback(
    /** @param {Lane} lane */
    async (lane) => {
      patchState(lane.direction, { error: null, starting: true });
      try {
        // Todo es local: sin el modelo que escucha el idioma o sin el que
        // traduce no se puede empezar.
        const current = lanesRef.current.find((l) => l.direction === lane.direction) ?? lane;
        const source = apiLang(current.sourceLang);
        const sourceName = languagesRef.current.find((l) => l.code === source)?.name.toLowerCase() ?? source;
        const [, canListen, canTranslate] = await Promise.all([
          // Tomar notas no habla: sin precargar la voz.
          current.notes ? true : api.warmUp(),
          api.listenWarmUp(source).catch(() => false),
          current.sourceLang === current.targetLang ? true : api.translateWarmUp().catch(() => false),
        ]);
        if (!canListen) {
          throw new Error(
            current.canListen
              ? t("app.error.missingListenModel", { lang: sourceName })
              : t("app.error.cantListen", { lang: sourceName }),
          );
        }
        if (!canTranslate) throw new Error(t("app.error.missingTranslateModel"));
        Object.assign(runtime.current[lane.direction], { context: "", carry: "" });
        runtime.current[lane.direction].capture = await startAutoCapture(lane.inputDeviceId, {
          // El micrófono necesita ganancia automática; BlackHole no la tolera.
          // En Tomar notas, también el micrófono de una reunión en persona.
          autoGain: lane.direction === "local_to_remote" || (Boolean(lane.notes) && lane.inputDeviceId !== SYSTEM_AUDIO),
          onSegment: (wav, info) => enqueue(lane, wav, info),
          listen: (samples) => api.listen(samples, source),
          onPartial: (partial) => patchState(lane.direction, { partial }),
          onEnded: () => {
            delete runtime.current[lane.direction].capture;
            patchState(lane.direction, {
              running: false,
              error: t("app.error.inputLost"),
            });
          },
        });
        lastSignal.current[lane.direction] = 0;
        patchState(lane.direction, { running: true });
      } catch (e) {
        patchState(lane.direction, {
          error: t("app.error.startFailed", { error: errorMessage(e) }),
        });
      } finally {
        patchState(lane.direction, { starting: false });
      }
    },
    [],
  );

  const stop = useCallback(
    /** @param {Lane} lane */
    async (lane) => {
      const rt = runtime.current[lane.direction];
      const capture = rt.capture;
      delete rt.capture;
      patchState(lane.direction, { running: false });
      // Entrega la frase en curso; lo que ya está en cola sigue sonando.
      await capture?.stop();
    },
    [],
  );

  // Subtítulos flotantes: siempre de Escuchar, que es lo que dice la otra
  // persona o el vídeo. Esta ventana sigue haciendo todo el trabajo y les
  // manda las últimas frases.
  const [floating, setFloating] = useState(false);
  const remoteLane = /** @type {Lane} */ (lanes.find((l) => l.direction === "remote_to_local"));
  const remoteState = state.remote_to_local;
  const floatingPayload = useRef(/** @type {object | null} */ (null));
  const toggleRemote = useRef(() => {});
  toggleRemote.current = () => (remoteState.running ? stop(remoteLane) : start(remoteLane));

  useEffect(() => {
    const same = remoteLane.sourceLang === remoteLane.targetLang;
    floatingPayload.current = {
      state: {
        ...EMPTY_STATE,
        running: remoteState.running,
        draft: remoteState.draft,
        history: remoteState.history
          .slice(0, CAPTION_SENTENCES)
          .map((h) => ({ id: h.id, captionKey: h.captionKey, translation: h.translation, transcript: h.transcript })),
      },
      showSource: !same && (remoteLane.showSource ?? (remoteLane.speak && !same)),
      // Lo que se está oyendo ahora, como al pie de los subtítulos de la app.
      live: [...remoteState.heard.map((h) => h.text), remoteState.partial].filter(Boolean).join(" "),
    };
    if (floating) emitTo("captions", "captions", floatingPayload.current).catch(() => {});
  }, [floating, remoteState, remoteLane.sourceLang, remoteLane.targetLang, remoteLane.showSource, remoteLane.speak]);

  useEffect(() => {
    const offs = [
      listen("captions-ready", () => {
        setFloating(true);
        if (floatingPayload.current) emitTo("captions", "captions", floatingPayload.current).catch(() => {});
      }),
      listen("captions-control", () => toggleRemote.current()),
      listen("captions-closed", () => setFloating(false)),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, []);

  const toggleFloating = async () => {
    try {
      if (floating) {
        await (await Window.getByLabel("captions"))?.close();
        setFloating(false);
      } else {
        await api.openCaptions();
        setFloating(true);
      }
    } catch (e) {
      console.warn("[lingora] subtítulos flotantes:", e);
    }
  };

  const { inputs, outputs } = devices;
  // En modo vídeo solo se traduce lo que se oye.
  const visible = mode !== "call" ? lanes.filter((l) => l.direction === "remote_to_local") : lanes;
  const running = lanes.filter((l) => state[l.direction].running || state[l.direction].starting);
  const anyRunning = running.length > 0;
  const anyRunningRef = useRef(anyRunning);
  anyRunningRef.current = anyRunning;

  // Al parar (o al volver de Ajustes), el interruptor vuelve al ajuste guardado.
  useEffect(() => {
    if (!anyRunning) setSaveNotes(loadSaveNotes());
  }, [anyRunning, view]);

  // Parado un rato, los modelos se sueltan: ocupan ~2 GB de memoria. Se
  // vuelven a cargar al empezar (~1–2 s).
  useEffect(() => {
    if (anyRunning) return;
    const timer = window.setTimeout(() => api.releaseModels().catch(() => {}), RELEASE_MODELS_MS);
    return () => window.clearTimeout(timer);
  }, [anyRunning]);

  // Cada vez que algo se pone en marcha empieza una nota nueva; al parar se
  // guarda (las frases que aún suenan en la cola se añaden después).
  // En Tomar notas la nota se graba siempre, y al parar se espera a que la cola
  // termine (con tope) para cerrarla y abrirla ya completa y con las personas repasadas.
  useEffect(() => {
    if (anyRunning) {
      recorderRef.current = createRecorder({ mode, summaryLang: loadNotesLang(), paused: mode !== "notes" && !loadSaveNotes() });
      return;
    }
    const recorder = recorderRef.current;
    if (mode !== "notes") {
      recorder?.finish();
      return;
    }
    if (!recorder) return;
    const rt = runtime.current.remote_to_local;
    setClosing(true);
    const settled = (async () => {
      // `capture.stop()` entrega el último trozo; después, lo que ya encadena el carril.
      await stopping.current;
      await Promise.all([rt.texting, rt.playback]);
    })();
    let timer = 0;
    const cap = new Promise((resolve) => (timer = window.setTimeout(resolve, NOTES_SETTLE_MS)));
    Promise.race([settled, cap])
      .then(() => {
        window.clearTimeout(timer);
        return recorder.finish();
      })
      .finally(() => setClosing(false))
      .then((id) => {
        // Sin frases no hay nota: se queda en la pantalla del modo.
        if (!id) return;
        setView("notes");
        setOpenRequest({ id, nonce: Date.now() });
      });
  }, [anyRunning]);
  // Con un solo carril en marcha, ese ocupa casi todo el ancho y el otro se
  // queda en su control: los subtítulos necesitan el espacio.
  const focused = mode === "call" && running.length === 1 ? running[0].direction : null;
  const tapsMac = laneSettings.find((l) => l.direction === "remote_to_local")?.inputDeviceId === SYSTEM_AUDIO;

  return (
    <>
    <main className="app" hidden={view !== "translate"}>
      <header className="topbar">
        <div className="brand">
          <MenuButton onClick={() => setMenuOpen(true)} recording={anyRunning} />
          <span className="logo" aria-hidden>
            <WaveIcon />
          </span>
          <div>
            <h1>Lingora</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          {/* En Tomar notas se oculta sin quitarlo: así el selector de modo no se desplaza. */}
          <div className={mode === "notes" ? "pair-hold is-away" : "pair-hold"}>
            <PairBar
              pair={pair}
              languages={shownLanguages}
              onChange={changePair}
              locked={anyRunning}
              mode={mode === "notes" ? "video" : mode}
              noTranslate={noTranslate}
            />
          </div>
          <div className="mode-switch" role="radiogroup" title={anyRunning ? t("app.mode.stopToChange") : undefined}>
            {[
              ["video", t("app.mode.video"), t("app.mode.video.hint")],
              ["notes", t("app.mode.notes"), t("app.mode.notes.hint")],
              CALL_MODE
                ? ["call", t("app.mode.call"), t("app.mode.call.hint")]
                : ["call", t("app.mode.callSoon"), t("app.mode.callSoon.hint")],
            ].map(([value, label, hint]) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? "is-selected" : ""}
                onClick={() => changeMode(/** @type {Mode} */ (value))}
                disabled={anyRunning || (value === "call" && !CALL_MODE)}
                title={anyRunning ? undefined : hint}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Aquí solo si algo falla; el detalle está en Ajustes. */}
      <Diagnostics mode={mode === "call" ? "call" : "video"} systemAudio={tapsMac} onFixed={loadDevices} onlyProblems />

      {mode === "notes" ? (
        <NoteTaking
          running={remoteState.running}
          starting={remoteState.starting}
          closing={closing}
          error={remoteState.error}
          heard={remoteState.heard}
          partial={remoteState.partial}
          noSignal={Boolean(remoteState.running && meters.remote_to_local && meters.remote_to_local.silentSecs > NO_SIGNAL_SECS)}
          input={notesInput}
          onInput={changeNotesInput}
          listen={notesListen}
          onListen={changeNotesListen}
          systemAudio={systemAudio}
          languages={shownLanguages}
          onOpenSettings={() => setView("settings")}
          onStart={() => start(remoteLane)}
          onStop={() => (stopping.current = stop(remoteLane))}
        />
      ) : (
        <div className={`lanes${mode === "video" ? " single" : ""}${focused ? ` focus-${focused}` : ""}`}>
          {visible.map((lane) => (
            <LaneCard
              key={lane.direction}
              lane={lane}
              compact={Boolean(focused) && focused !== lane.direction}
              original={mode === "video" && lane.direction === "remote_to_local" ? noTranslate : undefined}
              onOriginal={changeNoTranslate}
              state={state[lane.direction]}
              meter={meters[lane.direction]}
              volume={volumes[lane.direction]}
              inputs={inputs}
              onOpenSettings={() => setView("settings")}
              onToggle={() => (state[lane.direction].running ? stop(lane) : start(lane))}
              onChange={(patch) => updateLane(lane.direction, patch)}
              onVolume={(v) => changeVolume(lane.direction, v)}
              saveNotes={lane.direction === "remote_to_local" ? saveNotes : undefined}
              onSaveNotes={changeSaveNotes}
              floating={lane.direction === "remote_to_local" ? floating : undefined}
              onFloating={toggleFloating}
            />
          ))}
        </div>
      )}
    </main>
    <Notes visible={view === "notes"} recording={anyRunning} languages={shownLanguages} onMenu={() => setMenuOpen(true)} openRequest={openRequest} />
    {view === "settings" && (
      <Settings
        mode={mode === "call" ? "call" : "video"}
        systemAudio={tapsMac}
        recording={anyRunning}
        languages={shownLanguages}
        onFixed={loadDevices}
        onMenu={() => setMenuOpen(true)}
        lanes={(mode === "notes" ? [] : visible).map((lane) => ({
          key: lane.direction,
          title: lane.title,
          subtitle: t(`lanes.${lane.direction}.settingsSubtitle`),
          content: (
            <LaneSettings
              lane={lane}
              running={state[lane.direction].running}
              inputs={inputs}
              outputs={outputs}
              systemAudio={systemAudio}
              onChange={(patch) => updateLane(lane.direction, patch)}
            />
          ),
        }))}
      />
    )}
    <Sidebar open={menuOpen} view={view} recording={anyRunning} onSelect={setView} onClose={closeMenu} />
    </>
  );
}

/**
 * Tarjeta de un carril: cabecera, control principal, ajustes plegables y las
 * traducciones como subtítulos (la más reciente abajo y destacada).
 */
export function LaneCard({ lane, compact, original, onOriginal, state: s, meter, volume, inputs, onToggle, onChange, onVolume, saveNotes, onSaveNotes, floating, onFloating, onOpenSettings }) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  /** @type {[import("./api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  const feed = useRef(null);
  const target = apiLang(lane.targetLang);

  // Las voces del idioma; se vuelven a mirar al volver a la app por si se descargó alguna.
  useEffect(() => {
    if (!settingsOpen) return;
    const load = () =>
      api
        .voices(target)
        .then(setVoiceList)
        .catch(() => setVoiceList([]));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [settingsOpen, target]);
  const latestId = s.history[0]?.id;
  const live = [...s.heard.map((h) => h.text), s.partial].filter(Boolean).join(" ");

  // Sigue la última traducción y lo que se está oyendo, como unos subtítulos.
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [latestId, live]);

  const status = s.starting
    ? t("app.lane.status.preparing")
    : !s.running
      ? t("app.lane.status.paused")
      : meter?.speaking
        ? t("app.lane.status.detecting")
        : t("app.lane.status.listening");
  const noSignal = s.running && meter && meter.silentSecs > NO_SIGNAL_SECS;
  // Raíz cuadrada: la voz por BlackHole llega con poco nivel.
  const level = s.running && meter ? Math.min(1, Math.sqrt(meter.level) * 3) : 0;
  const entries = [...s.history].reverse();
  const same = lane.sourceLang === lane.targetLang;
  const speaks = lane.speak && !same;
  // Si el género elegido no tiene voz en este idioma, Rust usa el otro.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  const showSource = !same && (lane.showSource ?? speaks);
  // Un solo ajuste para qué texto se ve: la traducción, el original sin
  // traducir (solo en Traducir audio) o los dos.
  const subtitles = same ? "original" : showSource ? "both" : "translated";
  const subtitleOptions = [
    ["translated", t("app.lane.subtitles.translated"), t("app.lane.subtitles.translated.hint")],
    ...(original !== undefined ? [["original", t("app.lane.subtitles.original"), t("app.lane.subtitles.original.hint")]] : []),
    ["both", t("app.lane.subtitles.both"), t("app.lane.subtitles.both.hint")],
  ];
  const tapsMac = lane.inputDeviceId === SYSTEM_AUDIO;
  const inputName = tapsMac
    ? t("app.lane.input.mac")
    : (inputs.find((d) => d.webId && d.webId === lane.inputDeviceId)?.name ?? t("app.lane.input.default"));
  /** @param {string} value */
  const chooseSubtitles = (value) => {
    if (original !== undefined) onOriginal(value === "original");
    if (value !== "original") onChange({ showSource: value === "both" });
  };

  return (
    <section className={`lane lane-${lane.direction}${s.running ? " is-running" : ""}${compact ? " is-compact" : ""}`}>
      <header className="lane-head">
        <div>
          <div className="langs">
            <span>{lane.sourceLang}</span>
            {same ? (
              <span className="langs-note">{t("app.lane.sameLang")}</span>
            ) : (
              <>
                <ArrowIcon />
                <span>{lane.targetLang}</span>
              </>
            )}
          </div>
          <h2>{lane.title}</h2>
          <p className="muted">{lane.subtitle}</p>
        </div>
        <div className="lane-head-actions">
          {floating !== undefined && (
            <button
              className={floating ? "icon-button is-active" : "icon-button"}
              onClick={onFloating}
              title={floating ? t("app.lane.floatClose") : t("app.lane.floatOpen")}
              aria-pressed={floating}
            >
              <FloatIcon />
            </button>
          )}
          <button
            className={settingsOpen ? "icon-button is-active" : "icon-button"}
            onClick={() => setSettingsOpen((v) => !v)}
            title={t("app.lane.settings")}
            aria-expanded={settingsOpen}
          >
            <SlidersIcon />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="settings">
          {/* Lo esencial: qué ves y qué oyes. */}
          <div className="setting-row">
            <span className="setting-label">{t("app.lane.subtitles")}</span>
            <Segmented
              value={subtitles}
              onChange={chooseSubtitles}
              options={subtitleOptions.map(([value, label, hint]) => ({ value, label, hint }))}
            />
          </div>
          {!same && (
            <div className="setting-row">
              <span className="setting-label">{t("app.lane.voice")}</span>
              <Segmented
                value={speaks ? voice : "off"}
                onChange={(value) => {
                  if (value === "off") return onChange({ speak: false });
                  // Una voz concreta de otro género deja de valer: vuelve a la automática.
                  const chosen = voiceList.find((v) => v.id === voiceId);
                  const { [target]: _, ...rest } = lane.voiceIds;
                  onChange({ speak: true, voice: value, ...(chosen && chosen.gender !== value ? { voiceIds: rest } : {}) });
                }}
                options={[
                  { value: "off", label: t("app.lane.voice.off"), hint: t("app.lane.voice.off.hint") },
                  // Se lee en cada frase: se puede cambiar con el carril en marcha.
                  {
                    value: "female",
                    label: t("app.lane.voice.female"),
                    disabled: !lane.voices.female,
                    hint: lane.voices.female ? undefined : t("app.lane.voice.female.missing"),
                  },
                  {
                    value: "male",
                    label: t("app.lane.voice.male"),
                    disabled: !lane.voices.male,
                    hint: lane.voices.male ? undefined : t("app.lane.voice.male.missing"),
                  },
                ]}
              />
            </div>
          )}
          {/* La voz concreta y la velocidad, a mano; los dispositivos, en Ajustes. */}
          {speaks && <VoiceControls lane={lane} volume={volume} onChange={onChange} />}
          {!same && !lane.voices.female && !lane.voices.male && (
            <p className="settings-note">
              {t("app.lane.noVoicesNote")}
            </p>
          )}

          {/* Dispositivos: la app los elige sola; se cambian en Ajustes. */}
          <div className="setting-row">
            <span className="setting-label">{t("app.lane.audio")}</span>
            <button className="setting-summary" onClick={onOpenSettings}>
              <span className="setting-summary-text">
                {inputName}
                {speaks && ` → ${lane.outputDevice || t("app.lane.output.default")}`}
              </span>
              <span className="setting-more">{t("app.lane.audio.change")}</span>
            </button>
          </div>
        </div>
      )}

      <div className="control">
        <button
          className={s.running ? "toggle is-running" : "toggle"}
          onClick={onToggle}
          disabled={s.starting}
          title={s.running ? t("app.lane.stop") : t("app.lane.start")}
        >
          {s.starting ? <span className="spinner" /> : s.running ? <StopIcon /> : <PlayIcon />}
        </button>
        <div className="control-status">
          <span className="status-text">{status}</span>
          <span className="status-sub">
            {s.pending > 0 ? t("app.lane.queued", { count: s.pending }) : s.running ? t("app.lane.autoTranslating") : t("app.lane.pressToStart")}
          </span>
        </div>
        {saveNotes !== undefined && (
          <label className="notes-switch lane-save" title={saveNotes ? t("app.lane.saveNotes.on") : t("app.lane.saveNotes.off")}>
            <input type="checkbox" role="switch" checked={saveNotes} onChange={(e) => onSaveNotes(e.target.checked)} />
            <span>{t("app.lane.saveNotes")}</span>
          </label>
        )}
        <div className={meter?.speaking ? "bars is-speaking" : "bars"} aria-hidden>
          {[0.55, 0.85, 1, 0.75, 0.5].map((f, i) => (
            <span key={i} style={{ transform: `scaleY(${Math.max(0.12, level * f)})` }} />
          ))}
        </div>
        {speaks ? (
        <label className="volume" title={t("app.lane.volume")}>
          <VolumeIcon />
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            style={{ "--fill": `${(volume / 2) * 100}%` }}
          />
          <span className="volume-value">{Math.round(volume * 100)}%</span>
        </label>
        ) : (
          <span className="subtitles-only" title={t("app.lane.captionsOnly.hint")}>
            {t("app.lane.captionsOnly")}
          </span>
        )}
      </div>

      {noSignal && (
        <p className="notice notice-warn">
          {lane.direction === "remote_to_local"
            ? tapsMac
              ? t("app.lane.noSignal.mac")
              : t("app.lane.noSignal.blackhole")
            : t("app.lane.noSignal.mic")}
        </p>
      )}
      {s.error && <p className="notice notice-error">{s.error}</p>}

      {!compact && !showHistory && (
        <Captions state={s} live={live} showSource={showSource} onHistory={() => setShowHistory(true)} />
      )}
      {/* Fuera de la lista: la lista baja sola hasta la última frase y el botón quedaba oculto arriba. */}
      {!compact && showHistory && (
        <div className="feed-bar">
          <span>{t("app.lane.history")}</span>
          <button className="link" onClick={() => setShowHistory(false)}>
            {t("app.lane.backToCaptions")}
          </button>
        </div>
      )}
      {!compact && showHistory && (
      <div className="feed" ref={feed}>
        {entries.length === 0 && !live ? (
          <div className="empty">
            <p>{t("app.lane.empty1")}</p>
            <p>{t("app.lane.empty2")}</p>
          </div>
        ) : (
          entries.map((h) => {
            const latest = h.id === latestId;
            return (
              <article key={h.id} className={latest ? "line is-latest" : "line"}>
                {showSource && <p className="line-source" dir="auto">{h.transcript}</p>}
                <p className="line-target" dir="auto">{h.translation}</p>
                {/* Datos técnicos: aparecen al pasar el ratón; "voz omitida" sí se ve siempre. */}
                <button
                  className={h.skipped || detailsId === h.id ? "line-meta is-visible" : "line-meta"}
                  onClick={() => setDetailsId(detailsId === h.id ? null : h.id)}
                >
                  {h.lagSecs === null
                    ? t("app.lane.soon")
                    : t(h.skipped ? "app.lane.lagSkipped" : "app.lane.lag", { secs: h.lagSecs.toFixed(1) })}
                </button>
                {detailsId === h.id && (
                  <div className="details">
                    <p>
                      {t("app.lane.details", { dur: h.source_duration_secs.toFixed(1), stt: h.stt_ms, tr: h.translate_ms })}
                    </p>
                    <audio controls src={`data:audio/wav;base64,${h.source_wav_base64}`} preload="none" />
                  </div>
                )}
              </article>
            );
          })
        )}
        {live && (
          <div className="live" aria-live="polite">
            <span className="live-dot" />
            <p className="live-text" dir="auto">
              {live}
              <span className="caret" />
            </p>
          </div>
        )}
      </div>
      )}
    </section>
  );
}

/** @param {{ open: boolean }} props */
function Chevron({ open }) {
  return (
    <svg {...svg} width={14} height={14} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

/**
 * Los idiomas de la conversación, comunes a los dos carriles. Si se elige el
 * mismo en los dos lados, se intercambian. No se cambian con un carril en
 * marcha: la frase en curso quedaría a medio camino entre dos idiomas.
 * En modo vídeo se lee «Inglés → Español»: de lo que se oye a lo que se lee.
 * Con los subtítulos en el original (ajuste del panel), el destino se atenúa.
 * @param {{ pair: LangPair, onChange: (pair: LangPair) => void, locked: boolean, mode: Mode, noTranslate: boolean }} props
 */
function PairBar({ pair, languages, onChange, locked, mode, noTranslate }) {
  const t = useT();
  /** @param {"you" | "them"} side @param {string} code */
  const pick = (side, code) => {
    const other = side === "you" ? "them" : "you";
    onChange(code === pair[other] ? { you: pair.them, them: pair.you } : { ...pair, [side]: code });
  };
  // Lo que se escucha tiene que poder escucharse en local; en una llamada
  // también lo que hablas tú.
  /** @param {"you" | "them"} side */
  const listened = (side) => side === "them" || mode === "call";
  /** @param {"you" | "them"} side @param {string} label @param {string} hint */
  const select = (side, label, hint) => (
    <label className="pair-side" title={hint}>
      {label && <span>{label}</span>}
      <select value={pair[side]} onChange={(e) => pick(side, e.target.value)} disabled={locked} aria-label={hint}>
        {languages.map((l) => (
          <option key={l.code} value={l.code.toUpperCase()} disabled={listened(side) && !l.can_listen}>
            {listened(side) && !l.can_listen
              ? t("app.pair.soon", { name: l.name })
              : // Sin voz en este equipo: solo subtítulos hacia ese idioma.
                l.female_voice || l.male_voice
                ? l.name
                : t("app.pair.noVoice", { name: l.name })}
          </option>
        ))}
      </select>
    </label>
  );
  // Al intercambiar, tu idioma pasa a ser el que se escucha.
  const canSwap = languages.find((l) => l.code.toUpperCase() === pair.you)?.can_listen ?? true;
  const swap = (
    <button
      className="pair-swap"
      onClick={() => onChange({ you: pair.them, them: pair.you })}
      disabled={locked || !canSwap}
      title={canSwap ? t("app.pair.swap") : t("app.pair.swapDisabled")}
    >
      <SwapIcon />
    </button>
  );
  return (
    <div
      className={mode === "video" && noTranslate ? "pair is-untranslated" : "pair"}
      title={locked ? t("app.pair.locked") : undefined}
    >
      {mode === "video" ? (
        <>
          {select("them", "", t("app.pair.heard"))}
          {swap}
          {select("you", "", noTranslate ? t("app.pair.untranslated") : t("app.pair.translation"))}
        </>
      ) : (
        <>
          {select("you", t("app.pair.you"), t("app.pair.youSpeak"))}
          {swap}
          {select("them", t("app.pair.them"), t("app.pair.themSpeak"))}
        </>
      )}
    </div>
  );
}

function SwapIcon() {
  return (
    <svg {...svg} width={13} height={13}>
      <path d="M7 7h12l-3-3M17 17H5l3 3" />
    </svg>
  );
}

/** "Paulina · mujer, México · Premium" @param {import("./api").VoiceInfo} v */
const voiceLabel = (v) =>
  [v.name, [v.gender === "female" ? t("app.voices.gender.female") : v.gender === "male" ? t("app.voices.gender.male") : "", v.detail].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");

/**
 * La voz concreta (con prueba) y la velocidad máxima, en la tarjeta del
 * carril: se cambian a menudo y tienen que estar a mano.
 * @param {{ lane: Lane & { voices: { female: boolean, male: boolean } }, volume: number,
 *   onChange: (patch: Partial<Lane>) => void }} props
 */
function VoiceControls({ lane, volume, onChange }) {
  const t = useT();
  /** @type {[import("./api").VoiceInfo[], Function]} */
  const [voiceList, setVoiceList] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const target = apiLang(lane.targetLang);

  // Las voces del idioma; se vuelven a mirar al volver a la app por si se descargó alguna.
  useEffect(() => {
    const load = () =>
      api
        .voices(target)
        .then(setVoiceList)
        .catch(() => setVoiceList([]));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [target]);

  // Si el género elegido no tiene voz en este idioma, Rust usa el otro.
  const voice = lane.voices[lane.voice] ? lane.voice : lane.voices.female ? "female" : "male";
  const voiceId = voiceList.some((v) => v.id === lane.voiceIds[target]) ? lane.voiceIds[target] : "";
  /** @param {string} id "" = automática. */
  const chooseVoice = (id) => {
    const { [target]: _, ...rest } = lane.voiceIds;
    const chosen = voiceList.find((v) => v.id === id);
    onChange({ voiceIds: id ? { ...rest, [target]: id } : rest, ...(chosen?.gender ? { voice: chosen.gender } : {}) });
  };
  /** Dice una frase de ejemplo con la voz elegida, por la salida del carril. */
  const previewVoice = async () => {
    setPreviewing(true);
    setPreviewError("");
    try {
      const text =
        VOICE_SAMPLES[target] ?? (await api.translate(VOICE_SAMPLES.es, "es", target, "", () => {}, false, true)).translation;
      const speech = await api.speak(text, target, voice, 1, voiceId || null);
      await api.playAudio(trimSilence(speech.audio, speech.sample_rate), speech.sample_rate, lane.outputDevice, volume);
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      {voiceList.length > 1 && (
        <div className="setting-row">
          <span className="setting-label" />
          <div className="voice-pick">
            <select value={voiceId} onChange={(e) => chooseVoice(e.target.value)} aria-label={t("app.voices.specific")}>
              <option value="">{t(voice === "female" ? "app.voices.auto.female" : "app.voices.auto.male")}</option>
              {[
                ["kokoro", t("app.voices.group.kokoro")],
                ["system", t("app.voices.group.system")],
              ].map(([engine, label]) => {
                const list = voiceList.filter((v) => v.engine === engine);
                return (
                  list.length > 0 && (
                    <optgroup key={engine} label={label}>
                      {list.map((v) => (
                        <option key={v.id} value={v.id}>
                          {voiceLabel(v)}
                        </option>
                      ))}
                    </optgroup>
                  )
                );
              })}
            </select>
            <button className="voice-preview" onClick={previewVoice} disabled={previewing} title={t("app.voices.preview.hint")}>
              {previewing ? <span className="spinner" /> : t("app.voices.preview")}
            </button>
          </div>
        </div>
      )}
      {previewError && <p className="settings-note">{previewError}</p>}
      <div className="setting-row">
        <span className="setting-label">{t("app.voices.speed")}</span>
        <label className="speed-pick" title={t("app.voices.speed.hint")}>
          <input
            type="range"
            className="wide"
            min="1"
            max="1.4"
            step="0.05"
            value={lane.maxSpeed}
            onChange={(e) => onChange({ maxSpeed: Number(e.target.value) })}
            style={{ "--fill": `${((lane.maxSpeed - 1) / 0.4) * 100}%` }}
            aria-label={t("app.voices.speed.aria")}
          />
          <strong className="field-value">{t("app.voices.speed.upTo", { speed: lane.maxSpeed.toFixed(2) })}</strong>
        </label>
      </div>
    </>
  );
}

/**
 * Los dispositivos de un carril, en la página Ajustes: de dónde oye y por
 * dónde habla. Se eligen una vez; mismas reglas que tenía la tarjeta.
 * @param {{ lane: Lane, running: boolean, inputs: any[], outputs: any[], systemAudio: boolean,
 *   onChange: (patch: Partial<Lane>) => void }} props
 */
export function LaneSettings({ lane, running, inputs, outputs, systemAudio, onChange }) {
  const t = useT();
  const speaks = lane.speak && lane.sourceLang !== lane.targetLang;
  const tapsMac = lane.inputDeviceId === SYSTEM_AUDIO;
  return (
    <div className="prefs-fields">
      <label className="field">
        <span>{lane.direction === "remote_to_local" ? t("app.devices.listenFrom") : t("app.devices.mic")}</span>
        <select value={lane.inputDeviceId} onChange={(e) => onChange({ inputDeviceId: e.target.value })} disabled={running}>
          {systemAudio && lane.direction === "remote_to_local" && <option value={SYSTEM_AUDIO}>{t("app.devices.macRecommended")}</option>}
          <option value="">{t("app.lane.input.default")}</option>
          {inputs.map((d) => (
            <option key={d.uid} value={d.webId} disabled={!d.webId}>
              {d.webId ? d.name : t("app.devices.unavailable", { name: d.name })}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("app.devices.outputTo")}</span>
        <select value={lane.outputDevice} onChange={(e) => onChange({ outputDevice: e.target.value })} disabled={running}>
          <option value="">{t("app.lane.output.default")}</option>
          {outputs.map((d) => (
            // Con el audio del Mac la voz de Lingora nunca entra en la captura.
            <option key={d.uid} value={d.name} disabled={!tapsMac && feedsCapture(d.name)}>
              {!tapsMac && feedsCapture(d.name) ? t("app.devices.loop", { name: d.name }) : d.name}
            </option>
          ))}
        </select>
        {!speaks && <span className="field-hint">{t("app.devices.outputHint")}</span>}
      </label>
      {running && <p className="settings-note">{t("app.devices.stopToChange")}</p>}
    </div>
  );
}

export function WaveIcon() {
  return (
    <svg {...svg}>
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...svg} width={14} height={14}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Una ventana con una pequeña flotando encima: imagen sobre imagen. */
function FloatIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="11" y="12" width="7" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...svg}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...svg} width={22} height={22} fill="currentColor" stroke="none">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...svg} width={20} height={20} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}
