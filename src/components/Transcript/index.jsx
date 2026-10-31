import { formatClock, gapLabel, speakerLabel, transcriptParts } from "../../utils/notes.js";
import styles from "./styles.module.css";

/** One color per person; "Yo" (0) uses the app color. */
const SPEAKER_COLORS = ["#7dd3fc", "#fca5a5", "#c4b5fd", "#fcd34d", "#86efac", "#f9a8d4"];
/** @param {number | null | undefined} n */
export const speakerColor = (n) => (n === 0 || n === null || n === undefined ? "var(--accent)" : SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length]);

/**
 * The transcript in paragraphs, with time, person and color. Used by the note page.
 * @param {{ note: import("../../utils/api").Note, showSource?: boolean }} props
 */
export default function Transcript({ note, showSource = false }) {
  return (
    <ol className="note-lines">
      {transcriptParts(note).map((part, i) => {
        if ("gap" in part) {
          return (
            <li key={i} className={styles.noteGap}>
              <span>{gapLabel(part.gap)}</span>
            </li>
          );
        }
        const block = part.block;
        const first = block[0];
        const who = speakerLabel(note, first);
        const translated = block.some((x) => x.translation !== null);
        return (
          <li key={i} className={who ? "note-line has-who" : "note-line"}>
            <span className="note-time">{formatClock(first.t)}</span>
            <span className="note-text">
              {who && (
                <b className="note-who" style={{ "--who": speakerColor(first.speaker) }}>
                  {who}
                </b>
              )}
              <span>{block.map((x) => x.translation ?? x.source).join(" ")}</span>
              {showSource && translated && <small>{block.map((x) => x.source).join(" ")}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
