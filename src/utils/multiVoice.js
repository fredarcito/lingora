// "Several voices": each person in a video speaks with their own Lingora voice.
// Pure functions; the state lives in `useMultiVoice`. See docs/plan-varias-voces.md.

/** Above this median pitch a voice is taken as female. Measured on Lingora's
 * 10 voices: women 167–202 Hz, men 89–133 Hz. */
const FEMALE_HZ = 160;

/** Voiced 40 ms frames analyzed at most (3 s): enough to tell low from high,
 * and it stays a few milliseconds even on a long chunk. */
const MAX_FRAMES = 75;

/**
 * Median pitch (Hz) of the voiced parts of `samples`, by autocorrelation over
 * 40 ms frames; 0 if nothing is voiced.
 * @param {Float32Array | number[]} samples @param {number} [sampleRate]
 */
export function estimatePitch(samples, sampleRate = 16000) {
  const win = Math.round(sampleRate / 25);
  const hop = win;
  const lo = Math.floor(sampleRate / 400);
  const hi = Math.floor(sampleRate / 70);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  /** @type {number[]} */
  const f0 = [];
  for (let i = 0; i + win < samples.length && f0.length < MAX_FRAMES; i += hop) {
    let energy = 0;
    for (let j = i; j < i + win; j++) energy += samples[j] * samples[j];
    if (Math.sqrt(energy / win) < 0.05 * peak) continue;
    let best = 0;
    let lag = 0;
    for (let k = lo; k < hi; k++) {
      let ac = 0;
      for (let j = i; j < i + win - k; j++) ac += samples[j] * samples[j + k];
      if (ac > best) [best, lag] = [ac, k];
    }
    if (lag && best > 0.4 * energy) f0.push(sampleRate / lag);
  }
  f0.sort((a, b) => a - b);
  return f0.length ? f0[Math.floor(f0.length / 2)] : 0;
}

/** @param {number} hz @returns {"female" | "male"} */
export const genderFromPitch = (hz) => (hz > FEMALE_HZ ? "female" : "male");

/**
 * The voice for a new person: the first Lingora voice of their gender that no
 * one has yet; with all taken, they repeat in order.
 * @param {import("./api").VoiceInfo[]} voices The language's voices.
 * @param {string[]} used Voice ids already given to people.
 * @param {"female" | "male"} gender
 * @returns {string | null} null if the language has no Lingora voice.
 */
export function nextVoice(voices, used, gender) {
  const own = voices.filter((v) => v.engine === "supertonic" && v.gender === gender).map((v) => v.id);
  if (own.length === 0) return null;
  const free = own.find((id) => !used.includes(id));
  return free ?? own[used.filter((id) => own.includes(id)).length % own.length];
}
