import { api } from "@utils/api";
import { englishStrings, saveGenerated } from ".";

const CONTEXT = "Short user-interface text of a voice translation app (button, label, menu or message). Keep it brief and natural; do not add explanations.";

/** Names of the `{name}` placeholders in a text, in order of appearance and without repeats. @param {string} text */
const placeholderNames = (text) => [...new Set((text.match(/\{\w+\}/g) ?? []).map((m) => m.slice(1, -1)))];

/**
 * The model translates the names inside the braces (`{date}` → `{data}`). They are
 * replaced with numbers before translating and restored afterwards.
 * @param {string} text @returns {{ masked: string, names: string[] }}
 */
function mask(text) {
  const names = placeholderNames(text);
  return { masked: text.replace(/\{(\w+)\}/g, (_, n) => `{${names.indexOf(n) + 1}}`), names };
}

/** Returns the original names; null if placeholders are missing or extra. @param {string} result @param {string[]} names */
function unmask(result, names) {
  const found = new Set(result.match(/\{\d+\}/g) ?? []);
  if (found.size !== names.length || names.some((_, i) => !found.has(`{${i + 1}}`))) return null;
  return result.replace(/\{(\d+)\}/g, (_, n) => `{${names[Number(n) - 1]}}`);
}

/** Abbreviated month names in the language, as provided by the system: the model is not needed. @param {string} code */
function monthNames(code) {
  try {
    const fmt = new Intl.DateTimeFormat(code, { month: "short" });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2026, m, 15)).replace(/\.$/, "")).join(",");
  } catch {
    return null;
  }
}

/**
 * Translates the interface from English to `code` with the local model, key by key.
 * A translation that loses a `{x}` placeholder is discarded: that key stays in
 * English (and the reason is noted in the console). It saves when done.
 * @param {string} code
 * @param {(done: number, total: number) => void} onProgress
 * @param {{ cancelled: boolean }} control Set `cancelled` to stop.
 * @returns {Promise<{ missing: number } | null>} Null if it was cancelled.
 */
export async function generateLanguage(code, onProgress, control) {
  if (!(await api.translateWarmUp())) throw new Error("local-model-missing");
  const entries = Object.entries(englishStrings());
  /** @type {Record<string, string>} */
  const out = {};

  /** A valid translation or null; if the local server fails, it rethrows and retries once. @param {string} key @param {string} text */
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
  // Retry what failed: the server may have been restarting.
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
