//! Keyword search with BM25, no dependencies. Phase 1 uses it to pick the
//! paragraphs of a long note that best match the question; phase 2 will rank
//! the paragraphs of all notes with the same functions.

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

/// BM25 score of each document for the query (0 when they share no word).
/// Common words weigh little by themselves (the inverse frequency), so there
/// is no list of stop words.
pub fn rank(docs: &[&str], query: &str) -> Vec<f32> {
    let docs: Vec<Vec<String>> = docs.iter().map(|d| words(d)).collect();
    let n = docs.len() as f32;
    let avg_len = (docs.iter().map(Vec::len).sum::<usize>() as f32 / n.max(1.0)).max(1.0);
    let mut query_words = words(query);
    query_words.sort();
    query_words.dedup();
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
                    let df = containing[q.as_str()];
                    let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
                    idf * tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * d.len() as f32 / avg_len))
                })
                .sum()
        })
        .collect()
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
