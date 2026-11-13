import { useEffect, useRef, useState } from "react";
import { useT } from "@i18n";
import Markdown from "@components/Markdown";
import SummaryOptions from "@components/SummaryOptions";
import {
  Badge,
  ChatInput,
  ChatThread,
  ConfirmDialog,
  CopyIcon,
  IconButton,
  LockIcon,
  Menu,
  MenuItem,
  MoreIcon,
  SuggestionChips,
  useDismiss,
} from "@components/shared";
import { messageTime, streamingView, SUGGESTIONS, unaskedSuggestions } from "@utils/chat.js";
import styles from "./styles.module.css";

/** How long «Copiado» shows after copying an answer (ms). */
const COPIED_MS = 1500;

/**
 * The note's Chat tab: ask about this conversation and read the answer as it
 * is written. Where it answers is the summary's source (on the computer or a
 * service), shown as a small label over the messages; without one, the options to get
 * it take the input's place. It takes the rest of the window's height and
 * scrolls inside itself (the page does not); the input stays at the bottom
 * with the suggestions not asked yet over it. The state lives in the page
 * (`chat`, from `useNoteChat`).
 * @param {{ chat: ReturnType<typeof import("@hooks/useNoteChat").useNoteChat>, hasText: boolean, translating: boolean,
 *   serviceName: (id: string) => string, onJump: (secs: number) => void }} props
 *   `hasText`: the note has sentences; `translating`: a lane is translating (the computer's model would cut it).
 */
export default function NoteChat({ chat, hasText, translating, serviceName, onJump }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(-1);
  const copiedTimer = useRef(0);
  useDismiss(menuOpen, () => setMenuOpen(false));
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const local = chat.source.source === "local";
  // The computer's model and the translator don't fit together on every Mac.
  const reason = !hasText ? t("chat.noText") : local && translating ? t("chat.waitTranslation") : "";
  const showOptions = (chat.notReady || chat.model.downloading) && !chat.busy;
  const canAsk = !reason && chat.ready;
  const suggestions = SUGGESTIONS.map((id) => ({ id, label: t(`chat.suggest.${id}`) }));
  const followUps = chat.messages.length > 0 && !chat.busy && canAsk ? unaskedSuggestions(suggestions, chat.messages) : [];

  /** @param {string} text @param {number} index */
  const copy = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(index);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(-1), COPIED_MS);
    }, () => {});
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
      {followUps.length > 0 && <SuggestionChips className={styles.noteChatFollowUps} options={followUps} onPick={chat.ask} />}
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
        placeholder={reason || t("chat.placeholder")}
        sendLabel={t("chat.send")}
        stopLabel={t("chat.stop")}
      />
    </>
  );

  return (
    <div className={styles.noteChat}>
      <div className={styles.noteChatHead}>
        <div className={styles.noteChatTools}>
          <Badge muted icon={local ? <LockIcon /> : undefined}>
            {local ? t("chat.sourceLocal") : t("chat.sourceService", { name: serviceName(chat.source.source) })}
          </Badge>
          {chat.messages.length > 0 && (
            <div className={styles.noteChatMenu}>
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
        </div>
      </div>

      <ChatThread
        messages={chat.messages}
        streaming={chat.streaming}
        renderAnswer={(text, writing) => <Markdown text={writing ? streamingView(text) : text} onTime={onJump} writing={writing} />}
        renderActions={(m) => {
          const index = chat.messages.indexOf(m);
          return (
            <button type="button" className={styles.noteChatCopy} onClick={() => copy(m.text, index)}>
              <CopyIcon />
              {copied === index ? t("chat.copied") : t("chat.copy")}
            </button>
          );
        }}
        timeOf={(m) => messageTime(m.at)}
        assistantLabel={t("chat.assistant")}
        readingLabel={t("chat.reading")}
        stoppedLabel={t("chat.stopped")}
        latestLabel={t("chat.latest")}
        footer={footer}
      >
        <div className={styles.noteChatEmpty}>
          <p>{t("chat.empty")}</p>
          <SuggestionChips disabled={!canAsk} options={suggestions} onPick={chat.ask} />
        </div>
      </ChatThread>

      {chat.askConsent && (
        <ConfirmDialog
          title={t("chat.sendTitle")}
          body={t("chat.sendBody", { name: serviceName(chat.askConsent) })}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("notes.continue")}
          onCancel={chat.cancelConsent}
          onConfirm={chat.confirmConsent}
        />
      )}
      {confirming && (
        <ConfirmDialog
          danger
          title={t("chat.clearTitle")}
          body={t("chat.clearBody")}
          cancelLabel={t("notes.cancel")}
          confirmLabel={t("chat.clear")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            chat.clear();
          }}
        />
      )}
    </div>
  );
}
