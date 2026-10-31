import { useEffect, useRef } from "react";
import { BookmarkIcon, PenIcon, cx } from "@components/shared";
import { useT } from "@i18n";
import { formatClock, gapLabel, marksByPart, speakerLabel, transcriptParts } from "@utils/notes.js";
import styles from "./styles.module.css";

/** One color per person; "Yo" (0) uses the app color. */
const SPEAKER_COLORS = ["#7dd3fc", "#fca5a5", "#c4b5fd", "#fcd34d", "#86efac", "#f9a8d4"];
/** @param {number | null | undefined} n */
export const speakerColor = (n) => (n === 0 || n === null || n === undefined ? "var(--accent)" : SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length]);

/**
 * The transcript in paragraphs, with time, person and color. Used by the note page.
 * The user's notes and bookmarks (Take notes) go under the paragraph that was
 * being heard when they were made.
 * - `only`: just your notes (`"note"`) or bookmarks (`"bookmark"`), one per
 *   row, each with its paragraph below as context and `onJump` (index of the
 *   paragraph) to see it in the whole transcript.
 * - `focus`: the paragraph (index of `transcriptParts`) to bring into view and
 *   highlight briefly; a new `nonce` repeats it.
 * @param {{
 *   note: import("@utils/api").Note, showSource?: boolean,
 *   only?: "note" | "bookmark" | null, onJump?: (part: number) => void,
 *   focus?: { part: number, nonce: number } | null,
 * }} props
 */
export default function Transcript({ note, showSource = false, only = null, onJump, focus = null }) {
  const list = useRef(/** @type {HTMLOListElement | null} */ (null));
  const parts = transcriptParts(note);
  const marks = marksByPart(note, parts).map((m) => (only ? m.filter((x) => x.kind === only) : m));

  useEffect(() => {
    const row = focus && list.current?.querySelector(`[data-part="${focus.part}"]`);
    if (!(row instanceof HTMLElement)) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center" });
    if (!calm) {
      row.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" }, { backgroundColor: "transparent" }], {
        duration: 1600,
        easing: "ease-out",
      });
    }
  }, [focus]);

  // Filtered: one row per note or bookmark, with its paragraph as context.
  if (only) {
    return (
      <ol className="note-lines">
        {parts.flatMap((part, i) =>
          "block" in part ? marks[i].map((m) => <MarkRow key={`${m.kind}:${m.index}`} note={note} mark={m} block={part.block} onJump={onJump && (() => onJump(i))} />) : [],
        )}
      </ol>
    );
  }

  return (
    <ol className="note-lines" ref={list}>
      {parts.map((part, i) => {
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
          <li key={i} data-part={i} className={who ? "note-line has-who" : "note-line"}>
            <span className="note-time">{formatClock(first.t)}</span>
            <span className="note-text">
              {who && (
                <b className="note-who" style={{ "--who": speakerColor(first.speaker) }}>
                  {who}
                </b>
              )}
              <span>{block.map((x) => x.translation ?? x.source).join(" ")}</span>
              {showSource && translated && <small>{block.map((x) => x.source).join(" ")}</small>}
              {marks[i].length > 0 && <UserMarks marks={marks[i]} />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The user's notes and bookmarks, read-only: icon and time on a line, the text
 * below. Also on their own, for a note where nothing was transcribed.
 * @param {{ marks: import("@utils/notes.js").UserMark[] }} props
 */
export function UserMarks({ marks }) {
  const t = useT();
  return (
    <span className={styles.userMarks}>
      {marks.map((m) => (
        <span key={`${m.kind}:${m.index}`} className={cx(styles.userMark, m.kind === "bookmark" && styles.isBookmark)}>
          <span className={styles.userMarkHead}>
            {m.kind === "bookmark" ? <BookmarkIcon /> : <PenIcon />}
            <span>{formatClock(m.t)}</span>
          </span>
          <span className={styles.userMarkText} dir="auto">
            {m.text ?? t("noteTaking.bookmarked")}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * A note or bookmark in the filtered views: it leads, at its own time; the
 * paragraph that was being heard goes below, quieter and cut short, as context.
 * @param {{ note: import("@utils/api").Note, mark: import("@utils/notes.js").UserMark,
 *   block: import("@utils/api").NoteSentence[], onJump?: () => void }} props
 */
function MarkRow({ note, mark, block, onJump }) {
  const t = useT();
  const who = speakerLabel(note, block[0]);
  const bookmark = mark.kind === "bookmark";
  return (
    <li className={cx("note-line", styles.markRow)}>
      <span className="note-time">{formatClock(mark.t)}</span>
      <span className="note-text">
        <span className={cx(styles.markRowText, bookmark && styles.isBookmark)} dir="auto">
          {bookmark ? <BookmarkIcon /> : <PenIcon />}
          <span>{mark.text ?? t("noteTaking.bookmarked")}</span>
        </span>
        <span className={styles.markRowContext}>
          {who && (
            <b className={styles.markRowWho} style={{ "--who": speakerColor(block[0].speaker) }}>
              {who} · {formatClock(block[0].t)}
            </b>
          )}
          <span className={styles.markRowQuote}>{block.map((x) => x.translation ?? x.source).join(" ")}</span>
        </span>
        {onJump && (
          <button type="button" className={styles.userMarksJump} onClick={onJump}>
            {t("notes.marks.jump")}
          </button>
        )}
      </span>
    </li>
  );
}
