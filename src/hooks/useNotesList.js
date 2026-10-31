import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../utils/api";
import { NOTES_REFRESH_MS, fold, groupByLabel, groupLabel, haystack, inPeriod, olderMonths } from "../utils/noteList.js";

/**
 * The saved notes, read from disk every so often while `active`, with the
 * search, period and order of the list applied.
 * @param {{
 *   active: boolean,
 *   live: string | null,
 *   formats: import("../utils/noteList.js").DateFormats,
 *   t: import("../i18n").t,
 * }} options `live` is the id of the note being recorded: in "Most recent" it comes first.
 */
export function useNotesList({ active, live, formats, t }) {
  /** @type {[import("../utils/api").NoteSummary[], Function]} */
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [order, setOrder] = useState(/** @type {"recent" | "oldest"} */ ("recent"));

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
    if (!active) return;
    load();
    const timer = window.setInterval(load, NOTES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const haystacks = useMemo(() => new Map(notes.map((n) => [n.id, haystack(n, formats)])), [notes, formats]);
  const months = useMemo(() => olderMonths(notes), [notes]);

  const terms = fold(query).split(/\s+/).filter(Boolean);
  const shown = notes.filter((n) => inPeriod(n.created_at, period) && terms.every((term) => haystacks.get(n.id)?.includes(term)));
  // Grouped by day and then by month; in "Most recent", the note in progress comes first.
  const sorted = order === "recent" ? [...shown].sort((a, b) => Number(b.id === live) - Number(a.id === live)) : [...shown].reverse();
  const groups = groupByLabel(sorted, (iso) => groupLabel(iso, formats, t));

  return { notes, loaded, error, load, query, setQuery, period, setPeriod, order, setOrder, months, shown, groups };
}
