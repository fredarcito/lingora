import { api } from "./api";
import { pairDevices } from "./audio";

/**
 * What is connected for listening and speaking, and what to do with it in an
 * online meeting (Take notes). Rust reads it from Core Audio (`audio_route`).
 * @typedef {import("./api").AudioRoute} AudioRoute
 */

/** How often to check what is connected. */
export const ROUTE_CHECK_MS = 2000;

/**
 * Whether the microphone can hear what plays on the Mac. Without knowing what is
 * connected, yes: removing the echo when there is none costs almost nothing.
 * @param {AudioRoute | null} route
 */
export const echoPossible = (route) => route?.output !== "headphones";

/**
 * Whether the Mac microphone will be used instead of the default one: when they are some
 * Bluetooth headphones no app uses yet. Opening them would switch them to
 * call mode and the meeting would sound worse; with the headphones on, the
 * Mac microphone only hears you.
 * @param {AudioRoute | null} route
 */
export const prefersMacMic = (route) => Boolean(route?.input_bluetooth && !route.input_busy && route.builtin_mic);

/**
 * The WebView ID of the Mac microphone; "" if not found.
 * @param {AudioRoute} route
 * @returns {Promise<string>}
 */
async function macMicId(route) {
  // Without requesting the microphone again (`listWebviewDevices` would do it): that would already
  // open the headphones. With permission granted the names are already there.
  const [core, web] = await Promise.all([api.listAudioDevices(), navigator.mediaDevices.enumerateDevices()]);
  return pairDevices(core, web).inputs.find((d) => d.name === route.builtin_mic)?.webId ?? "";
}

/**
 * The WebView ID of the microphone for the meeting; "" is the default one.
 * @param {AudioRoute | null} route
 * @returns {Promise<string>}
 */
export async function meetingMic(route) {
  if (!route || !prefersMacMic(route)) return "";
  return macMicId(route);
}

/**
 * Whether in person (Take notes with the microphone) the Mac one will be used: always
 * when the input is Bluetooth headphones. In call mode they arrive at
 * 16 kHz and heavily compressed, and listening even gets the language wrong; the Mac one
 * also hears everyone in the room.
 * @param {AudioRoute | null} route
 */
export const prefersRoomMic = (route) => Boolean(route?.input_bluetooth && route.builtin_mic);

/**
 * The WebView ID of the microphone for taking notes in person; "" is the default one.
 * @param {AudioRoute | null} route
 * @returns {Promise<string>}
 */
export async function roomMic(route) {
  if (!route || !prefersRoomMic(route)) return "";
  return macMicId(route);
}

/**
 * What is connected now; null if it cannot be known.
 * @returns {Promise<AudioRoute | null>}
 */
export const readRoute = () => api.audioRoute().catch(() => null);
