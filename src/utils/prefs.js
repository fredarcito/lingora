import { LANES } from "./lanes";

/**
 * Translate settings saved in `localStorage`. The keys are the ones the app
 * has always used: renaming them would lose people's settings. Storage may be
 * unavailable: then the default is used and a change only lasts this session.
 * @typedef {import("@app/types").Mode} Mode
 * @typedef {import("@app/types").LangPair} LangPair
 * @typedef {import("@app/types").Lane} Lane
 * @typedef {import("@app/types").Direction} Direction
 */

const MODE_KEY = "lingora.mode";
const SPEAK_KEY = "lingora.speak";
const VOICE_IDS_KEY = "lingora.voiceIds";
const SHOW_SOURCE_KEY = "lingora.showSource";
const NO_TRANSLATE_KEY = "lingora.noTranslate";
const PAIR_KEY = "lingora.pair";
const MAX_SPEED_KEY = "lingora.maxSpeed";
const VOLUME_KEY = "lingora.volume";

/**
 * «Translate call» is still in development (it needs a virtual microphone): it
 * stays locked unless `VITE_CALL_MODE=true` is set in the build environment or in `.env`.
 */
export const CALL_MODE = import.meta.env.VITE_CALL_MODE === "true";

/** @param {string} key @param {string} value */
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage it only lasts this session.
  }
}

/** A per-lane object (`{ remote_to_local: …, local_to_remote: … }`). @param {string} key */
function loadPerLane(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

/** @returns {Mode} */
export function loadMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "notes") return "notes";
    return CALL_MODE && saved === "call" ? "call" : "video";
  } catch {
    return "video";
  }
}

/** @param {Mode} mode */
export const storeMode = (mode) => save(MODE_KEY, mode);

/** Captions in the original language, without translating. */
export function loadNoTranslate() {
  try {
    return localStorage.getItem(NO_TRANSLATE_KEY) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} on */
export const storeNoTranslate = (on) => save(NO_TRANSLATE_KEY, on ? "1" : "0");

/** @returns {LangPair} */
export function loadPair() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAIR_KEY) ?? "{}");
    // The codes are checked when the language list arrives.
    const valid = (c) => typeof c === "string" && c.length > 0;
    if (valid(saved.you) && valid(saved.them) && saved.you !== saved.them) return saved;
  } catch {
    // Without storage the default pair is used.
  }
  return { you: "ES", them: "EN" };
}

/** @param {LangPair} pair */
export const storePair = (pair) => save(PAIR_KEY, JSON.stringify(pair));

/** Volume per lane. */
export function loadVolumes() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}");
    return { remote_to_local: 1, local_to_remote: 1, ...saved };
  } catch {
    return { remote_to_local: 1, local_to_remote: 1 };
  }
}

/** @param {Record<Direction, number>} volumes */
export const storeVolumes = (volumes) => save(VOLUME_KEY, JSON.stringify(volumes));

/** The lanes with what each person chose: speed cap, voice yes or no, original text and voice. */
export function loadLaneSettings() {
  const saved = loadPerLane(MAX_SPEED_KEY);
  const speak = loadPerLane(SPEAK_KEY);
  const showSource = loadPerLane(SHOW_SOURCE_KEY);
  const voiceIds = loadPerLane(VOICE_IDS_KEY);
  return LANES.map((l) => ({
    ...l,
    maxSpeed: saved[l.direction] ?? l.maxSpeed,
    speak: speak[l.direction] ?? l.speak,
    showSource: showSource[l.direction],
    voiceIds: voiceIds[l.direction] ?? {},
  }));
}

/** Which lane field is saved under which key. */
const LANE_KEYS = /** @type {const} */ ([
  ["maxSpeed", MAX_SPEED_KEY],
  ["showSource", SHOW_SOURCE_KEY],
  ["voiceIds", VOICE_IDS_KEY],
  ["speak", SPEAK_KEY],
]);

/**
 * Saves the lane fields that `patch` changed, for every lane.
 * @param {Lane[]} lanes the lanes after the change @param {Partial<Lane>} patch
 */
export function storeLaneSettings(lanes, patch) {
  for (const [field, key] of LANE_KEYS) {
    if (field in patch) save(key, JSON.stringify(Object.fromEntries(lanes.map((l) => [l.direction, l[field]]))));
  }
}
