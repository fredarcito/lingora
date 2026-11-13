//! The chat with all the notes (docs/plan-chat.md §2). A question goes in
//! three steps:
//!
//! 1. The model reads it (`query.rs`): detail, overview or «I can't tell»,
//!    with its topic words, people and dates.
//! 2. The notes are chosen here, from the `Index` (filters by person and
//!    date first, then the words), and the context is built so it looks like
//!    the one-note chat: each note as its own block, its summary first, then
//!    whole stretches of conversation (a matching paragraph with the one
//!    before and after) instead of loose lines. An overview gives each
//!    note's summary instead, oldest to newest.
//! 3. The model answers; the citations it wrote are checked against what it
//!    was given, and only those that match are returned as sources.
//!
//! Ambiguous questions are not guessed: two people with the name, a name
//! nobody has, or nothing to go on return a `Notice` and the model writes
//! nothing.

use super::query::{self, Kind, Query, DEFAULT_LATEST};
use super::search::{fold, words, Hit, Index, NoteEntry, Part};
use super::{answer_stopped, cloud, local, prompt, OnToken, Turn};
use crate::error::Result;
use crate::notes::{paragraph_text, paragraphs, read_note, span_line};
use crate::summary_cloud::Cloud;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// Notes at most in a detail answer.
const DETAIL_NOTES: usize = 5;
/// A note gets into a detail answer if it scores at least this share of the best one.
const DETAIL_SHARE: f32 = 0.25;
/// Notes at most in an overview (the newest when more pass the filters).
const OVERVIEW_NOTES: usize = 12;
/// Overview by topic: every note where the topic's words appear gets in
/// (the newest `OVERVIEW_NOTES`). Missing a meeting makes a summary silently
/// partial, while one too many is visible and the user takes it out (the
/// chips under the answer). Tried and dropped (bench, 2026-11-13): a share of
/// the best note's score, and «at least two paragraphs»; both left out
/// meetings about the topic that named it once.
/// The title and the summary say what a note is about: they weigh more.
const TITLE_BOOST: f32 = 2.0;
const SUMMARY_BOOST: f32 = 1.5;
/// What the notes may take of the context, in characters. On the computer
/// ~14K tokens (at a conservative 3 characters per token; the model has 24K
/// with the history and the answer); with a key, more.
const LOCAL_BUDGET_CHARS: usize = 42_000;
const CLOUD_BUDGET_CHARS: usize = 120_000;
/// A cited time this close (seconds) to a paragraph given counts as from it.
const CITE_SLACK_SECS: f64 = 30.0;

const INSTRUCTIONS: &str = "Eres un asistente que responde preguntas sobre las notas de reuniones del usuario. \
Abajo tienes algunas de sus notas, numeradas (Nota 1, Nota 2…), elegidas para esta pregunta. \
Responde solo con lo que aparece en ellas; si la respuesta no está, dilo claramente en vez de suponerla. \
Responde siempre en el idioma en que está escrita la pregunta, de forma breve y directa, con Markdown sencillo (sin tablas). \
Di de qué reunión sale cada dato (por su título o su fecha) y no mezcles datos de reuniones distintas como si fueran de una sola; \
si algo aparece en varias, dilo. \
Cuando cites algo que se dijo, indica la nota y el momento con el formato [Nota 2, mm:ss]. \
Los números de nota valen solo para esta pregunta. \
Si aparecen etiquetas \"Persona N\", úsalas tal cual.";

const OVERVIEW: &str = "\nEs una pregunta sobre varias reuniones: tienes sus resúmenes, de la más antigua a la más reciente. \
Organiza la respuesta por reunión o por tema, y señala lo que cambió de una a otra.";

/// A note the answer used, for its source chip.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UsedNote {
    /// Its number in this answer («Nota 2»).
    pub n: usize,
    pub id: String,
    pub title: String,
    /// `2026-11-03`.
    pub date: String,
}

/// A citation that matches what the model was given.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Citation {
    pub n: usize,
    /// Seconds from the start of the note; `None` when it cites the note only.
    pub at: Option<f64>,
}

/// Why nothing was asked to the model: the interface says it in its language.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Notice {
    /// The model's own question back (`ask`, in the language of the question).
    Clarify { ask: String },
    /// The name matches several people.
    Ambiguous { person: String, names: Vec<String> },
    /// Nobody in the notes has that name.
    NoPerson { person: String },
    /// No note, person, topic or date to go on.
    Vague,
    /// The search found nothing.
    NothingFound,
    /// There are no notes yet.
    NoNotes,
}

/// «Basado en las 12 reuniones más recientes de 30».
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Basis {
    pub shown: usize,
    pub total: usize,
}

