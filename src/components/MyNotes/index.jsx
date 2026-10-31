import { useLayoutEffect, useRef, useState } from "react";
import { BookmarkIcon, Button, CloseIcon, IconButton, PenIcon, PlusIcon, cx } from "@components/shared";
import { useT } from "@i18n";
import { formatClock } from "@utils/notes.js";
import styles from "./styles.module.css";

/**
 * @typedef {Object} MyNotesActions What the panel asks of the recorder (see `createRecorder`).
 * @property {(text: string, startedTyping: number) => void} addMyNote
 * @property {(index: number, text: string) => void} editMyNote
 * @property {(index: number) => void} removeMyNote
 * @property {(index: number) => void} removeBookmark
 */

/**
 * The "My notes" panel while taking notes: the user's notes and bookmarks in
 * time order and, at the bottom, the box to write a new one. Enter or the
 * button saves, Shift+Enter is a new line. A note's time is when its first
 * letter was typed. Notes can be edited (click) and anything deleted until
 * recording ends (`readOnly`). `onJump` takes the transcript to a time.
 * @param {{
 *   marks: import("@utils/notes.js").UserMark[], actions: MyNotesActions,
 *   onJump?: (t: number) => void, readOnly?: boolean, className?: string,
 * }} props
 */
export default function MyNotes({ marks, actions, onJump, readOnly = false, className }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const startedTyping = useRef(0);
  const [editing, setEditing] = useState(/** @type {{ index: number, text: string } | null} */ (null));
  const list = useRef(/** @type {HTMLOListElement | null} */ (null));
  const count = useRef(marks.length);

  // Follows the end when something is added, not when something is edited or deleted.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && marks.length > count.current) el.scrollTop = el.scrollHeight;
    count.current = marks.length;
  }, [marks.length]);

  /** @param {string} value */
  const type = (value) => {
    if (!draft && value) startedTyping.current = performance.now();
    setDraft(value);
  };

  const submit = () => {
    if (!draft.trim()) return;
    actions.addMyNote(draft, startedTyping.current || performance.now());
    setDraft("");
    startedTyping.current = 0;
  };

  const commitEdit = () => {
    if (!editing) return;
    actions.editMyNote(editing.index, editing.text);
    setEditing(null);
  };

  /** Enter does the action, Shift+Enter is a new line. @param {React.KeyboardEvent} e @param {() => void} action */
  const onEnter = (e, action) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    action();
  };

  return (
    <aside className={cx(styles.myNotes, className)} aria-label={t("noteTaking.myNotes")}>
      <h3 className={styles.myNotesTitle}>{t("noteTaking.myNotes")}</h3>
      {marks.length === 0 ? (
        <p className={styles.myNotesEmpty}>{t("noteTaking.myNotesEmpty")}</p>
      ) : (
        <ol className={styles.myNotesList} ref={list}>
          {marks.map((m) => {
            const bookmark = m.kind === "bookmark";
            const isEditing = editing && !bookmark && editing.index === m.index;
            return (
              <li key={`${m.kind}:${m.index}:${m.t}`} className={cx(styles.mark, bookmark && styles.isBookmark)}>
                {/* Icon and time on top, the text below with the whole width. */}
                <div className={styles.markHead}>
                  <span className={styles.markIcon}>{bookmark ? <BookmarkIcon /> : <PenIcon />}</span>
                  {/* The time takes the transcript to that moment. */}
                  <button
                    type="button"
                    className={styles.markTime}
                    disabled={!onJump}
                    title={onJump ? t("noteTaking.jumpTo") : undefined}
                    onClick={() => onJump?.(m.t)}
                  >
                    {formatClock(m.t)}
                  </button>
                  {!readOnly && !isEditing && (
                    <IconButton
                      small
                      className={styles.markRemove}
                      label={t("noteTaking.removeMark")}
                      onClick={() => (bookmark ? actions.removeBookmark(m.index) : actions.removeMyNote(m.index))}
                    >
                      <CloseIcon />
                    </IconButton>
                  )}
                </div>
                {bookmark ? (
                  <p className={styles.markText}>{t("noteTaking.bookmarked")}</p>
                ) : isEditing ? (
                  <textarea
                    className={styles.markEdit}
                    value={editing.text}
                    autoFocus
                    rows={3}
                    aria-label={t("noteTaking.editNote")}
                    onChange={(e) => setEditing({ index: m.index, text: e.target.value })}
                    onKeyDown={(e) => (e.key === "Escape" ? setEditing(null) : onEnter(e, commitEdit))}
                    onBlur={commitEdit}
                  />
                ) : (
                  <button
                    type="button"
                    className={cx(styles.markText, styles.markEditable)}
                    disabled={readOnly}
                    title={readOnly ? undefined : t("noteTaking.editNote")}
                    onClick={() => setEditing({ index: m.index, text: m.text ?? "" })}
                  >
                    {m.text}
                  </button>
                )}
                {onJump && !isEditing && (
                  <button type="button" className={styles.markJump} onClick={() => onJump(m.t)}>
                    {t("noteTaking.jumpTo")}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!readOnly && (
        <div className={styles.compose}>
          <textarea
            className={styles.composeInput}
            value={draft}
            rows={3}
            placeholder={t("noteTaking.writeNote")}
            aria-label={t("noteTaking.writeNote")}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => onEnter(e, submit)}
          />
          <div className={styles.composeFoot}>
            <p className={styles.composeHint}>{t("noteTaking.myNotesHint")}</p>
            <Button disabled={!draft.trim()} onClick={submit}>
              <PlusIcon />
              {t("noteTaking.addNote")}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
