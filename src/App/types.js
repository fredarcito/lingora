// Los tipos de la pantalla Traducir (solo JSDoc), para App y las piezas de cada carril.

/**
 * @typedef {"remote_to_local" | "local_to_remote"} Direction
 *
 * @typedef {Object} Lane
 * @property {Direction} direction
 * @property {string} title
 * @property {string} subtitle
 * @property {string} sourceLang Código del idioma de origen ("EN"); lo elige el usuario.
 * @property {string} targetLang Código del idioma de destino ("ES"); lo elige el usuario.
 * @property {string} inputDeviceId ID del WebView para la entrada (BlackHole o micrófono), o
 *   `SYSTEM_AUDIO` para el audio del Mac sin BlackHole.
 * @property {string} outputDevice Nombre de Core Audio de la salida donde se oye la traducción.
 * @property {"female" | "male"} voice Voz de la traducción.
 * @property {Record<string, string>} voiceIds Voz concreta elegida por idioma
 *   de destino (`VoiceInfo.id`); sin ella, la mejor del género.
 * @property {number} maxSpeed Velocidad máxima de la voz cuando hay retraso (1 = nunca acelera).
 * @property {boolean} speak Decir la traducción en voz alta. Sin voz solo hay
 *   subtítulos: se oye el original y no se acumula retraso (el español dura
 *   más que el inglés). Se lee en cada trozo.
 * @property {boolean} [canListen] El idioma que se oye se puede escuchar en local (Parakeet o SenseVoice).
 * @property {{ female: boolean, male: boolean }} [voices] Qué voces hay en este equipo para el idioma de la traducción.
 * @property {boolean} [notes] Es el carril de Tomar notas: sin traducir, sin voz y sin precargar la voz.
 * @property {boolean} [showSource] Mostrar el texto original encima de cada
 *   traducción. Sin elegir, se muestra solo con voz: con solo subtítulos se
 *   quiere leer la traducción, no el original.
 *
 * @typedef {import("../utils/api").Transcription & import("../utils/api").Translation & { id: number, lagSecs: number | null, skipped?: boolean, silent?: boolean, captionKey?: number }} Entry
 *
 * @typedef {Object} LaneState
 * @property {boolean} running
 * @property {boolean} starting Cargando el modelo de voz y abriendo la entrada.
 * @property {string | null} error
 * @property {number} pending Frases detectadas que aún no han terminado de sonar.
 * @property {Entry[]} history Más reciente primero.
 * @property {Array<{ key: number, text: string }>} heard Frases ya cortadas que
 *   se están traduciendo, tal como las entendió la escucha local.
 * @property {string} partial La frase en curso, mientras se habla.
 * @property {{ key: number, text: string, source?: string } | null} draft Sin voz: la
 *   traducción que se está escribiendo, para que el subtítulo avance palabra
 *   a palabra en vez de aparecer de golpe.
 */

/**
 * Vídeo: solo se traduce lo que se oye. Llamada: también tu micrófono, para
 * la otra persona. Notas: se transcribe lo que se oye sin traducir ni hablar.
 * @typedef {"video" | "call" | "notes"} Mode
 */

/**
 * Los idiomas de la conversación: el tuyo y el de la otra persona. Los dos
 * carriles los usan, uno en cada sentido, así que no pueden contradecirse.
 * @typedef {{ you: string, them: string }} LangPair
 */

export {};
