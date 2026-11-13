//! Keyword search with BM25, no dependencies. Phase 1 uses `rank` to pick the
//! paragraphs of a long note that best match the question; phase 2 keeps the
//! words of all notes in an `Index` (inverted: a question only reads the
//! lists of its own words) and scores them with the same formula.

use std::collections::HashMap;

/// A letter without its accent, lowercase: "Reunión" and "reunion" are the same word.
fn fold_char(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        c => c,
    }
}

/// `text` in lowercase and without accents, to compare it with other text.
pub fn fold(text: &str) -> String {
    text.to_lowercase().chars().map(fold_char).collect()
}

/// The words of `text`, lowercase and without accents. One-letter words are left out.
pub fn words(text: &str) -> Vec<String> {
    fold(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() > 1)
        .map(str::to_string)
        .collect()
}

const K1: f32 = 1.5;
const B: f32 = 0.75;

/// BM25 weight of one query word in one document: it appears `tf` times in
/// it, the document has `len` words (`avg_len` on average), and `df` of the
/// `n` documents contain it. `rank` and `Index` share it, so they score alike.
fn bm25(tf: f32, df: f32, n: f32, len: f32, avg_len: f32) -> f32 {
    let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
    idf * tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * len / avg_len))
}

/// The distinct words of the query.
fn query_words(query: &str) -> Vec<String> {
    let mut out = words(query);
    out.sort();
    out.dedup();
    out
}

/// BM25 score of each document for the query (0 when they share no word).
/// Common words weigh little by themselves (the inverse frequency), so there
/// is no list of stop words.
pub fn rank(docs: &[&str], query: &str) -> Vec<f32> {
    let docs: Vec<Vec<String>> = docs.iter().map(|d| words(d)).collect();
    let n = docs.len() as f32;
    let avg_len = (docs.iter().map(Vec::len).sum::<usize>() as f32 / n.max(1.0)).max(1.0);
    let query_words = query_words(query);
    let mut containing: HashMap<&str, f32> = HashMap::new();
    for q in &query_words {
        containing.insert(q, docs.iter().filter(|d| d.contains(q)).count() as f32);
    }
    docs.iter()
        .map(|d| {
            query_words
                .iter()
                .map(|q| {
                    let tf = d.iter().filter(|w| *w == q).count() as f32;
                    if tf == 0.0 {
                        return 0.0;
                    }
                    bm25(tf, containing[q.as_str()], n, d.len() as f32, avg_len)
                })
                .sum()
        })
        .collect()
}

// ---------- All the notes (phase 2) ----------

/// What a searchable piece of a note is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// A paragraph of the transcript (its index, as `notes::paragraphs` makes them).
    Paragraph(usize),
    /// The note's summary.
    Summary,
    /// The note's title.
    Title,
}

/// One searchable piece of a note: what it is and how many words it has.
#[derive(Debug, Clone)]
pub struct Unit {
    pub part: Part,
    len: u32,
}

/// One note in the index: what is needed to choose it without reading it
/// again, and its words. No text is kept: the text of what is chosen is read
/// back from the note's file.
#[derive(Debug, Clone)]
pub struct NoteEntry {
    /// The file's name without `.json` (how the app opens the note).
    pub id: String,
    /// Local date, `2026-11-03`.
    date: String,
    pub title: String,
    /// The people's names (`speakers`, not "Yo").
    pub people: Vec<String>,
    pub units: Vec<Unit>,
    /// Word id → (unit, times it appears there).
    postings: HashMap<u32, Vec<(u32, u16)>>,
    modified: Option<std::time::SystemTime>,
}

impl NoteEntry {
    /// The note's local date, `2026-11-03`.
    pub fn date(&self) -> &str {
        &self.date
    }
}

/// A unit that matched a query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hit {
    pub unit: usize,
    pub score: f32,
}

/// The words of every note, kept in memory so a question only looks at the
/// lists of its own words. Built from the notes' JSON (`add`), refreshed per
/// note by its file's modification time (`refresh`).
#[derive(Debug, Default)]
pub struct Index {
    dictionary: HashMap<String, u32>,
    notes: HashMap<String, NoteEntry>,
}

/// The text searched in a sentence: what is shown (the translation) and, if
/// different, the original, so a question in either language finds it.
fn searchable(sentence: &serde_json::Value) -> String {
    let shown = crate::notes::shown_text(sentence);
    let source = crate::notes::str_field(sentence, "source");
    if source.is_empty() || source == shown {
        shown.to_string()
    } else {
        format!("{shown} {source}")
    }
}

/// The local date of a note: from its id (the local start time,
/// `2026-11-03_10-32-00`), its file name or, failing both, `created_at`.
pub fn note_date(note: &serde_json::Value, file_id: &str) -> String {
    let dated = |s: &str| s.get(0..10).filter(|d| super::query::is_date(d)).map(str::to_string);
    dated(crate::notes::str_field(note, "id"))
        .or_else(|| dated(file_id))
        .or_else(|| dated(crate::notes::str_field(note, "created_at")))
        .unwrap_or_default()
}

