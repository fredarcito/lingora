import { api } from "./api";

/**
 * Convierte lo que llega a `console.error` o a un error sin atrapar en texto.
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
 * Manda al registro de la app los errores de la interfaz: los que se escriben con
 * `console.error`, los que nadie atrapa y las promesas rechazadas sin `catch`.
 * Así, en un equipo ajeno, el .txt del escritorio cuenta también lo que pasó aquí.
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
