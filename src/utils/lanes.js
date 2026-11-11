// What the Translate screen (App) and the pieces of each lane share.

import { t } from "@i18n";
import { SYSTEM_AUDIO } from "./audio";

/** @param {string} code @returns {import("./api").Lang} */
export const apiLang = (code) => /** @type {import("./api").Lang} */ (code.toLowerCase());

/**
 * Outputs that end in BlackHole. Playing the translation there feeds it back into
 * the capture, and the app translates itself in a loop.
 * @param {string} name
 */
export const feedsCapture = (name) => /blackhole 2ch|^lingora$|salida múltiple|multi-output/i.test(name);

/**
 * Name of Lingora's virtual microphone (`driver/LingoraMic.c`). Speak plays
 * into it and the call uses it as its microphone; Listen never picks it.
 */
export const VIRTUAL_MIC = "Lingora Mic";

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
/** Entries kept in a lane's history. */
export const HISTORY_SIZE = 30;
/** How many of the latest entries keep their audio (~160 KB each): only Details plays it. */
export const HISTORY_AUDIO = 5;

/**
 * Puts the newest entry first in a lane's history; older ones beyond
 * `HISTORY_AUDIO` drop their audio.
 * @param {import("@app/types").Entry[]} history Most recent first.
 * @param {import("@app/types").Entry} entry
 * @returns {import("@app/types").Entry[]}
 */
export function addToHistory(history, entry) {
  return [entry, ...history.slice(0, HISTORY_SIZE - 1)].map((h, i) =>
    i < HISTORY_AUDIO || !h.source_wav ? h : { ...h, source_wav: undefined },
  );
}

export const EMPTY_STATE ={ running: false, starting: false, error: null, pending: 0, history: [], heard: [], partial: "", draft: null };

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

/**
 * The lanes as they run now: each saved lane with the languages of the pair
 * and what the mode changes (Take notes neither translates nor speaks,
 * "Original" captions, the voices this device has for the language).
 * @param {ReturnType<typeof import("./prefs.js").loadLaneSettings>} laneSettings
 * @param {{
 *   pair: import("@app/types").LangPair,
 *   mode: import("@app/types").Mode,
 *   meeting: boolean,
 *   notesInput: import("./notes.js").NotesInput,
 *   notesListen: "EN" | "ZH",
 *   notesCaptions: import("./notes.js").NotesCaptions,
 *   floating: boolean,
 *   noTranslate: boolean,
 *   systemAudio: boolean,
 *   langInfo: (code: string) => import("./api").LanguageInfo | undefined,
 * }} options `meeting`: Take notes in an online meeting (the Mac audio and your microphone);
 *   `floating`: the floating captions window is open.
 * @returns {import("@app/types").Lane[]}
 */
export function resolveLanes(laneSettings, { pair, mode, meeting, notesInput, notesListen, notesCaptions, floating, noTranslate, systemAudio, langInfo }) {
  return laneSettings.map((l) => {
    const langs = langsFor(l.direction, pair);
    // Tomar notas: Escuchar sin traducir ni hablar, con la entrada que se eligió
    // allí. En una reunión en línea, Hablar también: es tu micrófono ("Yo").
    const taking = mode === "notes" && (l.direction === "remote_to_local" || meeting);
    if (taking) langs.sourceLang = langs.targetLang = notesListen;
    // Captions in a language, with the floating window open: only the others are
    // translated; "Yo" stays as said. Each sentence reads it, so it can change while recording.
    if (taking && l.direction === "remote_to_local" && floating && notesCaptions !== "original") {
      langs.targetLang = notesCaptions.toUpperCase();
      langs.sourceLang = notesListenCode(notesListen, langs.targetLang);
    }
    // Local por defecto, pero solo si el modelo está instalado; si no, la nube.
    const source = langInfo(langs.sourceLang);
    const target = langInfo(langs.targetLang);
    const voices = { female: target?.female_voice ?? true, male: target?.male_voice ?? true };
    // Sin voz del sistema para el idioma, solo hay subtítulos.
    const speak = !taking && l.speak && (voices.female || voices.male);
    // "Original" captions (Translate audio): what is said, as said. Without voice
    // nothing is translated (the target is the same language, no lag); with it,
    // it still translates for the voice and only the captions show the original.
    const original = mode === "video" && noTranslate;
    if (original && !speak) langs.targetLang = langs.sourceLang;
    return {
      ...l,
      title: t(`lanes.${l.direction}.title`),
      subtitle: t(`lanes.${l.direction}.subtitle`),
      ...langs,
      ...(taking && {
        notes: true,
        // El micrófono de la reunión se elige al empezar (ver `meetingMic` en utils/route.js).
        inputDeviceId: l.direction === "local_to_remote" || notesInput === "mic" || !systemAudio ? "" : SYSTEM_AUDIO,
      }),
      canListen: source?.can_listen ?? true,
      voices,
      speak,
      captionsOriginal: original && speak,
    };
  });
}