impl Index {
    /// Indexes the note of the file `id` (or indexes it again, replacing what it had).
    pub fn add(&mut self, id: &str, note: &serde_json::Value, modified: Option<std::time::SystemTime>) {
        use crate::notes::{paragraphs, speaker_names, str_field};
        use serde_json::Value;
        let id = id.to_string();
        let sentences = note.get("sentences").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        let mut texts: Vec<(Part, String)> = paragraphs(sentences)
            .iter()
            .enumerate()
            .map(|(i, p)| (Part::Paragraph(i), p.iter().map(|s| searchable(s)).collect::<Vec<_>>().join(" ")))
            .collect();
        let summary = note.pointer("/summary/text").and_then(Value::as_str).unwrap_or("").trim();
        if !summary.is_empty() {
            texts.push((Part::Summary, summary.to_string()));
        }
        let title = str_field(note, "title");
        if !title.trim().is_empty() {
            texts.push((Part::Title, title.to_string()));
        }
        let mut postings: HashMap<u32, Vec<(u32, u16)>> = HashMap::new();
        let mut units = Vec::with_capacity(texts.len());
        for (u, (part, text)) in texts.into_iter().enumerate() {
            let words = words(&text);
            let mut counts: HashMap<u32, u16> = HashMap::new();
            for w in &words {
                let next = self.dictionary.len() as u32;
                let id = *self.dictionary.entry(w.clone()).or_insert(next);
                *counts.entry(id).or_insert(0) += 1;
            }
            for (w, c) in counts {
                postings.entry(w).or_default().push((u as u32, c));
            }
            units.push(Unit { part, len: words.len() as u32 });
        }
        let entry = NoteEntry { date: note_date(note, &id), title: title.to_string(), people: speaker_names(note), units, postings, modified, id: id.clone() };
        self.notes.insert(id, entry);
    }

    /// Reads again the notes of `dir` whose file changed since they were
    /// indexed, adds the new ones and drops the ones that are gone. Only the
    /// changed files are read, so a question pays a folder listing.
    pub fn refresh(&mut self, dir: &std::path::Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            self.notes.clear();
            return;
        };
        let mut seen = std::collections::HashSet::new();
        for e in entries.filter_map(|e| e.ok()) {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
            let modified = e.metadata().ok().and_then(|m| m.modified().ok());
            seen.insert(id.clone());
            if self.notes.get(&id).is_some_and(|n| n.modified.is_some() && n.modified == modified) {
                continue;
            }
            match crate::notes::read_note(&path) {
                // By file name, as the app opens notes.
                Ok(note) => self.add(&id, &note, modified),
                Err(_) => {
                    self.notes.remove(&id);
                }
            }
        }
        self.notes.retain(|id, _| seen.contains(id));
    }

    pub fn note(&self, id: &str) -> Option<&NoteEntry> {
        self.notes.get(id)
    }

    pub fn notes(&self) -> impl Iterator<Item = &NoteEntry> {
        self.notes.values()
    }

    /// BM25 of every unit of the notes in `ids` that shares a word with the
    /// query, by note id (the counts are over those notes only, so a filter by
    /// person or date doesn't let the rest change the scores).
    pub fn search(&self, ids: &[&str], query: &str) -> HashMap<String, Vec<Hit>> {
        let notes: Vec<&NoteEntry> = ids.iter().filter_map(|id| self.notes.get(*id)).collect();
        let n: f32 = notes.iter().map(|e| e.units.len() as f32).sum();
        let total_len: f32 = notes.iter().flat_map(|e| e.units.iter()).map(|u| u.len as f32).sum();
        let avg_len = (total_len / n.max(1.0)).max(1.0);
        let terms: Vec<u32> = query_words(query).iter().filter_map(|w| self.dictionary.get(w).copied()).collect();
        let mut out: HashMap<String, Vec<Hit>> = HashMap::new();
        for term in terms {
            let df: f32 = notes.iter().map(|e| e.postings.get(&term).map_or(0, Vec::len) as f32).sum();
            for e in &notes {
                let Some(list) = e.postings.get(&term) else { continue };
                let hits = out.entry(e.id.clone()).or_default();
                for &(unit, tf) in list {
                    let score = bm25(tf as f32, df, n, e.units[unit as usize].len as f32, avg_len);
                    match hits.iter_mut().find(|h| h.unit == unit as usize) {
                        Some(h) => h.score += score,
                        None => hits.push(Hit { unit: unit as usize, score }),
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_fold_case_and_accents() {
        assert_eq!(words("¿Qué dijo Ana del presupuesto? Año 2026"), ["que", "dijo", "ana", "del", "presupuesto", "ano", "2026"]);
        assert_eq!(words("a b cd"), ["cd"]);
    }

    #[test]
    fn rank_prefers_the_paragraph_with_the_rare_words() {
        let docs = ["Hoy hablamos del tiempo y del café.", "Ana propuso un presupuesto de quince mil euros.", "Hablamos del tiempo otra vez."];
        let scores = rank(&docs, "¿Qué presupuesto propuso Ana?");
        assert!(scores[1] > scores[0] && scores[1] > scores[2]);
        // Accents do not matter, and without shared words the score is 0.
        assert!(rank(&docs, "CAFE")[0] > 0.0);
        assert_eq!(rank(&docs, "vacaciones"), vec![0.0; 3]);
    }

    #[test]
    fn rank_handles_nothing() {
        assert!(rank(&[], "hola").is_empty());
        assert_eq!(rank(&["hola"], ""), vec![0.0]);
    }
}
