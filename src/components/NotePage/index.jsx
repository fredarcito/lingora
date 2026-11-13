import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorMessage } from "@utils/api";
import Markdown from "@components/Markdown";
import MindMap from "@components/MindMap";
import { langName as langInSentence, useT } from "@i18n";
import SummaryOptions from "@components/SummaryOptions";
import { useNoteSummary } from "@hooks/useNoteSummary";
import { useNoteChat } from "@hooks/useNoteChat";
import NoteChat from "@components/NoteChat";
import { providerOf } from "@utils/summarySource.js";
import SpeakerBar from "@components/SpeakerBar";
import Transcript, { UserMarks } from "@components/Transcript";
import { partAt } from "@utils/mindMap.js";
import { NOTES_REFRESH_MS } from "@utils/noteList.js";
import { discardActive, renameActive } from "@utils/noteRecorder.js";
import { formatSpan, noteToText, SUMMARY_TEMPLATES, summaryLangOf, summaryPrompt, summaryTemplateOf, transcriptParts, userMarks } from "@utils/notes.js";
import {
  ArrowIcon,
  BookmarkIcon,
  Button,
  ConfirmDialog,
  CopyIcon,
  InlineSelect,
  LinkButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  NoteIcon,
  PenIcon,
  RefreshIcon,
  RotatingText,
  Spinner,
  Switch,
  cx,
  useDismiss,
} from "@components/shared";
import styles from "./styles.module.css";

/** Each block of a fresh summary starts this much after the previous one… */
const CONDENSE_STEP_MS = 60;
/** …up to this many steps, so a long summary is done in under 2 s. */
const CONDENSE_STEPS = 30;

/** The phrases while summarizing: what it is doing, in plain words. */
const WORKING_PHRASES = Array.from({ length: 9 }, (_, i) => `notes.working${i + 1}`);

/**
 * A note's page: editable title, actions and tabs.
 * @param {{ id: string, live: boolean, translating?: boolean, languages: import("@utils/api").LanguageInfo[], onBack: () => void, topSlot?: HTMLElement | null }} props
 * `translating`: a lane is translating now (the Chat tab on the computer waits for it to end).
 * `topSlot`: where «← All notes» and the day go (the page header, level with the ☰); without it they stay at the top of the page.
 */
