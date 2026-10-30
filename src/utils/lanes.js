// What the Translate screen (App) and the pieces of each lane share.

/** @param {string} code @returns {import("./api").Lang} */
export const apiLang = (code) => /** @type {import("./api").Lang} */ (code.toLowerCase());

/**
 * Outputs that end in BlackHole. Playing the translation there feeds it back into
 * the capture, and the app translates itself in a loop.
 * @param {string} name
 */
export const feedsCapture = (name) => /blackhole 2ch|^lingora$|salida múltiple|multi-output/i.test(name);

/** Seconds of silence before warning. */
export const NO_SIGNAL_SECS = 8;

/**
 * Languages while the list from Rust (`api.languages`) arrives, which says which
 * ones Parakeet understands and which voices exist on this device. See docs/plan-idiomas.md.
 * @type {import("./api").LanguageInfo[]}
 */
export const FALLBACK_LANGUAGES = [
  { code: "es", name: "Español", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
  { code: "en", name: "Inglés", parakeet: true, can_listen: true, female_voice: true, male_voice: true },
];

/**
 * Default cap: measured with Kokoro, 1.15x still sounds natural and 1.3x already
 * sounds rushed (and it only shortens the voice by 17%: the pauses are not sped up).
 */
const DEFAULT_MAX_SPEED = 1.15;

/** Title and subtitle come from `lanes.<direction>.*` when rendered. @type {Omit<import("../App/types").Lane, "title" | "subtitle">[]} */
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
