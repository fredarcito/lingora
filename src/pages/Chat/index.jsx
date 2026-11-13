import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@i18n";
import AnswerSources from "@components/AnswerSources";
import ChatList from "@components/ChatList";
import Markdown from "@components/Markdown";
import { MenuButton } from "@components/Sidebar";
import SummaryOptions from "@components/SummaryOptions";
import ThemeToggle from "@components/ThemeToggle";
import {
  Badge,
  ChatInput,
  ChatThread,
  ConfirmDialog,
  CopyIcon,
  IconButton,
  LockIcon,
  Menu,
  MenuIcon,
  MenuItem,
  MoreIcon,
  PageHeader,
  SuggestionChips,
  cx,
  useDismiss,
} from "@components/shared";
import { useWidth } from "@hooks/useWidth.js";
import { api } from "@utils/api";
import { ALL_SUGGESTIONS, isCheckedCitation, messageTime, streamingCitesView, unaskedSuggestions } from "@utils/chat.js";
import { providerOf } from "@utils/summarySource.js";
import styles from "./styles.module.css";

/** Below this width the list of chats folds behind a button. */
const NARROW = 760;
/** How long «Copiado» shows after copying an answer (ms). */
const COPIED_MS = 1500;
/** A note's title in a citation, at most this long. */
const CITE_TITLE = 28;

/**
 * The Chat page: ask about all the notes. On the left the saved chats
 * (`ChatList`), on the right the open one, as the note's Chat tab looks,
 * with each answer's sources under it (a source opens its note at that
 * moment, with «Volver al chat»). The state lives in `App` (`chat`, from
 * `useNotesChat`), so leaving and coming back keeps it. `request` is a
 * question typed on Home: it starts a new chat with it.
 * @param {{ visible: boolean, recording: boolean, chat: ReturnType<typeof import("@hooks/useNotesChat").useNotesChat>,
 *   request: { question: string, nonce: number } | null, onMenu: () => void,
 *   onOpenNote: (id: string, at: number | null) => void }} props
 */
