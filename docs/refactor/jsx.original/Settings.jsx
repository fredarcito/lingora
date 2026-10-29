import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Diagnostics from "./Diagnostics";
import { MenuButton } from "./Sidebar";
import { api, errorMessage } from "./api";
import { loadNotesLang, loadSaveNotes, loadSpeakers, storeNotesLang, storeSaveNotes, storeSpeakers } from "./notes.js";
import { KeyField, notifyKeyChanged, useSummaryKey } from "./SummaryKey";
import LanguagePicker from "./LanguagePicker";
import { useT } from "./i18n";

/**
 * Ajustes: lo que se elige una vez y se olvida. Lo que se cambia al traducir
 * (subtítulos, voz sí o no, volumen) sigue en la tarjeta de cada carril.
 * Los ajustes de cada carril llegan ya montados en `lanes` (ver `LaneSettings`
 * en App.jsx), para no repetir aquí su lógica.
 * @param {{ lanes: Array<{ key: string, title: string, subtitle: string, content: React.ReactNode }>,
 *   mode: "video" | "call", systemAudio: boolean, recording: boolean, languages: import("./api").LanguageInfo[],
 *   onFixed: () => void, onMenu: () => void }} props
 */
export default function Settings({ lanes, mode, systemAudio, recording, languages, onFixed, onMenu }) {
  const t = useT();
  const [saveOn, setSaveOn] = useState(loadSaveNotes);
  const [speakersOn, setSpeakersOn] = useState(loadSpeakers);
  const [summaryLang, setSummaryLang] = useState(loadNotesLang);
  // Si está descargado lo que distingue personas; null mientras se mira.
  const [speakersReady, setSpeakersReady] = useState(/** @type {boolean | null} */ (null));
  const [version, setVersion] = useState("");
  const { status, hasKey } = useSummaryKey();
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Se vuelve a mirar tras descargarlo desde el diagnóstico de abajo.
  const checkSpeakers = () =>
    api
      .setupStatus()
      .then((list) => setSpeakersReady(list.find((m) => m.id === "speakers")?.installed ?? false))
      .catch(() => {});
  useEffect(() => {
    checkSpeakers();
  }, []);

  const clearKey = async () => {
    setKeyError("");
    try {
      await api.summaryKeyClear();
      notifyKeyChanged();
    } catch (e) {
      setKeyError(errorMessage(e));
    }
  };

  /** @param {boolean} on */
  const changeSave = (on) => {
    setSaveOn(on);
    storeSaveNotes(on);
  };

  /** @param {string} code */
  const changeSummaryLang = (code) => {
    setSummaryLang(code);
    storeNotesLang(code);
  };

  /** @param {boolean} on */
  const changeSpeakers = (on) => {
    setSpeakersOn(on);
    storeSpeakers(on);
  };

  return (
    <main className="app notes-view prefs-view">
      <header className="topbar notes-topbar">
        <div className="brand">
          <MenuButton onClick={onMenu} recording={recording} />
          <h1>{t("settings.title")}</h1>
        </div>
      </header>

      <div className="notes-scroll">
        <div className="notes-column">
          <section className="prefs-section">
            <div className="prefs-section-head">
              <h2>{t("settings.interface")}</h2>
              <p>{t("settings.interfaceHint")}</p>
            </div>
            <div className="prefs-card">
              <LanguagePicker languages={languages} />
            </div>
          </section>

          {lanes.map((l) => (
            <section key={l.key} className="prefs-section">
              <div className="prefs-section-head">
                <h2>{l.title}</h2>
                <p>{l.subtitle}</p>
              </div>
              <div className="prefs-card">{l.content}</div>
            </section>
          ))}

          <section className="prefs-section">
            <div className="prefs-section-head">
              <h2>{t("settings.notes")}</h2>
              <p>{t("settings.notesHint")}</p>
            </div>
            <div className="prefs-card">
              <label className="prefs-row">
                <span>
                  <strong>{t("settings.saveTitle")}</strong>
                  <small>{t("settings.saveHint")}</small>
                </span>
                <span className="notes-switch">
                  <input type="checkbox" role="switch" checked={saveOn} onChange={(e) => changeSave(e.target.checked)} />
                </span>
              </label>
              <label className="prefs-row">
                <span>
                  <strong>{t("settings.speakersTitle")}</strong>
                  <small>
                    {speakersReady === false
                      ? t("settings.speakersMissing")
                      : t("settings.speakersHint")}
                  </small>
                </span>
                <span className="notes-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={speakersOn && speakersReady !== false}
                    disabled={speakersReady === false}
                    onChange={(e) => changeSpeakers(e.target.checked)}
                  />
                </span>
              </label>
              <label className="prefs-row">
                <span>
                  <strong>{t("settings.summaryLangTitle")}</strong>
                  <small>{t("settings.summaryLangHint")}</small>
                </span>
                <select className="prefs-select" value={summaryLang} onChange={(e) => changeSummaryLang(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="prefs-key">
                <div className="prefs-row prefs-row-static">
                  <span>
                    <strong>{t("settings.aiTitle")}</strong>
                    <small>
                      {status === "keychain"
                        ? t("settings.keyKeychain")
                        : status === "env"
                          ? t("settings.keyEnv")
                          : t("settings.keyNone")}
                    </small>
                  </span>
                  {status === "keychain" && (
                    <button className="note-action" onClick={clearKey}>
                      {t("settings.keyRemove")}
                    </button>
                  )}
                </div>
                <KeyField placeholder={hasKey ? t("settings.keyNew") : t("settings.keyGroq")} />
                {keyError && <p className="notes-error">{keyError}</p>}
              </div>
            </div>
          </section>

          <section className="prefs-section">
            <div className="prefs-section-head">
              <h2>{t("settings.diagnostics")}</h2>
              <p>{t("settings.diagnosticsHint")}</p>
            </div>
            <Diagnostics
              mode={mode}
              systemAudio={systemAudio}
              onFixed={() => {
                onFixed();
                checkSpeakers();
              }}
              expanded
            />
          </section>

          <section className="prefs-section">
            <div className="prefs-section-head">
              <h2>{t("settings.about")}</h2>
            </div>
            <div className="prefs-card prefs-about">
              <p>
                <strong>Lingora</strong>
                {version && <span> · {t("settings.version", { version })}</span>}
              </p>
              <p className="muted">
                {hasKey
                  ? t("settings.aboutWithKey")
                  : t("settings.aboutPrivate")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
