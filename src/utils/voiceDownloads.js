// What to download so a language has a voice: the natural voice (one download
// with all its voices) or a light one (one download per voice, for low-end
// computers). See docs/plan-voz-ligera.md.

/** Sent on `window` when a voice was downloaded: the voice lists are read again. */
export const VOICES_CHANGED = "lingora:voices-changed";

export const announceVoices = () => window.dispatchEvent(new Event(VOICES_CHANGED));

/** Download id of the natural voice (`Model::Voice` in Rust). */
export const NATURAL_MODEL = "voice_model";

/**
 * @typedef {Object} Offer What one click downloads.
 * @property {"natural" | "light"} kind
 * @property {string} model What `api.downloadModel` gets.
 * @property {number} bytes
 * @property {string} voiceId The voice to use after it ("" = automatic).
 */

/**
 * The light voice of the gender, or the first one if there is none of it.
 * @param {import("@utils/api").LightVoice[]} voices @param {"female" | "male"} gender
 */
const ofGender = (voices, gender) => voices.find((v) => v.gender === gender) ?? voices[0];

/**
 * "Turn on voice": the one download that gives the language a voice, the kind
 * this computer should use first. Null if there is nothing to download.
 * @param {import("@utils/api").VoiceDownloads} d @param {"female" | "male"} gender
 * @returns {Offer | null}
 */
export function voiceOffer(d, gender) {
  const pick = ofGender(d.light, gender);
  /** @type {Offer | null} */
  const light = pick ? { kind: "light", model: pick.model, bytes: pick.bytes, voiceId: "" } : null;
  /** @type {Offer | null} */
  const natural = d.natural && !d.natural_installed ? { kind: "natural", model: NATURAL_MODEL, bytes: d.natural_bytes, voiceId: "" } : null;
  return (d.light_recommended || !d.natural ? light ?? natural : natural ?? light) ?? null;
}

/**
 * "Use light voice" when the natural one can't keep up: a downloaded light
 * voice of the gender, or the one to download. Null if the language has none.
 * @param {import("@utils/api").VoiceDownloads} d @param {"female" | "male"} gender
 * @returns {Offer | null}
 */
export function lightSwitch(d, gender) {
  const installed = d.light.filter((v) => v.installed);
  // One of the other gender only counts if the language has none of this one.
  const ready = installed.find((v) => v.gender === gender) ?? (d.light.some((v) => v.gender === gender) ? null : installed[0]);
  if (ready) return { kind: "light", model: "", bytes: 0, voiceId: ready.id };
  const pick = ofGender(d.light, gender);
  return pick ? { kind: "light", model: pick.model, bytes: pick.bytes, voiceId: pick.id } : null;
}

/**
 * @typedef {Object} LightDownload One light download and the voices it brings.
 * @property {string} model @property {number} bytes @property {boolean} installed
 * @property {import("@utils/api").LightVoice[]} voices
 */

/**
 * "More voices": the light voices grouped by download (Sharvard brings a
 * woman's and a man's voice), in the catalogue's order.
 * @param {import("@utils/api").LightVoice[]} voices @returns {LightDownload[]}
 */
export function lightDownloads(voices) {
  /** @type {LightDownload[]} */
  const out = [];
  for (const v of voices) {
    const group = out.find((g) => g.model === v.model);
    if (group) group.voices.push(v);
    else out.push({ model: v.model, bytes: v.bytes, installed: v.installed, voices: [v] });
  }
  return out;
}
