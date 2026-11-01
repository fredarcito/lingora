import { useEffect, useState } from "react";
import { api } from "@utils/api";

/**
 * The saved notes, read once, for the names given to people in them
 * (`speaker_names`). Without notes, or if they cannot be read, an empty list:
 * the suggestions are a help, not something to warn about.
 */
export function useKnownNames() {
  /** @type {[import("@utils/api").NoteSummary[], Function]} */
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    let alive = true;
    api
      .notesList()
      .then((list) => alive && setNotes(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return notes;
}
