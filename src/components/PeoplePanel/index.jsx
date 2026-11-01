import { useState } from "react";
import { useT } from "@i18n";
import { IconButton, LinkButton, Menu, MenuItem, MoreIcon, PlayIcon, Segmented, Spinner, cx, useDismiss } from "@components/shared";
import { speakerColor } from "@components/Transcript";
import styles from "./styles.module.css";

/**
 * The "Several voices" panel of the Listen lane: how many people speak, and one
 * row per person with their voice, a test button and a menu to join them with
 * another one. The dot has the person's color in the notes, and lights up
 * while they speak.
 * @param {{ multiVoice: import("@hooks/useMultiVoice").MultiVoice, voices: import("@utils/api").VoiceInfo[],
 *   voiceLabel: (v: import("@utils/api").VoiceInfo) => string, previewing: boolean,
 *   onPreview: (voiceId: string, gender: "female" | "male") => void }} props
 *   `voices`: the language's Lingora voices. `voiceLabel`: how the card names a voice.
 */
export default function PeoplePanel({ multiVoice, voices, voiceLabel, previewing, onPreview }) {
  const t = useT();
  const { people, speaking } = multiVoice;
  /** The person whose menu is open. */
  const [menu, setMenu] = useState(/** @type {number | null} */ (null));
  /** The person being tested. */
  const [testing, setTesting] = useState(/** @type {number | null} */ (null));
  useDismiss(menu !== null, () => setMenu(null));

  return (
    <div className={styles.panel}>
      {/* Knowing how many speak is the surest way to stop it from splitting one person in two. */}
      <div className={styles.head}>
        <span className={styles.title}>{t("app.voices.people")}</span>
        <Segmented
          small
          value={String(multiVoice.max ?? "auto")}
          onChange={(v) => multiVoice.setMax(v === "auto" ? null : Number(v))}
          options={[
            { value: "auto", label: t("app.voices.people.auto"), hint: t("app.voices.people.auto.hint") },
            ...[2, 3, 4].map((n) => ({ value: String(n), label: String(n), hint: t("app.voices.people.max", { n }) })),
          ]}
        />
      </div>

      {people.length === 0 ? (
        <p className={styles.empty}>{t("app.voices.waiting")}</p>
      ) : (
        <ul className={styles.list}>
          {people.map((p, i) => {
            const name = t("app.voices.person", { n: i + 1 });
            const now = speaking === p.index;
            return (
              <li key={p.index} className={styles.row}>
                <span
                  className={cx(styles.dot, now && styles.isSpeaking)}
                  style={{ "--who": speakerColor(i + 1) }}
                  title={now ? t("app.voices.speaking") : undefined}
                />
                <span className={styles.name}>{name}</span>
                <select
                  className={styles.voice}
                  value={p.voiceId}
                  onChange={(e) => {
                    const v = voices.find((x) => x.id === e.target.value);
                    if (v?.gender) multiVoice.setVoice(p.index, v.id, v.gender);
                  }}
                  aria-label={name}
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {voiceLabel(v)}
                    </option>
                  ))}
                </select>
                <IconButton
                  small
                  label={t("app.voices.preview.hint")}
                  disabled={previewing}
                  onClick={() => {
                    setTesting(p.index);
                    onPreview(p.voiceId, p.gender);
                  }}
                >
                  {previewing && testing === p.index ? <Spinner small /> : <PlayIcon />}
                </IconButton>
                {people.length > 1 && (
                  <div className={styles.more} onClick={(e) => e.stopPropagation()}>
                    <IconButton small active={menu === p.index} label={t("app.voices.more")} onClick={() => setMenu(menu === p.index ? null : p.index)}>
                      <MoreIcon />
                    </IconButton>
                    {menu === p.index && (
                      <Menu align="end" role="menu" className={styles.menu}>
                        <p className={styles.menuTitle}>{t("app.voices.merge")}</p>
                        {people.map(
                          (q, j) =>
                            q.index !== p.index && (
                              <MenuItem
                                key={q.index}
                                onClick={() => {
                                  setMenu(null);
                                  multiVoice.merge(p.index, q.index);
                                }}
                              >
                                <span className={styles.dot} style={{ "--who": speakerColor(j + 1) }} />
                                {t("app.voices.person", { n: j + 1 })}
                              </MenuItem>
                            ),
                        )}
                      </Menu>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {people.length > 0 && (
        <LinkButton className={styles.reset} onClick={multiVoice.reset} title={t("app.voices.restart.hint")}>
          {t("app.voices.restart")}
        </LinkButton>
      )}
    </div>
  );
}
