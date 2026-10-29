import { useT } from "../../i18n";
import PairBar from "../PairBar";
import { MenuButton } from "../Sidebar";
import { WaveIcon, cx } from "../shared";
import styles from "./styles.module.css";

/**
 * La cabecera de Traducir: ☰, logo, los idiomas de la conversación y el modo
 * (Vídeo, Tomar notas, Llamada). Con un carril en marcha (`running`) no se
 * cambia ni el modo ni los idiomas. `callMode`: «Traducir llamada» ya está
 * disponible; si no, sale bloqueada.
 * @param {{ mode: import("../../App/types").Mode, onMode: (mode: import("../../App/types").Mode) => void, callMode: boolean,
 *   running: boolean, onMenu: () => void, pair: import("../../App/types").LangPair,
 *   languages: import("../../utils/api").LanguageInfo[], onPair: (pair: import("../../App/types").LangPair) => void,
 *   noTranslate: boolean }} props
 */
export default function TopBar({ mode, onMode, callMode, running, onMenu, pair, languages, onPair, noTranslate }) {
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
        {/* En Tomar notas se oculta sin quitarlo: así el selector de modo no se desplaza. */}
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
        <div className={styles.modeSwitch} role="radiogroup" title={running ? t("app.mode.stopToChange") : undefined}>
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
