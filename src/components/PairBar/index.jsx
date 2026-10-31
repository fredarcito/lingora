import { useT } from "@i18n";
import { SwapIcon, cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * The conversation languages, shared by both lanes. If the same language is picked
 * on both sides, they are swapped. They cannot be changed while a lane
 * is running: the sentence in progress would be left halfway between two languages.
 * In video mode it reads "English → Spanish": from what is heard to what is read.
 * With subtitles in the original (panel setting), the target is dimmed.
 * @param {{ pair: import("@app/types").LangPair, onChange: (pair: import("@app/types").LangPair) => void, locked: boolean, mode: import("@app/types").Mode, noTranslate: boolean }} props
 */
export default function PairBar({ pair, languages, onChange, locked, mode, noTranslate }) {
  const t = useT();
  /** @param {"you" | "them"} side @param {string} code */
  const pick = (side, code) => {
    const other = side === "you" ? "them" : "you";
    onChange(code === pair[other] ? { you: pair.them, them: pair.you } : { ...pair, [side]: code });
  };
  // What is heard must be audible locally; in a call
  // so must what you say.
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
              : // No voice on this device: subtitles only toward that language.
                l.female_voice || l.male_voice
                ? l.name
                : t("app.pair.noVoice", { name: l.name })}
          </option>
        ))}
      </select>
    </label>
  );
  // When swapping, your language becomes the one that is heard.
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
