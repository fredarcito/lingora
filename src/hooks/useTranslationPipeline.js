import { useCallback, useRef, useState } from "react";
import { t } from "@i18n";
import { api, errorMessage } from "@utils/api";
import { FILLER, SYSTEM_AUDIO, joinWords, startAutoCapture } from "@utils/audio";
import { EMPTY_STATE, addToHistory, apiLang } from "@utils/lanes";
import { logEvent } from "@utils/log";
import { loadSpeakers } from "@utils/notes.js";
import { phraseQueue, phraseSplitter, splitAtSentenceEnd } from "@utils/phrases";
import { echoPossible, readRoute } from "@utils/route";
import { createSpeechQueue } from "@utils/speechQueue";
import { MAX_VOICE_LAG_SECS, speedFor, speedRange, trimSilence } from "@utils/voice";
import { useLaneMeters } from "@hooks/useLaneMeters.js";
import { useMultiVoice } from "@hooks/useMultiVoice.js";
import { useVolumes } from "@hooks/useVolumes.js";

/**
 * @typedef {import("@app/types").Direction} Direction
 * @typedef {import("@app/types").Lane} Lane
 * @typedef {import("@app/types").Entry} Entry
 * @typedef {import("@app/types").LaneState} LaneState
 */

/** Without voice, how often the subtitle being written is repainted at most. */
const DRAFT_EVERY_MS = 33;

/** The voice of both lanes, in order: a sentence already too late is not made. */
const speechQueue = createSpeechQueue();

/**
 * Transcripción en local (Parakeet o SenseVoice, según el idioma) sobre el
 * trozo entero, ~0,1–0,3 s; sin coste si la escucha en vivo ya lo oyó entero.
 * @param {Lane} lane @param {Uint8Array} wav @param {import("@utils/audio").SegmentInfo} info
 * @returns {Promise<import("@utils/api").Transcription>}
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
    source_wav: wav,
    source_duration_secs: info.secs,
  };
}

let entryId = 0;

const EMPTY_RUNTIME = {
  texting: Promise.resolve(),
  playback: Promise.resolve(),
  pending: 0,
  lag: 0,
  context: "",
  carry: "",
};

/**
 * The live translation of both lanes: each one captures audio, cuts it into
 * chunks and runs them through `enqueue` (listen → translate → voice →
 * playback, in order). `start` and `stop` open and close a lane's capture.
 * - `state` is what each lane shows; `runtime`, what its chain carries between chunks.
 * - `lanesRef` is read on every chunk, so voice, speed and languages can change while running.
 * - `recorderRef` is the note being written, if any (see `useNoteRecorder`).
 * @param {{
 *   lanesRef: React.MutableRefObject<Lane[]>,
 *   languagesRef: React.MutableRefObject<import("@utils/api").LanguageInfo[]>,
 *   recorderRef: React.MutableRefObject<ReturnType<typeof import("@utils/notes.js").createRecorder> | null>,
 * }} options
 */
