import { api } from "./api";

/**
 * Converts what arrives at `console.error` or an uncaught error into text.
 * @param {unknown} value
 * @returns {string}
 */
export function describe(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Writes a measurement to the app's log (on Windows, the .txt on the desktop),
 * so a tester's log shows how late the voice and captions arrive. Never throws.
 * @param {string} message
 */
export function logEvent(message) {
  api.logUiEvent(message).catch(() => {});
}

/**
 * Sends the interface errors to the app's log: those written with
 * `console.error`, the ones nobody catches and the promises rejected without `catch`.
 * That way, on someone else's computer, the .txt on the desktop also records what happened here.
 */
export function captureErrors() {
  const send = (/** @type {string} */ message) => api.logUi(message).catch(() => {});
  const original = console.error;
  console.error = (...args) => {
    original(...args);
    send(args.map(describe).join(" "));
  };
  window.addEventListener("error", (e) => send(`sin atrapar: ${describe(e.error ?? e.message)}`));
  window.addEventListener("unhandledrejection", (e) => send(`promesa rechazada: ${describe(e.reason)}`));
}
