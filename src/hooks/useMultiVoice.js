import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@utils/api";
import { createSpeakerTracker } from "@utils/notes";
import { estimatePitch, genderFromPitch, nextVoice } from "@utils/multiVoice";

/**
 * @typedef {Object} Person
 * @property {string} voiceId A Lingora voice (`VoiceInfo.id`).
 * @property {"female" | "male"} gender Of that voice: what `speak` receives.
 *
 * @typedef {Object} MultiVoice
 * @property {Person[]} people In order of appearance (Person 1 first).
 * @property {boolean | null} available The speakers add-on is downloaded (null until known).
 * @property {(print: Promise<number[]>, samples: Float32Array, secs: number, lang: string, preferred: string | null) => Promise<Person | null>} assign
 *   Who is speaking in a chunk and with which voice. Calls must come in chunk
 *   order (as `enqueue` does). null if it can't tell: the lane's voice is used.
 * @property {(index: number, voiceId: string, gender: "female" | "male") => void} setVoice
 * @property {() => void} reset Forgets everyone (a new video).
 * @property {() => void} refresh Checks again whether the add-on is downloaded.
 */

/**
 * "Several voices" for the Listen lane: tells the people in the audio apart
 * with the notes' speaker tracker (as is, without `refine()`: a voice must not
 * change mid-video) and gives each one a Lingora voice of their gender, which
 * they keep until `reset`. See docs/plan-varias-voces.md.
 * @returns {MultiVoice}
 */
export function useMultiVoice() {
  const tracker = useRef(createSpeakerTracker());
  /** Read by `enqueue` without waiting for a render. @type {import("react").MutableRefObject<Person[]>} */
  const people = useRef([]);
  const [shown, setShown] = useState(/** @type {Person[]} */ ([]));
  const [available, setAvailable] = useState(/** @type {boolean | null} */ (null));
  // The tracker needs the chunks in order: each one waits for the previous.
  const queue = useRef(/** @type {Promise<unknown>} */ (Promise.resolve()));
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

  const refresh = useCallback(() => {
    api
      .setupStatus()
      .then((list) => setAvailable(list.some((m) => m.id === "speakers" && m.installed)))
      .catch(() => setAvailable(false));
  }, []);
  useEffect(refresh, [refresh]);

  const assign = useCallback(
    /** @type {MultiVoice["assign"]} */
    (print, samples, secs, lang, preferred) => {
      const run = queue.current.then(async () => {
        const [vector, voices] = await Promise.all([print, voicesOf(lang)]);
        /** @type {{ speaker?: number }} */
        const slot = {};
        tracker.current.add(/** @type {any} */ (slot), vector, secs);
        const index = (slot.speaker ?? 0) - 1;
        if (index < 0) return null;
        if (index < people.current.length) return people.current[index];
        // Someone new: a voice of their gender. Person 1 keeps the voice
        // chosen in the card if it is a Lingora voice of that gender.
        const gender = genderFromPitch(estimatePitch(samples));
        const used = people.current.map((p) => p.voiceId);
        const mine = voices.find((v) => v.id === preferred && v.engine === "supertonic" && v.gender === gender);
        const voiceId = index === 0 && mine ? mine.id : nextVoice(voices, used, gender);
        if (!voiceId) return null;
        const person = { voiceId, gender };
        people.current = [...people.current, person];
        setShown(people.current);
        return person;
      });
      queue.current = run.catch(() => {});
      return run.catch(() => null);
    },
    [],
  );

  const setVoice = useCallback(
    /** @type {MultiVoice["setVoice"]} */
    (index, voiceId, gender) => {
      people.current = people.current.map((p, i) => (i === index ? { voiceId, gender } : p));
      setShown(people.current);
    },
    [],
  );

  const reset = useCallback(() => {
    tracker.current = createSpeakerTracker();
    people.current = [];
    setShown([]);
  }, []);

  return { people: shown, available, assign, setVoice, reset, refresh };
}
