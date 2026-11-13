import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * @typedef {Object} VirtualMicStatus
 * @property {boolean} available The app carries the driver (only on the Mac).
 * @property {boolean} installed It is in the audio plug-ins folder.
 * @property {boolean} active macOS already shows the device.
 */

/**
 * @typedef {Object} OwnVoiceStatus "Your voice" (Settings → Speak): docs/plan-tu-voz.md.
 * @property {boolean} model_installed
 * @property {number} model_bytes Size of the download.
 * @property {number} sample_secs Seconds of the saved recording; 0 without one.
 * @property {string[]} langs App codes of the languages it speaks.
 */

/**
 * @typedef {Object} ModelStatus
 * @property {string} id Same id as its diagnostics check.
 * @property {boolean} required Cannot start without it.
 * @property {boolean} installed
 * @property {boolean} partial A download is partly done.
 * @property {number} approx_bytes
 */

/**
 * @typedef {Object} OnDisk Something downloaded, for Settings → Disk space.
 * @property {string} id The model's id (as its diagnostics check) or, for a leftover, its file name.
 * @property {boolean} obsolete Left by an older version; nothing uses it.
 * @property {"" | "translator" | "voice"} was What a leftover was, when known.
 * @property {boolean} required Cannot listen or translate without it.
 * @property {boolean} partial Only a download left halfway.
 * @property {number} bytes
 */

/**
 * @typedef {Object} VoiceInfo
 * @property {string} id "supertonic:5", "piper:<model>:<speaker>", "system:<identifier>" or "own".
 * @property {string} name The voice's name, or the number (1–5) of a natural voice within its gender.
 * @property {"own" | "supertonic" | "piper" | "system"} engine Your voice, natural, light or system voice.
 * @property {"female" | "male" | null} gender
 * @property {string} detail Country and quality ("México · Premium"), or empty.
 */

/**
 * @typedef {Object} LightVoice A light voice of the catalogue, downloaded or not.
 * @property {string} id What `speak` gets ("piper:es_ES-sharvard-medium:1").
 * @property {string} model What `downloadModel` gets; several voices can share one download.
 * @property {string} name
 * @property {"female" | "male"} gender
 * @property {string} detail The country ("España").
 * @property {boolean} installed
 * @property {number} bytes Size of the download.
 */