export function useTranslationPipeline({ lanesRef, languagesRef, recorderRef }) {
  const [state, setState] = useState({
    remote_to_local: EMPTY_STATE,
    local_to_remote: EMPTY_STATE,
  });
  /**
   * Por carril: la captura activa, las cadenas que mantienen el orden
   * (texto, voz y reproducción), cuántos trozos quedan por sonar, y el texto
   * que se arrastra entre trozos: `prompt` para Whisper, `context` para el
   * traductor y `carry` con la frase sin terminar.
   * @type {React.MutableRefObject<Record<string, typeof EMPTY_RUNTIME & { capture?: import("@utils/audio").AutoCapture }>>}
   */
  const runtime = useRef({
    remote_to_local: { ...EMPTY_RUNTIME },
    local_to_remote: { ...EMPTY_RUNTIME },
  });
  const { meters, lastSignal } = useLaneMeters(runtime);
  const { volumes, volumesRef, changeVolume } = useVolumes();
  // "Several voices" in the Listen lane: one voice per person (docs/plan-varias-voces.md).
  const multiVoice = useMultiVoice();

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
   * @param {Lane} lane @param {Uint8Array} wav @param {import("@utils/audio").SegmentInfo} info
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
    // Several voices: the voice print (~80 ms) runs alongside the transcription,
    // so who is speaking is known before the translation is ready.
    const target = apiLang(current.targetLang);
    const printing =
      current.speak && current.voice === "multi" && lane.direction === "remote_to_local" && info.samples
        ? api.voicePrint(info.samples)
        : null;
    printing?.catch(() => {});
    const person = printing
      ? multiVoice.assign(printing, /** @type {Float32Array} */ (info.samples), info.secs, target, current.voiceIds[target] ?? null)
      : null;

    /** @type {ReturnType<typeof phraseQueue<Promise<import("@utils/api").Speech | null>>>} */
    const phrases = phraseQueue();
    /** Set when this chunk's voice is skipped: its sentences not made yet are not made. */
    const chunkVoice = { skipped: false };
    let firstPhrase = true;
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

        // The lane's speed setting: a cap to climb to when behind and, in Agile, a floor.
        const { base, max } = speedRange(current.maxSpeed);
        const speed = Math.max(base, speedFor(rt.pending, rt.lag, max));
        const splitter = phraseSplitter((phrase) => {
          // "Mmm", "Ajá": la voz los pronuncia como un resoplido.
          if (!current.speak || FILLER.test(phrase)) return;
          const voiceId = current.voiceIds[t.target_lang] ?? null;
          // Rust only knows female and male: with several voices, each person's (or female if unknown).
          const gender = current.voice === "multi" ? "female" : current.voice;
          // Playback skips the whole chunk if its first sentence sounds too late,
          // and the lag only grows: if it is already late when its turn comes,
          // it is not made (null), nor the rest of the chunk.
          const first = firstPhrase;
          firstPhrase = false;
          const late = () => {
            if (first && (performance.now() - info.endedAt) / 1000 > MAX_VOICE_LAG_SECS) chunkVoice.skipped = true;
            return chunkVoice.skipped;
          };
          /** @param {"female" | "male"} g @param {string | null} id */
          const say = (g, id) => speechQueue.run(() => api.speak(phrase, t.target_lang, g, speed, id, current.voiceHq), late);
          const speech = person ? person.then((p) => say(p?.gender ?? gender, p?.voiceId ?? voiceId)) : say(gender, voiceId);
          // Si falla una frase anterior, esta no se llega a esperar.
          speech.catch(() => {});
          phrases.push(speech);
        });
        // Each update repaints the whole app, and on the Mac a token can come
        // every ~10 ms: at most one every DRAFT_EVERY_MS, and the rest at the
        // end. No timer: it must also work with the window hidden (floating captions).
        let draftedAt = 0;
        let undrafted = false;
        const showDraft = () => {
          draftedAt = performance.now();
          undrafted = false;
          patchState(lane.direction, { draft: { key: heardKey, text: draft.translation, source: head } });
        };
        const tr = await api.translate(
          head,
          t.source_lang,
          t.target_lang,
          rt.context,
          (delta) => {
            draft.translation += delta;
            splitter.add(delta);
            if (current.speak) return;
            if (performance.now() - draftedAt >= DRAFT_EVERY_MS) showDraft();
            else undrafted = true;
          },
          false,
          true,
        );
        if (undrafted) showDraft();
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
              history: addToHistory(prev[lane.direction].history, entry),
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
            logEvent(
              `${lane.direction}: voz con ${lag.toFixed(1)} s de retraso ` +
                `(${info.secs?.toFixed(1) ?? "?"} s de audio, ${rt.pending} en cola, ` +
                (speech ? `generada en ${(speech.tts_ms / 1000).toFixed(1)} s)` : "no generada: ya iba tarde)"),
            );
            // Se omite el trozo entero o nada: cortarlo a medias suena a
            // palabras sueltas.
            if (lag > MAX_VOICE_LAG_SECS) {
              patchEntry(lane.direction, id, { skipped: true });
              logEvent(`${lane.direction}: frase omitida (más de ${MAX_VOICE_LAG_SECS} s de retraso)`);
              // Lo siguiente en la cola ya no arrastra este retraso.
              rt.lag = 0;
              chunkVoice.skipped = true;
              break;
            }
          }
          // Only a skipped chunk gets null, and that one stopped above.
          if (!speech) break;
          const audio = trimSilence(speech.audio, speech.sample_rate);
          // Several voices: the dot lights up with the voice that is heard.
          if (person) multiVoice.showSpeaking((await person)?.index ?? null);
          await api.playAudio(audio, speech.sample_rate, lane.outputDevice, volumesRef.current[lane.direction]);
        }
        const result = await texted;
        // Todo el texto quedó a la espera del trozo siguiente.
        if (!result.translation) return;
        const silent = id === null;
        showEntry();
        // Sin voz, el retraso es hasta que aparece el subtítulo.
        if (silent) {
          const lag = (performance.now() - info.endedAt) / 1000;
          logEvent(
            `${lane.direction}: subtítulo con ${lag.toFixed(1)} s de retraso ` +
              `(${info.secs?.toFixed(1) ?? "?"} s de audio, traducido en ${((result.translate_ms ?? 0) / 1000).toFixed(1)} s, ${rt.pending} en cola)`,
          );
          patchEntry(lane.direction, id, {
            lagSecs: lag,
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
            ? { print: printing ?? api.voicePrint(info.samples), secs: info.secs }
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
          info,
        );
      } catch (e) {
        // Un trozo fallido no detiene el carril: se muestra y se sigue.
        patchState(lane.direction, { error: errorMessage(e) });
      } finally {
        dropHeard();
        if (person) multiVoice.showSpeaking(null);
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
      const preparing = performance.now();
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
        // El micrófono necesita ganancia automática; BlackHole no la tolera.
        // En Tomar notas, también el micrófono de una reunión en persona.
        const realMic = lane.direction === "local_to_remote" || (Boolean(lane.notes) && lane.inputDeviceId !== SYSTEM_AUDIO);
        runtime.current[lane.direction].capture = await startAutoCapture(lane.inputDeviceId, {
          autoGain: realMic,
          // Like Chrome: on unless headphones are known to be connected.
          cancelEcho: realMic && echoPossible(await readRoute()),
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
        logEvent(
          `${lane.direction}: preparado en ${((performance.now() - preparing) / 1000).toFixed(1)} s ` +
            `(${current.sourceLang} → ${current.targetLang}, voz ${current.speak ? "sí" : "no"}, notas ${current.notes ? "sí" : "no"})`,
        );
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

  return { state, runtime, meters, volumes, changeVolume, multiVoice, start, stop };
}
