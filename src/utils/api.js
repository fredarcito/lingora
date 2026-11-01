import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * @typedef {Object} ModelStatus
 * @property {string} id Same id as its diagnostics check.
 * @property {boolean} required Cannot start without it.
 * @property {boolean} installed
 * @property {boolean} partial A download is partly done.
 * @property {number} approx_bytes
 */

/**
 * @typedef {Object} VoiceInfo
 * @property {string} id "supertonic:5" or "system:<identifier>".
 * @property {string} name The system voice's name, or the number (1–5) of a Lingora voice within its gender.
 * @property {"supertonic" | "system"} engine
 * @property {"female" | "male" | null} gender
 * @property {string} detail Country and quality ("México · Premium"), or empty.
 */

/**
 * @typedef {"remote_to_local" | "local_to_remote"} Direction
 * App language code ("es", "ja", "zh-hant"…); the list comes from `languages`.
 * @typedef {string} Lang
 *
 * @typedef {Object} LanguageInfo
 * @property {Lang} code
 * @property {string} name Name in Spanish.
 * @property {boolean} parakeet Heard by Parakeet (European languages).
 * @property {boolean} can_listen Can be heard locally (Parakeet or SenseVoice); if not, it only works as the translation language.
 * @property {boolean} female_voice A female voice is available on this machine.
 * @property {boolean} male_voice A male voice is available on this machine.
 *
 * @typedef {Object} Transcription
 * @property {Direction} direction
 * @property {Lang} source_lang
 * @property {Lang} target_lang
 * @property {string} transcript
 * @property {number} stt_ms
 * @property {string} source_wav_base64 Exact audio sent to Whisper (WAV 16 kHz, base64).
 * @property {number} source_duration_secs Duration of that audio in seconds.
 *
 * @typedef {Object} Translation
 * @property {string} translation
 * @property {number} translate_ms
 *
 * @typedef {Object} Speech
 * @property {number[]} audio Mono float32 samples.
 * @property {number} sample_rate
 * @property {number} phonemize_ms
 * @property {number} tts_ms
 *
 * @typedef {Object} Word Word recognized locally, with its position in seconds.
 * @property {string} text
 * @property {number} start
 * @property {number} end
 *
 * @typedef {Object} DeviceInfo
 * @property {string} name
 * @property {string} uid
 * @property {number} input_channels
 * @property {number} output_channels
 *
 * @typedef {Object} AudioRoute What is connected for listening and speaking (Online meeting).
 * @property {"headphones" | "speakers" | "other"} output Headphones (wired, USB or
 *   Bluetooth), the Mac speakers or something else (monitor, external speaker…): with
 *   the last two, the microphone can hear the others.
 * @property {string} output_name
 * @property {string} input_name The default input.
 * @property {boolean} input_bluetooth
 * @property {boolean} input_busy Another app is already using the default input.
 * @property {string | null} builtin_mic The Mac microphone, if there is one.
 *
 * @typedef {Object} SettingsSummary
 * @property {string} stt_model
 * @property {string} translation_model
 * @property {string} espeak_bin
 * @property {string} tts_bin
 * @property {boolean} has_api_key
 * @property {boolean} local_translation Whether local translation is installed.
 *
 * @typedef {Object} Check
 * @property {string} id
 * @property {"ok" | "warning" | "error"} status
 * @property {string} title
 * @property {string} detail
 * @property {string | null} fix Text of the automatic fix button.
 *
 * @typedef {Object} NoteSentence
 * @property {number} t Seconds from `created_at` until the sentence ended.
 * @property {Direction} direction
 * @property {Lang | "auto"} source_lang "auto" in Take notes (European listening detects the language).
 * @property {Lang | "auto"} target_lang
 * @property {number | null} speaker Speaker number; null if they are not yet told apart.
 * @property {string} source
 * @property {string | null} translation Null in original mode (untranslated).
 *
 * @typedef {Object} Note A saved conversation (see docs/plan-notas.md).
 * @property {number} version
 * @property {string} id Local start date; it is the file name.
 * @property {string} title
 * @property {string} created_at ISO 8601.
 * @property {string | null} ended_at
 * @property {"video" | "call" | "notes"} mode
 * @property {"notes" | "translation"} [kind] Without it, a translation.
 * @property {string} [summary_lang] Summary language (only in Take notes).
 * @property {Record<string, string>} speakers Name of each speaker ("1": "Ana").
 * @property {NoteSentence[]} sentences
 * @property {{ at: number, secs: number }[]} [gaps] Unsaved gaps: before sentence `at`, and how long they lasted.
 * @property {MyNote[]} [my_notes] What the user wrote while recording (Take notes), ordered by `t`.
 * @property {{ t: number }[]} [bookmarks] Moments the user marked while recording, ordered by `t`.
 * @property {boolean} [summary_with_notes] The summary also uses `my_notes` (off by default: they may be private).
 * @property {{ text: string, created_at: string } | null} summary
 *
 * @typedef {Object} MyNote
 * @property {number} t Seconds, on the same clock as `sentences[].t`: when the user started writing it.
 * @property {string} text
 *
 * @typedef {Object} NoteSummary The minimum of a note needed to list and search it.
 * @property {string} id
 * @property {string} title
 * @property {string} created_at
 * @property {string | null} ended_at
 * @property {number} sentences
 * @property {boolean} has_summary
 * @property {"notes" | "translation"} [kind]
 * @property {string} preview First ~200 characters, for searching.
 * @property {string | null} [source_lang] Languages of the first sentence.
 * @property {string | null} [target_lang]
 * @property {string | null} [summary_line] The first sentence of the summary, if any.
 *
 * @typedef {"keychain" | "env" | "none"} SummaryKeyStatus Where the key for
 *   Groq summaries is stored: in the keychain, in the development environment
 *   (`GROQ_API_KEY`) or nowhere.
 *
 * @typedef {Object} AppError
 * @property {string} kind
 * @property {string} message
 */