/// The answer of `notes_chat`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct AllAnswer {
    /// What the model wrote (with `Notice::Clarify`, its question back; with
    /// another notice, empty: the interface writes it).
    pub text: String,
    /// An overview (summaries of several meetings): its notes can be changed.
    pub overview: bool,
    /// The notes given to the model, in their order.
    pub notes: Vec<UsedNote>,
    pub citations: Vec<Citation>,
    /// Citations to something it was not given (dropped; the bench counts them).
    pub invented: usize,
    pub basis: Option<Basis>,
    pub notice: Option<Notice>,
}

// ---------- The index ----------

/// One index per notes folder (the app's, or the bench's).
static INDEXES: Mutex<Option<HashMap<PathBuf, Index>>> = Mutex::new(None);

/// Runs `f` with the index of `dir`, brought up to date first.
fn with_index<T>(dir: &Path, f: impl FnOnce(&Index) -> T) -> T {
    let mut all = INDEXES.lock().unwrap_or_else(PoisonError::into_inner);
    let index = all.get_or_insert_with(HashMap::new).entry(dir.to_path_buf()).or_default();
    index.refresh(dir);
    f(index)
}

/// Builds the index of the app's notes, so the first question doesn't wait
/// for it. Called on a thread of its own when the app starts.
pub fn warm() {
    let started = std::time::Instant::now();
    let notes = with_index(&crate::notes::notes_dir(), |index| index.notes().count());
    tracing::info!("chat: índice de {notes} notas en {} ms", started.elapsed().as_millis());
}

// ---------- Choosing the notes ----------

/// A chosen note and what of it to give.
#[derive(Debug, Clone, PartialEq)]
struct Pick {
    id: String,
    /// Its paragraphs that matched, best first.
    matched: Vec<usize>,
}

/// What step 2 decided.
#[derive(Debug, Clone, PartialEq)]
enum Plan {
    Notes { overview: bool, picks: Vec<Pick>, basis: Option<Basis> },
    Notice(Notice),
}

/// The notes where `person` is one of the people (or in the title), and the
/// different names that matched. «Jeff» matches «Jeff Chen»: every word of
/// the person must be in the name.
fn match_person<'a>(person: &str, notes: &[&'a NoteEntry]) -> (Vec<&'a NoteEntry>, Vec<String>) {
    let wanted = words(person);
    if wanted.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let has = |text: &str| {
        let w = words(text);
        wanted.iter().all(|x| w.contains(x))
    };
    let mut names: Vec<String> = Vec::new();
    let mut found = Vec::new();
    for note in notes {
        let mut hit = has(&note.title);
        for name in &note.people {
            if has(name) {
                hit = true;
                if !names.iter().any(|n| fold(n) == fold(name)) {
                    names.push(name.clone());
                }
            }
        }
        if hit {
            found.push(*note);
        }
    }
    (found, names)
}

