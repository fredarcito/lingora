import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorMessage } from "@utils/api";
import Diagnostics from "@components/Diagnostics";
import LaneCard from "@components/LaneCard";
import LaneSettings from "@components/LaneSettings";
import TopBar from "@components/TopBar";
import NoteTaking from "@pages/NoteTaking";
import Notes from "@pages/Notes";
import { cx } from "@components/shared";
import Settings from "@pages/Settings";
import Sidebar from "@components/Sidebar";
import { createRecorder, loadNotesCaptions, loadNotesConsent, loadNotesInput, loadNotesLang, loadNotesListen, loadSaveNotes, loadSpeakers, storeNotesCaptions, storeNotesInput, storeNotesListen, storeSaveNotes } from "@utils/notes.js";
import { t, useT } from "@i18n";
import { FILLER, SYSTEM_AUDIO, joinWords, startAutoCapture } from "@utils/audio";
import { useAudioRoute } from "@hooks/useAudioRoute.js";
import { useDevices } from "@hooks/useDevices.js";
import { useFloatingCaptions } from "@hooks/useFloatingCaptions.js";
import { useLaneMeters } from "@hooks/useLaneMeters.js";
import { useLanguages } from "@hooks/useLanguages.js";
import { useVolumes } from "@hooks/useVolumes.js";
import { useWidth } from "@hooks/useWidth.js";
import { useMeetingNotes } from "@hooks/useMeetingNotes.js";
import { useMultiVoice } from "@hooks/useMultiVoice.js";
import { EMPTY_STATE, NO_SIGNAL_SECS, apiLang, langsFor, notesListenCode } from "@utils/lanes";
import { CALL_MODE, loadLaneSettings, loadMode, loadNoTranslate, loadPair, storeLaneSettings, storeMode, storeNoTranslate, storePair } from "@utils/prefs.js";
import { trimSilence } from "@utils/voice";
import styles from "./styles.module.css";

/**
 * @typedef {import("./types").Direction} Direction
 * @typedef {import("./types").Lane} Lane
 * @typedef {import("./types").Entry} Entry
 * @typedef {import("./types").LaneState} LaneState
 * @typedef {import("./types").Mode} Mode
 * @typedef {import("./types").LangPair} LangPair
 */

/** En llamada con un solo carril en marcha, cuál ocupa casi todo el ancho. */
const FOCUS_CLASS = { local_to_remote: styles.focusLocalToRemote, remote_to_local: styles.focusRemoteToLocal };

/**
 * Velocidad de la voz según el retraso. Un vídeo no espera a la traducción, y
 * el español dura un 15-25 % más que el inglés: si la voz no acelera, el
 * retraso crece sin límite. `lag` es el retraso medido en la última frase
 * que sonó; `pending`, los trozos en cola; `max`, el tope que elige el
 * usuario (más rápido alcanza antes, pero suena menos natural).
 * @param {number} pending @param {number} lag @param {number} max
 */
function speedFor(pending, lag, max) {
  // Acelerar con poco retraso solo deja silencios esperando al trozo siguiente.
  const byLag = lag > 6 ? 1 : lag > 4.5 ? 0.7 : lag > 3.5 ? 0.4 : lag > 2.5 ? 0.2 : 0;
  const byQueue = pending >= 4 ? 1 : pending === 3 ? 0.5 : 0;
  return 1 + (max - 1) * Math.max(byLag, byQueue);
}

/**
 * Con más retraso que esto la voz ya no sirve en una conversación: se omite
 * y solo se muestra el texto, para alcanzar al original.
 */
const MAX_VOICE_LAG_SECS = 10;

/**
 * Fin de frase. Además de la puntuación latina: la china y japonesa (sin
 * espacio detrás; Whisper a veces pone la latina pegada al carácter
 * siguiente), el danda del hindi y el bengalí, la del árabe y el urdu, y la
 * birmana, tibetana y jemer.
 */
