import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@utils/api";
import { createSpeakerTracker } from "@utils/notes";
import { addToMean, closest, estimatePitch, genderFromPitch, nextVoice } from "@utils/multiVoice";

/** Seconds someone must have spoken before getting their own voice: a single
 * odd sentence (music, a shout, another tone) must not become a new person. */
const MIN_PERSON_SECS = 8;
/** How long the "speaking now" dot waits before going off when a voice ends:
 * the next sentence of the same person follows right after, without a flicker. */
const SPEAKING_OFF_MS = 600;

/**
 * @typedef {Object} Person
 * @property {string} voiceId A Lingora voice (`VoiceInfo.id`).
 * @property {"female" | "male"} gender Of that voice: what `speak` receives.
 *
 * @typedef {Person & { index: number }} ShownPerson `index` is what `setVoice`
 *   and `merge` take; the card numbers them 1, 2… in order.
 *
 * @typedef {Object} MultiVoice
 * @property {ShownPerson[]} people In order of appearance (Person 1 first).
 * @property {number | null} speaking `index` of the person whose voice is playing.
 * @property {number | null} max At most this many people (null: as many as it finds).
 * @property {(max: number | null) => void} setMax
 * @property {boolean | null} available The speakers add-on is downloaded (null until known).
 * @property {(print: Promise<number[]>, samples: Float32Array, secs: number, lang: string, preferred: string | null) => Promise<ShownPerson | null>} assign
 *   Who is speaking in a chunk and with which voice. Calls must come in chunk
 *   order (as `enqueue` does). null if it can't tell: the lane's voice is used.
 * @property {(index: number, voiceId: string, gender: "female" | "male") => void} setVoice
 * @property {(from: number, into: number) => void} merge "They are the same person": `from` speaks with `into`'s voice from now on.
 * @property {(index: number | null) => void} showSpeaking Lights the dot of `index`
 *   while their voice plays; null when it ends (after a short wait).
 * @property {() => void} reset Forgets everyone (a new video).
 * @property {() => void} refresh Checks again whether the add-on is downloaded.
 */

/**
 * "Several voices" for the Listen lane. The notes' speaker tracker (as is,
 * without `refine()`: a voice must not change mid-video) tells the voices
 * apart; live it splits more than there are, so on top of it:
 * - someone becomes a person (with their own voice) only after speaking
 *   `MIN_PERSON_SECS`; until then they borrow the most similar person's voice;
 * - with `max`, no one beyond it: they go to the most similar person;
 * - `merge` joins two people by hand.
 * Each person keeps their voice until `reset`. See docs/plan-varias-voces.md.
 * @returns {MultiVoice}
 */