/// The score of each unit, with the title and the summary weighing more.
fn boosted(entry: &NoteEntry, hits: &[Hit]) -> Vec<(Part, f32)> {
    let mut out: Vec<(Part, f32)> = hits
        .iter()
        .map(|h| {
            let part = entry.units[h.unit].part;
            let boost = match part {
                Part::Title => TITLE_BOOST,
                Part::Summary => SUMMARY_BOOST,
                Part::Paragraph(_) => 1.0,
            };
            (part, h.score * boost)
        })
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

/// The paragraphs among the parts, in the order given.
fn paragraph_parts(parts: &[(Part, f32)]) -> Vec<usize> {
    parts.iter().filter_map(|(p, _)| if let Part::Paragraph(i) = p { Some(*i) } else { None }).collect()
}

/// Step 2 without the files: which notes, from the index. `query_text` is
/// what the words are searched with (the question, the one before it and the
/// model's topic words); `topic_text`, only the topic words, for choosing the
/// notes of an overview by topic (the question's own words, «resume lo que
/// se habló», would bring in every note).
fn plan(index: &Index, q: &Query, query_text: &str, topic_text: &str, note_ids: Option<&[String]>) -> Plan {
    let all: Vec<&NoteEntry> = index.notes().collect();
    if all.is_empty() {
        return Plan::Notice(Notice::NoNotes);
    }

    // The notes the user chose (the chips under an answer): exactly those.
    if let Some(ids) = note_ids {
        let mut chosen: Vec<&NoteEntry> = ids.iter().filter_map(|id| index.note(id)).collect();
        if chosen.is_empty() {
            return Plan::Notice(Notice::NothingFound);
        }
        chosen.sort_by(|a, b| a.id.cmp(&b.id));
        let names: Vec<&str> = chosen.iter().map(|e| e.id.as_str()).collect();
        let hits = index.search(&names, query_text);
        let picks = chosen
            .iter()
            .map(|e| Pick { id: e.id.clone(), matched: paragraph_parts(&boosted(e, hits.get(&e.id).map_or(&[][..], Vec::as_slice))) })
            .collect();
        return Plan::Notes { overview: q.kind != Kind::Detail, picks, basis: None };
    }

    if q.kind == Kind::Clarify {
        return Plan::Notice(Notice::Clarify { ask: q.ask.clone().unwrap_or_default() });
    }
    if q.kind == Kind::Overview && q.is_vague() {
        return Plan::Notice(Notice::Vague);
    }

    // Filters: people (every one named), then dates.
    let mut candidates = all.clone();
    for person in &q.people {
        let (found, names) = match_person(person, &candidates);
        let exact = names.iter().any(|n| fold(n) == fold(person));
        if names.len() > 1 && !exact {
            return Plan::Notice(Notice::Ambiguous { person: person.clone(), names });
        }
        if found.is_empty() {
            // Not with the others: is it someone at all?
            let (anywhere, _) = match_person(person, &all);
            return Plan::Notice(if anywhere.is_empty() { Notice::NoPerson { person: person.clone() } } else { Notice::NothingFound });
        }
        candidates = found;
    }
    let from = q.from.as_deref().unwrap_or("");
    let to = q.to.as_deref().unwrap_or("9999");
    candidates.retain(|e| e.date() >= from && e.date() <= to);
    if candidates.is_empty() {
        return Plan::Notice(Notice::NothingFound);
    }
    let filtered = !q.people.is_empty() || q.from.is_some() || q.to.is_some();
    // Newest first.
    candidates.sort_by(|a, b| b.id.cmp(&a.id));
    let ids: Vec<&str> = candidates.iter().map(|e| e.id.as_str()).collect();
    let hits = index.search(&ids, query_text);
    let parts_of = |e: &NoteEntry| boosted(e, hits.get(&e.id).map_or(&[][..], Vec::as_slice));

    // The newest of the candidates, as an overview.
    let latest = |limit: usize| {
        let total = candidates.len();
        let shown: Vec<&NoteEntry> = candidates.iter().take(limit.min(OVERVIEW_NOTES)).copied().collect();
        let picks = shown.iter().rev().map(|e| Pick { id: e.id.clone(), matched: paragraph_parts(&parts_of(e)) }).collect();
        Plan::Notes { overview: true, picks, basis: (shown.len() < total).then_some(Basis { shown: shown.len(), total }) }
    };

    if q.kind == Kind::Overview {
        // By person, date or «las últimas»: those notes, whatever their words.
        if filtered || q.latest.is_some() {
            return latest(q.latest.unwrap_or(if filtered { OVERVIEW_NOTES } else { DEFAULT_LATEST }));
        }
        // By topic: the notes that are about it (its words only).
        let topic_hits = index.search(&ids, topic_text);
        let mut about: Vec<(&NoteEntry, Vec<(Part, f32)>)> = candidates
            .iter()
            .map(|e| (*e, boosted(e, topic_hits.get(&e.id).map_or(&[][..], Vec::as_slice))))
            .filter(|(_, parts)| !parts.is_empty())
            .collect();
        if about.is_empty() {
            return Plan::Notice(Notice::NothingFound);
        }
        // The newest of them (candidates are newest first), shown oldest first.
        let total = about.len();
        about.truncate(OVERVIEW_NOTES);
        let shown = about.len();
        let picks = about.iter().rev().map(|(e, parts)| Pick { id: e.id.clone(), matched: paragraph_parts(parts) }).collect();
        return Plan::Notes { overview: true, picks, basis: (shown < total).then_some(Basis { shown, total }) };
    }

    // Detail: the notes with the best matches; each scored by its three best
    // places, so one lucky line doesn't beat a note about it.
    let mut scored: Vec<(&NoteEntry, f32, Vec<(Part, f32)>)> = candidates
        .iter()
        .filter_map(|e| {
            let parts = parts_of(e);
            let s: f32 = parts.iter().take(3).zip([1.0, 0.5, 0.25]).map(|(p, w)| p.1 * w).sum();
            (s > 0.0).then_some((*e, s, parts))
        })
        .collect();
    if scored.is_empty() {
        // «¿De qué hablé con Jeff?»: the words found nothing, but the filters chose notes.
        return if filtered { latest(DEFAULT_LATEST) } else { Plan::Notice(Notice::NothingFound) };
    }
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(b.0.id.cmp(&a.0.id)));
    let best = scored[0].1;
    scored.retain(|s| s.1 >= best * DETAIL_SHARE);
    scored.truncate(DETAIL_NOTES);
    let picks = scored.iter().map(|(e, _, parts)| Pick { id: e.id.clone(), matched: paragraph_parts(parts) }).collect();
    Plan::Notes { overview: false, picks, basis: None }
}

// ---------- The context ----------

/// A note as it goes to the model, and what of it was given (for the citations).
#[derive(Debug, Clone)]
struct Block {
    used: UsedNote,
    text: String,
    /// The stretches given, in seconds; a citation must fall in one.
    spans: Vec<(f64, f64)>,
}