/**
 * @typedef {Object} VoiceDownloads What can be downloaded to give a language a voice (docs/plan-voz-ligera.md).
 * @property {boolean} light_recommended Low-end computer: the light voice goes first.
 * @property {boolean} natural The natural voice speaks the language.
 * @property {boolean} natural_installed
 * @property {number} natural_bytes One download for all its languages.
 * @property {LightVoice[]} light
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
 * @property {Uint8Array} [source_wav] The chunk's audio (WAV 16 kHz) for Details;
 *   only the latest entries keep it (`addToHistory`).
 * @property {number} source_duration_secs Duration of that audio in seconds.
 *
 * @typedef {Object} Translation
 * @property {string} translation
 * @property {number} translate_ms
 *
 * @typedef {Object} Speech
 * @property {Float32Array} audio Mono samples.
 * @property {number} sample_rate
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
 * @property {string} [summary_template] Summary template id (`SUMMARY_TEMPLATES`); without it, "general".
 * @property {Record<string, string>} speakers Name of each speaker ("1": "Ana").
 * @property {NoteSentence[]} sentences
 * @property {{ at: number, secs: number }[]} [gaps] Unsaved gaps: before sentence `at`, and how long they lasted.
 * @property {MyNote[]} [my_notes] What the user wrote while recording (Take notes), ordered by `t`.
 * @property {{ t: number }[]} [bookmarks] Moments the user marked while recording, ordered by `t`.
 * @property {boolean} [summary_with_notes] The summary also uses `my_notes` (off by default: they may be private).
 * @property {{ role: "user" | "assistant", text: string, at: string }[]} [chat] The conversation with the note (Chat tab).
 * @property {{ text: string, map?: string, template?: string, created_at: string } | null} summary `map`: the same lists in short,
 *   for the mind map (summaries made before it have none). `template`: the one it was made with; without it, "general".
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
 * @property {string[]} [speaker_names] Names given to the people (not "Yo"), to suggest them in other notes.
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

/**
 * The answer of `notesChat`.
 * @typedef {{ text: string, overview: boolean, notes: import("@utils/chat.js").UsedNote[],
 *   citations: import("@utils/chat.js").Citation[], invented: number, basis: { shown: number, total: number } | null,
 *   notice: { kind: "clarify", ask: string } | { kind: "ambiguous", person: string, names: string[] }
 *     | { kind: "no_person", person: string } | { kind: "vague" | "nothing_found" | "no_notes" } | null }} NotesAnswer
 */

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
   * It comes raw, not as JSON (`Speech::to_bytes` in Rust): sample rate and
   * synthesis ms (u32 LE), then the samples (f32 LE).
   * @returns {Promise<Speech>}
   */
  speak: async (text, lang, voice, speed = 1.0, voiceId = null, hq = false) => {
    /** @type {ArrayBuffer | number[]} */
    const data = await invoke("speak", { text, lang, voice, speed, voiceId, hq });
    const buffer = data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer;
    const head = new DataView(buffer, 0, 8);
    return { sample_rate: head.getUint32(0, true), tts_ms: head.getUint32(4, true), audio: new Float32Array(buffer, 8) };
  },
  /**
   * The voices that can be chosen for a language: Lingora's and the system ones.
   * @param {Lang} lang
   * @returns {Promise<VoiceInfo[]>}
   */
  voices: (lang) => invoke("voices", { lang }),
  /**
   * What can be downloaded to give the language a voice, and which kind this computer should use.
   * @param {Lang} lang @returns {Promise<VoiceDownloads>}
   */
  voiceDownloads: (lang) => invoke("voice_downloads", { lang }),
  /** @returns {Promise<OwnVoiceStatus>} */
  ownVoiceStatus: () => invoke("own_voice_status"),
  /**
   * Keeps a new recording of your voice in place of the old one. Raw: sample
   * rate (u32 LE), then the samples (f32 LE).
   * @param {Float32Array} samples @param {number} sampleRate
   * @returns {Promise<"silent" | "too_short" | null>} Why it was not kept, or null.
   */
  saveOwnVoice: (samples, sampleRate) => {
    const body = new Uint8Array(4 + samples.length * 4);
    new DataView(body.buffer).setUint32(0, sampleRate, true);
    new Float32Array(body.buffer, 4, samples.length).set(samples);
    return invoke("save_own_voice", body);
  },
  /**
   * The saved recording of your voice, to hear it back. Raw: sample rate (u32 LE), then the samples (f32 LE).
   * @returns {Promise<{ audio: Float32Array, sample_rate: number }>}
   */
  ownVoiceSample: async () => {
    /** @type {ArrayBuffer | number[]} */
    const data = await invoke("own_voice_sample");
    const buffer = data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer;
    return { sample_rate: new DataView(buffer, 0, 4).getUint32(0, true), audio: new Float32Array(buffer, 4) };
  },
  /** @returns {Promise<void>} */
  deleteOwnVoice: () => invoke("delete_own_voice"),
  /** Low-end computer: the light voice is recommended. @returns {Promise<boolean>} */
  lightDevice: () => invoke("light_device"),
  /** The natural voice is in use and can't keep up on this computer. @returns {Promise<boolean>} */
  voiceStruggling: () => invoke("voice_struggling"),
  /**
   * Plays the voice on an output (by name; "" = system output) and
   * resolves when it finishes playing. Raw, like `listen`: sample rate (u32
   * LE), volume (f32 LE), sample count (u32 LE), the samples (f32 LE) and the
   * device name (UTF-8, to the end; not a header, which only takes ASCII).
   * @param {Float32Array | number[]} samples @param {number} sampleRate @param {string} deviceName
   * @param {number} [volume] Gain: 1 = original, up to 2.
   * @returns {Promise<void>}
   */
  playAudio: (samples, sampleRate, deviceName, volume = 1) => {
    const name = new TextEncoder().encode(deviceName);
    const body = new Uint8Array(12 + samples.length * 4 + name.length);
    const head = new DataView(body.buffer);
    head.setUint32(0, sampleRate, true);
    head.setFloat32(4, volume, true);
    head.setUint32(8, samples.length, true);
    new Float32Array(body.buffer, 12, samples.length).set(samples);
    body.set(name, 12 + samples.length * 4);
    return invoke("play_audio", body);
  },
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
  /** Lingora Mic, the virtual microphone for calls. @returns {Promise<VirtualMicStatus>} */
  virtualMicStatus: () => invoke("virtual_mic_status"),
  /**
   * Installs it behind macOS's password window and restarts the Mac's audio.
   * Closing the window leaves the status as it was. @returns {Promise<VirtualMicStatus>}
   */
  virtualMicInstall: () => invoke("virtual_mic_install"),
  /** @returns {Promise<VirtualMicStatus>} */
  virtualMicUninstall: () => invoke("virtual_mic_uninstall"),
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
   * Opens a microphone in Rust with echo cancellation: what plays on the
   * speakers is removed. The blocks arrive like `systemAudioStart`'s.
   * @param {string} device The device's name; "" for the default one.
   * @param {boolean} autoGain
   * @param {(samples: Float32Array) => void} onBlock
   * @returns {Promise<number>} The sample rate.
   */
  micStart: (device, autoGain, onBlock) => {
    const channel = new Channel();
    channel.onmessage = (data) =>
      onBlock(new Float32Array(data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer));
    return invoke("mic_start", { device, autoGain, onAudio: channel });
  },
  /** @returns {Promise<void>} */
  micStop: () => invoke("mic_stop"),
  /**
   * Logs a UI error to the log (on Windows, a .txt on the desktop).
   * @param {string} message
   * @returns {Promise<void>}
   */
  logUi: (message) => invoke("log_ui", { message }),
  /**
   * Logs a UI measurement (voice lag, skipped sentences, start time). Not an error.
   * @param {string} message
   * @returns {Promise<void>}
   */
  logUiEvent: (message) => invoke("log_ui_event", { message }),
  /** App languages and which voices this machine has. @returns {Promise<LanguageInfo[]>} */
  languages: () => invoke("languages"),
  /**
   * Which models are downloaded (for the welcome screen).
   * @returns {Promise<ModelStatus[]>}
   */
  setupStatus: () => invoke("setup_status"),
  /**
   * What is downloaded on this computer: the models and what older versions left.
   * @returns {Promise<OnDisk[]>}
   */
  storageStatus: () => invoke("storage_status"),
  /**
   * Deletes something downloaded (by its `OnDisk.id`) and returns the updated list.
   * @param {string} id @returns {Promise<OnDisk[]>}
   */
  removeDownload: (id) => invoke("remove_download", { id }),
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
  /**
   * Writes the note's mind map (PNG) to Downloads and shows it in Finder.
   * @param {string} id @param {Uint8Array} png
   * @returns {Promise<string>} The file path.
   */
  noteExportImage: (id, png) => invoke("note_export_image", { id, png: Array.from(png) }),
  /**
   * Summarizes the note and saves the summary in it: on the computer (the
   * summary model must be downloaded) or, with `cloud`, with the user's key.
   * @param {string} id @param {import("@utils/summarySource.js").CloudRequest | null} [cloud]
   * @returns {Promise<string>} The summary in Markdown.
   */
  noteSummarize: (id, cloud = null) => invoke("note_summarize", { id, cloud }),
  /**
   * Answers the last message of `messages` about the note: on the computer or,
   * with `cloud`, with the user's key. The answer arrives in pieces through
   * `onToken`; the promise resolves with all of it (also if it was stopped).
   * Pass the history exactly as it was returned (`requestTurns`).
   * @param {string} id @param {{ role: "user" | "assistant", text: string }[]} messages
   * @param {import("@utils/summarySource.js").CloudRequest | null} cloud @param {(piece: string) => void} onToken
   * @returns {Promise<string>}
   */
  noteChat: (id, messages, cloud, onToken) => {
    const channel = new Channel();
    channel.onmessage = onToken;
    return invoke("note_chat", { id, messages, cloud, onToken: channel });
  },
  /** Stops the chat answer in progress; `noteChat` resolves with what was written. @returns {Promise<void>} */
  chatStop: () => invoke("chat_stop"),
  /**
   * Answers the last message of `messages` from all the notes (the Chat
   * page): it picks the notes, and the answer arrives in pieces through
   * `onToken`. `today` is the local date (`localDate()`); `noteIds`, the notes
   * the user chose for this question (they skip the choosing). With a
   * `notice` nothing was asked to the model (the interface says why).
   * @param {{ role: "user" | "assistant", text: string }[]} messages @param {string} today
   * @param {import("@utils/summarySource.js").CloudRequest | null} cloud @param {string[] | null} noteIds
   * @param {(piece: string) => void} onToken
   * @returns {Promise<NotesAnswer>}
   */
  notesChat: (messages, today, cloud, noteIds, onToken) => {
    const channel = new Channel();
    channel.onmessage = onToken;
    return invoke("notes_chat", { messages, today, cloud, noteIds, onToken: channel });
  },
  /** The saved all-notes chats, most recently used first. @returns {Promise<{ id: string, title: string, updated_at: string }[]>} */
  chatsList: () => invoke("chats_list"),
  /** @param {string} id @returns {Promise<import("@utils/chat.js").SavedChat>} */
  chatRead: (id) => invoke("chat_read", { id }),
  /** Creates or replaces a saved chat (`chat.id` is its file). @param {import("@utils/chat.js").SavedChat} chat @returns {Promise<void>} */
  chatSave: (chat) => invoke("chat_save", { chat }),
  /** @param {string} id @returns {Promise<void>} */
  chatDelete: (id) => invoke("chat_delete", { id }),
  /**
   * Where a service's key is: in the keychain, in the development environment or nowhere.
   * @param {string} provider @returns {Promise<"keychain" | "env" | "none">}
   */
  summaryKeyStatus: (provider) => invoke("summary_key_status", { provider }),
  /**
   * Checks the key with the service and saves it in the keychain (a custom
   * server is checked at `baseUrl`; without a key nothing is saved).
   * @param {string} provider @param {string} key @param {string} [baseUrl]
   * @returns {Promise<string[]>} The account's models that write text (empty if a custom server has no list).
   */
  summaryKeySet: (provider, key, baseUrl) => invoke("summary_key_set", { provider, key, baseUrl: baseUrl || null }),
  /**
   * The models of a service whose key is already saved (or of the custom server).
   * @param {string} provider @param {string} [baseUrl] @returns {Promise<string[]>}
   */
  summaryModels: (provider, baseUrl) => invoke("summary_models", { provider, baseUrl: baseUrl || null }),
  /**
   * The end of the saved key ("…a1B2"), to show which one it is; null without one.
   * @param {string} provider @returns {Promise<string | null>}
   */
  summaryKeyHint: (provider) => invoke("summary_key_hint", { provider }),
  /** Deletes a service's key from the keychain. @param {string} provider @returns {Promise<void>} */
  summaryKeyClear: (provider) => invoke("summary_key_clear", { provider }),
  /** Opens in the browser the page where the service's key is created. @param {string} provider @returns {Promise<void>} */
  summaryKeyHelp: (provider) => invoke("summary_key_help", { provider }),
  /** The computer's RAM in GB, or null if unknown. @returns {Promise<number | null>} */
  systemMemory: () => invoke("system_memory"),
};
