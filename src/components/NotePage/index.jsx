import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../utils/api";
import Markdown from "../Markdown";
import { langName as langInSentence, useT } from "../../i18n";
import { KeyPanel, useSummaryKey } from "../SummaryKey";
import SpeakerBar from "../SpeakerBar";
import Transcript, { UserMarks } from "../Transcript";
import { NOTES_REFRESH_MS } from "../../utils/noteList.js";
import {
  discardActive,
  formatSpan,
  loadSummaryConsent,
  noteToText,
  renameActive,
  setActiveSummary,
  storeSummaryConsent,
  summaryLangOf,
  summaryPrompt,
  userMarks,
} from "../../utils/notes.js";
import {
  ArrowIcon,
  BookmarkIcon,
  Button,
  ConfirmDialog,
  CopyIcon,
  LinkButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  NoteIcon,
  PenIcon,
  RefreshIcon,
  Spinner,
  Switch,
  cx,
  useDismiss,
} from "../shared";
import styles from "./styles.module.css";

/**
 * A note's page: editable title, actions and tabs.
 * @param {{ id: string, live: boolean, languages: import("../../utils/api").LanguageInfo[], onBack: () => void }} props
 */
export default function NotePage({ id, live, languages, onBack }) {
  const t = useT();
  const [note, setNote] = useState(/** @type {import("../../utils/api").Note | null} */ (null));
  const [error, setError] = useState("");
  const [tab, setTab] = useState(/** @type {"summary" | "transcript" | null} */ (null));
  const [showSource, setShowSource] = useState(false);
  // Transcript tab: all of it, or only the paragraphs with your notes or bookmarks.
  const [markFilter, setMarkFilter] = useState(/** @type {"all" | "note" | "bookmark"} */ ("all"));
  const [focus, setFocus] = useState(/** @type {{ part: number, nonce: number } | null} */ (null));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Language the summary is in, if the selector was changed after summarizing.
  const [summaryWasIn, setSummaryWasIn] = useState(/** @type {string | null} */ (null));
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [askConsent, setAskConsent] = useState(false);
  // Summarizing without a key leads to the panel in the Summary tab, even if there is already a summary.
  const [askKey, setAskKey] = useState(false);
  const { status: keyStatus, hasKey } = useSummaryKey();
  const noticeTimer = useRef(0);
  // The latest value of the `live` prop: the polling reads it without restarting.
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const n = await api.noteRead(id);
        if (cancelled) return;
        setNote((prev) => (editing && prev ? { ...n, title: prev.title } : n));
        setTab((t) => t ?? (n.summary ? "summary" : "transcript"));
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    load();
    const timer = window.setInterval(() => liveRef.current && load(), NOTES_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, editing]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // The ⋯ menu closes when clicking anywhere else or with Escape.
  useDismiss(menuOpen, () => setMenuOpen(false));

  /** @param {string} text */
  const say = (text) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  };

  /** @param {() => Promise<unknown>} action @param {string} [done] */
  const run = async (action, done) => {
    try {
      await action();
      if (done) say(done);
    } catch (e) {
      say(errorMessage(e));
    }
  };

  const commitTitle = () => {
    setEditing(false);
    const title = draft.trim();
    if (!note || !title || title === note.title) return;
    const next = { ...note, title };
    setNote(next);
    renameActive(note.id, title);
    run(() => api.noteSave(next));
  };

  const summarize = async () => {
    setAskConsent(false);
    setSummaryError("");
    setSummarizing(true);
    setTab("summary");
    try {
      await api.noteSummarize(id);
      const n = await api.noteRead(id);
      setNote((prev) => (prev ? { ...prev, summary: n.summary } : n));
      setActiveSummary(id, n.summary);
      setSummaryWasIn(null);
    } catch (e) {
      setSummaryError(errorMessage(e));
    } finally {
      setSummarizing(false);
    }
  };

  const askSummary = () => {
    setTab("summary");
    if (!hasKey) setAskKey(true);
    else if (!loadSummaryConsent()) setAskConsent(true);
    else summarize();
  };

  const remove = () =>
    run(async () => {
      discardActive(id);
      await api.noteDelete(id);
      onBack();
    });

  if (!note) {
    return (
      <div className="notes-scroll">
        <div className="notes-column">
          <LinkButton className={styles.notesBack} onClick={onBack}>
            {t("notes.back")}
          </LinkButton>
          <p className={error ? "notes-error" : cx("muted", styles.notesOpening)}>{error || t("notes.opening")}</p>
        </div>
      </div>
    );
  }

  /** @param {string} code */
  const langName = (code) => languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
  const first = note.sentences[0];
  const taking = note.kind === "notes";
  const langs = taking
    ? t("notes.transcription", { lang: first?.source_lang === "zh" ? t("notes.lang.zh") : t("notes.lang.auto") })
    : !first
      ? ""
      : first.source_lang === first.target_lang
        ? t("notes.untranslated", { lang: langName(first.source_lang) })
        : `${langName(first.source_lang)} → ${langName(first.target_lang)}`;
  const [day, ...span] = formatSpan(note).split(" · ");
  const meta = [...span, langs].filter(Boolean);
  const summaryLang = summaryLangOf(note, languages);
  // The summary is no longer in the chosen language: "Summarize again" becomes the primary button.
  const stale = !!note.summary && summaryWasIn !== null && summaryWasIn !== summaryLang;
  const hasPeople = note.sentences.some((s) => s.speaker !== null && s.speaker !== undefined);
  const marks = userMarks(note);
  const noteCount = marks.filter((m) => m.kind === "note").length;
  // Take notes: your notes may be private, so they count for the summary (and
  // can make one without a transcript) only if you include them.
  const withNotes = Boolean(note.summary_with_notes) && noteCount > 0;
  const summarizable = note.sentences.length > 0 || withNotes;
  const summaryHint = !note.summary && !live && summarizable && (
    <p className={cx(styles.noteSummaryHint, "muted")}>
      <LinkButton onClick={() => setTab("summary")}>{t("notes.goSummary")}</LinkButton>
    </p>
  );
  const copyForChat = () => run(() => navigator.clipboard.writeText(`${summaryPrompt(note, languages)}\n\n${noteToText(note)}`), t("notes.copied"));

  return (
    <div className="notes-scroll">
      <div className="notes-column">
        <div className={styles.noteTopline}>
          <LinkButton className={styles.notesBack} onClick={onBack}>
            {t("notes.back")}
          </LinkButton>
          <span className={styles.noteDay}>{day}</span>
        </div>

        <div className={cx(styles.noteHead, styles.noteHeadRow)}>
          <div className={styles.noteTitleBlock}>
            {!live && <p className={styles.noteEyebrow}>{t("notes.saved")}</p>}
            {editing ? (
              <input
                className={styles.noteTitleInput}
                autoFocus
                value={draft}
                aria-label={t("notes.titleLabel")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            ) : (
              <h2>
                <button
                  className={styles.noteTitle}
                  title={t("notes.changeTitle")}
                  onClick={() => {
                    setDraft(note.title);
                    setEditing(true);
                  }}
                >
                  {note.title}
                </button>
              </h2>
            )}
            <p className={styles.noteMeta}>
              {live && <span className="note-live">{t("notes.live")}</span>}
              <span>{meta.join(" · ")}</span>
            </p>
          </div>
          <div className={styles.noteMenuWrap}>
            <Button
              className={styles.noteMore}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("notes.more")}
              title={t("notes.more")}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              <MoreIcon />
            </Button>
            {menuOpen && (
              <Menu align="end" role="menu">
                {[
                  ["md", t("notes.exportMd")],
                  ["txt", t("notes.exportTxt")],
                ].map(([format, label]) => (
                  <MenuItem key={format} onClick={() => run(() => api.noteExport(id, /** @type {"md" | "txt"} */ (format)), t("notes.savedDownloads"))}>
                    {label}
                  </MenuItem>
                ))}
                <MenuItem title={t("notes.copyTitle")} onClick={copyForChat}>
                  {t("notes.copyForChat")}
                </MenuItem>
                <MenuItem onClick={() => run(() => api.noteReveal(id))}>{t("notes.reveal")}</MenuItem>
                <MenuSeparator />
                <MenuItem danger onClick={() => setConfirming(true)}>
                  {t("notes.delete")}
                </MenuItem>
              </Menu>
            )}
          </div>
        </div>
        <p className={styles.noteNotice} role="status">
          {notice}
        </p>

        <div className={styles.noteTabs}>
          <div className={styles.noteTabsGroup} role="tablist">
            {[
              ["summary", t("notes.tab.summary")],
              ["transcript", t("notes.tab.transcript")],
            ].map(([value, label]) => (
              <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? styles.isSelected : ""} onClick={() => setTab(/** @type {any} */ (value))}>
                {label}
              </button>
            ))}
          </div>
          {tab === "transcript" && !taking && (
            <Switch checked={showSource} onChange={setShowSource} label={t("notes.showSource")} />
          )}
          {/* Take notes: all of the transcript, or only the paragraphs with your notes or bookmarks. */}
          {tab === "transcript" && note.sentences.length > 0 && marks.length > 0 && (
            <div className={styles.noteMarksFilter} role="radiogroup" aria-label={t("notes.marks.title")}>
              {[
                { value: "all", label: t("notes.marks.all"), icon: null, n: null },
                { value: "note", label: t("notes.marks.notes"), icon: <PenIcon />, n: noteCount },
                { value: "bookmark", label: t("notes.marks.bookmarks"), icon: <BookmarkIcon />, n: marks.length - noteCount },
              ].map((o) => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={markFilter === o.value}
                  className={cx(styles.noteMarksOption, markFilter === o.value && styles.isSelected)}
                  disabled={o.n === 0}
                  onClick={() => setMarkFilter(/** @type {"all" | "note" | "bookmark"} */ (o.value))}
                >
                  {o.icon}
                  {o.label}
                  {o.n !== null && <span className={styles.noteMarksCount}>{o.n}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "summary" && (
          <>
            <div className={styles.noteSummaryBar}>
              <label className={styles.noteSummaryLang}>
                <span>{t("notes.summaryIn")}</span>
                <select
                  value={summaryLang}
                  disabled={live || summarizing}
                  aria-label={t("notes.summaryLang")}
                  onChange={(e) => {
                    if (note.summary && summaryWasIn === null) setSummaryWasIn(summaryLang);
                    const next = { ...note, summary_lang: e.target.value };
                    setNote(next);
                    run(() => api.noteSave(next));
                  }}
                >
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              {noteCount > 0 && (
                <Switch
                  className={styles.noteSummaryNotes}
                  checked={Boolean(note.summary_with_notes)}
                  disabled={live || summarizing}
                  label={t("notes.summaryWithNotes")}
                  title={t("notes.summaryWithNotesHint")}
                  onChange={(on) => {
                    const next = { ...note, summary_with_notes: on };
                    setNote(next);
                    run(() => api.noteSave(next));
                  }}
                />
              )}
              <div className={styles.noteSummaryActions}>
                {note.summary && (
                  <Button
                    className={styles.noteSummaryCopy}
                    aria-label={t("notes.copySummary")}
                    title={t("notes.copySummary")}
                    onClick={() => run(() => navigator.clipboard.writeText(/** @type {{ text: string }} */ (note.summary).text), t("notes.copied"))}
                  >
                    <CopyIcon />
                  </Button>
                )}
                {!note.summary && (
                  <Button title={t("notes.copyTitle")} disabled={!summarizable} onClick={copyForChat}>
                    {t("notes.copyForChat")}
                  </Button>
                )}
                <Button
                  variant={note.summary && !stale ? "default" : "primary"}
                  busy={summarizing}
                  disabled={live || summarizing || !summarizable}
                  title={live ? t("notes.waitFinish") : undefined}
                  onClick={askSummary}
                >
                  {summarizing ? (
                    t("notes.summarizing")
                  ) : note.summary ? (
                    <>
                      <RefreshIcon />
                      {t("notes.resummarize")}
                    </>
                  ) : (
                    t("notes.summarize")
                  )}
                </Button>
              </div>
            </div>
            {stale && !summarizing && (
              <p className={styles.noteSummaryStale} role="status">
                {t("notes.summaryStale", { lang: langInSentence(/** @type {string} */ (summaryWasIn), langName(/** @type {string} */ (summaryWasIn)), true) })}
              </p>
            )}
            {summarizing && (
              <p className={styles.noteWorking} role="status">
                <Spinner small /> {t("notes.working")}
              </p>
            )}
            {summaryError && (
              <p className="notes-error" role="alert">
                {summaryError}
              </p>
            )}
            {note.summary && (
              <div className={cx(styles.noteSummary, styles.noteSummaryCard)}>
                <Markdown className={styles.summaryMd} text={note.summary.text} />
                <div className={styles.noteSummaryFoot}>
                  <span>{t("notes.summaryFoot")}</span>
                  <LinkButton className={styles.noteToTranscript} onClick={() => setTab("transcript")}>
                    <ArrowIcon />
                    {t("notes.goTranscript")}
                  </LinkButton>
                </div>
              </div>
            )}
            {!note.summary && !summarizing && hasKey && (
              <div className={styles.noteSummaryEmpty}>
                <span className={styles.noteSummaryEmptyIcon} aria-hidden>
                  <NoteIcon />
                </span>
                <p>{t("notes.noSummary")}</p>
              </div>
            )}
            {keyStatus !== null && !hasKey && (!note.summary || askKey) && <KeyPanel onSaved={() => setAskKey(false)} />}
          </>
        )}

        {/* With people, the hint goes on the right of their row; without them, on its own. */}
        {tab === "transcript" && !hasPeople && summaryHint}

        {tab === "transcript" && hasPeople && (
          <SpeakerBar
            note={note}
            live={live}
            aside={summaryHint}
            onChange={(next) => {
              setNote(next);
              run(() => api.noteSave(next));
            }}
          />
        )}

        {tab === "transcript" &&
          (note.sentences.length === 0 && marks.length > 0 ? (
            <>
              <p className="muted notes-empty">{t("notes.nothingTranscribed")}</p>
              <UserMarks marks={marks} />
            </>
          ) : note.sentences.length === 0 ? (
            <p className="muted notes-empty">{t("notes.noSentences")}</p>
          ) : (
            <Transcript
              note={note}
              showSource={showSource}
              only={markFilter === "all" ? null : markFilter}
              focus={focus}
              onJump={(part) => {
                setMarkFilter("all");
                setFocus({ part, nonce: Date.now() });
              }}
            />
          ))}
      </div>

      {askConsent && (
        <ConfirmDialog
          title={t("notes.sendTitle")}
          body={t("notes.sendBody")}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("notes.continue")}
          onCancel={() => setAskConsent(false)}
          onConfirm={() => {
            storeSummaryConsent();
            summarize();
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          danger
          title={t("notes.delTitle")}
          body={t("notes.delBody", { title: note.title })}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("notes.delete")}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