/// The note as the model sees it: header, summary and, unless `summary_only`,
/// the transcript (whole if it fits in `room` characters, otherwise the
/// matching paragraphs with their neighbours).
fn note_block(n: usize, id: &str, note: &Value, matched: &[usize], overview: bool, room: usize) -> Block {
    let title = crate::notes::str_field(note, "title").to_string();
    let sentences = note.get("sentences").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let paras = paragraphs(sentences);
    let starts: Vec<f64> = paras.iter().map(|p| p[0].get("t").and_then(Value::as_f64).unwrap_or(0.0)).collect();
    let last_t = sentences.last().and_then(|s| s.get("t")).and_then(Value::as_f64).unwrap_or(0.0);
    let end_of = |i: usize| starts.get(i + 1).copied().unwrap_or(last_t);
    let shown_title = if title.trim().is_empty() { "(sin título)".to_string() } else { title.clone() };

    let mut text = format!("Nota {n}: «{shown_title}» · {}\n", span_line(note));
    let names = crate::notes::speaker_names(note);
    if !names.is_empty() {
        text.push_str(&format!("Personas: {}\n", names.join(", ")));
    }
    let summary = note.pointer("/summary/text").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    let mut spans = Vec::new();
    if let Some(s) = summary {
        text.push_str(&format!("Resumen (hecho antes; lo que dice la transcripción manda):\n{s}\n"));
        // A summary can cite any moment of its note.
        spans.push((0.0, last_t + CITE_SLACK_SECS));
    }
    let used = UsedNote { n, id: id.to_string(), title, date: super::search::note_date(note, id) };
    if overview && summary.is_some() {
        return Block { used, text, spans };
    }
    if overview {
        text.push_str("(Esta reunión no tiene resumen.)\n");
    }

    let texts: Vec<String> = paras.iter().map(|p| paragraph_text(note, p, false)).collect();
    let room = room.saturating_sub(text.chars().count());
    let whole: usize = texts.iter().map(|t| t.chars().count()).sum();
    let chosen: Vec<usize> = if whole <= room {
        (0..texts.len()).collect()
    } else {
        // The matching paragraphs with the one before and after (who asked,
        // what was answered); without matches, from the start.
        let order: Vec<usize> = if matched.is_empty() {
            (0..texts.len()).collect()
        } else {
            matched.iter().flat_map(|&i| [i, i.saturating_sub(1), (i + 1).min(texts.len().saturating_sub(1))]).collect()
        };
        let (mut used_chars, mut chosen) = (0, Vec::new());
        for i in order {
            if i >= texts.len() || chosen.contains(&i) {
                continue;
            }
            let cost = texts[i].chars().count();
            if used_chars + cost <= room {
                used_chars += cost;
                chosen.push(i);
            }
        }
        chosen.sort_unstable();
        chosen
    };
    if chosen.is_empty() {
        return Block { used, text, spans };
    }
    let all = chosen.len() == texts.len();
    text.push_str(if all { "Transcripción:\n" } else { "Fragmentos de la transcripción (los saltos van marcados con […]):\n" });
    let mut previous: Option<usize> = None;
    for &i in &chosen {
        if previous.map_or(i != 0, |p| p + 1 != i) {
            text.push_str("[…]\n\n");
        }
        text.push_str(&texts[i]);
        spans.push((starts[i] - CITE_SLACK_SECS, end_of(i) + CITE_SLACK_SECS));
        previous = Some(i);
    }
    if previous.is_some_and(|p| p + 1 < texts.len()) {
        text.push_str("[…]\n");
    }
    Block { used, text, spans }
}

/// The blocks for the plan, within `budget` characters: each note gets an
/// equal share, and what one doesn't use goes to the next.
fn blocks(dir: &Path, picks: &[Pick], overview: bool, budget: usize) -> Vec<Block> {
    let mut out = Vec::new();
    let mut left = budget;
    for (k, pick) in picks.iter().enumerate() {
        let Ok(note) = read_note(&dir.join(format!("{}.json", pick.id))) else { continue };
        let room = left / (picks.len() - k);
        let block = note_block(out.len() + 1, &pick.id, &note, &pick.matched, overview, room);
        left = left.saturating_sub(block.text.chars().count());
        out.push(block);
    }
    out
}

/// The instructions plus the notes. `period`: the dates the notes were
/// filtered by, so «esta semana» is not worked out again by the model.
fn system(blocks: &[Block], overview: bool, today: &str, period: (Option<&str>, Option<&str>)) -> String {
    let mut out = String::from(INSTRUCTIONS);
    if overview {
        out.push_str(OVERVIEW);
    }
    if query::is_date(today) {
        out.push_str(&format!("\nHoy es {today}."));
    }
    match period {
        (Some(from), Some(to)) => out.push_str(&format!(" Las notas de abajo son las del periodo que pide la pregunta: del {from} al {to}.")),
        (Some(from), None) => out.push_str(&format!(" Las notas de abajo son las del periodo que pide la pregunta: desde el {from}.")),
        (None, Some(to)) => out.push_str(&format!(" Las notas de abajo son las del periodo que pide la pregunta: hasta el {to}.")),
        (None, None) => {}
    }
    for b in blocks {
        out.push_str("\n\n---\n");
        out.push_str(&b.text);
    }
    out
}

