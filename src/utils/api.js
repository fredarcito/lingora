import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * @typedef {Object} ModelStatus
 * @property {string} id Mismo id que su comprobación del diagnóstico.
 * @property {boolean} required Sin él no se puede empezar.
 * @property {boolean} installed
 * @property {boolean} partial Hay una descarga a medias.
 * @property {number} approx_bytes
 */

/**
 * @typedef {Object} VoiceInfo
 * @property {string} id "kokoro:em_alex" o "system:<identificador>".
 * @property {string} name
 * @property {"kokoro" | "system"} engine
 * @property {"female" | "male" | null} gender
 * @property {string} detail País y calidad ("México · Premium"), o vacío.
 */

/**
 * @typedef {"remote_to_local" | "local_to_remote"} Direction
 * Código de idioma de la app ("es", "ja", "zh-hant"…); la lista la da `languages`.
 * @typedef {string} Lang
 *
 * @typedef {Object} LanguageInfo
 * @property {Lang} code
 * @property {string} name Nombre en español.
 * @property {boolean} parakeet Lo escucha Parakeet (idiomas europeos).
 * @property {boolean} can_listen Se puede escuchar en local (Parakeet o SenseVoice); si no, solo sirve como idioma de la traducción.
 * @property {boolean} female_voice Hay voz de mujer en este equipo.
 * @property {boolean} male_voice Hay voz de hombre en este equipo.
 *
 * @typedef {Object} Transcription
 * @property {Direction} direction
 * @property {Lang} source_lang
 * @property {Lang} target_lang
 * @property {string} transcript
 * @property {number} stt_ms
 * @property {string} source_wav_base64 Audio exacto enviado a Whisper (WAV 16 kHz, base64).
 * @property {number} source_duration_secs Duración de ese audio en segundos.
 *
 * @typedef {Object} Translation
 * @property {string} translation
 * @property {number} translate_ms
 *
 * @typedef {Object} Speech
 * @property {number[]} audio Muestras mono float32.
 * @property {number} sample_rate
 * @property {number} phonemize_ms
 * @property {number} tts_ms
 *
 * @typedef {Object} Word Palabra reconocida en local, con su posición en segundos.
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
 * @typedef {Object} AudioRoute Lo que hay conectado para oír y hablar (Reunión en línea).
 * @property {"headphones" | "speakers" | "other"} output Auriculares (con cable, USB o
 *   Bluetooth), las bocinas del Mac u otra cosa (monitor, altavoz externo…): con
 *   las dos últimas el micrófono puede oír a los demás.
 * @property {string} output_name
 * @property {string} input_name La entrada por defecto.
 * @property {boolean} input_bluetooth
 * @property {boolean} input_busy Otra app ya usa la entrada por defecto.
 * @property {string | null} builtin_mic El micrófono del Mac, si lo hay.
 *
 * @typedef {Object} SettingsSummary
 * @property {string} stt_model
 * @property {string} translation_model
 * @property {string} espeak_bin
 * @property {string} tts_bin
 * @property {boolean} has_api_key
 * @property {boolean} local_translation Si la traducción local está instalada.
 *
 * @typedef {Object} Check
 * @property {string} id
 * @property {"ok" | "warning" | "error"} status
 * @property {string} title
 * @property {string} detail
 * @property {string | null} fix Texto del botón de arreglo automático.
 *
 * @typedef {Object} NoteSentence
 * @property {number} t Segundos desde `created_at` hasta que terminó la frase.
 * @property {Direction} direction
 * @property {Lang | "auto"} source_lang "auto" en Tomar notas (la escucha europea detecta el idioma).
 * @property {Lang | "auto"} target_lang
 * @property {number | null} speaker Número de persona; null si aún no se distinguen.
 * @property {string} source
 * @property {string | null} translation Null en modo original (sin traducir).
 *
 * @typedef {Object} Note Una conversación guardada (ver docs/plan-notas.md).
 * @property {number} version
 * @property {string} id Fecha local de inicio; es el nombre del archivo.
 * @property {string} title
 * @property {string} created_at ISO 8601.
 * @property {string | null} ended_at
 * @property {"video" | "call" | "notes"} mode
 * @property {"notes" | "translation"} [kind] Sin él, una traducción.
 * @property {string} [summary_lang] Idioma del resumen (solo en Tomar notas).
 * @property {Record<string, string>} speakers Nombre de cada persona ("1": "Ana").
 * @property {NoteSentence[]} sentences
 * @property {{ at: number, secs: number }[]} [gaps] Ratos sin guardar: antes de la frase `at`, y cuánto duraron.
 * @property {{ text: string, created_at: string } | null} summary
 *
 * @typedef {Object} NoteSummary Lo justo de una nota para listarla y buscar.
 * @property {string} id
 * @property {string} title
 * @property {string} created_at
 * @property {string | null} ended_at
 * @property {number} sentences
 * @property {boolean} has_summary
 * @property {"notes" | "translation"} [kind]
 * @property {string} preview Primeros ~200 caracteres, para buscar.
 * @property {string | null} [source_lang] Idiomas de la primera frase.
 * @property {string | null} [target_lang]
 * @property {string | null} [summary_line] La primera frase del resumen, si hay.
 *
 * @typedef {"keychain" | "env" | "none"} SummaryKeyStatus Dónde está la clave de
 *   Groq para resumir: en el llavero, en el entorno de desarrollo
 *   (`GROQ_API_KEY`) o en ninguna parte.
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
   * Transcribe un trozo de audio.
   * @param {Uint8Array} wav @param {Direction} direction
   * @param {Lang} source @param {Lang} target
   * @param {string} [prompt] Lo transcrito justo antes en este carril.
   * @returns {Promise<Transcription>}
   */
  transcribe: (wav, direction, source, target, prompt = "") =>
    invoke("transcribe", { wav: Array.from(wav), direction, source, target, prompt }),
  /**
   * Traduce texto ya transcrito. La traducción llega a trozos por `onDelta`
   * según la escribe el modelo; la promesa resuelve con el texto completo.
   * @param {string} text @param {Lang} source @param {Lang} target
   * @param {string} [context] Texto anterior del carril, solo como referencia.
   * @param {(delta: string) => void} [onDelta]
   * @param {boolean} [concise] Traducción condensada (sin muletillas), para que
   *   la voz no se quede atrás.
   * @param {boolean} [local] Traduce en local (HY-MT2) en vez de Groq; sin
   *   contexto ni condensar.
   * @returns {Promise<Translation>}
   */
  translate: (text, source, target, context = "", onDelta = () => {}, concise = false, local = false) => {
    const channel = new Channel();
    channel.onmessage = onDelta;
    return invoke("translate", { text, source, target, context, concise, local, onDelta: channel });
  },
  /**
   * Arranca la traducción local y carga el modelo (~1 s).
   * @returns {Promise<boolean>} Si está disponible.
   */
  translateWarmUp: () => invoke("translate_warm_up"),
  /**
   * Sintetiza la voz de un fragmento de texto.
   * @param {string} text @param {Lang} lang @param {"female" | "male"} voice
   * @param {number} [speed] Velocidad de la voz; > 1 cuando hay frases en cola.
   * @param {string | null} [voiceId] Una voz concreta (`VoiceInfo.id`); sin
   *   ella, la mejor del género.
   * @returns {Promise<Speech>}
   */
  speak: (text, lang, voice, speed = 1.0, voiceId = null) => invoke("speak", { text, lang, voice, speed, voiceId }),
  /**
   * Las voces que se pueden elegir para un idioma: Kokoro y las del sistema.
   * @param {Lang} lang
   * @returns {Promise<VoiceInfo[]>}
   */
  voices: (lang) => invoke("voices", { lang }),
  /**
   * Reproduce la voz en una salida (por nombre; "" = salida del sistema) y
   * resuelve cuando termina de sonar.
   * @param {number[]} samples @param {number} sampleRate @param {string} deviceName
   * @param {number} [volume] Ganancia: 1 = original, hasta 2.
   * @returns {Promise<void>}
   */
  playAudio: (samples, sampleRate, deviceName, volume = 1) =>
    invoke("play_audio", { samples, sampleRate, deviceName, volume }),
  /**
   * @param {boolean} full Incluye dependencias (lento); sin él, solo audio.
   * @returns {Promise<Check[]>}
   */
  runDiagnostics: (full) => invoke("run_diagnostics", { full }),
  /** Aplica un arreglo automático. @param {string} id @returns {Promise<Check[]>} */
  fixDiagnostic: (id) => invoke("fix_diagnostic", { id }),
  /**
   * Carga el modelo que escucha el idioma (Parakeet o SenseVoice).
   * @param {Lang} lang
   * @returns {Promise<boolean>} Si está disponible.
   */
  listenWarmUp: (lang) => invoke("listen_warm_up", { lang }),
  /**
   * Suelta los modelos de escucha y traducción para liberar memoria. Se
   * vuelven a cargar al empezar otra vez. @returns {Promise<void>}
   */
  releaseModels: () => invoke("release_models"),
  /**
   * Reconoce en local la frase en curso. Va en crudo, no en JSON: se llama
   * cada medio segundo con varios segundos de audio.
   * @param {Float32Array} samples Mono 16 kHz.
   * @param {Lang} lang Idioma que se oye: elige el modelo.
   * @returns {Promise<Word[]>}
   */
  listen: (samples, lang) =>
    invoke("listen", new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), { headers: { lang } }),
  /**
   * Huella de voz de una frase, para distinguir en las notas quién habla.
   * En crudo, como `listen`.
   * @param {Float32Array} samples Mono 16 kHz.
   * @returns {Promise<number[]>}
   */
  voicePrint: (samples) => invoke("voice_print", new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)),
  /** Carga el modelo de voz antes de la primera frase. @returns {Promise<void>} */
  warmUp: () => invoke("warm_up"),
  /**
   * Fuera del Mac Rust aún no lista los dispositivos: se usan los del WebView
   * (sin las entradas «default» y «communications», que repiten otro).
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
   * Si este Mac puede capturar su audio sin BlackHole (macOS 14.2+).
   * @returns {Promise<boolean>}
   */
  systemAudioSupported: () => invoke("system_audio_supported"),
  /**
   * Captura lo que suena en el Mac, menos la propia Lingora. Los bloques
   * llegan en crudo (float32 mono).
   * @param {(samples: Float32Array) => void} onBlock
   * @returns {Promise<number>} La frecuencia de muestreo.
   */
  systemAudioStart: (onBlock) => {
    const channel = new Channel();
    channel.onmessage = (data) =>
      onBlock(new Float32Array(data instanceof ArrayBuffer ? data : Uint8Array.from(data).buffer));
    return invoke("system_audio_start", { onAudio: channel });
  },
  /** @returns {Promise<void>} */
  systemAudioStop: () => invoke("system_audio_stop"),
  /** Idiomas de la app y qué voces tienen en este equipo. @returns {Promise<LanguageInfo[]>} */
  languages: () => invoke("languages"),
  /**
   * Qué modelos están descargados (para la bienvenida).
   * @returns {Promise<ModelStatus[]>}
   */
  setupStatus: () => invoke("setup_status"),
  /**
   * Descarga un modelo; sigue donde lo dejó si se cortó.
   * @param {string} id @param {(p: { downloaded: number, total: number }) => void} onProgress
   * @returns {Promise<void>}
   */
  downloadModel: (id, onProgress) => {
    const channel = new Channel();
    channel.onmessage = onProgress;
    return invoke("download_model", { id, onProgress: channel });
  },
  /** Abre (o muestra) la ventana de subtítulos flotantes. @returns {Promise<void>} */
  openCaptions: () => invoke("open_captions"),
  /** @returns {Promise<SettingsSummary>} */
  settingsSummary: () => invoke("settings_summary"),
  /** Las notas guardadas, de la más nueva a la más vieja. @returns {Promise<NoteSummary[]>} */
  notesList: () => invoke("notes_list"),
  /** @param {string} id @returns {Promise<Note>} */
  noteRead: (id) => invoke("note_read", { id }),
  /** Crea o reemplaza la nota (`note.id` es el archivo). @param {Note} note @returns {Promise<void>} */
  noteSave: (note) => invoke("note_save", { note }),
  /** @param {string} id @returns {Promise<void>} */
  noteDelete: (id) => invoke("note_delete", { id }),
  /** Muestra el archivo de la nota en Finder. @param {string} id @returns {Promise<void>} */
  noteReveal: (id) => invoke("note_reveal", { id }),
  /**
   * Escribe la nota en Descargas y la muestra en Finder.
   * @param {string} id @param {"md" | "txt"} format
   * @returns {Promise<string>} La ruta del archivo.
   */
  noteExport: (id, format) => invoke("note_export", { id, format }),
  /** @returns {Promise<SummaryKeyStatus>} */
  summaryKeyStatus: () => invoke("summary_key_status"),
  /**
   * Comprueba la clave de Groq y la guarda en el llavero del Mac.
   * @param {string} key @returns {Promise<void>}
   */
  summaryKeySet: (key) => invoke("summary_key_set", { key }),
  /** Borra la clave del llavero. @returns {Promise<void>} */
  summaryKeyClear: () => invoke("summary_key_clear"),
  /** Abre en el navegador la página donde se crea la clave de Groq. @returns {Promise<void>} */
  summaryKeyHelp: () => invoke("summary_key_help"),
  /**
   * Resume la nota con la IA y guarda el resumen en ella.
   * @param {string} id @returns {Promise<string>} El resumen en Markdown.
   */
  noteSummarize: (id) => invoke("note_summarize", { id }),
};
