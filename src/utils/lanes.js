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

/** Title and subtitle come from `lanes.<direction>.*` when rendered. @type {Omit<import("@app/types").Lane, "title" | "subtitle">[]} */
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
    voiceHq: false,
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
    voiceHq: false,
  },
];

/**
 * The lane's state with what was said in place of the translation, for
 * "Original" captions while the voice still translates. The captions keep their
 * timing: each sentence shows up when its translation starts to sound.
 * @param {import("@app/types").LaneState} state
 * @returns {import("@app/types").LaneState}
 */
export const originalText = (state) => ({
  ...state,
  history: state.history.map((h) => ({ ...h, translation: h.transcript })),
});

/**
 * The languages of a lane according to the pair: "Listen" goes from the other
 * person to you and "Speak", the other way around.
 * @param {import("@app/types").Direction} direction @param {import("@app/types").LangPair} pair
 */
export const langsFor = (direction, pair) =>
  direction === "remote_to_local"
    ? { sourceLang: pair.them, targetLang: pair.you }
    : { sourceLang: pair.you, targetLang: pair.them };

/**
 * Take notes listens with a code that only picks the engine: `"EN"` the
 * European one (it detects the language by itself) and `"ZH"` the one for
 * Chinese, Japanese, Korean… With captions in that same language the lane
 * would look untranslated (source = target), so another code of the same
 * engine is used.
 * @param {"EN" | "ZH"} family @param {string} target
 */
export const notesListenCode = (family, target) => (target !== family ? family : family === "EN" ? "ES" : "JA");

/** A stopped lane with nothing on screen. @type {import("@app/types").LaneState} */
export const EMPTY_STATE = { running: false, starting: false, error: null, pending: 0, history: [], heard: [], partial: "", draft: null };

/**
 * Whether a lane hears a language that needs the add-on for Chinese, Japanese
 * and Korean: it can be heard locally, but not by the European listener.
 * @param {Array<{ sourceLang: string }>} lanes
 * @param {import("./api").LanguageInfo[]} languages
 */
export function needsSenseVoice(lanes, languages) {
  return lanes.some((l) => {
    const info = languages.find((x) => x.code === apiLang(l.sourceLang));
    return Boolean(info?.can_listen && !info.parakeet);
  });
}
