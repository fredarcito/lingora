import { useState } from "react";
import { useT } from "@i18n";
import { speakerLabel, speakerName, speakerShares } from "@utils/notes.js";
import { Button, Menu, MenuItem, cx, useDismiss } from "@components/shared";
import { speakerColor } from "@components/Transcript";
import styles from "./styles.module.css";

/**
 * The people in the note, each with how much they said (share of the words),
 * to correct what was detected: changing their
 * name ("Persona 2" → "Ana") or merging two that are the same person (the same voice
 * can sound different for a while). It cannot be edited while recording: the recorder
 * would rewrite the note.
 * `aside` goes on the right of the title row (the note page puts the summary hint there).
 * @param {{ note: import("@utils/api").Note, live: boolean, onChange: (note: import("@utils/api").Note) => void,
 *   aside?: import("react").ReactNode }} props
 */
export default function SpeakerBar({ note, live, onChange, aside }) {
  const t = useT();
  const [editing, setEditing] = useState(/** @type {number | null} */ (null));
  const [name, setName] = useState("");
  const shares = speakerShares(note);
  const people = [...shares.keys()].sort((a, b) => a - b);
  /** @param {number} n */
  const label = (n) => speakerLabel(note, /** @type {any} */ ({ speaker: n }));
  /** What is edited: your name without "(Yo)"; for the others, "Persona n" if they do not have one yet. @param {number} n */
  const editable = (n) => speakerName(note, n) || (n === 0 ? "" : label(n));

  // Closes when clicking outside or with Esc.
  useDismiss(editing !== null, () => setEditing(null));

  /** @param {number} n */
  const rename = (n) => {
    const value = name.trim();
    setEditing(null);
    if (!value || value === editable(n)) return;
    onChange({ ...note, speakers: { ...note.speakers, [n]: value } });
  };

  /** The sentences of `from` move to `into`. @param {number} from @param {number} into */
  const merge = (from, into) => {
    setEditing(null);
    const { [from]: _, ...speakers } = note.speakers ?? {};
    onChange({
      ...note,
      speakers,
      sentences: note.sentences.map((s) => (s.speaker === from ? { ...s, speaker: into } : s)),
    });
  };

  return (
    <div className={styles.speakerBar}>
      {/* One line: the label (what the % means, on hover), the people and, on the right, `aside`. */}
      <span className={styles.speakerBarLabel} title={t("notes.shareHint")}>
        {t("notes.speakers")}
      </span>
      {people.map((n) => (
        <div key={n} className={styles.speakerWrap} onClick={(e) => e.stopPropagation()}>
          <button
            className={cx(styles.speakerChip, editing === n && styles.isOpen)}
            disabled={live}
            title={live ? t("notes.speakerEditLater") : t("notes.speakerEdit")}
            aria-expanded={editing === n}
            onClick={() => {
              setName(editable(n));
              setEditing(editing === n ? null : n);
            }}
          >
            <span className={styles.speakerDot} style={{ "--who": speakerColor(n) }} />
            <span className={styles.speakerChipName}>{label(n)}</span>
            <span className={styles.speakerCount}>{t("notes.share", { pct: shares.get(n) })}</span>
          </button>
          {editing === n && (
            <Menu className={styles.speakerMenu}>
              <label className={styles.speakerName}>
                <span>{t("notes.name")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && rename(n)}
                />
              </label>
              <Button variant="primary" className={styles.speakerSave} onClick={() => rename(n)}>
                {t("notes.saveName")}
              </Button>
              {people.length > 1 && (
                <>
                  <p className={styles.speakerMenuTitle}>{t("notes.sameAs")}</p>
                  {people
                    .filter((m) => m !== n)
                    .map((m) => (
                      <MenuItem key={m} onClick={() => merge(n, m)}>
                        <span className={styles.speakerDot} style={{ "--who": speakerColor(m) }} />
                        {label(m)}
                      </MenuItem>
                    ))}
                </>
              )}
            </Menu>
          )}
        </div>
      ))}
      {aside && <div className={styles.speakerBarAside}>{aside}</div>}
      {/* The split at a glance, below: one thin line with a stretch of each person's color. */}
      {people.length > 1 && (
        <div className={styles.speakerSplit} aria-hidden>
          {people.map((n) => (
            <span key={n} style={{ "--who": speakerColor(n), flexGrow: shares.get(n) }} />
          ))}
        </div>
      )}
    </div>
  );
}
