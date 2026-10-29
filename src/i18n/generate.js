import { api } from "../utils/api";
import { englishStrings, saveGenerated } from ".";

const CONTEXT = "Short user-interface text of a voice translation app (button, label, menu or message). Keep it brief and natural; do not add explanations.";

/** Nombres de los marcadores `{nombre}` de un texto, en orden de aparición y sin repetir. @param {string} text */
const placeholderNames = (text) => [...new Set((text.match(/\{\w+\}/g) ?? []).map((m) => m.slice(1, -1)))];

/**
 * El modelo traduce los nombres dentro de las llaves (`{date}` → `{data}`). Se
 * cambian por números antes de traducir y se devuelven después.
 * @param {string} text @returns {{ masked: string, names: string[] }}
 */
function mask(text) {
  const names = placeholderNames(text);
  return { masked: text.replace(/\{(\w+)\}/g, (_, n) => `{${names.indexOf(n) + 1}}`), names };
}

/** Devuelve los nombres originales; null si faltan marcadores o sobran. @param {string} result @param {string[]} names */
function unmask(result, names) {
  const found = new Set(result.match(/\{\d+\}/g) ?? []);
  if (found.size !== names.length || names.some((_, i) => !found.has(`{${i + 1}}`))) return null;
  return result.replace(/\{(\d+)\}/g, (_, n) => `{${names[Number(n) - 1]}}`);
}

/** Meses abreviados en el idioma, los que da el sistema: no hace falta el modelo. @param {string} code */
function monthNames(code) {
  try {
    const fmt = new Intl.DateTimeFormat(code, { month: "short" });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2026, m, 15)).replace(/\.$/, "")).join(",");
  } catch {
    return null;
  }
}

/**
 * Traduce la interfaz del inglés a `code` con el modelo local, clave a clave.
 * Una traducción que pierde un marcador `{x}` se descarta: esa clave se queda en
 * inglés (y se anota en la consola con el motivo). Guarda al terminar.
 * @param {string} code
 * @param {(done: number, total: number) => void} onProgress
 * @param {{ cancelled: boolean }} control Se pone `cancelled` para parar.
 * @returns {Promise<{ missing: number } | null>} Null si se canceló.
 */
export async function generateLanguage(code, onProgress, control) {
  if (!(await api.translateWarmUp())) throw new Error("local-model-missing");
  const entries = Object.entries(englishStrings());
  /** @type {Record<string, string>} */
  const out = {};

  /** Una traducción válida o null; si el servidor local falla, lo relanza y reintenta una vez. @param {string} key @param {string} text */
  const translate = async (key, text) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { masked, names } = mask(text);
        const { translation } = await api.translate(masked, "en", code, CONTEXT, () => {}, false, true);
        const result = unmask(translation.trim(), names);
        if (result) return result;
        console.warn(`[i18n ${code}] descartada ${key}: ${JSON.stringify(masked)} → ${JSON.stringify(translation)}`);
        return null;
      } catch (e) {
        console.warn(`[i18n ${code}] falló ${key} (intento ${attempt + 1}):`, e);
        await api.translateWarmUp().catch(() => false);
      }
    }
    return null;
  };

  for (let i = 0; i < entries.length; i++) {
    if (control.cancelled) return null;
    const [key, text] = entries[i];
    onProgress(i, entries.length);
    const result = key === "notesLib.months" ? monthNames(code) : await translate(key, text);
    if (result) out[key] = result;
  }
  // Repaso de lo que falló: el servidor pudo estar reiniciándose.
  for (const [key, text] of entries) {
    if (control.cancelled) return null;
    if (key in out) continue;
    const result = await translate(key, text);
    if (result) out[key] = result;
  }
  onProgress(entries.length, entries.length);
  const missing = entries.length - Object.keys(out).length;
  saveGenerated(code, out, missing);
  return { missing };
}
