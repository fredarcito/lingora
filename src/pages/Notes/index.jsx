import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../utils/api";
import Markdown from "../../components/Markdown";
import { langName as langInSentence, useLang, useT } from "../../i18n";
import { MenuButton } from "../../components/Sidebar";
import { KeyPanel, useSummaryKey } from "../../components/SummaryKey";
import {
  activeNoteId,
  discardActive,
  formatClock,
  formatDuration,
  formatSpan,
  formatWhen,
  gapLabel,
  loadSummaryConsent,
  noteToText,
  renameActive,
  setActiveSummary,
  speakerLabel,
  speakerName,
  storeSummaryConsent,
  summaryLangOf,
  summaryPrompt,
  transcriptParts,
} from "../../utils/notes.js";
import {
  Badge,
  Button,
  ChevronIcon,
  ConfirmDialog,
  CopyIcon,
  LinkButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  NoteIcon,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
  Switch,
  cx,
  useDismiss,
} from "../../components/shared";
import styles from "./styles.module.css";

/** Cada cuánto se refresca lo que se está grabando. */
const REFRESH_MS = 3000;

/**
 * "ES → EN", o "ES" si no se tradujo. Tomar notas no tiene idioma fijo y las
 * notas guardadas antes no lo traen: entonces null.
 * @param {import("../../utils/api").NoteSummary} n
 */
function langPair(n) {
  const { source_lang: from, target_lang: to } = n;
  if (n.kind === "notes" || !from || !to) return null;
  return from === to ? from.toUpperCase() : `${from.toUpperCase()} → ${to.toUpperCase()}`;
}

/** Días entre la fecha y hoy, contando días de calendario (hoy = 0). @param {Date} date */
function daysAgo(date) {
  const day = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date()) - day(date)) / 86_400_000);
}

/** "2026-09": el mes de una fecha, para agrupar y filtrar. @param {Date} d */
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** @param {string} text */
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Sin acentos y en minúsculas, para que «sabado» encuentre «sábado». @param {string} text */
const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * @typedef {Object} DateFormats
 * @property {Intl.DateTimeFormat} weekday "jueves, 29 de octubre"
 * @property {Intl.DateTimeFormat} day "lunes"
 * @property {Intl.DateTimeFormat} short "28 sept"
 * @property {Intl.DateTimeFormat} month "octubre"
 * @property {Intl.DateTimeFormat} monthYear "septiembre de 2026"
 */

/**
 * Nombre de un mes para el separador y el filtro: "Octubre" o, si es de otro
 * año, "Septiembre de 2025".
 * @param {string} key "2026-09" @param {DateFormats} formats
 */
function monthLabel(key, formats) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return capitalize((year === new Date().getFullYear() ? formats.month : formats.monthYear).format(date));
}

/**
 * El separador de la nota: "Hoy · jueves, 29 de octubre", "Ayer · …",
 * "Esta semana" y, de ahí para atrás, el mes. Así una lista de meses no se
 * llena de cabeceras de días.
 * @param {string} iso @param {DateFormats} formats @param {import("../../i18n").t} t
 */
function groupLabel(iso, formats, t) {
  const date = new Date(iso);
  const diff = daysAgo(date);
  const full = formats.weekday.format(date);
  if (diff === 0) return t("notes.today", { date: full });
  if (diff === 1) return t("notes.yesterday", { date: full });
  if (diff < 7) return t("notes.thisWeek");
  return monthLabel(monthKey(date), formats);
}

/**
 * Si la nota entra en el periodo elegido: "all", "week" (los últimos 7 días),
 * "month" (este mes), "last" (el mes pasado) o "m:2026-08".
 * @param {string} iso @param {string} period
 */
function inPeriod(iso, period) {
  const date = new Date(iso);
  const now = new Date();
  if (period === "week") return daysAgo(date) < 7;
  if (period === "month") return monthKey(date) === monthKey(now);
  if (period === "last") return monthKey(date) === monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (period.startsWith("m:")) return monthKey(date) === period.slice(2);
  return true;
}

/** "10:32 – 11:07" o solo "10:32" si sigue grabando. @param {import("../../utils/api").NoteSummary} n @param {boolean} live */
function timeRange(n, live) {
  const start = formatWhen(n.created_at).split(" · ")[1];
  if (live || !n.ended_at) return start;
  return `${start} – ${formatWhen(n.ended_at).split(" · ")[1]}`;
}

/**
 * Vista de notas: la lista de conversaciones guardadas y, al pulsar una, su
 * página a ancho completo. Sigue montada aunque se vea Traducir (el buscador
 * se conserva), pero solo consulta el disco mientras está visible.
 * `openRequest` abre una nota concreta (al terminar Tomar notas): el `nonce`
 * distingue dos peticiones seguidas de la misma nota.
 * @param {{ visible: boolean, recording: boolean, languages: import("../../utils/api").LanguageInfo[], onMenu: () => void,
 *   openRequest?: { id: string, nonce: number } | null }} props
 */