const SENTENCE_BREAK = /[.!?…]+["»”)]*\s+|[。！？।॥۔؟။།។]+[」』”）]*\s*|[.!?](?=[\u3040-\u30ff\u3400-\u9fff])/g;
/** Fin de cláusula: coma, punto y coma o dos puntos, también los chinos, árabes y birmanos. */
const CLAUSE_BREAK = /[,;:]\s+|[，、；：،؛၊]\s*|[,;:](?=[\u3040-\u30ff\u3400-\u9fff])/g;
/** Caracteres chinos y japoneses. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;

/**
 * Largo de una frase para los límites de abajo: un carácter chino o japonés
 * dice tanto como dos o tres letras, así que cuenta doble.
 * @param {string} text
 */
const phraseLength = (text) => text.length + (text.match(CJK)?.length ?? 0);

/** Frases por debajo de este largo se unen a la siguiente: la voz suena entrecortada. */
const MIN_PHRASE_CHARS = 25;
/** Frases por encima de este largo se parten por su última coma. */
const MAX_PHRASE_CHARS = 120;
/**
 * La primera frase decide cuándo se empieza a oír algo, así que se corta ya
 * en su primera coma a partir de este largo (Kokoro tarda ~1/4 de lo que
 * dura el audio).
 */
const FIRST_PHRASE_MIN_CHARS = 20;

/**
 * Parte en frases para la voz una traducción que llega a trozos. Cada frase
 * se entrega en cuanto se completa, para que la primera suene mientras el
 * traductor sigue escribiendo.
 * @param {(phrase: string) => void} emit
 */
function phraseSplitter(emit) {
  let buffer = "";
  let first = true;
  const take = (n) => {
    const phrase = buffer.slice(0, n).trim();
    buffer = buffer.slice(n);
    if (phrase) {
      emit(phrase);
      first = false;
    }
  };
  /** Fin del primer separador que deja una frase de al menos `min` caracteres. */
  const cutAt = (/** @type {RegExp} */ re, min) => {
    for (const m of buffer.matchAll(re)) {
      const end = m.index + m[0].length;
      if (phraseLength(buffer.slice(0, end).trim()) >= min) return end;
    }
    return -1;
  };
  const scan = () => {
    for (;;) {
      const min = first ? FIRST_PHRASE_MIN_CHARS : MIN_PHRASE_CHARS;
      let cut = cutAt(SENTENCE_BREAK, min);
      if (cut < 0 && first) cut = cutAt(CLAUSE_BREAK, min);
      if (cut < 0 && phraseLength(buffer) > MAX_PHRASE_CHARS) {
        const commas = [...buffer.matchAll(CLAUSE_BREAK)];
        if (commas.length) cut = commas[commas.length - 1].index + commas[commas.length - 1][0].length;
      }
      if (cut < 0) return;
      take(cut);
    }
  };
  return {
    /** @param {string} delta */
    add(delta) {
      buffer += delta;
      scan();
    },
    flush() {
      take(buffer.length);
    },
  };
}

/**
 * Cola de frases de voz de un trozo: la traducción las va añadiendo y la
 * reproducción las consume en orden según están listas.
 * @template T
 */
function phraseQueue() {
  /** @type {T[]} */
  const items = [];
  let done = false;
  /** @type {(() => void) | null} */
  let wake = null;
  return {
    /** @param {T} item */
    push(item) {
      items.push(item);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; ; ) {
        if (i < items.length) yield items[i++];
        else if (done) return;
        else await new Promise((resolve) => (wake = resolve));
      }
    },
  };
}

/**
 * Separa lo que se puede traducir ya de la última frase sin terminar. Whisper
 * suele poner punto al final del trozo aunque la frase siga, así que el final
 * del texto no cuenta como fin de frase: se busca el último fin de frase
 * interno, o en su defecto la última coma. Si no hay ninguno, el texto se
 * guarda entero una vez; a la segunda se traduce tal cual para no acumular
 * retraso.
 * @param {string} text
 * @param {boolean} alreadyCarried Si este texto ya incluye algo guardado antes.
 * @returns {{ head: string, tail: string }}
 */
function splitAtSentenceEnd(text, alreadyCarried) {
  const body = text.replace(/[.…。]+\s*$/, "");
  const cut = (re) => {
    let last = -1;
    for (const m of body.matchAll(re)) last = m.index + m[0].length;
    return last;
  };
  let at = cut(SENTENCE_BREAK);
  if (at < 0) at = cut(CLAUSE_BREAK);
  if (at < 0) return alreadyCarried ? { head: text, tail: "" } : { head: "", tail: body };
  return { head: body.slice(0, at).trim(), tail: body.slice(at).trim() };
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

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
    source_wav_base64: toBase64(wav),
    source_duration_secs: info.secs,
  };
}

