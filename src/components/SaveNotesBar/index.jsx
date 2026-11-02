import { useT } from "@i18n";
import { Switch } from "@components/shared";
import styles from "./styles.module.css";

/**
 * «Save to notes» above the lanes in a call: one note per session, written by both
 * lanes (Listen as the other people, Speak as "Me"), so it belongs to neither card.
 * With a single lane (Translate audio) the switch stays on its card.
 * Next to the switch, what happens with it on or off.
 * @param {{ checked: boolean, onChange: (on: boolean) => void }} props
 */
export default function SaveNotesBar({ checked, onChange }) {
  const t = useT();
  const hint = checked ? t("app.lane.saveNotes.on") : t("app.lane.saveNotes.off");
  return (
    <div className={styles.saveNotesBar}>
      <Switch checked={checked} onChange={onChange} label={t("app.lane.saveNotes")} />
      <span className={styles.saveNotesHint} title={hint}>
        {hint}
      </span>
    </div>
  );
}