// ---------- Citations ----------

/// `12:40` or `1:02:03` in seconds.
fn clock_secs(clock: &str) -> Option<f64> {
    let parts: Vec<&str> = clock.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 || parts.iter().any(|p| p.is_empty() || p.len() > 2 || !p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    Some(parts.iter().fold(0.0, |acc, p| acc * 60.0 + p.parse::<f64>().unwrap_or(0.0)))
}

/// Every citation in the text: `[Nota 2, 12:40]`, `[Note 2 · 12:40]`,
/// `[Nota 2]` (the note only) and a bare `[12:40]` (no note).
fn find_citations(text: &str) -> Vec<(Option<usize>, Option<f64>)> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find(']') else { break };
        let inside = rest[..close].trim();
        if inside.chars().count() > 40 {
            continue;
        }
        let lower = inside.to_lowercase();
        if let Some(after) = lower.strip_prefix("nota").or_else(|| lower.strip_prefix("note")) {
            let after = after.trim_start();
            let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
            let Ok(n) = digits.parse::<usize>() else { continue };
            let time = after[digits.len()..].trim_start_matches([' ', ',', '·', ':', ';', '-', '–', '—']).trim();
            if time.is_empty() {
                out.push((Some(n), None));
            } else if let Some(secs) = clock_secs(time) {
                out.push((Some(n), Some(secs)));
            }
        } else if let Some(secs) = clock_secs(inside) {
            out.push((None, Some(secs)));
        }
    }
    out
}

/// The citations that match what was given, and how many don't. A bare time
/// counts only when there was one note.
fn check_citations(text: &str, blocks: &[Block]) -> (Vec<Citation>, usize) {
    let (mut ok, mut invented) = (Vec::new(), 0);
    for (n, at) in find_citations(text) {
        let n = match n {
            Some(n) => n,
            None if blocks.len() == 1 => 1,
            // A bare time with several notes: it can't be told whose; not invented.
            None => continue,
        };
        let Some(block) = blocks.get(n.wrapping_sub(1)) else {
            invented += 1;
            continue;
        };
        let fits = at.is_none_or(|t| block.spans.iter().any(|(a, b)| t >= *a && t <= *b));
        if !fits {
            invented += 1;
            continue;
        }
        let c = Citation { n, at };
        if !ok.contains(&c) {
            ok.push(c);
        }
    }
    (ok, invented)
}

// ---------- The whole question ----------

/// The model, on the computer or with the user's key (`cloud` and its key).
async fn complete(cloud: Option<(&Cloud, &str)>, system: String, turns: Vec<Turn>, on_token: OnToken) -> Result<String> {
    match cloud {
        Some((service, key)) => {
            let mut on_token = on_token;
            cloud::chat(service, key, &system, &turns, &mut on_token).await
        }
        None => local::chat(system, turns, on_token).await,
    }
}

