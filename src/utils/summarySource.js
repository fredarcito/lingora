/**
 * Where summaries are made: on the computer (the default) or with the user's
 * own AI key. The services are named in the interface (the user needs to know
 * which key to paste and who receives the transcript); the models are not,
 * except the prefilled "model" field, which is the user's own account.
 * @typedef {{ id: string, name: string, model: string, custom?: boolean }} SummaryProvider
 * @typedef {{ provider: string, model: string, base_url?: string }} CloudRequest
 */

const SOURCE_KEY = "lingora.summarySource";
const MODELS_KEY = "lingora.summaryModels";
const BASE_URL_KEY = "lingora.summaryBaseUrl";
/** One per service: agreeing to send to one is not agreeing to send to another. */
const CONSENT_KEY = "lingora.summaryConsent.";

/** Below this much RAM (GB), the note recommends a key over the local summary (~3.5 GB). */
export const LOW_MEMORY_GB = 8;

/**
 * The services, in the order they are offered. `model` is the default
 * (checked 2026-11-02; the user can change it). `name` is a proper name;
 * the custom server's name comes from `t()`.
 * @type {SummaryProvider[]}
 */
export const PROVIDERS = [
  { id: "openai", name: "OpenAI", model: "gpt-5.4-nano" },
  { id: "anthropic", name: "Claude", model: "claude-opus-5-5" },
  { id: "gemini", name: "Gemini", model: "gemini-3.5-flash-lite" },
  { id: "groq", name: "Groq", model: "qwen/qwen3.8-27b" },
  { id: "openrouter", name: "OpenRouter", model: "openrouter/auto" },
  { id: "custom", name: "", model: "", custom: true },
];

/** @param {string} id @returns {SummaryProvider | undefined} */
export const providerOf = (id) => PROVIDERS.find((p) => p.id === id);

/** Whether the local summary would not fit well. Unknown RAM is not low. @param {number | null | undefined} gb */
export const isLowMemory = (gb) => typeof gb === "number" && gb < LOW_MEMORY_GB;

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage it only lasts this session.
  }
}

/** `"local"` or a service's id. @returns {string} */
export function loadSummarySource() {
  const saved = read(SOURCE_KEY);
  return saved && providerOf(saved) ? saved : "local";
}

/** @param {string} source */
export const storeSummarySource = (source) => save(SOURCE_KEY, source);

/** @returns {Record<string, string>} */
function loadModels() {
  try {
    return JSON.parse(read(MODELS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** The model chosen for a service, or its default. @param {string} id */
export const modelFor = (id) => loadModels()[id] || providerOf(id)?.model || "";

/** @param {string} id @param {string} model */
export function storeModel(id, model) {
  save(MODELS_KEY, JSON.stringify({ ...loadModels(), [id]: model.trim() }));
}

/** The custom server's address. */
export const loadBaseUrl = () => read(BASE_URL_KEY) ?? "";

/** @param {string} url */
export const storeBaseUrl = (url) => save(BASE_URL_KEY, url.trim());

/** @param {string} id */
export const hasConsent = (id) => read(CONSENT_KEY + id) === "true";

/** @param {string} id */
export const storeConsent = (id) => save(CONSENT_KEY + id, "true");

/** The chat with all the notes asks its own permission: it sends parts of several notes, not one. */
const NOTES_CHAT_CONSENT_KEY = "lingora.notesChatConsent.";

/** @param {string} id */
export const hasNotesChatConsent = (id) => read(NOTES_CHAT_CONSENT_KEY + id) === "true";

/** @param {string} id */
export const storeNotesChatConsent = (id) => save(NOTES_CHAT_CONSENT_KEY + id, "true");

/**
 * What `api.noteSummarize` takes to summarize with a key, or null for local.
 * @param {string} source @returns {CloudRequest | null}
 */
export function cloudRequest(source) {
  const provider = providerOf(source);
  if (!provider) return null;
  return provider.custom ? { provider: source, model: modelFor(source), base_url: loadBaseUrl() } : { provider: source, model: modelFor(source) };
}

/**
 * The model to preselect from the account's list: the one already chosen if
 * it is there, else the recommended one, else the first. With no list (a
 * custom server without one), the one already chosen.
 * @param {string[]} list @param {string} chosen @param {string} recommended
 */
export function pickModel(list, chosen, recommended) {
  if (!list.length) return chosen;
  if (list.includes(chosen)) return chosen;
  return list.includes(recommended) ? recommended : list[0];
}

/**
 * The list as it is offered: the recommended one first, then the rest in order.
 * @param {string[]} list @param {string} recommended
 */
export const modelOrder = (list, recommended) => (list.includes(recommended) ? [recommended, ...list.filter((m) => m !== recommended)] : list);
