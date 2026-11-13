import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@i18n";
import { api, errorMessage } from "@utils/api";
import { chatTitle, localDate, newChatId, newMessage, requestTurns } from "@utils/chat.js";
import { downloadSummaryModel, useSummaryModel } from "@hooks/useSummaryModel";
import { notifySummarySource, useSummarySource } from "@hooks/useSummarySource";
import { cloudRequest, hasNotesChatConsent, storeNotesChatConsent, storeSummarySource } from "@utils/summarySource.js";

/**
 * What the interface says when the chat didn't ask the model (`notice`).
 * @param {NonNullable<import("@utils/api").NotesAnswer["notice"]>} notice
 */
export function noticeText(notice) {
  switch (notice.kind) {
    case "clarify":
      return notice.ask;
    case "ambiguous":
      return t("chat.all.notice.ambiguous", { person: notice.person, names: notice.names.join(", ") });
    case "no_person":
      return t("chat.all.notice.noPerson", { person: notice.person });
    case "vague":
      return t("chat.all.notice.vague");
    case "no_notes":
      return t("chat.all.notice.noNotes");
    default:
      return t("chat.all.notice.nothingFound");
  }
}

/**
 * The chat with all the notes (the Chat page): the saved chats, the one
 * open, the answer being written and where it answers (the summary's source,
 * like the note chat, with its own first-time permission per service: it
 * sends parts of several notes). It lives in `App`, above the pages, so going
 * to a note from a source and coming back finds it as it was, even with an
 * answer still being written. One question at a time.
 * @param {{ translating: boolean }} options `translating`: a lane is translating (the computer's model would cut it).
 */
export function useNotesChat({ translating }) {
  const [chats, setChats] = useState(/** @type {{ id: string, title: string, updated_at: string }[]} */ ([]));
  // The open chat; null for a new one, not saved until its first answer.
  const [current, setCurrentState] = useState(/** @type {import("@utils/chat.js").SavedChat | null} */ (null));
  const [streaming, setStreaming] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [askConsent, setAskConsent] = useState(/** @type {{ provider: string, text: string, noteIds: string[] | null } | null} */ (null));
  const model = useSummaryModel();
  const source = useSummarySource();
  const cloudOn = source.source !== "local";
  const ready = cloudOn ? source.hasKey === true : model.installed === true;
  const notReady = cloudOn ? source.hasKey === false : model.installed === false;
  const busy = streaming !== null;
  // On the computer the chat's model and the translator don't fit together everywhere.
  const blocked = !cloudOn && translating;

  const latest = useRef(current);
  /** @param {import("@utils/chat.js").SavedChat | null} next */
  const setCurrent = (next) => {
    latest.current = next;
    setCurrentState(next);
  };
  // Bumped by «Nuevo chat», opening another or deleting this one: an answer started before is dropped.
  const generation = useRef(0);

  const loadList = useCallback(async () => {
    try {
      setChats(await api.chatsList());
    } catch (e) {
      console.warn("[lingora] no se pudieron listar los chats:", e);
    }
  }, []);
  useEffect(() => {
    loadList();
  }, [loadList]);

  /** @param {import("@utils/chat.js").SavedChat} chat */
  const persist = async (chat) => {
    try {
      await api.chatSave(chat);
      await loadList();
    } catch (e) {
      console.warn("[lingora] no se pudo guardar el chat:", e);
    }
  };

  /** @param {string} text @param {string[] | null} noteIds @param {import("@utils/summarySource.js").CloudRequest | null} cloud */
  const send = async (text, noteIds, cloud) => {
    const now = new Date();
    const before = latest.current;
    const base = before ?? { id: newChatId(now), title: chatTitle(text), created_at: now.toISOString(), updated_at: now.toISOString(), messages: [] };
    const withQuestion = { ...base, messages: [...base.messages, newMessage("user", text, now)] };
    const gen = generation.current;
    setCurrent(withQuestion);
    setDraft("");
    setError("");
    setStreaming("");
    try {
      const answer = await api.notesChat(requestTurns(withQuestion.messages), localDate(now), cloud, noteIds, (piece) => setStreaming((s) => (s ?? "") + piece));
      if (gen !== generation.current) return;
      /** @type {import("@utils/chat.js").AllChatMessage} */
      const reply = {
        ...newMessage("assistant", answer.notice ? noticeText(answer.notice) : answer.text),
        notes: answer.notes,
        citations: answer.citations,
        overview: answer.overview,
        basis: answer.basis,
        ...(answer.notice ? { notice: answer.notice.kind } : {}),
      };
      const next = { ...withQuestion, updated_at: new Date().toISOString(), messages: [...withQuestion.messages, reply] };
      setCurrent(next);
      await persist(next);
    } catch (e) {
      if (gen !== generation.current) return;
      // Nothing was answered: the question goes back to the field to try again.
      setCurrent(before);
      setDraft(text);
      setError(errorMessage(e));
    } finally {
      if (gen === generation.current) setStreaming(null);
    }
  };

  /**
   * Asks a question; with `noteIds`, about exactly those notes (the chips
   * under an answer, changed by the user). With a service, the first time asks permission.
   * @param {string} text @param {string[] | null} [noteIds]
   */
  const ask = (text, noteIds = null) => {
    const q = text.trim();
    if (!q || busy || !ready || blocked) return;
    if (cloudOn && !hasNotesChatConsent(source.source)) return setAskConsent({ provider: source.source, text: q, noteIds });
    send(q, noteIds, cloudRequest(source.source));
  };

  const confirmConsent = () => {
    if (!askConsent) return;
    storeNotesChatConsent(askConsent.provider);
    const { provider, text, noteIds } = askConsent;
    setAskConsent(null);
    send(text, noteIds, cloudRequest(provider));
  };

  /** Leaves the chat in progress (an answer being written is stopped and dropped). */
  const leave = () => {
    generation.current += 1;
    if (busy) api.chatStop().catch(() => {});
    setStreaming(null);
    setError("");
  };

  /** A new, empty chat (saved with its first answer). */
  const newChat = () => {
    leave();
    setCurrent(null);
    setDraft("");
  };

  /** @param {string} id */
  const open = async (id) => {
    if (latest.current?.id === id) return;
    leave();
    try {
      setCurrent(await api.chatRead(id));
      setDraft("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** @param {string} id @param {string} title */
  const rename = async (id, title) => {
    const name = title.replace(/\s+/g, " ").trim();
    if (!name) return;
    try {
      const chat = latest.current?.id === id ? latest.current : await api.chatRead(id);
      const next = { ...chat, title: name };
      if (latest.current?.id === id) setCurrent(next);
      await persist(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** @param {string} id */
  const remove = async (id) => {
    try {
      await api.chatDelete(id);
      if (latest.current?.id === id) newChat();
      await loadList();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const getModel = async () => {
    if (await downloadSummaryModel()) useLocal();
  };

  const useLocal = () => {
    storeSummarySource("local");
    notifySummarySource();
  };

  return {
    chats,
    current,
    messages: /** @type {import("@utils/chat.js").AllChatMessage[]} */ (current?.messages ?? []),
    streaming,
    busy,
    error,
    draft,
    setDraft,
    askConsent: askConsent?.provider ?? null,
    model,
    source,
    ready,
    notReady,
    blocked,
    ask,
    stop: () => api.chatStop().catch(() => {}),
    newChat,
    open,
    rename,
    remove,
    getModel,
    useLocal,
    confirmConsent,
    cancelConsent: () => setAskConsent(null),
  };
}