/// Answers the last message of `turns` (the question) from the notes in
/// `dir`. `today` is the user's local date (`2026-11-13`); `note_ids`, the
/// notes the user chose for it (they skip the choosing). The answer goes to
/// `on_token` as it is written. The command and the bench both come here.
pub async fn answer(dir: PathBuf, turns: Vec<Turn>, today: &str, cloud: Option<(&Cloud, &str)>, note_ids: Option<Vec<String>>, on_token: OnToken) -> Result<AllAnswer> {
    prompt::question(&turns)?;

    // 1. What the question asks for.
    let raw = complete(cloud, query::query_system(today), query::query_turns(&turns), Box::new(|_| {})).await?;
    if answer_stopped() {
        return Ok(AllAnswer::default());
    }
    let q = query::parse_query(&raw).unwrap_or_else(|| {
        tracing::warn!("chat: no se pudo leer el análisis de la pregunta: {raw}");
        Query::fallback()
    });
    let question = turns.last().map_or("", |t| t.text.as_str());
    let q = query::refine(q, question, turns.len() > 1);
    tracing::info!("chat: pregunta {:?}, temas {:?}, personas {:?}, {:?}–{:?}", q.kind, q.terms, q.people, q.from, q.to);

    // 2. Which notes, and the context from them.
    let query_text = format!("{} {}", prompt::search_query(&turns), q.terms.join(" "));
    let topic_text = q.terms.join(" ");
    let period = (q.from.clone(), q.to.clone());
    let budget = if cloud.is_some() { CLOUD_BUDGET_CHARS } else { LOCAL_BUDGET_CHARS };
    let folder = dir.clone();
    let built = tauri::async_runtime::spawn_blocking(move || {
        let plan = with_index(&folder, |index| plan(index, &q, &query_text, &topic_text, note_ids.as_deref()));
        match plan {
            Plan::Notice(notice) => Err(notice),
            Plan::Notes { overview, picks, basis } => Ok((overview, blocks(&folder, &picks, overview, budget), basis)),
        }
    })
    .await
    .map_err(|e| crate::error::Error::Notes(format!("no se pudo buscar en las notas: {e}")))?;
    let (overview, blocks, basis) = match built {
        Err(Notice::Clarify { ask }) => return Ok(AllAnswer { text: ask.clone(), notice: Some(Notice::Clarify { ask }), ..Default::default() }),
        Err(notice) => return Ok(AllAnswer { notice: Some(notice), ..Default::default() }),
        Ok(built) => built,
    };
    if blocks.is_empty() {
        return Ok(AllAnswer { notice: Some(Notice::NothingFound), ..Default::default() });
    }
    tracing::info!("chat: {} notas, {} caracteres", blocks.len(), blocks.iter().map(|b| b.text.chars().count()).sum::<usize>());

    // 3. The answer, and its citations checked.
    let text = complete(cloud, system(&blocks, overview, today, (period.0.as_deref(), period.1.as_deref())), turns, on_token).await?;
    let (citations, invented) = check_citations(&text, &blocks);
    if invented > 0 {
        tracing::warn!("chat: {invented} citas a algo que no se le dio");
    }
    Ok(AllAnswer { text, overview, notes: blocks.into_iter().map(|b| b.used).collect(), citations, invented, basis, notice: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A note with these people, title, summary and lines (seconds, speaker, text).
    fn note(id: &str, title: &str, people: &[&str], summary: Option<&str>, lines: &[(f64, i64, &str)]) -> Value {
        let speakers: serde_json::Map<String, Value> = people.iter().enumerate().map(|(i, p)| ((i + 1).to_string(), json!(p))).collect();
        let sentences: Vec<Value> = lines.iter().map(|(t, s, text)| json!({ "t": t, "speaker": s, "source": text, "translation": text })).collect();
        let mut n = json!({ "id": id, "title": title, "speakers": speakers, "sentences": sentences });
        if let Some(s) = summary {
            n["summary"] = json!({ "text": s });
        }
        n
    }

    fn index(notes: &[Value]) -> Index {
        let mut index = Index::default();
        for n in notes {
            index.add(n["id"].as_str().unwrap(), n, None);
        }
        index
    }

    fn library() -> Index {
        index(&[
            note("2026-10-01_10-00-00", "Kickoff Atlas", &["Jeff Chen"], Some("Arranca el proyecto Atlas."), &[(5.0, 1, "El proyecto Atlas empieza hoy."), (30.0, 0, "El plazo de Atlas es diciembre.")]),
            note("2026-10-20_10-00-00", "Revisión", &["Jeff Chen", "Ana"], None, &[(5.0, 2, "Atlas va con retraso por el proveedor."), (40.0, 1, "Atlas necesita más presupuesto.")]),
            note("2026-11-03_10-00-00", "Presupuesto", &["Ana", "Jeff Ruiz"], Some("Ana propone quince mil euros."), &[(24.0, 1, "Propongo quince mil euros para la campaña.")]),
            note("2026-11-10_10-00-00", "Café", &["Luis"], None, &[(3.0, 1, "Hablamos del tiempo y de Atlas de pasada.")]),
        ])
    }

    fn q(kind: Kind) -> Query {
        Query { kind, ..Query::fallback() }
    }

    fn ids(plan: &Plan) -> Vec<String> {
        match plan {
            Plan::Notes { picks, .. } => picks.iter().map(|p| p.id[..10].to_string()).collect(),
            Plan::Notice(n) => vec![format!("{n:?}")],
        }
    }

    #[test]
    fn index_searches_original_and_translation_and_refreshes() {
        let mut index = Index::default();
        let mut n = note("2026-11-01_09-00-00", "Call", &["Jeff"], None, &[(1.0, 1, "We need a bigger budget.")]);
        n["sentences"][0]["translation"] = json!("Necesitamos más presupuesto.");
        index.add("2026-11-01_09-00-00", &n, None);
        let ids = ["2026-11-01_09-00-00"];
        assert!(index.search(&ids, "presupuesto").contains_key(ids[0]));
        assert!(index.search(&ids, "BUDGET").contains_key(ids[0]));
        assert!(index.search(&ids, "vacaciones").is_empty());
        // Indexing it again replaces it.
        index.add(ids[0], &note(ids[0], "Call", &[], None, &[(1.0, 1, "Otra cosa.")]), None);
        assert!(index.search(&ids, "presupuesto").is_empty());
    }

    #[test]
    fn index_refresh_reads_the_folder() {
        let dir = std::env::temp_dir().join(format!("lingora-index-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |id: &str, text: &str| std::fs::write(dir.join(format!("{id}.json")), note(id, "T", &[], None, &[(1.0, 1, text)]).to_string()).unwrap();
        write("2026-11-01_09-00-00", "presupuesto");
        write("2026-11-02_09-00-00", "café");
        let mut index = Index::default();
        index.refresh(&dir);
        assert_eq!(index.notes().count(), 2);
        std::fs::remove_file(dir.join("2026-11-02_09-00-00.json")).unwrap();
        index.refresh(&dir);
        assert_eq!(index.notes().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_first_name_shared_by_two_people_asks_which() {
        let idx = library();
        let query = Query { people: vec!["Jeff".into()], ..q(Kind::Overview) };
        match plan(&idx, &query, "", "", None) {
            Plan::Notice(Notice::Ambiguous { person, names }) => {
                assert_eq!(person, "Jeff");
                assert_eq!(names.len(), 2);
            }
            other => panic!("{other:?}"),
        }
        // The full name is enough, oldest first.
        let query = Query { people: vec!["Jeff Chen".into()], ..q(Kind::Overview) };
        assert_eq!(ids(&plan(&idx, &query, "", "", None)), ["2026-10-01", "2026-10-20"]);
    }

    #[test]
    fn nobody_with_that_name_says_so() {
        let query = Query { people: vec!["Marta".into()], ..q(Kind::Overview) };
        assert_eq!(plan(&library(), &query, "", "", None), Plan::Notice(Notice::NoPerson { person: "Marta".into() }));
    }

    #[test]
    fn the_latest_are_counted_and_said() {
        let query = Query { latest: Some(2), ..q(Kind::Overview) };
        match plan(&library(), &query, "", "", None) {
            Plan::Notes { overview, picks, basis } => {
                assert!(overview);
                assert_eq!(picks.iter().map(|p| &p.id[..10]).collect::<Vec<_>>(), ["2026-11-03", "2026-11-10"]);
                assert_eq!(basis, Some(Basis { shown: 2, total: 4 }));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn dates_filter_the_notes() {
        let query = Query { from: Some("2026-11-01".into()), to: Some("2026-11-07".into()), ..q(Kind::Overview) };
        assert_eq!(ids(&plan(&library(), &query, "", "", None)), ["2026-11-03"]);
    }

    #[test]
    fn a_topic_overview_takes_every_note_about_it() {
        let query = Query { terms: vec!["Atlas".into()], ..q(Kind::Overview) };
        // By the topic's words only: «Presupuesto» (no Atlas) stays out, «Café» (once) gets in.
        assert_eq!(ids(&plan(&library(), &query, "resume lo que se habló de Atlas", "Atlas", None)), ["2026-10-01", "2026-10-20", "2026-11-10"]);
    }

    #[test]
    fn vague_and_clarify_ask_back() {
        assert_eq!(plan(&library(), &q(Kind::Overview), "resume mis reuniones", "resume mis reuniones", None), Plan::Notice(Notice::Vague));
        let query = Query { ask: Some("¿Qué proyecto?".into()), ..q(Kind::Clarify) };
        assert_eq!(plan(&library(), &query, "", "", None), Plan::Notice(Notice::Clarify { ask: "¿Qué proyecto?".into() }));
    }

    #[test]
    fn detail_picks_the_notes_with_the_answer() {
        let query = Query { terms: vec!["presupuesto".into()], ..q(Kind::Detail) };
        let plan = plan(&library(), &query, "¿Qué presupuesto propuso Ana? presupuesto", "¿Qué presupuesto propuso Ana? presupuesto", None);
        assert_eq!(ids(&plan)[0], "2026-11-03");
        assert_eq!(plan_overview(&plan), Some(false));
        assert_eq!(super::plan(&library(), &q(Kind::Detail), "vacaciones", "vacaciones", None), Plan::Notice(Notice::NothingFound));
    }

    fn plan_overview(plan: &Plan) -> Option<bool> {
        if let Plan::Notes { overview, .. } = plan { Some(*overview) } else { None }
    }

    #[test]
    fn notes_chosen_by_the_user_are_used_as_they_are() {
        let chosen = vec!["2026-11-10_10-00-00".to_string(), "2026-10-01_10-00-00".to_string()];
        let plan = plan(&library(), &q(Kind::Overview), "atlas", "atlas", Some(&chosen));
        assert_eq!(ids(&plan), ["2026-10-01", "2026-11-10"]);
        assert_eq!(super::plan(&Index::default(), &q(Kind::Detail), "x", "x", None), Plan::Notice(Notice::NoNotes));
    }

    #[test]
    fn a_block_gives_neighbours_and_marks_the_jumps() {
        let lines: Vec<(f64, i64, &str)> = (0..10).map(|i| (i as f64 * 60.0, (i % 2) as i64, "una frase de relleno bastante larga para ocupar sitio")).collect();
        let n = note("2026-11-03_10-00-00", "Larga", &["Ana"], None, &lines);
        let block = note_block(1, "f", &n, &[5], false, 400);
        assert!(block.text.starts_with("Nota 1: «Larga» · 3 nov 2026 · 10:00"));
        assert!(block.text.contains("Fragmentos") && block.text.contains("[…]"));
        // Paragraph 5 starts at 05:00 with 04:00 and 06:00 around it.
        assert!(block.text.contains("[04:00]") && block.text.contains("[05:00]") && block.text.contains("[06:00]"));
        assert!(!block.text.contains("[00:00]"));
        // Everything fits: the whole transcript, no jumps.
        let whole = note_block(1, "f", &n, &[5], false, 100_000);
        assert!(whole.text.contains("Transcripción:") && !whole.text.contains("[…]"));
    }

    #[test]
    fn an_overview_gives_the_summary_only() {
        let n = note("2026-11-03_10-00-00", "Presupuesto", &["Ana"], Some("Ana propone quince mil."), &[(24.0, 1, "Propongo quince mil.")]);
        let block = note_block(2, "f", &n, &[], true, 10_000);
        assert!(block.text.contains("Resumen") && !block.text.contains("[00:24]"));
        let bare = note("2026-11-03_10-00-00", "Sin", &[], None, &[(24.0, 1, "Propongo quince mil.")]);
        assert!(note_block(1, "f", &bare, &[], true, 10_000).text.contains("no tiene resumen"));
    }

    #[test]
    fn citations_are_read_in_every_form() {
        let text = "Ana propuso 15.000 [Nota 2, 00:24] y Jeff dudó [note 1 · 1:02:03]. Ver [Nota 3]. Luego [12:40] y [enlace largo que no es una cita en absoluto, para nada].";
        assert_eq!(find_citations(text), vec![(Some(2), Some(24.0)), (Some(1), Some(3723.0)), (Some(3), None), (None, Some(760.0))]);
    }

    #[test]
    fn citations_to_what_was_not_given_are_dropped() {
        let used = |n| UsedNote { n, id: String::new(), title: String::new(), date: String::new() };
        let blocks = vec![
            Block { used: used(1), text: String::new(), spans: vec![(0.0, 60.0)] },
            Block { used: used(2), text: String::new(), spans: vec![(200.0, 300.0)] },
        ];
        let (ok, invented) = check_citations("a [Nota 1, 00:30] b [Nota 2, 00:30] c [Nota 7, 00:10] d [Nota 2, 04:00] e [Nota 2, 04:00] f [00:30]", &blocks);
        assert_eq!(ok, vec![Citation { n: 1, at: Some(30.0) }, Citation { n: 2, at: Some(240.0) }]);
        assert_eq!(invented, 2);
        // With one note a bare time is that note's.
        let (ok, _) = check_citations("[00:30]", &blocks[..1]);
        assert_eq!(ok, vec![Citation { n: 1, at: Some(30.0) }]);
    }

    #[test]
    fn the_system_numbers_the_notes() {
        let n = note("2026-11-03_10-00-00", "Presupuesto", &["Ana"], None, &[(24.0, 1, "Propongo quince mil.")]);
        let b = note_block(1, "f", &n, &[], false, 10_000);
        let s = system(&[b], false, "2026-11-13", (None, None));
        assert!(s.starts_with(INSTRUCTIONS) && s.contains("Hoy es 2026-11-13.") && s.contains("---\nNota 1: «Presupuesto»"));
        assert!(!s.contains("periodo"));
        let empty = system(&[], true, "x", (None, None));
        assert!(empty.contains("varias reuniones") && !empty.contains("Hoy es"));
        assert!(system(&[], false, "2026-11-13", (Some("2026-11-09"), Some("2026-11-15"))).contains("del 2026-11-09 al 2026-11-15"));
    }

    /// 1,000 notes of half an hour: how long building and asking take. By
    /// hand: `cargo test --release index_timing -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn index_timing() {
        let vocabulary: Vec<String> = (0..20_000).map(|i| format!("palabra{i}")).collect();
        let mut seed = 7u64;
        let mut next = move || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        let notes: Vec<Value> = (0..1000)
            .map(|k| {
                let lines: Vec<(f64, i64, String)> =
                    (0..400).map(|i| (i as f64 * 4.5, (i / 6 % 3) as i64, (0..14).map(|_| vocabulary[next() % 2000 + (next() % 10) * 1800].as_str()).collect::<Vec<_>>().join(" "))).collect();
                let lines: Vec<(f64, i64, &str)> = lines.iter().map(|(t, s, x)| (*t, *s, x.as_str())).collect();
                note(&format!("2026-01-01_00-00-{k:04}"), "Reunión", &["Ana", "Jeff"], Some("Resumen breve."), &lines)
            })
            .collect();
        let started = std::time::Instant::now();
        let idx = index(&notes);
        println!("build: {} ms", started.elapsed().as_millis());
        let all: Vec<&str> = idx.notes().map(|e| e.id.as_str()).collect();
        let started = std::time::Instant::now();
        for i in 0..20 {
            let found = idx.search(&all, &format!("{} {} {}", vocabulary[i], vocabulary[i * 7], vocabulary[i * 13]));
            assert!(!found.is_empty());
        }
        println!("query: {:.1} ms", started.elapsed().as_secs_f64() * 1000.0 / 20.0);
    }
}
