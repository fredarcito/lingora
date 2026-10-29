// Lo que comparten la pantalla Traducir (App) y las piezas de cada carril.

/** @param {string} code @returns {import("./api").Lang} */
export const apiLang = (code) => /** @type {import("./api").Lang} */ (code.toLowerCase());

/**
 * Salidas que acaban en BlackHole. Reproducir ahí la traducción la vuelve a
 * meter en la captura y la app se traduce a sí misma en bucle.
 * @param {string} name
 */
export const feedsCapture = (name) => /blackhole 2ch|^lingora$|salida múltiple|multi-output/i.test(name);

/** Segundos sin sonido antes de avisar. */
export const NO_SIGNAL_SECS = 8;

/**
 * Idiomas mientras llega la lista de Rust (`api.languages`), que dice cuáles
 * entiende Parakeet y qué voces hay en este equipo. Ver docs/plan-idiomas.md.
 * @type {import("./api").LanguageInfo[]}
 */
export const FALLBACK_LANGUAGES = [
  { code: "es", name: "Español", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
  { code: "en", name: "Inglés", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
];

/**
 * Tope por defecto: medido con Kokoro, 1,15x aún suena natural y 1,3x ya
 * suena apurado (y solo acorta la voz un 17 %: las pausas no se aceleran).
 */
const DEFAULT_MAX_SPEED = 1.15;

/** Título y subtítulo salen de `lanes.<dirección>.*` al pintar. @type {Omit<import("../App/types").Lane, "title" | "subtitle">[]} */
export const LANES = [
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
