import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * UI texts. Each file in `es/` and `en/` is a namespace
 * (`settings.json` → `settings.title`); `en` is the fallback language. A key
 * with plurals is written `key_one` / `key_other` and requested with `{ count }`.
 */
const files = import.meta.glob("./{es,en}/*.json", { eager: true, import: "default" });

/** @type {Record<string, Record<string, string>>} */
const BUNDLED = { es: {}, en: {} };
for (const [path, strings] of Object.entries(files)) {
  const [, lang, ns] = /** @type {RegExpMatchArray} */ (path.match(/\.\/(\w+)\/(\w+)\.json$/));
  for (const [key, text] of Object.entries(/** @type {Record<string, string>} */ (strings))) BUNDLED[lang][`${ns}.${key}`] = text;
}

/** Languages that Lingora ships with. */
export const BUNDLED_LANGS = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
];

const STORAGE_KEY = "lingora.uiLang";
/** Languages generated with the local model: `lingora.uiStrings.<code>` stores `{ strings, date, missing }`. */
const GENERATED_PREFIX = "lingora.uiStrings.";
const RTL = new Set(["ar", "he", "fa", "ur"]);

/** Base code of the system language, whatever it is (`fr-CA` → `fr`). */
export function rawSystemLang() {
  return (navigator.language || "en").toLowerCase().split("-")[0];
}

/** English UI text: what gets translated when another language is generated. @returns {Record<string, string>} */
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

/** Codes of the languages already generated on this device. @returns {string[]} */
export function generatedLangs() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(GENERATED_PREFIX))
      .map((k) => k.slice(GENERATED_PREFIX.length));
  } catch {
    return [];
  }
}

/** Saves a generated language. Throws if it does not fit in storage. @param {string} code @param {Record<string, string>} strings @param {number} missing */
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
    // Without storage there was nothing saved.
  }
  delete extra[code];
}

export const OFFER_KEY = "lingora.uiLangOffered";

/** System language reduced to its base code: `es-MX` → `es`. Only Spanish maps to Spanish; everything else maps to English. */
export function systemLang() {
  const base = (navigator.language || "en").toLowerCase().split("-")[0];
  return base === "es" ? "es" : "en";
}

/** The one picked by hand if there is one (and it is available); otherwise the system one. */
function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved in BUNDLED || readGenerated(saved))) return saved;
  } catch {
    // Without storage the system one is used.
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
 * Translation of a key. If it is missing in the current language it falls back to English and, finally, to the key itself.
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
 * Name of a language written in the interface language (`fr` → «francés» or «French»).
 * If the system does not know it, `fallback`. In a sentence it is used as is; in a list,
 * with the first letter capitalized.
 * @param {string} code @param {string} fallback @param {boolean} [inSentence]
 */
export function langName(code, fallback, inSentence = false) {
  try {
    const name = new Intl.DisplayNames([current], { type: "language" }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return inSentence ? name : name.charAt(0).toLocaleUpperCase(current) + name.slice(1);
  } catch {
    // Code that Intl does not recognize.
  }
  return fallback;
}

const I18nContext = createContext({ lang: current, setLang: /** @type {(code: string) => void} */ (() => {}) });

/** Interface language and how to change it. */
export function useLang() {
  return useContext(I18nContext);
}

/** `t` that repaints the component when the language changes. */
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
      // It is applied anyway; it just is not remembered when reopening.
    }
  }, []);

  // The floating subtitles are another window: they learn about it through shared storage.
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
