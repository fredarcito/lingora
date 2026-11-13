import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@utils/api";
import { newMessage, requestTurns } from "@utils/chat.js";
import { downloadSummaryModel, useSummaryModel } from "@hooks/useSummaryModel";
import { notifySummarySource, useSummarySource } from "@hooks/useSummarySource";
import { cloudRequest, hasConsent, storeConsent, storeSummarySource } from "@utils/summarySource.js";

/**
 * The chat with one note: the messages (saved in the note, `chat`), the answer
 * being written, and where it answers (on the computer or with the user's key,
 * the same source as the summary, with the model download and the first-time
 * permission of each service on the way). It lives in the note's page, not in
 * the tab, so an answer in progress survives changing tabs. One question at a time.
 *
 * While the note is still being recorded (`live`) the recorder owns the file,
 * so the chat is not written to it; it is kept here and saved with the next
 * answer once the recording ends.
 * @param {string} id The note's id.
 * @param {{ note: import("@utils/api").Note | null,
 *   setNote: (update: (prev: import("@utils/api").Note | null) => import("@utils/api").Note | null) => void, live: boolean }} page
 */
export function useNoteChat(id, { note, setNote, live }) {
  const [messages, setMessagesState] = useState(/** @type {import("@utils/chat.js").ChatMessage[]} */ ([]));
  // What the answer in progress has written so far; null when none is in progress.
  const [streaming, setStreaming] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  // The service waiting for the first-time permission, with the question to send once allowed.
  const [askConsent, setAskConsent] = useState(/** @type {{ provider: string, text: string } | null} */ (null));
  const model = useSummaryModel();
  const source = useSummarySource();
  const cloudOn = source.source !== "local";
  const ready = cloudOn ? source.hasKey === true : model.installed === true;
  const notReady = cloudOn ? source.hasKey === false : model.installed === false;
  const busy = streaming !== null;

  // The latest messages, for the callbacks that outlive a render.
  const latest = useRef(messages);
  const liveRef = useRef(live);
  liveRef.current = live;
  // Bumped by «Borrar chat»: an answer started before it is dropped when it ends.
  const generation = useRef(0);
  /** @param {import("@utils/chat.js").ChatMessage[]} next */
  const setMessages = (next) => {
    latest.current = next;
    setMessagesState(next);
  };

  // The saved chat appears when the note loads, once (the page keeps reloading a live note).
  const loaded = useRef(false);
  useEffect(() => {
    if (!note || loaded.current) return;
    loaded.current = true;
    setMessages(note.chat ?? []);
  }, [note]);

  /** Writes the chat in the note (re-read first: its title or summary may have changed meanwhile). @param {import("@utils/chat.js").ChatMessage[]} chat */
  const persist = async (chat) => {
    if (liveRef.current) return;
    try {
      await api.noteSave({ ...(await api.noteRead(id)), chat });
      setNote((prev) => (prev ? { ...prev, chat } : prev));
    } catch (e) {
      console.warn("[lingora] no se pudo guardar el chat:", e);
    }
  };

  /** @param {string} text @param {import("@utils/summarySource.js").CloudRequest | null} cloud */
  const send = async (text, cloud) => {
    const before = latest.current;
    const gen = generation.current;
    const withQuestion = [...before, newMessage("user", text)];
    setMessages(withQuestion);
    setDraft("");
    setError("");
    setStreaming("");
    try {
      const answer = await api.noteChat(id, requestTurns(withQuestion), cloud, (piece) => setStreaming((s) => (s ?? "") + piece));
      if (gen !== generation.current) return;
      const next = [...withQuestion, newMessage("assistant", answer)];
      setMessages(next);
      await persist(next);
    } catch (e) {
      if (gen !== generation.current) return;
      // Nothing was answered: the question goes back to the field to try again.
      setMessages(before);
      setDraft(text);
      setError(errorMessage(e));
    } finally {
      setStreaming(null);
    }
  };

  /** Asks a question. With a service, the first time asks permission first. @param {string} text */
  const ask = (text) => {
    const q = text.trim();
    if (!q || busy || !ready) return;
    if (cloudOn && !hasConsent(source.source)) return setAskConsent({ provider: source.source, text: q });
    send(q, cloudRequest(source.source));
  };

  /** The user allowed sending the note to the service that was waiting. */
  const confirmConsent = () => {
    if (!askConsent) return;
    storeConsent(askConsent.provider);
    const { provider, text } = askConsent;
    setAskConsent(null);
    send(text, cloudRequest(provider));
  };

  /** Starts a new chat: the messages go, here and in the note. */
  const clear = () => {
    generation.current += 1;
    if (busy) api.chatStop().catch(() => {});
    setMessages([]);
    setError("");
    persist([]);
  };

  /** Downloads the model and, once there, makes the computer the place to answer. */
  const getModel = async () => {
    if (await downloadSummaryModel()) useLocal();
  };

  const useLocal = () => {
    storeSummarySource("local");
    notifySummarySource();
  };

  return {
    messages,
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
    ask,
    stop: () => api.chatStop().catch(() => {}),
    clear,
    getModel,
    useLocal,
    confirmConsent,
    cancelConsent: () => setAskConsent(null),
  };
}
