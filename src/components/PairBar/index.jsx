import { useT } from "../../i18n";
import { SwapIcon, cx } from "../shared";
import styles from "./styles.module.css";

/**
 * Los idiomas de la conversación, comunes a los dos carriles. Si se elige el
 * mismo en los dos lados, se intercambian. No se cambian con un carril en
 * marcha: la frase en curso quedaría a medio camino entre dos idiomas.
 * En modo vídeo se lee «Inglés → Español»: de lo que se oye a lo que se lee.
 * Con los subtítulos en el original (ajuste del panel), el destino se atenúa.
 * @param {{ pair: import("../../App/types").LangPair, onChange: (pair: import("../../App/types").LangPair) => void, locked: boolean, mode: import("../../App/types").Mode, noTranslate: boolean }} props
 */
export default function PairBar({ pair, languages, onChange, locked, mode, noTranslate }) {
  const t = useT();
  /** @param {"you" | "them"} side @param {string} code */
  const pick = (side, code) => {
    const other = side === "you" ? "them" : "you";
    onChange(code === pair[other] ? { you: pair.them, them: pair.you } : { ...pair, [side]: code });
  };
  // Lo que se escucha tiene que poder escucharse en local; en una llamada
  // también lo que hablas tú.
  /** @param {"you" | "them"} side */
  const listened = (side) => side === "them" || mode === "call";
  /** @param {"you" | "them"} side @param {string} label @param {string} hint */
  const select = (side, label, hint) => (
    <label className={styles.pairSide} title={hint}>
      {label && <span>{label}</span>}
      <select value={pair[side]} onChange={(e) => pick(side, e.target.value)} disabled={locked} aria-label={hint}>
        {languages.map((l) => (
          <option key={l.code} value={l.code.toUpperCase()} disabled={listened(side) && !l.can_listen}>
            {listened(side) && !l.can_listen
              ? t("app.pair.soon", { name: l.name })
              : // Sin voz en este equipo: solo subtítulos hacia ese idioma.
                l.female_voice || l.male_voice
                ? l.name
                : t("app.pair.noVoice", { name: l.name })}
          </option>
        ))}
      </select>
    </label>
  );
  // Al intercambiar, tu idioma pasa a ser el que se escucha.
  const canSwap = languages.find((l) => l.code.toUpperCase() === pair.you)?.can_listen ?? true;
  const swap = (
    <button
      className={styles.pairSwap}
      onClick={() => onChange({ you: pair.them, them: pair.you })}
      disabled={locked || !canSwap}
      title={canSwap ? t("app.pair.swap") : t("app.pair.swapDisabled")}
    >
      <SwapIcon />
    </button>
  );
  return (
    <div
      className={cx(styles.pair, mode === "video" && noTranslate && styles.isUntranslated)}
      title={locked ? t("app.pair.locked") : undefined}
    >
      {mode === "video" ? (
        <>
          {select("them", "", t("app.pair.heard"))}
          {swap}
          {select("you", "", noTranslate ? t("app.pair.untranslated") : t("app.pair.translation"))}
        </>
      ) : (
        <>
          {select("you", t("app.pair.you"), t("app.pair.youSpeak"))}
          {swap}
          {select("them", t("app.pair.them"), t("app.pair.themSpeak"))}
        </>
      )}
    </div>
  );
}