/** @param {unknown} e @returns {e is AppError} */
export function isAppError(e) {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** @param {unknown} e @returns {string} */
export function errorMessage(e) {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const api = {
  /**
   * Transcribes a piece of audio.
   * @param {Uint8Array} wav @param {Direction} direction
   * @param {Lang} source @param {Lang} target
   * @param {string} [prompt] What was transcribed just before in this lane.
   * @returns {Promise<Transcription>}
   */
  transcribe: (wav, direction, source, target, prompt = "") =>
    invoke("transcribe", { wav: Array.from(wav), direction, source, target, prompt }),
  /**
   * Translates text already transcribed. The translation arrives in chunks via `onDelta`
   * as the model writes it; the promise resolves with the full text.
   * @param {string} text @param {Lang} source @param {Lang} target
   * @param {string} [context] Previous text of the lane, for reference only.
   * @param {(delta: string) => void} [onDelta]
   * @param {boolean} [concise] Condensed translation (no filler words), so that
   *   the voice does not fall behind.
   * @param {boolean} [local] Translates locally (Index-Translate) instead of Groq; without
   *   context or condensing.
   * @returns {Promise<Translation>}
   */
  translate: (text, source, target, context = "", onDelta = () => {}, concise = false, local = false) => {
    const channel = new Channel();
    channel.onmessage = onDelta;
    return invoke("translate", { text, source, target, context, concise, local, onDelta: channel });
  },
  /**
   * Starts local translation and loads the model (~1 s).
   * @returns {Promise<boolean>} Whether it is available.
   */
  translateWarmUp: () => invoke("translate_warm_up"),
  /**
   * Synthesizes speech for a text fragment.
   * @param {string} text @param {Lang} lang @param {"female" | "male"} voice
   * @param {number} [speed] Voice speed; > 1 when there are sentences queued.
   * @param {string | null} [voiceId] A specific voice (`VoiceInfo.id`); without
   *   it, the best one for the gender.
   * @param {boolean} [hq] Higher-quality Lingora voice (slightly slower).
   * @returns {Promise<Speech>}
   */
  speak: (text, lang, voice, speed = 1.0, voiceId = null, hq = false) => invoke("speak", { text, lang, voice, speed, voiceId, hq }),
  /**
   * The voices that can be chosen for a language: Lingora's and the system ones.
   * @param {Lang} lang
   * @returns {Promise<VoiceInfo[]>}
   */
  voices: (lang) => invoke("voices", { lang }),
  /**
   * Plays the voice on an output (by name; "" = system output) and
   * resolves when it finishes playing.
   * @param {number[]} samples @param {number} sampleRate @param {string} deviceName
   * @param {number} [volume] Gain: 1 = original, up to 2.
   * @returns {Promise<void>}
   */
  playAudio: (samples, sampleRate, deviceName, volume = 1) =>
    invoke("play_audio", { samples, sampleRate, deviceName, volume }),
  /**
   * @param {boolean} full Includes dependencies (slow); without it, audio only.
   * @returns {Promise<Check[]>}
   */
  runDiagnostics: (full) => invoke("run_diagnostics", { full }),
  /** Applies an automatic fix. @param {string} id @returns {Promise<Check[]>} */
  fixDiagnostic: (id) => invoke("fix_diagnostic", { id }),
  /**
   * Loads the model that listens to the language (Parakeet or SenseVoice).
   * @param {Lang} lang
   * @returns {Promise<boolean>} Whether it is available.
   */
  listenWarmUp: (lang) => invoke("listen_warm_up", { lang }),
  /**
   * Releases the listening and translation models to free memory. They
   * reload when starting again. @returns {Promise<void>}
   */
  releaseModels: () => invoke("release_models"),
  /**
   * Recognizes the current sentence locally. It is sent raw, not as JSON: it is called
   * every half second with several seconds of audio.
   * @param {Float32Array} samples Mono 16 kHz.
   * @param {Lang} lang Language being heard: picks the model.
   * @returns {Promise<Word[]>}
   */
  listen: (samples, lang) =>
    invoke("listen", new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), { headers: { lang } }),
  /**
   * Voice fingerprint of a sentence, to tell who is speaking in the notes.
   * Raw, like `listen`.
   * @param {Float32Array} samples Mono 16 kHz.
   * @returns {Promise<number[]>}
   */
  voicePrint: (samples) => invoke("voice_print", new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)),
  /** Loads the voice model before the first sentence. @returns {Promise<void>} */
  warmUp: () => invoke("warm_up"),
  /**
   * Outside the Mac, Rust does not list the devices yet: the WebView ones are used
   * (without the «default» and «communications» entries, which repeat another).
   * @returns {Promise<DeviceInfo[]>}
   */
  listAudioDevices: () =>
    invoke("list_audio_devices").catch(async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.label && d.kind !== "videoinput" && d.deviceId !== "default" && d.deviceId !== "communications")
        .map((d) => ({
          name: d.label,
          uid: d.deviceId,
          input_channels: d.kind === "audioinput" ? 1 : 0,
          output_channels: d.kind === "audiooutput" ? 1 : 0,
        })),
    ),
  /** @returns {Promise<AudioRoute>} */
  audioRoute: () => invoke("audio_route"),
  /**
   * Whether this Mac can capture its audio without BlackHole (macOS 14.2+).
   * @returns {Promise<boolean>}
   */
  systemAudioSupported: () => invoke("system_audio_supported"),
  /**
   * Captures what plays on the Mac, except Lingora itself. The blocks
   * arrive raw (mono float32).
   * @param {(samples: Float32Array) => void} onBlock
   * @returns {Promise<number>} The sample rate.
   */
  systemAudioStart: (onBlock) => {
    const channel = new Channel();
    channel.onmessage = (data) =>
      onBlock(new Float32Array(data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer));
    return invoke("system_audio_start", { onAudio: channel });
  },
  /** @returns {Promise<void>} */
  systemAudioStop: () => invoke("system_audio_stop"),
  /**
   * Logs a UI error to the log (on Windows, a .txt on the desktop).
   * @param {string} message
   * @returns {Promise<void>}
   */
  logUi: (message) => invoke("log_ui", { message }),
  /** App languages and which voices this machine has. @returns {Promise<LanguageInfo[]>} */
  languages: () => invoke("languages"),
  /**
   * Which models are downloaded (for the welcome screen).
   * @returns {Promise<ModelStatus[]>}
   */
  setupStatus: () => invoke("setup_status"),
  /**
   * Downloads a model; resumes where it left off if interrupted.
   * @param {string} id @param {(p: { downloaded: number, total: number }) => void} onProgress
   * @returns {Promise<void>}
   */
  downloadModel: (id, onProgress) => {
    const channel = new Channel();
    channel.onmessage = onProgress;
    return invoke("download_model", { id, onProgress: channel });
  },
  /** Opens (or shows) the floating captions window. @returns {Promise<void>} */
  openCaptions: () => invoke("open_captions"),
  /** @returns {Promise<SettingsSummary>} */
  settingsSummary: () => invoke("settings_summary"),
  /** Saved notes, from newest to oldest. @returns {Promise<NoteSummary[]>} */
  notesList: () => invoke("notes_list"),
  /** @param {string} id @returns {Promise<Note>} */
  noteRead: (id) => invoke("note_read", { id }),
  /** Creates or replaces the note (`note.id` is the file). @param {Note} note @returns {Promise<void>} */
  noteSave: (note) => invoke("note_save", { note }),
  /** @param {string} id @returns {Promise<void>} */
  noteDelete: (id) => invoke("note_delete", { id }),
  /** Shows the note's file in Finder. @param {string} id @returns {Promise<void>} */
  noteReveal: (id) => invoke("note_reveal", { id }),
  /**
   * Writes the note to Downloads and shows it in Finder.
   * @param {string} id @param {"md" | "txt"} format
   * @returns {Promise<string>} The file path.
   */
  noteExport: (id, format) => invoke("note_export", { id, format }),
  /** @returns {Promise<SummaryKeyStatus>} */
  summaryKeyStatus: () => invoke("summary_key_status"),
  /**
   * Checks the Groq key and saves it in the Mac keychain.
   * @param {string} key @returns {Promise<void>}
   */
  summaryKeySet: (key) => invoke("summary_key_set", { key }),
  /** Deletes the key from the keychain. @returns {Promise<void>} */
  summaryKeyClear: () => invoke("summary_key_clear"),
  /** Opens in the browser the page where the Groq key is created. @returns {Promise<void>} */
  summaryKeyHelp: () => invoke("summary_key_help"),
  /**
   * Summarizes the note with AI and saves the summary in it.
   * @param {string} id @returns {Promise<string>} The summary in Markdown.
   */
  noteSummarize: (id) => invoke("note_summarize", { id }),
};
