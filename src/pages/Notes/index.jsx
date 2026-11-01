import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@i18n";
import { MenuButton } from "@components/Sidebar";
import NotePage from "@components/NotePage";
import { useNotesList } from "@hooks/useNotesList.js";
import { activeNoteId, formatDuration } from "@utils/notes.js";
import { dateFormats, daysAgo, langPair, monthLabel, timeRange } from "@utils/noteList.js";
import { Badge, ChevronIcon, NoteIcon, PageHeader, SearchBox, Select, TranslateIcon, cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * Notes view: the list of saved conversations and, when one is pressed, its
 * full-width page. It stays mounted even when Translate is shown (the search box
 * is kept), but it only reads from disk while it is visible.
 * `openRequest` opens a specific note (when Take notes finishes): the `nonce`
 * tells apart two consecutive requests for the same note. `home` changes each
 * time Notes is picked in the side menu: back to the list, from the top.
 * @param {{ visible: boolean, recording: boolean, languages: import("@utils/api").LanguageInfo[], onMenu: () => void,
 *   openRequest?: { id: string, nonce: number } | null, home?: number }} props
 */
export default function Notes({ visible, recording, languages, onMenu, openRequest = null, home = 0 }) {
  const t = useT();
  const { lang } = useLang();
  const formats = useMemo(() => dateFormats(lang), [lang]);
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const live = recording ? activeNoteId() : null;
  const { notes, loaded, error, load, query, setQuery, period, setPeriod, order, setOrder, months, shown, groups } = useNotesList({
    active: visible && !openId,
    live,
    formats,
    t,
  });
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));
  const scrollTop = useRef(0);
  const search = useRef(/** @type {HTMLInputElement | null} */ (null));
  // ⌘K from an open note: goes back to the list and focuses the search box when it renders.
  const focusSearch = useRef(false);

  // Back from a note: the list where it was left. Coming from another screen:
  // from the top, not where a note was opened some time ago.
  useLayoutEffect(() => {
    if (!openId && scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, [openId]);
  useLayoutEffect(() => {
    if (!visible) return;
    scrollTop.current = 0;
    if (!openId && scroller.current) scroller.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** @param {string} id */
  const open = (id) => {
    scrollTop.current = scroller.current?.scrollTop ?? 0;
    setOpenId(id);
  };

  useLayoutEffect(() => {
    if (!home) return;
    scrollTop.current = 0;
    setOpenId(null);
  }, [home]);

  // Before painting: otherwise the list shows for a frame on the way from Take notes to the note.
  useLayoutEffect(() => {
    if (openRequest) setOpenId(openRequest.id);
  }, [openRequest]);

  // ⌘K: to the search box, also from an open note.
  useEffect(() => {
    if (!visible) return;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (openId) {
        focusSearch.current = true;
        setOpenId(null);
        load();
      } else search.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, openId, load]);

  useEffect(() => {
    if (openId || !focusSearch.current) return;
    focusSearch.current = false;
    search.current?.select();
  }, [openId]);

  /** The day before the time when the separator does not say it ("lunes · 10:32", "28 sept · 10:32"). @param {string} iso */
  const dayOf = (iso) => {
    const date = new Date(iso);
    const diff = daysAgo(date);
    return diff < 2 ? "" : diff < 7 ? formats.day.format(date) : formats.short.format(date);
  };

  return (
    <main className="app notes-view" hidden={!visible}>
      <header className="topbar notes-topbar">
        <div className={cx("brand", !openId && styles.notesBrand)}>
          <MenuButton onClick={onMenu} recording={recording} />
          {openId ? (
            <h1>{t("notes.title")}</h1>
          ) : (
            <SearchBox className={styles.notesTopsearch} inputRef={search} value={query} onChange={setQuery} placeholder={t("notes.search")} shortcut="⌘K" />
          )}
        </div>
      </header>

      {openId ? (
        <NotePage
          key={openId}
          id={openId}
          live={live === openId}
          languages={languages}
          onBack={() => {
            setOpenId(null);
            load();
          }}
        />
      ) : (
        <div className="notes-scroll" ref={scroller}>
          <div className="notes-column">
            <PageHeader
              title={t("notes.title")}
              subtitle={
                loaded &&
                notes.length > 0 &&
                (shown.length === notes.length ? t("notes.count", { count: notes.length }) : t("notes.countOf", { shown: shown.length, count: notes.length }))
              }
            >
              {notes.length > 0 && (
                <div className={styles.notesFilters}>
                  <Select
                    value={period}
                    label={t("notes.period")}
                    onChange={setPeriod}
                    options={[
                      { value: "all", label: t("notes.period.all") },
                      { value: "week", label: t("notes.period.week") },
                      { value: "month", label: t("notes.period.month") },
                      { value: "last", label: t("notes.period.last") },
                      ...months.map((k) => ({ value: `m:${k}`, label: monthLabel(k, formats) })),
                    ]}
                  />
                  <Select
                    value={order}
                    label={t("notes.order")}
                    onChange={(v) => setOrder(/** @type {any} */ (v))}
                    options={[
                      { value: "recent", label: t("notes.order.recent") },
                      { value: "oldest", label: t("notes.order.oldest") },
                    ]}
                  />
                </div>
              )}
            </PageHeader>
            {error && <p className="notes-error">{error}</p>}
            {loaded && !error && notes.length === 0 && (
              <div className={styles.notesEmptyState}>
                <span className={cx(styles.noteIcon, styles.big)} aria-hidden>
                  <NoteIcon />
                </span>
                <p>{t("notes.empty.title")}</p>
                <p className="muted">{t("notes.empty.hint")}</p>
              </div>
            )}
            {notes.length > 0 && shown.length === 0 && <p className="muted notes-empty">{t("notes.noMatch")}</p>}
            {groups.map(([label, items]) => (
              <section key={label} className={styles.notesGroup}>
                <h2 className={styles.notesDay}>
                  <span>{label}</span>
                </h2>
                <ul className={styles.notesList}>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button className={styles.noteItem} onClick={() => open(n.id)}>
                        <span className={styles.noteItemBody}>
                          <span className={styles.noteItemTitle}>
                            <span className={styles.noteItemName}>{n.title}</span>
                            {n.id === live && <span className="note-live">{t("notes.live")}</span>}
                            {/* The kind at a glance: notes in the accent color, translated conversations in gray. */}
                            {n.kind === "notes" ? (
                              <Badge icon={<NoteIcon />}>{t("notes.badge.notes")}</Badge>
                            ) : (
                              <Badge icon={<TranslateIcon />} muted>
                                {t("notes.badge.conversation")}
                              </Badge>
                            )}
                            {n.has_summary && <Badge>{t("notes.badge.summary")}</Badge>}
                          </span>
                          <span className={styles.noteItemMeta}>
                            {[
                              dayOf(n.created_at),
                              timeRange(n, n.id === live),
                              n.id !== live && formatDuration(/** @type {any} */ (n)),
                              langPair(n) ?? t("notes.sentences", { count: n.sentences }),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {(n.summary_line || n.preview) && <span className={styles.noteItemPreview}>{n.summary_line || n.preview}</span>}
                        </span>
                        <span className={styles.noteChevron} aria-hidden>
                          <ChevronIcon />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
