import { useMemo } from "react";
import { useLang, useT } from "@i18n";
import { MenuButton } from "@components/Sidebar";
import PairBar from "@components/PairBar";
import ThemeToggle from "@components/ThemeToggle";
import { ActivityRow, Badge, CallIcon, LinkButton, ModeCard, PageHeader, PenIcon, SwapIcon, cx } from "@components/shared";
import { useNotesList } from "@hooks/useNotesList.js";
import { dateFormats, relativeDay } from "@utils/noteList.js";
import styles from "./styles.module.css";

/** How many notes the recent activity shows. */
const RECENT = 5;

/**
 * The first screen: the three modes in one line each, the latest notes and
 * a placeholder for the future chat. Picking a mode only calls `onPick`; the
 * wiring (changing mode, going to Translate) lives in `App`. With a lane
 * running (`running`) only the running mode (`mode`) can be picked: it goes
 * back to it. `mode` is also the one highlighted when nothing runs (the last used).
 * @param {{
 *   visible: boolean, mode: import("@app/types").Mode, running: boolean, callMode: boolean,
 *   pair: import("@app/types").LangPair, languages: import("@utils/api").LanguageInfo[],
 *   onPair: (pair: import("@app/types").LangPair) => void, noTranslate: boolean,
 *   onPick: (mode: import("@app/types").Mode) => void, onMenu: () => void,
 *   onOpenNote: (id: string) => void, onSeeAll: () => void,
 * }} props
 */
export default function Home({ visible, mode, running, callMode, pair, languages, onPair, noTranslate, onPick, onMenu, onOpenNote, onSeeAll }) {
  const t = useT();
  const { lang } = useLang();
  const formats = useMemo(() => dateFormats(lang), [lang]);
  const { notes, loaded } = useNotesList({ active: visible, live: null, formats, t });
  const recent = notes.slice(0, RECENT);

  /** @type {[import("@app/types").Mode, "audio" | "call" | "notes", string, import("react").ReactNode][]} */
  const modes = [
    ["video", "audio", "audio", <SwapIcon key="a" />],
    ["call", "call", "call", <CallIcon key="c" />],
    ["notes", "notes", "notes", <PenIcon key="n" />],
  ];

  return (
    <main className="app" hidden={!visible}>
      <header className="topbar">
        <div className="brand">
          <MenuButton onClick={onMenu} recording={running} />
          <PageHeader title={t("home.title")} subtitle={t("home.subtitle")} />
        </div>
        <div className={styles.origin}>
          <span>{t("home.origin")}</span>
          <PairBar pair={pair} languages={languages} onChange={onPair} locked={running} mode="video" noTranslate={noTranslate} />
          <ThemeToggle />
        </div>
      </header>
      <div className="notes-scroll">
        <div className={cx("notes-column", styles.column)}>
          <div className={styles.modes}>
            {modes.map(([value, key, tone, icon]) => {
              const locked = value === "call" && !callMode;
              const isRunning = running && mode === value;
              return (
                <ModeCard
                  key={value}
                  tone={tone}
                  icon={icon}
                  title={t(`home.${key}.title`)}
                  description={t(`home.${key}.desc`)}
                  action={locked ? t("app.mode.callSoon") : isRunning ? t("home.running.action") : t(`home.${key}.action`)}
                  highlighted={!locked && mode === value}
                  disabled={locked || (running && mode !== value)}
                  hint={locked ? t("app.mode.callSoon.hint") : running && mode !== value ? t("app.mode.stopToChange") : undefined}
                  onClick={() => onPick(value)}
                />
              );
            })}
          </div>
          <div className={styles.lower}>
            <section className={styles.panel} aria-labelledby="home-recent">
              <div className={styles.panelHead}>
                <h2 id="home-recent">{t("home.recent")}</h2>
                <LinkButton onClick={onSeeAll}>{t("home.seeAll")}</LinkButton>
              </div>
              {loaded && recent.length === 0 && <p className="muted">{t("home.recent.empty")}</p>}
              <ul className={styles.list}>
                {recent.map((n) => (
                  <li key={n.id}>
                    <ActivityRow
                      icon={n.kind === "notes" ? <PenIcon /> : <SwapIcon />}
                      tone={n.kind === "notes" ? "notes" : "audio"}
                      title={n.title}
                      subtitle={[n.summary_line || n.preview, relativeDay(n.created_at, formats, t)].filter(Boolean).join(" · ")}
                      action={t("home.open")}
                      onClick={() => onOpenNote(n.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
            {/* Placeholder: the chat is a separate future plan. No state, no handlers. */}
            <section className={cx(styles.panel, styles.chat)} aria-labelledby="home-chat">
              <div className={styles.panelHead}>
                <h2 id="home-chat">{t("home.chat.title")}</h2>
                <Badge muted>{t("home.chat.soon")}</Badge>
              </div>
              <p className="muted">{t("home.chat.desc")}</p>
              <input className={styles.chatInput} disabled placeholder={t("home.chat.placeholder")} aria-label={t("home.chat.title")} />
              <button type="button" className={styles.chatButton} disabled>
                {t("home.chat.action")}
              </button>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