export default function Chat({ visible, recording, chat, request, onMenu, onOpenNote }) {
  const t = useT();
  const { lang } = useLang();
  const [ref, width] = useWidth();
  const narrow = width > 0 && width < NARROW;
  const [listOpen, setListOpen] = useState(false);
  const [copied, setCopied] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useDismiss(menuOpen, () => setMenuOpen(false));
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  // The notes that exist now: for the sources of deleted notes and «Añadir nota».
  const [known, setKnown] = useState(/** @type {{ id: string, title: string, created_at: string }[] | null} */ (null));
  useEffect(() => {
    if (!visible) return;
    api.notesList().then(setKnown, () => setKnown(null));
  }, [visible, chat.messages.length]);

  const dayFormat = useMemo(() => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }), [lang]);
  /** `2026-11-03` → «3 nov». @param {string} date */
  const formatDay = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return y && m && d ? dayFormat.format(new Date(y, m - 1, d)) : date;
  };

  // A question typed on Home: a new chat with it (or in the field, if it can't be asked yet).
  const handled = useRef(0);
  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    chat.newChat();
    if (chat.ready && !chat.blocked && !chat.busy) chat.ask(request.question);
    else chat.setDraft(request.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const local = chat.source.source === "local";
  const serviceName = (/** @type {string} */ id) => (providerOf(id)?.custom ? t("summarySource.custom") : providerOf(id)?.name ?? id);
  const showOptions = (chat.notReady || chat.model.downloading) && !chat.busy;
  const canAsk = chat.ready && !chat.blocked;
  const suggestions = ALL_SUGGESTIONS.map((id) => ({ id, label: t(`chat.all.suggest.${id}`) }));
  /** A suggestion that ends in «…» is completed by the user. @param {string} label */
  const pick = (label) => (label.endsWith("…") ? chat.setDraft(label.slice(0, -1)) : chat.ask(label));
  // Over the input once the chat has started, as in the note's chat: the ones not asked yet.
  const followUps = chat.messages.length > 0 && !chat.busy && canAsk ? unaskedSuggestions(suggestions, chat.messages) : [];

  /** @param {string} text @param {number} index */
  const copy = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(index);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(-1), COPIED_MS);
    }, () => {});
  };

  /** @param {import("@utils/chat.js").AllChatMessage} m */
  const citeLinks = (m) => {
    const notes = m.notes ?? [];
    const citations = m.citations ?? [];
    const noteOf = (/** @type {number} */ n) => notes.find((x) => x.n === n);
    const short = (/** @type {string} */ title) => {
      const name = title.trim() || t("chat.all.untitled");
      return name.length > CITE_TITLE ? `${name.slice(0, CITE_TITLE - 1).trimEnd()}…` : name;
    };
    return {
      cite: {
        /** @param {number} n @param {string | null} clock */
        label: (n, clock) => {
          const note = noteOf(n);
          const secs = clock === null ? null : clock.split(":").reduce((a, x) => a * 60 + Number(x), 0);
          if (!note || !isCheckedCitation(citations, n, secs)) return null;
          return clock ? `${short(note.title)} · ${clock}` : short(note.title);
        },
        /** @param {number} n @param {number | null} secs */
        open: (n, secs) => {
          const note = noteOf(n);
          if (note) onOpenNote(note.id, secs);
        },
      },
      // A bare [mm:ss] only says which note when there was one.
      onTime: notes.length === 1 ? (/** @type {number} */ secs) => onOpenNote(notes[0].id, secs) : undefined,
    };
  };

  const footer = showOptions ? (
    <SummaryOptions
      model={chat.model}
      memoryGb={chat.source.memoryGb}
      source={chat.source.source}
      intro={t("chat.chooseHow")}
      submitLabel={t("chat.saveKey")}
      onDownload={chat.getModel}
      onLocal={chat.useLocal}
      onKeySaved={() => {}}
    />
  ) : (
    <>
      {followUps.length > 0 && <SuggestionChips className={styles.chatPageFollowUps} options={followUps} onPick={pick} />}
      {chat.error && (
        <p className="notes-error" role="alert">
          {chat.error}
        </p>
      )}
      <ChatInput
        value={chat.draft}
        onChange={chat.setDraft}
        onSend={() => chat.ask(chat.draft)}
        onStop={chat.stop}
        busy={chat.busy}
        disabled={!canAsk}
        placeholder={chat.blocked ? t("chat.waitTranslation") : t("chat.all.placeholder")}
        sendLabel={t("chat.send")}
        stopLabel={t("chat.stop")}
      />
    </>
  );

  const list = (
    <ChatList
      className={cx(styles.chatPageList, narrow && styles.isFloating)}
      chats={chat.chats}
      currentId={chat.current?.id ?? null}
      onNew={() => {
        chat.newChat();
        setListOpen(false);
      }}
      onOpen={(id) => {
        chat.open(id);
        setListOpen(false);
      }}
      onRename={chat.rename}
      onDelete={chat.remove}
    />
  );

  const brand = (
    <div className="brand">
      <MenuButton onClick={onMenu} recording={recording} />
      {narrow && (
        <IconButton label={listOpen ? t("chat.all.hideChats") : t("chat.all.showChats")} aria-expanded={listOpen} active={listOpen} onClick={() => setListOpen((o) => !o)}>
          <MenuIcon />
        </IconButton>
      )}
      <h1>{t("chat.all.title")}</h1>
    </div>
  );

  return (
    <main ref={ref} className={cx("notes-view", styles.chatShell)} hidden={!visible}>
      {!narrow && (
        <aside className={styles.chatSide}>
          {brand}
          {list}
        </aside>
      )}
      <div className={styles.chatBody}>
        {narrow && (
          <header className="topbar notes-topbar">
            {brand}
            <div className="topbar-end">
              <ThemeToggle />
            </div>
          </header>
        )}
        <PageHeader title={t("chat.all.heading")} subtitle={t("chat.all.subtitle")}>
          <div className={styles.chatPageHead}>
            <Badge muted icon={local ? <LockIcon /> : undefined}>
              {local ? t("chat.sourceLocal") : t("chat.sourceService", { name: serviceName(chat.source.source) })}
            </Badge>
            {chat.current && (
              <div className={styles.chatPageMenu}>
                <IconButton
                  small
                  label={t("chat.more")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  active={menuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((o) => !o);
                  }}
                >
                  <MoreIcon />
                </IconButton>
                {menuOpen && (
                  <Menu align="end" role="menu">
                    <MenuItem
                      onClick={() => {
                        setMenuOpen(false);
                        chat.newChat();
                      }}
                    >
                      {t("chat.all.newChat")}
                    </MenuItem>
                    <MenuItem
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirming(true);
                      }}
                    >
                      {t("chat.clear")}
                    </MenuItem>
                  </Menu>
                )}
              </div>
            )}
            {!narrow && <ThemeToggle />}
          </div>
        </PageHeader>
        <div className={styles.chatPage}>
          {narrow && listOpen && list}
        <section className={styles.chatPageMain} aria-label={t("chat.all.title")}>
          <ChatThread
            className={styles.chatPageThread}
            messages={chat.messages}
            streaming={chat.streaming}
            renderAnswer={(text, writing, m) =>
              writing || !m ? (
                <Markdown text={streamingCitesView(text)} cite={{ label: () => null, open: () => {} }} writing={writing} />
              ) : (
                <>
                  <Markdown text={text} {...citeLinks(m)} />
                  <AnswerSources
                    key={m.at}
                    message={m}
                    known={known}
                    formatDay={formatDay}
                    untitled={t("chat.all.untitled")}
                    disabled={!canAsk || chat.busy}
                    onOpen={onOpenNote}
                    onAskAgain={(ids) => {
                      const i = chat.messages.indexOf(m);
                      const question = chat.messages.slice(0, i).findLast((x) => x.role === "user");
                      if (question) chat.ask(question.text, ids);
                    }}
                  />
                </>
              )
            }
            renderActions={(m) => {
              if (m.notice) return null;
              const index = chat.messages.indexOf(m);
              return (
                <button type="button" className={styles.chatPageCopy} onClick={() => copy(m.text, index)}>
                  <CopyIcon />
                  {copied === index ? t("chat.copied") : t("chat.copy")}
                </button>
              );
            }}
            timeOf={(m) => messageTime(m.at)}
            assistantLabel={t("chat.assistant")}
            readingLabel={t("chat.all.reading")}
            stoppedLabel={t("chat.stopped")}
            latestLabel={t("chat.latest")}
            footer={footer}
          >
            <div className={styles.chatPageEmpty}>
              <p>{t("chat.all.empty")}</p>
              <p className={styles.chatPageHint}>{t("chat.all.hint")}</p>
              <SuggestionChips disabled={!canAsk} options={suggestions} onPick={pick} />
            </div>
          </ChatThread>
        </section>
        </div>
      </div>

      {confirming && chat.current && (
        <ConfirmDialog
          danger
          title={t("chat.all.deleteTitle")}
          body={t("chat.all.deleteBody")}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("chat.clear")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            if (chat.current) chat.remove(chat.current.id);
          }}
        />
      )}
      {chat.askConsent && (
        <ConfirmDialog
          title={t("chat.sendTitle")}
          body={t("chat.all.sendBody", { name: serviceName(chat.askConsent) })}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("notes.continue")}
          onCancel={chat.cancelConsent}
          onConfirm={chat.confirmConsent}
        />
      )}
    </main>
  );
}