let entryId = 0;

/** Tiempo parado tras el que se liberan los modelos de la memoria. */
const RELEASE_MODELS_MS = 3 * 60_000;

/** Tope de espera a que termine la cola de Tomar notas antes de cerrar la nota. */
const NOTES_SETTLE_MS = 20_000;

const EMPTY_RUNTIME = {
  texting: Promise.resolve(),
  playback: Promise.resolve(),
  pending: 0,
  lag: 0,
  context: "",
  carry: "",
};

export default function App() {
  // Repinta al cambiar de idioma; los textos se piden con `t` del módulo.
  useT();
  const [pair, setPair] = useState(loadPair);
  const [mode, setMode] = useState(loadMode);
  // Solo en Traducir audio: en una llamada la otra persona necesita oírte traducido.
  const [noTranslate, setNoTranslate] = useState(loadNoTranslate);
  // Tomar notas: qué se escucha y la familia de idiomas; no tocan los ajustes de Escuchar.
  const [notesInput, setNotesInput] = useState(loadNotesInput);
  const [notesListen, setNotesListen] = useState(loadNotesListen);
  const [notesCaptions, setNotesCaptions] = useState(loadNotesCaptions);
  // The floating captions window; here because Take notes only translates while it is open.
  const [floating, setFloating] = useState(false);
  const [laneSettings, setLanes] = useState(loadLaneSettings);
  const { languages, languagesRef, langInfo, shownLanguages } = useLanguages();
  // Antes de los dispositivos: al conectar algo no se releen mientras traduce.
  const anyRunningRef = useRef(false);
  const { devices, systemAudio, loadDevices } = useDevices({ setLanes, anyRunningRef });

  // Reunión en línea: el audio del Mac y tu micrófono a la vez.
  const meeting = mode === "notes" && notesInput === "meeting" && systemAudio;
  const lanes = laneSettings.map((l) => {
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
  // El modo rápido se lee en cada trozo: se puede comparar sin detener el carril.
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  // La conversación que se está guardando (ver notes.js) y el menú ☰.
  const recorderRef = useRef(/** @type {ReturnType<typeof createRecorder> | null} */ (null));
  // What the My notes panel of Take notes asks of the recorder; stable, for ⌘B.
  const [modeRef, modeWidth] = useWidth();
  const [notesActions] = useState(() => ({
    /** @param {string} text @param {number} startedTyping */
    addMyNote: (text, startedTyping) => recorderRef.current?.addMyNote(text, startedTyping),
    /** @param {number} index @param {string} text */
    editMyNote: (index, text) => recorderRef.current?.editMyNote(index, text),
    /** @param {number} index */
    removeMyNote: (index) => recorderRef.current?.removeMyNote(index),
    addBookmark: () => recorderRef.current?.addBookmark(),
    /** @param {number} index */
    removeBookmark: (index) => recorderRef.current?.removeBookmark(index),
  }));
  const [view, setView] = useState(/** @type {import("@components/Sidebar").View} */ ("translate"));
  // Al terminar Tomar notas se abre la nota; `stopping` es la parada en curso.
  const [openRequest, setOpenRequest] = useState(/** @type {{ id: string, nonce: number } | null} */ (null));
  const stopping = useRef(/** @type {Promise<void> | null} */ (null));
  // Cerrando la nota de Tomar notas (esperando a la cola).
  const [closing, setClosing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /** @param {Mode} next */
  const changeMode = (next) => {
    setMode(next);
    storeMode(next);
  };

  /** @param {import("@utils/notes.js").NotesInput} next */
  const changeNotesInput = (next) => {
    setNotesInput(next);
    storeNotesInput(next);
  };

  /** @param {"EN" | "ZH"} next */
  const changeNotesListen = (next) => {
    setNotesListen(next);
    storeNotesListen(next);
  };

  /** @param {import("@utils/notes.js").NotesCaptions} next */
  const changeNotesCaptions = (next) => {
    setNotesCaptions(next);
    storeNotesCaptions(next);
  };

  /** @param {boolean} next */
  const changeNoTranslate = (next) => {
    setNoTranslate(next);
    storeNoTranslate(next);
  };

  /** @param {LangPair} next */
  const changePair = (next) => {
    setPair(next);
    storePair(next);
  };
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
  // «Guardar en notas» de la tarjeta: parado es el ajuste de siempre; en marcha
  // pausa y reanuda la nota en curso sin cambiar el ajuste.
  const [saveNotes, setSaveNotes] = useState(loadSaveNotes);
  /** @param {boolean} on */
  const changeSaveNotes = (on) => {
    setSaveNotes(on);
    if (recorderRef.current && anyRunningRef.current) recorderRef.current.setSaving(on);
    else storeSaveNotes(on);
  };
  /** @param {Direction} direction @param {Partial<Lane>} patch */
  const updateLane = (direction, patch) => {
    setLanes((prev) => {
      const next = prev.map((l) => (l.direction === direction ? { ...l, ...patch } : l));
      storeLaneSettings(next, patch);
      return next;
    });
  };

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

    /** @type {ReturnType<typeof phraseQueue<Promise<import("@utils/api").Speech>>>} */
    const phrases = phraseQueue();
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

        const speed = speedFor(rt.pending, rt.lag, current.maxSpeed);
        const splitter = phraseSplitter((phrase) => {
          // "Mmm", "Ajá": la voz los pronuncia como un resoplido.
          if (!current.speak || FILLER.test(phrase)) return;
          const voiceId = current.voiceIds[t.target_lang] ?? null;
          // Rust only knows female and male: with several voices, each person's (or female if unknown).
          const gender = current.voice === "multi" ? "female" : current.voice;
          const speech = person
            ? person.then((p) => api.speak(phrase, t.target_lang, p?.gender ?? gender, speed, p?.voiceId ?? voiceId, current.voiceHq))
            : api.speak(phrase, t.target_lang, gender, speed, voiceId, current.voiceHq);
          // Si falla una frase anterior, esta no se llega a esperar.
          speech.catch(() => {});
          phrases.push(speech);
        });
        const tr = await api.translate(
          head,
          t.source_lang,
          t.target_lang,
          rt.context,
          (delta) => {
            draft.translation += delta;
            splitter.add(delta);
            if (!current.speak) patchState(lane.direction, { draft: { key: heardKey, text: draft.translation, source: head } });
          },
          false,
          true,
        );
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
              history: [entry, ...prev[lane.direction].history].slice(0, 30),
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
            // Se omite el trozo entero o nada: cortarlo a medias suena a
            // palabras sueltas.
            if (lag > MAX_VOICE_LAG_SECS) {
              patchEntry(lane.direction, id, { skipped: true });
              // Lo siguiente en la cola ya no arrastra este retraso.
              rt.lag = 0;
              break;
            }
          }
          const audio = trimSilence(speech.audio, speech.sample_rate);
          await api.playAudio(audio, speech.sample_rate, lane.outputDevice, volumesRef.current[lane.direction]);
        }
        const result = await texted;
        // Todo el texto quedó a la espera del trozo siguiente.
        if (!result.translation) return;
        const silent = id === null;
        showEntry();
        // Sin voz, el retraso es hasta que aparece el subtítulo.
        if (silent) {
          patchEntry(lane.direction, id, {
            lagSecs: (performance.now() - info.endedAt) / 1000,
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
        runtime.current[lane.direction].capture = await startAutoCapture(lane.inputDeviceId, {
          // El micrófono necesita ganancia automática; BlackHole no la tolera.
          // En Tomar notas, también el micrófono de una reunión en persona.
          autoGain: lane.direction === "local_to_remote" || (Boolean(lane.notes) && lane.inputDeviceId !== SYSTEM_AUDIO),
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

  const remoteLane = /** @type {Lane} */ (lanes.find((l) => l.direction === "remote_to_local"));
  const remoteState = state.remote_to_local;

  const { inputs, outputs } = devices;
  // En modo vídeo solo se traduce lo que se oye.
  const visible = mode !== "call" ? lanes.filter((l) => l.direction === "remote_to_local") : lanes;
  const running = lanes.filter((l) => state[l.direction].running || state[l.direction].starting);
  const anyRunning = running.length > 0;
  anyRunningRef.current = anyRunning;
  // Tomar notas en una reunión en línea: los dos carriles a la vez.
  const localState = state.local_to_remote;
  const meetingNotes = useMeetingNotes({
    mode,
    meeting,
    remoteLane,
    localLane: /** @type {Lane} */ (lanes.find((l) => l.direction === "local_to_remote")),
    state,
    lanesRef,
    runtime,
    start,
    stop,
    stopping,
  });
  const { inMeeting } = meetingNotes;
  // In Take notes the floating ▶ / ❚❚ starts and stops the whole note (both lanes in a meeting).
  const { toggleFloating } = useFloatingCaptions(
    mode === "notes"
      ? {
          floating,
          setFloating,
          remoteLane,
          remoteState,
          // The privacy notice is only shown on the Take notes screen.
          start: async () => void (loadNotesConsent() && meetingNotes.startNotes()),
          stop: async () => meetingNotes.stopNotes(),
        }
      : { floating, setFloating, remoteLane, remoteState, start, stop },
  );

  // Al parar (o al volver de Ajustes), el interruptor vuelve al ajuste guardado.
  useEffect(() => {
    if (!anyRunning) setSaveNotes(loadSaveNotes());
  }, [anyRunning, view]);

  // Parado un rato, los modelos se sueltan: ocupan ~2 GB de memoria. Se
  // vuelven a cargar al empezar (~1–2 s).
  useEffect(() => {
    if (anyRunning) return;
    const timer = window.setTimeout(() => api.releaseModels().catch(() => {}), RELEASE_MODELS_MS);
    return () => window.clearTimeout(timer);
  }, [anyRunning]);

  // Cada vez que algo se pone en marcha empieza una nota nueva; al parar se
  // guarda (las frases que aún suenan en la cola se añaden después).
  // En Tomar notas la nota se graba siempre, y al parar se espera a que la cola
  // termine (con tope) para cerrarla y abrirla ya completa y con las personas repasadas.
  // Antes de pintar: si no, al parar asoman un instante las opciones de Tomar notas.
  useLayoutEffect(() => {
    if (anyRunning) {
      const recorder = createRecorder({ mode, summaryLang: loadNotesLang(), paused: mode !== "notes" && !loadSaveNotes() });
      // Reunión en línea: lo que tu micrófono oyó de los demás no es tuyo.
      recorderRef.current = meetingNotes.wrapRecorder(recorder);
      return;
    }
    const recorder = recorderRef.current;
    if (mode !== "notes") {
      recorder?.finish();
      return;
    }
    if (!recorder) return;
    // En una reunión en línea también el micrófono.
    const rts = [runtime.current.remote_to_local, runtime.current.local_to_remote];
    setClosing(true);
    const settled = (async () => {
      // `capture.stop()` entrega el último trozo; después, lo que ya encadena el carril.
      await stopping.current;
      await Promise.all(rts.flatMap((rt) => [rt.texting, rt.playback]));
    })();
    let timer = 0;
    const cap = new Promise((resolve) => (timer = window.setTimeout(resolve, NOTES_SETTLE_MS)));
    Promise.race([settled, cap])
      .then(() => {
        window.clearTimeout(timer);
        return recorder.finish();
      })
      .then((id) => {
        // Sin frases no hay nota: se queda en la pantalla del modo.
        if (!id) return;
        setView("notes");
        setOpenRequest({ id, nonce: Date.now() });
      })
      // Después de cambiar de pantalla: si no, las opciones de Tomar notas asoman un instante.
      .finally(() => setClosing(false));
  }, [anyRunning]);
  // Con un solo carril en marcha, ese ocupa casi todo el ancho y el otro se
  // queda en su control: los subtítulos necesitan el espacio.
  const focused = mode === "call" && running.length === 1 ? running[0].direction : null;
  // Antes de empezar, lo que hay conectado, para la pista de Reunión en línea.
  const shownRoute = useAudioRoute(mode === "notes" && !anyRunning && view === "translate");
  const tapsMac = laneSettings.find((l) => l.direction === "remote_to_local")?.inputDeviceId === SYSTEM_AUDIO;

  return (
    <>
    <main className="app" hidden={view !== "translate"}>
      <TopBar
        modeRef={modeRef}
        mode={mode}
        onMode={changeMode}
        callMode={CALL_MODE}
        running={anyRunning}
        onMenu={() => setMenuOpen(true)}
        pair={pair}
        languages={shownLanguages}
        onPair={changePair}
        noTranslate={noTranslate}
      />

      {/* Aquí solo si algo falla; el detalle está en Ajustes. */}
      <Diagnostics mode={mode === "call" ? "call" : "video"} systemAudio={tapsMac} onFixed={loadDevices} onlyProblems />

      {/* In Take notes, My notes is as wide as the mode selector above it. */}
      <div key={mode} className={styles.modeBody} style={modeWidth ? { "--mode-w": `${modeWidth}px` } : undefined}>
        {mode === "notes" ? (
          <NoteTaking
            running={remoteState.running}
            starting={remoteState.starting || localState.starting}
            closing={closing}
            error={remoteState.error}
            micError={meetingNotes.micError}
            heard={[...remoteState.heard, ...(inMeeting ? localState.heard : [])]}
            partial={remoteState.partial || (inMeeting ? localState.partial : "")}
            noSignal={Boolean(remoteState.running && meters.remote_to_local && meters.remote_to_local.silentSecs > NO_SIGNAL_SECS)}
            input={notesInput}
            onInput={changeNotesInput}
            listen={notesListen}
            onListen={changeNotesListen}
            systemAudio={systemAudio}
            languages={shownLanguages}
            route={shownRoute}
            onOpenSettings={() => setView("settings")}
            captions={notesCaptions}
            onCaptions={changeNotesCaptions}
            floating={floating}
            onFloating={toggleFloating}
            onStart={meetingNotes.startNotes}
            onStop={meetingNotes.stopNotes}
            notesActions={notesActions}
          />
        ) : (
          <div className={cx("lanes", mode === "video" && "single", focused && FOCUS_CLASS[focused])}>
            {visible.map((lane) => (
              <LaneCard
                key={lane.direction}
                lane={lane}
                compact={Boolean(focused) && focused !== lane.direction}
                original={mode === "video" && lane.direction === "remote_to_local" ? noTranslate : undefined}
                onOriginal={changeNoTranslate}
                state={state[lane.direction]}
                meter={meters[lane.direction]}
                volume={volumes[lane.direction]}
                inputs={inputs}
                onOpenSettings={() => setView("settings")}
                onToggle={() => (state[lane.direction].running ? stop(lane) : start(lane))}
                onChange={(patch) => updateLane(lane.direction, patch)}
                onVolume={(v) => changeVolume(lane.direction, v)}
                saveNotes={lane.direction === "remote_to_local" ? saveNotes : undefined}
                onSaveNotes={changeSaveNotes}
                floating={lane.direction === "remote_to_local" ? floating : undefined}
                onFloating={toggleFloating}
                multiVoice={lane.direction === "remote_to_local" ? multiVoice : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </main>
    <Notes visible={view === "notes"} recording={anyRunning} languages={shownLanguages} onMenu={() => setMenuOpen(true)} openRequest={openRequest} />
    {view === "settings" && (
      <Settings
        mode={mode === "call" ? "call" : "video"}
        systemAudio={tapsMac}
        recording={anyRunning}
        languages={shownLanguages}
        onFixed={loadDevices}
        onMenu={() => setMenuOpen(true)}
        // En Tomar notas la entrada del carril es la que se eligió allí: aquí van
        // los dispositivos guardados de Escuchar, para que no desaparezcan.
        lanes={(mode === "notes"
          ? laneSettings.filter((l) => l.direction === "remote_to_local").map((l) => ({ ...l, title: t(`lanes.${l.direction}.title`) }))
          : visible
        ).map((lane) => ({
          key: lane.direction,
          title: lane.title,
          subtitle: t(`lanes.${lane.direction}.settingsSubtitle`),
          content: (
            <LaneSettings
              lane={lane}
              running={state[lane.direction].running}
              inputs={inputs}
              outputs={outputs}
              systemAudio={systemAudio}
              onChange={(patch) => updateLane(lane.direction, patch)}
            />
          ),
        }))}
      />
    )}
    <Sidebar open={menuOpen} view={view} recording={anyRunning} onSelect={setView} onClose={closeMenu} />
    </>
  );
}

