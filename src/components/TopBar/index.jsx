import { useT } from "../../i18n";
import PairBar from "../PairBar";
import { MenuButton } from "../Sidebar";
import { WaveIcon, cx } from "../shared";
import styles from "./styles.module.css";

/**
 * The Translate header: ☰, logo, the conversation languages and the mode
 * (Video, Take notes, Call). With a lane running (`running`) neither the mode nor the
 * languages can be changed. `callMode`: "Translate call" is already
 * available; otherwise it is shown locked. `modeRef` gets the mode selector, so
 * Take notes can line My notes up with it.
 * @param {{ mode: import("../../App/types").Mode, onMode: (mode: import("../../App/types").Mode) => void, callMode: boolean,
 *   running: boolean, onMenu: () => void, pair: import("../../App/types").LangPair,
 *   languages: import("../../utils/api").LanguageInfo[], onPair: (pair: import("../../App/types").LangPair) => void,
 *   noTranslate: boolean, modeRef?: (el: HTMLElement | null) => void }} props
 */
export default function TopBar({ mode, onMode, callMode, running, onMenu, pair, languages, onPair, noTranslate, modeRef }) {
  const t = useT();
  return (
    <header className="topbar">
      <div className="brand">
        <MenuButton onClick={onMenu} recording={running} />
        <span className="logo" aria-hidden>
          <WaveIcon />
        </span>
        <div>
          <h1>Lingora</h1>
          <p>{t("app.tagline")}</p>
        </div>
      </div>
      <div className={styles.topbarActions}>
        {/* In Take notes it is hidden instead of removed, so the mode selector does not shift. */}
        <div className={cx(styles.pairHold, mode === "notes" && styles.isAway)}>
          <PairBar
            pair={pair}
            languages={languages}
            onChange={onPair}
            locked={running}
            mode={mode === "notes" ? "video" : mode}
            noTranslate={noTranslate}
          />
        </div>
        <div ref={modeRef} className={styles.modeSwitch} role="radiogroup" title={running ? t("app.mode.stopToChange") : undefined}>
          {[
            ["video", t("app.mode.video"), t("app.mode.video.hint")],
            ["notes", t("app.mode.notes"), t("app.mode.notes.hint")],
            callMode
              ? ["call", t("app.mode.call"), t("app.mode.call.hint")]
              : ["call", t("app.mode.callSoon"), t("app.mode.callSoon.hint")],
          ].map(([value, label, hint]) => (
            <button
              key={value}
              role="radio"
              aria-checked={mode === value}
              className={mode === value ? styles.isSelected : ""}
              onClick={() => onMode(/** @type {import("../../App/types").Mode} */ (value))}
              disabled={running || (value === "call" && !callMode)}
              title={running ? undefined : hint}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
