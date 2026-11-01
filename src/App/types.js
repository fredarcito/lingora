// The types of the Translate screen (JSDoc only), for App and the pieces of each lane.

/**
 * @typedef {"remote_to_local" | "local_to_remote"} Direction
 *
 * @typedef {Object} Lane
 * @property {Direction} direction
 * @property {string} title
 * @property {string} subtitle
 * @property {string} sourceLang Source language code ("EN"); the user chooses it.
 * @property {string} targetLang Target language code ("ES"); the user chooses it.
 * @property {string} inputDeviceId WebView ID for the input (BlackHole or microphone), or
 *   `SYSTEM_AUDIO` for Mac audio without BlackHole.
 * @property {string} outputDevice Core Audio name of the output where the translation is heard.
 * @property {"female" | "male"} voice Voice of the translation.
 * @property {Record<string, string>} voiceIds Specific voice chosen per target language
 *   (`VoiceInfo.id`); without it, the best voice of the gender.
 * @property {number} maxSpeed Maximum speed of the voice when there is lag (1 = never speeds up).
 * @property {boolean} [voiceHq] Higher-quality Lingora voice: slightly slower to arrive. It is read in each chunk.
 * @property {boolean} speak Speak the translation aloud. Without voice there are only
 *   subtitles: the original is heard and no lag builds up (Spanish lasts
 *   longer than English). It is read in each chunk.
 * @property {boolean} [canListen] The language being heard can be listened to locally (Parakeet or SenseVoice).
 * @property {{ female: boolean, male: boolean }} [voices] Which voices exist on this device for the translation language.
 * @property {boolean} [notes] It is the Take notes lane: no translation, no voice and no voice preloading.
 * @property {boolean} [showSource] Show the original text above each
 *   translation. If not chosen, it is shown only with voice: with subtitles only
 *   the translation is meant to be read, not the original.
 *
 * @typedef {import("@utils/api").Transcription & import("@utils/api").Translation & { id: number, lagSecs: number | null, skipped?: boolean, silent?: boolean, captionKey?: number }} Entry
 *
 * @typedef {Object} LaneState
 * @property {boolean} running
 * @property {boolean} starting Loading the voice model and opening the input.
 * @property {string | null} error
 * @property {number} pending Detected sentences that have not finished playing yet.
 * @property {Entry[]} history Most recent first.
 * @property {Array<{ key: number, text: string }>} heard Sentences already split that
 *   are being translated, as the local listening understood them.
 * @property {string} partial The sentence in progress, while speaking.
 * @property {{ key: number, text: string, source?: string } | null} draft Without voice: the
 *   translation being written, so the subtitle advances word
 *   by word instead of appearing all at once.
 */

/**
 * Video: only what is heard is translated. Call: your microphone too, for
 * the other person. Notes: what is heard is transcribed without translating or speaking.
 * @typedef {"video" | "call" | "notes"} Mode
 */

/**
 * The conversation languages: yours and the other person's. Both
 * lanes use them, one in each direction, so they cannot contradict each other.
 * @typedef {{ you: string, them: string }} LangPair
 */

export {};
