/**
 * Settings → Disk space: what to call each downloaded thing and what deleting
 * it costs. The list comes from `api.storageStatus()`.
 */

/** Current models, by id (the same as its diagnostics check). */
const MODELS = new Set(["listener", "sense_voice", "translator", "voice_model", "speakers"]);

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

/**
 * i18n key of the item's name: generic, never the model's name.
 * @param {import("@utils/api").OnDisk} item
 */
export function itemNameKey(item) {
  if (!item.obsolete && MODELS.has(item.id)) return `storage.item.${item.id}`;
  if (item.was === "translator" || item.was === "voice") return `storage.item.old.${item.was}`;
  return "storage.item.old.unknown";
}

/**
 * i18n key of what stops working if it is deleted.
 * @param {import("@utils/api").OnDisk} item
 */
export function warningKey(item) {
  if (item.obsolete || !MODELS.has(item.id)) return "storage.warn.obsolete";
  if (item.partial) return "storage.warn.partial";
  return `storage.warn.${item.id}`;
}
