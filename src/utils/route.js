import { api } from "./api";
import { pairDevices } from "./audio";

/**
 * Lo que hay conectado para oír y hablar, y qué hacer con ello en una
 * reunión en línea (Tomar notas). Rust lo lee de Core Audio (`audio_route`).
 * @typedef {import("./api").AudioRoute} AudioRoute
 */

/** Cada cuánto se mira qué hay conectado. */
export const ROUTE_CHECK_MS = 2000;

/**
 * Si el micrófono puede oír lo que suena en el Mac. Sin saber qué hay
 * conectado, sí: quitar el eco cuando no lo hay apenas cuesta.
 * @param {AudioRoute | null} route
 */
export const echoPossible = (route) => route?.output !== "headphones";

/**
 * Si se usará el micrófono del Mac en vez del de por defecto: cuando son unos
 * auriculares Bluetooth que ninguna app usa aún. Abrirlos los pasaría a modo
 * llamada y la reunión se oiría peor; con los auriculares puestos, el
 * micrófono del Mac solo te oye a ti.
 * @param {AudioRoute | null} route
 */
export const prefersMacMic = (route) => Boolean(route?.input_bluetooth && !route.input_busy && route.builtin_mic);

/**
 * El ID del WebView del micrófono del Mac; "" si no se encuentra.
 * @param {AudioRoute} route
 * @returns {Promise<string>}
 */
async function macMicId(route) {
  // Sin pedir el micrófono otra vez (lo haría `listWebviewDevices`): eso ya
  // abriría los auriculares. Con el permiso concedido los nombres ya están.
  const [core, web] = await Promise.all([api.listAudioDevices(), navigator.mediaDevices.enumerateDevices()]);
  return pairDevices(core, web).inputs.find((d) => d.name === route.builtin_mic)?.webId ?? "";
}

/**
 * El ID del WebView del micrófono para la reunión; "" es el de por defecto.
 * @param {AudioRoute | null} route
 * @returns {Promise<string>}
 */
export async function meetingMic(route) {
  if (!route || !prefersMacMic(route)) return "";
  return macMicId(route);
}

/**
 * Si en persona (Tomar notas con el micrófono) se usará el del Mac: siempre
 * que la entrada sean unos auriculares Bluetooth. En modo llamada llegan a
 * 16 kHz y muy comprimidos, y la escucha se equivoca hasta de idioma; el del
 * Mac, además, oye a todos los de la sala.
 * @param {AudioRoute | null} route
 */
export const prefersRoomMic = (route) => Boolean(route?.input_bluetooth && route.builtin_mic);

/**
 * El ID del WebView del micrófono para tomar notas en persona; "" es el de por defecto.
 * @param {AudioRoute | null} route
 * @returns {Promise<string>}
 */
export async function roomMic(route) {
  if (!route || !prefersRoomMic(route)) return "";
  return macMicId(route);
}

/**
 * Lo que hay conectado ahora; null si no se puede saber.
 * @returns {Promise<AudioRoute | null>}
 */
export const readRoute = () => api.audioRoute().catch(() => null);
