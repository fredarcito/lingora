/**
 * Settings → Disk space: what to call each downloaded thing and what deleting
 * it costs. The list comes from `api.storageStatus()`.
 */

/** Current models, by id (the same as its diagnostics check). */
const MODELS = new Set(["listener", "sense_voice", "translator", "voice_model", "speakers", "summary", "own_voice"]);

/**
 * Size as people read it: "1,3 GB" or "145 MB" (in the interface language).
 * @param {number} bytes @param {string} lang
 */
export function formatSize(bytes, lang) {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1_000_000)).toLocaleString(lang)} MB`;
}

/** @param {import("@utils/api").OnDisk[]} items */
export const totalBytes = (items) => items.reduce((sum, i) => sum + i.bytes, 0);

/** A light voice: its id is "piper:<name>" (`piper.rs`). @param {import("@utils/api").OnDisk} item */
const isLightVoice = (item) => !item.obsolete && item.id.startsWith("piper:");

/**
 * i18n key of the item's name: generic, never the model's name. A light voice
 * takes `{ name }` from `itemNameVars`.
 * @param {import("@utils/api").OnDisk} item
 */
export function itemNameKey(item) {
  if (isLightVoice(item)) return "storage.item.light_voice";
  if (!item.obsolete && MODELS.has(item.id)) return `storage.item.${item.id}`;
  if (item.was === "translator" || item.was === "voice") return `storage.item.old.${item.was}`;
  return "storage.item.old.unknown";
}

/**
 * The voice's name and country for a light voice ("Sharvard, es-ES"), so two
 * of them don't read the same; nothing for the rest.
 * @param {import("@utils/api").OnDisk} item
 */
export function itemNameVars(item) {
  if (!isLightVoice(item)) return {};
  const [locale = "", name = ""] = item.id.slice("piper:".length).split("-");
  return { name: `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${locale.replace("_", "-")}` };
}

/**
 * i18n key of what stops working if it is deleted.
 * @param {import("@utils/api").OnDisk} item
 */
export function warningKey(item) {
  if (isLightVoice(item)) return item.partial ? "storage.warn.partial" : "storage.warn.light_voice";
  if (item.obsolete || !MODELS.has(item.id)) return "storage.warn.obsolete";
  if (item.partial) return "storage.warn.partial";
  return `storage.warn.${item.id}`;
}