export default function Notes({ visible, recording, languages, onMenu, openRequest = null }) {
  const t = useT();
  const { lang } = useLang();
  /** @type {DateFormats} */
  const formats = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }),
      day: new Intl.DateTimeFormat(lang, { weekday: "long" }),
      short: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }),
      month: new Intl.DateTimeFormat(lang, { month: "long" }),
      monthYear: new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }),
    }),
    [lang],
  );
  /** @type {[import("../../utils/api").NoteSummary[], Function]} */
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [order, setOrder] = useState(/** @type {"recent" | "oldest"} */ ("recent"));
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));
  const scrollTop = useRef(0);
  const search = useRef(/** @type {HTMLInputElement | null} */ (null));
  // ⌘K desde una nota abierta: vuelve a la lista y enfoca el buscador al pintarla.
  const focusSearch = useRef(false);

  const load = useCallback(async () => {
    try {
      setNotes(await api.notesList());
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!visible || openId) return;
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible, openId, load]);

  // Al volver a la lista, donde se había dejado.
  useLayoutEffect(() => {
    if (!openId && scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, [openId, visible]);

  /** @param {string} id */
  const open = (id) => {
    scrollTop.current = scroller.current?.scrollTop ?? 0;
    setOpenId(id);
  };

  useEffect(() => {
    if (openRequest) setOpenId(openRequest.id);
  }, [openRequest]);

  // ⌘K: al buscador, también desde una nota abierta.
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

  // Lo que encuentra el buscador de cada nota: título, texto y su fecha escrita
  // de varias formas ("jueves", "28 oct", "septiembre de 2026").
  const haystacks = useMemo(
    () =>
      new Map(
        notes.map((n) => {
          const d = new Date(n.created_at);
          return [n.id, fold(`${n.title} ${n.preview} ${n.summary_line ?? ""} ${formats.weekday.format(d)} ${formats.short.format(d)} ${formats.monthYear.format(d)}`)];
        }),
      ),
    [notes, formats],
  );
  // Los meses con notas, del más nuevo al más viejo, sin este ni el pasado (ya tienen su opción).
  const months = useMemo(() => {
    const now = new Date();
    const recent = [monthKey(now), monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
    return [...new Set(notes.map((n) => monthKey(new Date(n.created_at))))].filter((k) => !recent.includes(k)).sort().reverse();
  }, [notes]);

  const terms = fold(query).split(/\s+/).filter(Boolean);
  const shown = notes.filter((n) => inPeriod(n.created_at, period) && terms.every((term) => haystacks.get(n.id)?.includes(term)));
  const live = recording ? activeNoteId() : null;
  // Agrupado por día y luego por mes; en "Más recientes", la nota en curso primero.
  const sorted = order === "recent" ? [...shown].sort((a, b) => Number(b.id === live) - Number(a.id === live)) : [...shown].reverse();
  /** @type {[string, import("../../utils/api").NoteSummary[]][]} */
  const groups = [];
  for (const n of sorted) {
    const label = groupLabel(n.created_at, formats, t);
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(n);
    else groups.push([label, [n]]);
  }
  /** El día delante de la hora cuando el separador no lo dice ("lunes · 10:32", "28 sept · 10:32"). @param {string} iso */
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
                            {n.kind === "notes" && <Badge>{t("notes.badge.notes")}</Badge>}
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

/**
 * La página de una nota: título editable, acciones y pestañas.
 * @param {{ id: string, live: boolean, languages: import("../../utils/api").LanguageInfo[], onBack: () => void }} props
 */
function NotePage({ id, live, languages, onBack }) {
  const t = useT();
  const [note, setNote] = useState(/** @type {import("../../utils/api").Note | null} */ (null));
  const [error, setError] = useState("");
  const [tab, setTab] = useState(/** @type {"summary" | "transcript" | null} */ (null));
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Idioma en que está el resumen si se cambió el selector después de resumir.
  const [summaryWasIn, setSummaryWasIn] = useState(/** @type {string | null} */ (null));
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [askConsent, setAskConsent] = useState(false);
  // Resumir sin clave lleva al panel de la pestaña Resumen, aunque ya haya un resumen.
  const [askKey, setAskKey] = useState(false);
  const { status: keyStatus, hasKey } = useSummaryKey();
  const noticeTimer = useRef(0);
  // Lo último que dijo la propiedad `live`: el sondeo lo lee sin reiniciarse.
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
    const timer = window.setInterval(() => liveRef.current && load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, editing]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // El menú ⋯ se cierra al pulsar en cualquier otro sitio o con Escape.
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
          <p className={error ? "notes-error" : "muted"}>{error || t("notes.opening")}</p>
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
  // El resumen ya no está en el idioma elegido: «Volver a resumir» pasa a principal.
  const stale = !!note.summary && summaryWasIn !== null && summaryWasIn !== summaryLang;
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
              <div className={styles.noteSummaryActions}>
                {!note.summary && (
                  <Button title={t("notes.copyTitle")} disabled={note.sentences.length === 0} onClick={copyForChat}>
                    {t("notes.copyForChat")}
                  </Button>
                )}
                <Button
                  variant={note.summary && !stale ? "default" : "primary"}
                  busy={summarizing}
                  disabled={live || summarizing || note.sentences.length === 0}
                  title={live ? t("notes.waitFinish") : undefined}
                  onClick={askSummary}
                >
                  {summarizing ? t("notes.summarizing") : note.summary ? t("notes.resummarize") : t("notes.summarize")}
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
                <Button
                  className={styles.noteSummaryCopy}
                  aria-label={t("notes.copySummary")}
                  title={t("notes.copySummary")}
                  onClick={() => run(() => navigator.clipboard.writeText(/** @type {{ text: string }} */ (note.summary).text), t("notes.copied"))}
                >
                  <CopyIcon />
                </Button>
                <Markdown className={styles.summaryMd} text={note.summary.text} />
                <p className={styles.noteSummaryFoot}>{t("notes.summaryFoot")}</p>
              </div>
            )}
            {!note.summary && !summarizing && hasKey && (
              <p className="muted notes-empty">{t("notes.noSummary")}</p>
            )}
            {keyStatus !== null && !hasKey && (!note.summary || askKey) && <KeyPanel onSaved={() => setAskKey(false)} />}
          </>
        )}

        {tab === "transcript" && !note.summary && !live && note.sentences.length > 0 && (
          <p className={cx(styles.noteSummaryHint, "muted")}>
            {t("notes.summaryHint")} <LinkButton onClick={() => setTab("summary")}>{t("notes.goSummary")}</LinkButton>
          </p>
        )}

        {tab === "transcript" && note.sentences.some((s) => s.speaker !== null && s.speaker !== undefined) && (
          <SpeakerBar
            note={note}
            live={live}
            onChange={(next) => {
              setNote(next);
              run(() => api.noteSave(next));
            }}
          />
        )}

        {tab === "transcript" &&
          (note.sentences.length === 0 ? (
            <p className="muted notes-empty">{t("notes.noSentences")}</p>
          ) : (
            <Transcript note={note} showSource={showSource} />
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

/**
 * La transcripción en párrafos, con hora, persona y color. La usan la página
 * de la nota y la vista en vivo de Tomar notas.
 * @param {{ note: import("../../utils/api").Note, showSource?: boolean }} props
 */
export function Transcript({ note, showSource = false }) {
  return (
    <ol className="note-lines">
      {transcriptParts(note).map((part, i) => {
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
          <li key={i} className={who ? "note-line has-who" : "note-line"}>
            <span className="note-time">{formatClock(first.t)}</span>
            <span className="note-text">
              {who && (
                <b className="note-who" style={{ "--who": speakerColor(first.speaker) }}>
                  {who}
                </b>
              )}
              <span>{block.map((x) => x.translation ?? x.source).join(" ")}</span>
              {showSource && translated && <small>{block.map((x) => x.source).join(" ")}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Un color por persona; "Yo" (0) va en el color de la app. */
const SPEAKER_COLORS = ["#7dd3fc", "#fca5a5", "#c4b5fd", "#fcd34d", "#86efac", "#f9a8d4"];
/** @param {number | null | undefined} n */
export const speakerColor = (n) => (n === 0 || n === null || n === undefined ? "var(--accent)" : SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length]);

/**
 * Las personas de la nota, para corregir lo que se detectó: cambiarles el
 * nombre ("Persona 2" → "Ana") o unir dos que son la misma (la misma voz
 * puede sonar distinta un rato). Mientras se graba no se edita: el grabador
 * reescribiría la nota.
 * @param {{ note: import("../../utils/api").Note, live: boolean, onChange: (note: import("../../utils/api").Note) => void }} props
 */
function SpeakerBar({ note, live, onChange }) {
  const t = useT();
  const [editing, setEditing] = useState(/** @type {number | null} */ (null));
  const [name, setName] = useState("");
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const s of note.sentences) {
    if (s.speaker !== null && s.speaker !== undefined) counts.set(s.speaker, (counts.get(s.speaker) ?? 0) + 1);
  }
  const people = [...counts.keys()].sort((a, b) => a - b);
  /** @param {number} n */
  const label = (n) => speakerLabel(note, /** @type {any} */ ({ speaker: n }));
  /** Lo que se edita: tu nombre sin "(Yo)"; a los demás, "Persona n" si aún no tienen. @param {number} n */
  const editable = (n) => speakerName(note, n) || (n === 0 ? "" : label(n));

  // Se cierra al pulsar fuera o con Esc.
  useDismiss(editing !== null, () => setEditing(null));

  /** @param {number} n */
  const rename = (n) => {
    const value = name.trim();
    setEditing(null);
    if (!value || value === editable(n)) return;
    onChange({ ...note, speakers: { ...note.speakers, [n]: value } });
  };

  /** Las frases de `from` pasan a `into`. @param {number} from @param {number} into */
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
      <span className={styles.speakerBarLabel}>{t("notes.speakers")}</span>
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
            {label(n)}
            <span className={styles.speakerCount}>{counts.get(n)}</span>
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
    </div>
  );
}