export function useMultiVoice() {
  const tracker = useRef(createSpeakerTracker());
  /**
   * What the tracker found (by its number), and the person each one is:
   * `person` null while provisional.
   * @type {import("react").MutableRefObject<Map<number, { secs: number, person: number | null }>>}
   */
  const found = useRef(new Map());
  /**
   * The people; `into` set once merged into another one. Read by `enqueue`
   * without waiting for a render.
   * @type {import("react").MutableRefObject<Array<Person & { mean: number[], n: number, into?: number }>>}
   */
  const people = useRef([]);
  const maxRef = useRef(/** @type {number | null} */ (null));
  const [shown, setShown] = useState(/** @type {ShownPerson[]} */ ([]));
  const [speaking, setSpeaking] = useState(/** @type {number | null} */ (null));
  const [max, setMaxState] = useState(/** @type {number | null} */ (null));
  const [available, setAvailable] = useState(/** @type {boolean | null} */ (null));
  // The tracker needs the chunks in order: each one waits for the previous.
  const queue = useRef(/** @type {Promise<unknown>} */ (Promise.resolve()));
  const speakingTimer = useRef(/** @type {number | undefined} */ (undefined));
  // The voices per language, asked once: the list also reads the system voices.
  const voiceLists = useRef(/** @type {Map<string, Promise<import("@utils/api").VoiceInfo[]>>} */ (new Map()));
  /** @param {string} lang */
  const voicesOf = (lang) => {
    if (!voiceLists.current.has(lang)) {
      const list = api.voices(lang);
      // A failed list is asked again next time.
      list.catch(() => voiceLists.current.delete(lang));
      voiceLists.current.set(lang, list);
    }
    return /** @type {Promise<import("@utils/api").VoiceInfo[]>} */ (voiceLists.current.get(lang));
  };

  /** Follows merges to the person who is still in the list. @param {number} i */
  const resolve = (i) => {
    while (people.current[i]?.into !== undefined) i = /** @type {number} */ (people.current[i].into);
    return i;
  };
  const publish = () =>
    setShown(people.current.flatMap((p, index) => (p.into === undefined ? [{ voiceId: p.voiceId, gender: p.gender, index }] : [])));
  /** The most similar person still in the list, or -1. @param {number[]} print */
  const mostSimilar = (print) => closest(print, people.current.map((p) => (p.into === undefined ? p.mean : null)));

  const refresh = useCallback(() => {
    api
      .setupStatus()
      .then((list) => setAvailable(list.some((m) => m.id === "speakers" && m.installed)))
      .catch(() => setAvailable(false));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => () => window.clearTimeout(speakingTimer.current), []);

  const assign = useCallback(
    /** @type {MultiVoice["assign"]} */
    (print, samples, secs, lang, preferred) => {
      const run = queue.current.then(async () => {
        const [vector, voices] = await Promise.all([print, voicesOf(lang)]);
        /** @type {{ speaker?: number }} */
        const slot = {};
        tracker.current.add(/** @type {any} */ (slot), vector, secs);
        if (!slot.speaker) return null;
        const seen = found.current.get(slot.speaker) ?? { secs: 0, person: null };
        seen.secs += secs;
        found.current.set(slot.speaker, seen);

        const alive = people.current.filter((p) => p.into === undefined).length;
        const room = maxRef.current === null || alive < maxRef.current;
        if (seen.person === null && (alive === 0 || (room && seen.secs >= MIN_PERSON_SECS))) {
          // Someone new: a voice of their gender. Person 1 keeps the voice
          // chosen in the card if it is a Lingora voice of that gender.
          const gender = genderFromPitch(estimatePitch(samples));
          const used = people.current.filter((p) => p.into === undefined).map((p) => p.voiceId);
          const mine = voices.find((v) => v.id === preferred && v.engine === "supertonic" && v.gender === gender);
          const voiceId = alive === 0 && mine ? mine.id : nextVoice(voices, used, gender);
          if (!voiceId) return null;
          people.current = [...people.current, { voiceId, gender, mean: vector, n: 0 }];
          seen.person = people.current.length - 1;
          publish();
        }

        let index;
        if (seen.person !== null) {
          index = resolve(seen.person);
        } else {
          // Provisional: the most similar person's voice. With no room left
          // and enough said, they stay with that person for good.
          index = mostSimilar(vector);
          if (index < 0) return null;
          if (!room && seen.secs >= MIN_PERSON_SECS) seen.person = index;
        }
        const person = people.current[index];
        // Only their own sentences shape their print, not borrowed ones.
        if (seen.person !== null) {
          person.mean = addToMean(person.mean, person.n, vector);
          person.n += 1;
        }
        return { voiceId: person.voiceId, gender: person.gender, index };
      });
      queue.current = run.catch(() => {});
      return run.catch(() => null);
    },
    [],
  );

  const setVoice = useCallback(
    /** @type {MultiVoice["setVoice"]} */
    (index, voiceId, gender) => {
      const p = people.current[index];
      if (!p) return;
      people.current = people.current.map((q, i) => (i === index ? { ...q, voiceId, gender } : q));
      publish();
    },
    [],
  );

  const merge = useCallback(
    /** @type {MultiVoice["merge"]} */
    (from, into) => {
      const target = resolve(into);
      if (from === target || !people.current[from]) return;
      people.current = people.current.map((p, i) => (i === from ? { ...p, into: target } : p));
      publish();
      setSpeaking((s) => (s === from ? target : s));
    },
    [],
  );

  // The dot follows the voice that plays, not the chunk being analyzed: that
  // one runs seconds ahead of what is heard.
  const showSpeaking = useCallback((/** @type {number | null} */ index) => {
    window.clearTimeout(speakingTimer.current);
    if (index === null) speakingTimer.current = window.setTimeout(() => setSpeaking(null), SPEAKING_OFF_MS);
    else setSpeaking(resolve(index));
  }, []);

  const setMax = useCallback((/** @type {number | null} */ value) => {
    maxRef.current = value;
    setMaxState(value);
  }, []);

  const reset = useCallback(() => {
    tracker.current = createSpeakerTracker();
    found.current = new Map();
    people.current = [];
    publish();
    window.clearTimeout(speakingTimer.current);
    setSpeaking(null);
  }, []);

  return { people: shown, speaking, max, setMax, available, assign, setVoice, merge, showSpeaking, reset, refresh };
}
