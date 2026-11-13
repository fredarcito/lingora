import { useState } from "react";
import { useT } from "@i18n";
import { LinkButton, Select, SourceChips } from "@components/shared";
import { sourceChips } from "@utils/chat.js";
import styles from "./styles.module.css";

/** `12:40`, or `1:02:03` past an hour. @param {number} secs */
function clockOf(secs) {
  const s = Math.floor(secs);
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** «Reunión con Ana · 3 nov» / «Reunión con Ana · 12:40». @param {string} title @param {string} day @param {number | null} at */
function chipLabel(title, day, at) {
  return `${title} · ${at === null ? day : clockOf(at)}`;
}

/**
 * Under an all-notes answer: where it comes from. For a detail answer, one
 * chip per moment it cited (or per note it was given, if it cited none);
 * each opens the note there. For an overview («resume las reuniones con
 * Jeff») the notes it was built from, which the user can change: «×» takes
 * one out, «Añadir nota» adds one, and «Preguntar de nuevo» asks the same
 * question with exactly those notes. A note deleted since shows disabled.
 * @param {{ message: import("@utils/chat.js").AllChatMessage, known: { id: string, title: string, created_at: string }[] | null,
 *   formatDay: (date: string) => string, untitled: string,
 *   onOpen: (id: string, at: number | null) => void, onAskAgain: (noteIds: string[]) => void, disabled: boolean }} props
 *   `known`: the notes that exist now (null while loading: nothing shows as deleted).
 */
export default function AnswerSources({ message, known, formatDay, untitled, onOpen, onAskAgain, disabled }) {
  const t = useT();
  const notes = message.notes ?? [];
  const original = notes.map((n) => n.id);
  const [ids, setIds] = useState(original);
  if (notes.length === 0) return null;

  const exists = (/** @type {string} */ id) => !known || known.some((n) => n.id === id);
  const titleOf = (/** @type {string} */ id) => {
    const used = notes.find((n) => n.id === id);
    const note = known?.find((n) => n.id === id);
    return (used?.title || note?.title || untitled).trim() || untitled;
  };
  // A note's id is its local start time (`2026-11-03_10-32-00`): its day.
  const dayOf = (/** @type {string} */ id) => formatDay(notes.find((n) => n.id === id)?.date ?? id.slice(0, 10));

  if (!message.overview) {
    const chips = sourceChips(notes, message.citations ?? []);
    return (
      <SourceChips
        className={styles.answerSources}
        label={t("chat.all.sources")}
        items={chips.map((c) => ({
          key: `${c.id}@${c.at ?? ""}`,
          label: chipLabel(titleOf(c.id), formatDay(c.date), c.at),
          disabled: !exists(c.id),
          title: exists(c.id) ? undefined : t("chat.all.deletedNote"),
        }))}
        onOpen={(key) => {
          const [id, at] = key.split("@");
          onOpen(id, at ? Number(at) : null);
        }}
      />
    );
  }

  const changed = ids.length !== original.length || ids.some((id, i) => id !== original[i]);
  const addable = (known ?? []).filter((n) => !ids.includes(n.id));
  return (
    <div className={styles.answerSources}>
      {message.basis && <p className={styles.answerSourcesBasis}>{t("chat.all.basis", { shown: message.basis.shown, total: message.basis.total })}</p>}
      <SourceChips
        label={t("chat.all.basedOn")}
        items={ids.map((id) => ({
          key: id,
          label: `${titleOf(id)} · ${dayOf(id)}`,
          disabled: !exists(id),
          title: exists(id) ? undefined : t("chat.all.deletedNote"),
        }))}
        onOpen={(id) => onOpen(id, null)}
        onRemove={ids.length > 1 ? (id) => setIds(ids.filter((x) => x !== id)) : undefined}
        removeLabel={(item) => t("chat.all.removeNote", { title: item.label })}
      >
        {addable.length > 0 && (
          <Select
            className={styles.answerSourcesAdd}
            value=""
            label={t("chat.all.addNote")}
            onChange={(id) => id && setIds([...ids, id])}
            options={[{ value: "", label: t("chat.all.addNote") }, ...addable.map((n) => ({ value: n.id, label: `${(n.title || untitled).trim()} · ${formatDay(n.id.slice(0, 10))}` }))]}
          />
        )}
      </SourceChips>
      {changed && (
        <LinkButton className={styles.answerSourcesAgain} disabled={disabled} onClick={() => onAskAgain(ids)}>
          {t("chat.all.askAgain")}
        </LinkButton>
      )}
    </div>
  );
}
