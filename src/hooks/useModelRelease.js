import { useEffect } from "react";
import { api } from "@utils/api";

/** Tiempo parado tras el que se liberan los modelos de la memoria. */
const RELEASE_MODELS_MS = 3 * 60_000;

/**
 * Parado un rato, los modelos se sueltan: ocupan ~2 GB de memoria. Se
 * vuelven a cargar al empezar (~1–2 s).
 * @param {boolean} anyRunning
 */
export function useModelRelease(anyRunning) {
  useEffect(() => {
    if (anyRunning) return;
    const timer = window.setTimeout(() => api.releaseModels().catch(() => {}), RELEASE_MODELS_MS);
    return () => window.clearTimeout(timer);
  }, [anyRunning]);
}