export default function NotePage({ id, live, translating = false, languages, onBack, topSlot }) {
  const t = useT();
  const [note, setNote] = useState(/** @type {import("@utils/api").Note | null} */ (null));
  const [error, setError] = useState("");
  const [tab, setTab] = useState(/** @type {"summary" | "map" | "chat" | "transcript" | null} */ (null));
  const [showSource, setShowSource] = useState(false);
  // Transcript tab: all of it, or only the paragraphs with your notes or bookmarks.
  const [markFilter, setMarkFilter] = useState(/** @type {"all" | "note" | "bookmark"} */ ("all"));
  const [focus, setFocus] = useState(/** @type {{ part: number, nonce: number } | null} */ (null));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const summary = useNoteSummary(id, { setNote, setTab });
  const { summarizing, model, ready, notReady, askConsent } = summary;
  const chat = useNoteChat(id, { note, setNote, live });
  const noticeTimer = useRef(0);
  const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  // What the wait for a summary shows, in turn (it can take a minute on the computer).
  const working = WORKING_PHRASES.map((key) => t(key));
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

  // Each block's place in the cascade (headings, paragraphs and each point of a
  // list), set before painting so none shows early; the mark goes once all ended.
  useLayoutEffect(() => {
    const md = summaryRef.current?.firstElementChild;
    if (!summary.fresh || !md) return;
    const blocks = [...md.children].flatMap((el) => (el.tagName === "UL" ? [...el.children] : [el]));
    blocks.forEach((el, i) => /** @type {HTMLElement} */ (el).style.setProperty("--i", String(Math.min(i, CONDENSE_STEPS))));
    const timer = window.setTimeout(summary.endFresh, CONDENSE_STEPS * CONDENSE_STEP_MS + 1000);
    return () => window.clearTimeout(timer);
  }, [summary.fresh, note?.summary?.created_at, tab]);

  // A jump to a paragraph happens once: back in the transcript later, it opens where it opens.
  useEffect(() => {
    if (tab !== "transcript") setFocus(null);
  }, [tab]);

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

  /** A service's name as the interface shows it. @param {string} id */
  const serviceName = (id) => (providerOf(id)?.custom ? t("summarySource.custom") : providerOf(id)?.name ?? id);

  const remove = () =>
    run(async () => {
      discardActive(id);
      await api.noteDelete(id);
      onBack();
    });

  /** @param {import("react").ReactNode} node */
  const inTop = (node) => (topSlot ? createPortal(node, topSlot) : node);

  if (!note) {
    return (
      <div className="notes-scroll">
        <div className="notes-column">
          {inTop(
            <LinkButton className={styles.notesBack} onClick={onBack}>
              {t("notes.back")}
            </LinkButton>,
          )}
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
  const summaryTemplate = summaryTemplateOf(note);
  // The summary was made with another template than the chosen one.
  const staleTemplate = !!note.summary && (note.summary.template ?? "general") !== summaryTemplate;
  const staleLang = !!note.summary && summary.wasIn !== null && summary.wasIn !== summaryLang;
  const stale = staleLang || staleTemplate;
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
  /** Goes to the transcript at that second (the map's boxes and the times an answer cites). @param {number} secs */
  const jumpTo = (secs) => {
    const part = partAt(transcriptParts(note), secs);
    if (part === null) return;
    setTab("transcript");
    setMarkFilter("all");
    setFocus({ part, nonce: Date.now() });
  };
  const copyForChat = () => run(() => navigator.clipboard.writeText(`${summaryPrompt(note, languages)}\n\n${noteToText(note)}`), t("notes.copied"));

  return (
    <div className="notes-scroll">
      <div className="notes-column">
        {inTop(
          <div className={styles.noteTopline}>
            <LinkButton className={styles.notesBack} onClick={onBack}>
              {t("notes.back")}
            </LinkButton>
            <span className={styles.noteDay}>{day}</span>
          </div>,
        )}

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
              ["map", t("notes.tab.map")],
              ["transcript", t("notes.tab.transcript")],
              ["chat", t("notes.tab.chat")],
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
              {/* "Resumen General ⌄ en Español ⌄": each select has its own aria-label. */}
              <div className={styles.noteSummaryLang}>
                <span>{t("notes.tab.summary")}</span>
                <InlineSelect
                  value={summaryTemplate}
                  disabled={live || summarizing}
                  label={t("notes.summaryTemplate")}
                  options={SUMMARY_TEMPLATES.map((id) => ({ value: id, label: t(`notes.template.${id}`) }))}
                  onChange={(value) => {
                    const next = { ...note, summary_template: value };
                    setNote(next);
                    run(() => api.noteSave(next));
                  }}
                />
                <span>{t("notes.summaryInLang")}</span>
                <InlineSelect
                  value={summaryLang}
                  disabled={live || summarizing}
                  label={t("notes.summaryLang")}
                  options={languages.map((l) => ({ value: l.code, label: l.name }))}
                  onChange={(value) => {
                    if (note.summary) summary.langChanged(summaryLang);
                    const next = { ...note, summary_lang: value };
                    setNote(next);
                    run(() => api.noteSave(next));
                  }}
                />
              </div>
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
                <Button
                  className={styles.noteSummarize}
                  variant={note.summary && !stale ? "default" : "primary"}
                  busy={summarizing}
                  disabled={live || summarizing || !summarizable}
                  title={live ? t("notes.waitFinish") : undefined}
                  onClick={summary.ask}
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
            {staleLang && !summarizing && (
              <p className={styles.noteSummaryStale} role="status">
                {t("notes.summaryStale", { lang: langInSentence(/** @type {string} */ (summary.wasIn), langName(/** @type {string} */ (summary.wasIn)), true) })}
              </p>
            )}
            {staleTemplate && !summarizing && (
              <p className={styles.noteSummaryStale} role="status">
                {t("notes.summaryStaleTemplate", { template: t(`notes.template.${note.summary?.template ?? "general"}`) })}
              </p>
            )}
            {summarizing && (
              <p className={styles.noteWorking}>
                <Spinner small /> <RotatingText phrases={working} label={t("notes.working")} />
              </p>
            )}
            {summary.error && (
              <p className="notes-error" role="alert">
                {summary.error}
              </p>
            )}
            {/* Above the summary: with a long one, below it would be off screen. */}
            {((notReady && (!note.summary || summary.askDownload)) || model.downloading) && (
              <SummaryOptions
                model={model}
                memoryGb={summary.source.memoryGb}
                source={summary.source.source}
                onDownload={summary.getModel}
                onLocal={summary.summarizeHere}
                onKeySaved={summary.keySaved}
              />
            )}
            {note.summary && (
              <div ref={summaryRef} className={cx(styles.noteSummary, styles.noteSummaryCard, summary.fresh && styles.summaryFresh, summarizing && styles.summaryWorking)}>
                <Markdown className={styles.summaryMd} text={note.summary.text} />
                <div className={styles.noteSummaryFoot}>
                  <span>
                    {note.summary.source && note.summary.source !== "local"
                      ? t("notes.summaryFootWith", { name: serviceName(note.summary.source) })
                      : t("notes.summaryFoot")}
                  </span>
                  <LinkButton className={styles.noteToTranscript} onClick={() => setTab("transcript")}>
                    <ArrowIcon />
                    {t("notes.goTranscript")}
                  </LinkButton>
                </div>
              </div>
            )}
            {!note.summary && !summarizing && ready && (
              <div className={styles.noteSummaryEmpty}>
                <span className={styles.noteSummaryEmptyIcon} aria-hidden>
                  <NoteIcon />
                </span>
                <p>{t("notes.noSummary")}</p>
              </div>
            )}
          </>
        )}

        {tab === "map" &&
          (note.summary ? (
            <MindMap
              key={note.summary.created_at}
              title={note.title}
              summary={note.summary.text}
              short={note.summary.map}
              onJump={jumpTo}
              onExport={(png) => run(() => api.noteExportImage(id, png), t("notes.savedDownloads"))}
            />
          ) : summarizing ? (
            <p className={styles.noteWorking}>
              <Spinner small /> <RotatingText phrases={working} label={t("notes.working")} />
            </p>
          ) : (
            <div className={styles.noteSummaryEmpty}>
              <span className={styles.noteSummaryEmptyIcon} aria-hidden>
                <NoteIcon />
              </span>
              <p>{t(live ? "notes.waitFinish" : "notes.map.empty")}</p>
              {summary.error && (
                <p className="notes-error" role="alert">
                  {summary.error}
                </p>
              )}
              {!live && summarizable && (
                <Button variant="primary" onClick={summary.ask}>
                  {t("notes.summarize")}
                </Button>
              )}
            </div>
          ))}

        {tab === "chat" && (
          <NoteChat chat={chat} hasText={note.sentences.length > 0} translating={translating} serviceName={serviceName} onJump={jumpTo} />
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
          body={t("notes.sendBody", { name: serviceName(askConsent) })}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("notes.continue")}
          onCancel={summary.cancelConsent}
          onConfirm={summary.confirmConsent}
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
