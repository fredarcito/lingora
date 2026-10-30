import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Diagnostics from "../../components/Diagnostics";
import { MenuButton } from "../../components/Sidebar";
import { api, errorMessage } from "../../utils/api";
import { loadMyName, loadNotesLang, loadSaveNotes, loadSpeakers, storeMyName, storeNotesLang, storeSaveNotes, storeSpeakers } from "../../utils/notes.js";
import { KeyField, notifyKeyChanged, useSummaryKey } from "../../components/SummaryKey";
import LanguagePicker from "../../components/LanguagePicker";
import { useT } from "../../i18n";
import { Button, PageHeader, Select, Switch, TextField, cx } from "../../components/shared";
import styles from "./styles.module.css";

/**
 * Settings: what is chosen once and then forgotten. What is changed while translating
 * (subtitles, voice on or off, volume) stays on each lane's card.
 * Each lane's settings arrive already mounted in `lanes` (see
 * `components/LaneSettings`), so its logic is not repeated here.
 * @param {{ lanes: Array<{ key: string, title: string, subtitle: string, content: React.ReactNode }>,
 *   mode: "video" | "call", systemAudio: boolean, recording: boolean, languages: import("../../utils/api").LanguageInfo[],
 *   onFixed: () => void, onMenu: () => void }} props
 */
export default function Settings({ lanes, mode, systemAudio, recording, languages, onFixed, onMenu }) {
  const t = useT();
  const [saveOn, setSaveOn] = useState(loadSaveNotes);
  const [speakersOn, setSpeakersOn] = useState(loadSpeakers);
  const [summaryLang, setSummaryLang] = useState(loadNotesLang);
  const [myName, setMyName] = useState(loadMyName);
  // Whether the files that tell speakers apart are downloaded; null while checking.
  const [speakersReady, setSpeakersReady] = useState(/** @type {boolean | null} */ (null));
  const [version, setVersion] = useState("");
  const { status, hasKey } = useSummaryKey();
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Checked again after downloading it from the diagnostics below.
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
    <main className={cx("app notes-view", styles.prefsView)}>
      <header className="topbar notes-topbar">
        {/* The title level with the menu and aligned with the sections, like the search box in Notes. */}
        <div className={cx("brand", styles.prefsBrand)}>
          <MenuButton onClick={onMenu} recording={recording} />
          <div className={styles.prefsTitle}>
            <PageHeader title={t("settings.title")} />
          </div>
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
                  <strong>{t("settings.myNameTitle")}</strong>
                  <small>
                    {t("settings.myNameHint", { label: myName.trim() ? `${myName.trim()} (${t("notesLib.me")})` : t("notesLib.me") })}
                  </small>
                </span>
                <TextField
                  value={myName}
                  onChange={setMyName}
                  onCommit={() => storeMyName(myName)}
                  label={t("settings.myNameTitle")}
                  placeholder={t("settings.myNamePlaceholder")}
                  maxLength={40}
                />
              </label>
              <label className="prefs-row">
                <span>
                  <strong>{t("settings.saveTitle")}</strong>
                  <small>{t("settings.saveHint")}</small>
                </span>
                <Switch checked={saveOn} onChange={changeSave} />
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
                <Switch checked={speakersOn && speakersReady !== false} disabled={speakersReady === false} onChange={changeSpeakers} />
              </label>
              <label className="prefs-row">
                <span>
                  <strong>{t("settings.summaryLangTitle")}</strong>
                  <small>{t("settings.summaryLangHint")}</small>
                </span>
                <Select value={summaryLang} onChange={changeSummaryLang} options={languages.map((l) => ({ value: l.code, label: l.name }))} />
              </label>
              <div className={styles.prefsKey}>
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
                    <Button onClick={clearKey}>{t("settings.keyRemove")}</Button>
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
              className={styles.prefsDiagnostics}
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
            <div className={cx("prefs-card", styles.prefsAbout)}>
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
