import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Textos de la interfaz. Cada archivo de `es/` y `en/` es un espacio de nombres
 * (`settings.json` → `settings.title`); `en` es el idioma de respaldo. Una clave
 * con plural se escribe `clave_one` / `clave_other` y se pide con `{ count }`.
 */
const files = import.meta.glob("./{es,en}/*.json", { eager: true, import: "default" });

/** @type {Record<string, Record<string, string>>} */
const BUNDLED = { es: {}, en: {} };
for (const [path, strings] of Object.entries(files)) {
  const [, lang, ns] = /** @type {RegExpMatchArray} */ (path.match(/\.\/(\w+)\/(\w+)\.json$/));
  for (const [key, text] of Object.entries(/** @type {Record<string, string>} */ (strings))) BUNDLED[lang][`${ns}.${key}`] = text;
}

/** Idiomas que Lingora trae de serie. */
export const BUNDLED_LANGS = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
];

const STORAGE_KEY = "lingora.uiLang";
/** Idiomas generados con el modelo local: `lingora.uiStrings.<código>` guarda `{ strings, date, missing }`. */
const GENERATED_PREFIX = "lingora.uiStrings.";
const RTL = new Set(["ar", "he", "fa", "ur"]);

/** Código base del idioma del sistema, sea cual sea (`fr-CA` → `fr`). */
export function rawSystemLang() {
  return (navigator.language || "en").toLowerCase().split("-")[0];
}

/** Texto del inglés de la interfaz: lo que se traduce al generar otro idioma. @returns {Record<string, string>} */
export function englishStrings() {
  return BUNDLED.en;
}

/** @typedef {{ strings: Record<string, string>, date: string, missing: number }} Generated */

/** @param {string} code @returns {Generated | null} */
function readGenerated(code) {
  try {
    return JSON.parse(localStorage.getItem(GENERATED_PREFIX + code) ?? "null");
  } catch {
    return null;
  }
}

/** Códigos de los idiomas ya generados en este equipo. @returns {string[]} */
export function generatedLangs() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(GENERATED_PREFIX))
      .map((k) => k.slice(GENERATED_PREFIX.length));
  } catch {
    return [];
  }
}

/** Guarda un idioma generado. Lanza si no cabe en el almacenamiento. @param {string} code @param {Record<string, string>} strings @param {number} missing */
export function saveGenerated(code, strings, missing) {
  const data = { strings, date: new Date().toISOString(), missing };
  localStorage.setItem(GENERATED_PREFIX + code, JSON.stringify(data));
  extra[code] = strings;
}

/** @param {string} code */
export function removeGenerated(code) {
  try {
    localStorage.removeItem(GENERATED_PREFIX + code);
  } catch {
    // Sin almacenamiento no había nada guardado.
  }
  delete extra[code];
}

export const OFFER_KEY = "lingora.uiLangOffered";

/** Idioma del sistema reducido al código base: `es-MX` → `es`. Solo español sale en español. */
export function systemLang() {
  const base = (navigator.language || "en").toLowerCase().split("-")[0];
  return base === "es" ? "es" : "en";
}

/** Elegido a mano si lo hay (y está disponible); si no, el del sistema. */
function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved in BUNDLED || readGenerated(saved))) return saved;
  } catch {
    // Sin almacenamiento se usa el del sistema.
  }
  return systemLang();
}

/** @type {Record<string, Record<string, string>>} */
const extra = {};
for (const code of generatedLangs()) {
  const data = readGenerated(code);
  if (data) extra[code] = data.strings;
}
let current = initialLang();

/**
 * Traducción de una clave. Si falta en el idioma actual cae al inglés y, al final, a la propia clave.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  const tables = [extra[current], BUNDLED[current], BUNDLED.en];
  let name = key;
  if (vars && typeof vars.count === "number") {
    const form = new Intl.PluralRules(current).select(vars.count);
    name = tables.some((tb) => tb?.[`${key}_${form}`] !== undefined) ? `${key}_${form}` : `${key}_other`;
  }
  let text = key;
  for (const tb of tables) {
    if (tb?.[name] !== undefined) {
      text = tb[name];
      break;
    }
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/**
 * Nombre de un idioma escrito en el de la interfaz (`fr` → «francés» o «French»).
 * Si el sistema no lo conoce, `fallback`. En una frase va tal cual; en una lista,
 * con mayúscula inicial.
 * @param {string} code @param {string} fallback @param {boolean} [inSentence]
 */
export function langName(code, fallback, inSentence = false) {
  try {
    const name = new Intl.DisplayNames([current], { type: "language" }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return inSentence ? name : name.charAt(0).toLocaleUpperCase(current) + name.slice(1);
  } catch {
    // Código que Intl no reconoce.
  }
  return fallback;
}

const I18nContext = createContext({ lang: current, setLang: /** @type {(code: string) => void} */ (() => {}) });

/** Idioma de la interfaz y cómo cambiarlo. */
export function useLang() {
  return useContext(I18nContext);
}

/** `t` que hace repintar el componente al cambiar de idioma. */
export function useT() {
  const { lang } = useLang();
  return useCallback(/** @type {typeof t} */ ((key, vars) => t(key, vars)), [lang]);
}

/** @param {string} code */
function apply(code) {
  current = code;
  document.documentElement.lang = code;
  document.documentElement.dir = RTL.has(code) ? "rtl" : "ltr";
}

/** @param {{ children: React.ReactNode }} props */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    apply(current);
    return current;
  });

  /** @param {string} code */
  const setLang = useCallback((code) => {
    apply(code);
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Se aplica igual; solo no se recuerda al reabrir.
    }
  }, []);

  // Los subtítulos flotantes son otra ventana: se enteran por el almacenamiento compartido.
  useEffect(() => {
    /** @param {StorageEvent} e */
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue && e.newValue !== current) {
        apply(e.newValue);
        setLangState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
