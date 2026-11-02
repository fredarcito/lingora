import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@utils/api";
import { langName, useLang } from "@i18n";
import { FALLBACK_LANGUAGES } from "@utils/lanes";
import { VOICES_CHANGED } from "@utils/voiceDownloads";

/**
 * The languages the app can use (from Rust), read again when the window gets
 * focus or a voice was downloaded in the app: voices can arrive while it is open.
 * - `languagesRef` always has the latest list, for code that runs later.
 * - `langInfo` finds a language by its uppercase code ("EN").
 * - `shownLanguages` are named in the interface language (Rust names them in Spanish).
 */
export function useLanguages() {
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
  const languagesRef = useRef(languages);
  languagesRef.current = languages;
  /** @param {string} code */
  const langInfo = (code) => languages.find((l) => l.code.toUpperCase() === code);
  useEffect(() => {
    const load = () => api.languages().then(setLanguages).catch(() => {});
    load();
    window.addEventListener("focus", load);
    window.addEventListener(VOICES_CHANGED, load);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener(VOICES_CHANGED, load);
    };
  }, []);
  const { lang: uiLang } = useLang();
  const shownLanguages = useMemo(() => languages.map((l) => ({ ...l, name: langName(l.code, l.name) })), [languages, uiLang]);
  return { languages, languagesRef, langInfo, shownLanguages };
}
