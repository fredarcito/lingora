//! The question bench (docs/plan-chat.md §1.5): fixed questions with known
//! answers over fixed notes, scored automatically, to know with numbers
//! whether a change to the prompt, the fitting or the model makes the chat
//! better or worse. Test code only. It runs by hand:
//! `cargo test --release chat_bench -- --ignored --nocapture`
//! (with `LINGORA_BENCH_CLOUD=openai|anthropic`, `LINGORA_BENCH_MODEL` and
//! `LINGORA_SUMMARY_KEY`, with a service instead of the computer's model).
//! Questions with `"note": null` go through the chat with all the notes
//! (`all::answer`, over every note of the fixtures). With
//! `LINGORA_BENCH_ALL=1` the one-note questions are asked that way too: the
//! all-notes chat must score about the same (docs/plan-chat.md §2.5).

use super::search::fold;
use super::all::{AllAnswer, Notice};
use super::{all, cloud, local, prompt, Role, Turn};
use crate::notes::read_note;
use crate::summary_cloud::Cloud;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A `[mm:ss]` this close (seconds) to a correct time counts as citing it.
const CITE_SLACK_SECS: u64 = 30;

/// One entry of `questions.json`.
#[derive(Debug, Deserialize)]
struct Question {
    id: String,
    /// The note's file name without `.json`; `null` is for all notes (phase 2).
    note: Option<String>,
    q: String,
    kind: String,
    /// Every item must be in the answer; an item that is a list passes with any of its alternatives.
    #[serde(default)]
    must: Vec<Value>,
    /// Correct times, "mm:ss".
    #[serde(default)]
    time: Vec<String>,
    #[serde(default = "yes")]
    answerable: bool,
    /// The language the answer must be in ("es" / "en").
    lang: String,
    /// Asked in the same chat, after this question.
    #[serde(default)]
    after: Option<String>,
    /// All notes: the notes (file names) the answer must come from.
    #[serde(default)]
    sources: Vec<String>,
    /// All notes: the user's date when asking (`2026-11-13`).
    #[serde(default)]
    today: Option<String>,
    /// All notes: the question is ambiguous and the chat must ask back.
    #[serde(default)]
    asks_back: bool,
}

fn yes() -> bool {
    true
}

/// Whether the answer has everything it must (lowercase, without accents).
fn correct(answer: &str, must: &[Value]) -> bool {
    let answer = fold(answer);
    must.iter().all(|item| match item {
        Value::String(s) => answer.contains(&fold(s)),
        Value::Array(alternatives) => alternatives.iter().filter_map(Value::as_str).any(|s| answer.contains(&fold(s))),
        _ => false,
    })
}

/// The seconds of every `[mm:ss]` (or `[h:mm:ss]`) in the text.
fn cited_secs(text: &str) -> Vec<u64> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else { break };
        // `[12:40]`, or the time at the end of `[Nota 2, 12:40]`.
        let inside = &rest[open + 1..open + close];
        let clock = inside.rsplit([' ', ',']).next().unwrap_or(inside);
        let parts: Option<Vec<u64>> = clock.split(':').map(|p| p.parse().ok()).collect();
        if let Some(p) = parts.filter(|p| (2..=3).contains(&p.len())) {
            out.push(p.iter().fold(0, |total, n| total * 60 + n));
        }
        rest = &rest[open + close + 1..];
    }
    out
}

/// Seconds of "mm:ss".
fn clock_secs(clock: &str) -> u64 {
    clock.split(':').filter_map(|p| p.parse::<u64>().ok()).fold(0, |total, n| total * 60 + n)
}

/// Whether the answer cites one of the correct times.
fn cites(answer: &str, times: &[String]) -> bool {
    let cited = cited_secs(answer);
    times.iter().map(|t| clock_secs(t)).any(|t| cited.iter().any(|c| c.abs_diff(t) <= CITE_SLACK_SECS))
}

/// How a question without an answer in the note was answered.
#[derive(Debug, PartialEq, Eq)]
enum Honesty {
    /// It said it is not there.
    Said,
    /// It did not say so in any known way: to read by hand, not a failure.
    Review,
}

const NOT_FOUND: &[&str] = &[
    "no se menciona",
    "no menciona",
    "no mencionan",
    "no se mencionan",
    "no aparece",
    "no hay informacion",
    "no se dice",
    "no se habla",
    "no se comenta",
    "no consta",
    "no se indica",
    "no esta en la",
    "no hay ninguna",
    "not mentioned",
    "doesn't say",
    "does not say",
    "doesn't mention",
    "does not mention",
    "no information",
    "isn't mentioned",
    "is not mentioned",
    "not discussed",
    "not in the conversation",
    "not in the transcript",
    "no encontre",
    "couldn't find",
    "could not find",
    "didn't find",
];

fn honesty(answer: &str) -> Honesty {
    let answer = fold(answer).replace('’', "'");
    if NOT_FOUND.iter().any(|p| answer.contains(p)) {
        Honesty::Said
    } else {
        Honesty::Review
    }
}

const ES: &[&str] = &["el", "la", "los", "las", "de", "que", "en", "y", "un", "una", "es", "por", "con", "para", "se", "del", "no", "lo"];
const EN: &[&str] = &["the", "of", "and", "to", "in", "is", "that", "it", "for", "was", "on", "with", "as", "this", "are", "not", "said", "who"];

/// The language of a text, by counting common words of each ("es" or "en").
fn language_of(text: &str) -> &'static str {
    let words = super::search::words(text);
    let count = |list: &[&str]| words.iter().filter(|w| list.contains(&w.as_str())).count();
    if count(EN) > count(ES) {
        "en"
    } else {
        "es"
    }
}

/// The score of one answer.
#[derive(Debug, serde::Serialize)]
struct Score {
    id: String,
    kind: String,
    q: String,
    answer: String,
    correct: Option<bool>,
    cites: Option<bool>,
    /// `Some(true)` said it is not there, `Some(false)` did not (to review).
    no_invention: Option<bool>,
    language: bool,
    /// All notes: the expected notes were among those given.
    sources: Option<bool>,
    /// All notes: it asked back exactly when it should have.
    asks_back: Option<bool>,
    /// All notes: citations to something it was not given.
    invented: usize,
}

fn score(q: &Question, answer: &str) -> Score {
    Score {
        id: q.id.clone(),
        kind: q.kind.clone(),
        q: q.q.clone(),
        answer: answer.to_string(),
        correct: q.answerable.then(|| correct(answer, &q.must)),
        cites: (!q.time.is_empty()).then(|| cites(answer, &q.time)),
        no_invention: (!q.answerable).then(|| honesty(answer) == Honesty::Said),
        language: language_of(answer) == q.lang,
        sources: None,
        asks_back: None,
        invented: 0,
    }
}

/// What the interface would show for a notice (it writes it, not the model).
fn notice_text(notice: &Notice) -> String {
    match notice {
        Notice::Clarify { ask } => ask.clone(),
        Notice::Ambiguous { person, names } => format!("¿A qué {person} te refieres? Hay varios: {}.", names.join(", ")),
        Notice::NoPerson { person } => format!("No encontré reuniones con {person}."),
        Notice::Vague => "¿De qué periodo, o con quién?".into(),
        Notice::NothingFound => "No encontré nada sobre eso en tus notas.".into(),
        Notice::NoNotes => "Aún no tienes notas.".into(),
    }
}

/// The score of an all-notes answer: the same, plus its sources and whether it asked back.
fn score_all(q: &Question, answer: &AllAnswer, shown: &str) -> Score {
    let asked = matches!(answer.notice, Some(Notice::Clarify { .. } | Notice::Ambiguous { .. } | Notice::Vague));
    let used: Vec<&str> = answer.notes.iter().map(|n| n.id.as_str()).collect();
    let mut s = score(q, shown);
    if asked && q.asks_back {
        // Asking back was the right answer: nothing else to score.
        s.correct = None;
        s.cites = None;
    }
    s.sources = (!q.sources.is_empty()).then(|| q.sources.iter().all(|id| used.contains(&id.as_str())));
    s.asks_back = Some(asked == q.asks_back);
    s.invented = answer.invented;
    s
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/chat-bench")
}

/// `a/b`, or `-` without any.
fn ratio(ok: usize, total: usize) -> String {
    if total == 0 { "-".into() } else { format!("{ok}/{total}") }
}

fn summary_line(scores: &[&Score]) -> String {
    let of = |f: fn(&Score) -> Option<bool>| {
        let all: Vec<bool> = scores.iter().filter_map(|s| f(s)).collect();
        (all.iter().filter(|b| **b).count(), all.len())
    };
    let (c, cn) = of(|s| s.correct);
    let (ci, cin) = of(|s| s.cites);
    let (ni, nin) = of(|s| s.no_invention);
    let (so, son) = of(|s| s.sources);
    let (ab, abn) = of(|s| s.asks_back);
    let langs = scores.iter().filter(|s| s.language).count();
    let mut line = format!(
        "Correct {} · Cites {} · No invention {} ({} review) · Language {}",
        ratio(c, cn),
        ratio(ci, cin),
        ratio(ni, nin),
        nin - ni,
        ratio(langs, scores.len())
    );
    if abn > 0 {
        let invented: usize = scores.iter().map(|s| s.invented).sum();
        line.push_str(&format!(" · Sources {} · Asks back {} · Invented citations {invented}", ratio(so, son), ratio(ab, abn)));
    }
    line
}

/// Asks every question through the same path as `note_chat` and scores the answers.
#[tokio::test]
#[ignore]
async fn chat_bench() {
    // The chat's own lines (how each question was read, how many notes went in).
    let _ = tracing_subscriber::fmt().with_test_writer().with_env_filter("lingora_lib::chat=info").without_time().try_init();
    let dir = fixtures();
    let questions: Vec<Question> = serde_json::from_str(&std::fs::read_to_string(dir.join("questions.json")).expect("questions.json")).expect("questions.json");
    let service = std::env::var("LINGORA_BENCH_CLOUD").ok();
    let cloud_target = service.as_ref().map(|provider| Cloud {
        provider: provider.clone(),
        model: std::env::var("LINGORA_BENCH_MODEL").expect("LINGORA_BENCH_MODEL with LINGORA_BENCH_CLOUD"),
        base_url: None,
    });
    let key = match &cloud_target {
        Some(c) => crate::summary_cloud::key_for(&c.provider).await.expect("LINGORA_SUMMARY_KEY"),
        None => String::new(),
    };

    let mut answers: HashMap<String, String> = HashMap::new();
    let mut scores: Vec<Score> = Vec::new();
    let through_all = std::env::var("LINGORA_BENCH_ALL").is_ok_and(|v| v == "1");
    for q in &questions {
        if q.note.is_none() || through_all {
            let mut turns: Vec<Turn> = Vec::new();
            if let Some(before) = q.after.as_ref().and_then(|id| questions.iter().find(|b| &b.id == id)) {
                turns.push(Turn { role: Role::User, text: before.q.clone() });
                turns.push(Turn { role: Role::Assistant, text: answers.get(&before.id).cloned().unwrap_or_default() });
            }
            turns.push(Turn { role: Role::User, text: q.q.clone() });
            let today = q.today.clone().unwrap_or_else(|| "2026-11-13".into());
            let target = cloud_target.as_ref().map(|c| (c, key.as_str()));
            let answer = all::answer(dir.join("notes"), turns, &today, target, None, Box::new(|_| {})).await.unwrap();
            let shown = answer.notice.as_ref().map_or_else(|| answer.text.clone(), notice_text);
            let used: Vec<&str> = answer.notes.iter().map(|n| n.id.as_str()).collect();
            println!("{} [{}] → {}", q.id, used.join(", "), shown.replace('\n', " "));
            answers.insert(q.id.clone(), shown.clone());
            scores.push(score_all(q, &answer, &shown));
            continue;
        }
        let Some(note_name) = &q.note else { continue };
        let note = read_note(&dir.join("notes").join(format!("{note_name}.json"))).expect("note");
        // A follow-up goes in the chat of the question it follows.
        let mut turns: Vec<Turn> = Vec::new();
        if let Some(before) = q.after.as_ref().and_then(|id| questions.iter().find(|b| &b.id == id)) {
            turns.push(Turn { role: Role::User, text: before.q.clone() });
            turns.push(Turn { role: Role::Assistant, text: answers.get(&before.id).cloned().unwrap_or_default() });
        }
        turns.push(Turn { role: Role::User, text: q.q.clone() });
        let answer = match &cloud_target {
            Some(c) => {
                let system = prompt::system_for_cloud(&note, &turns).unwrap();
                cloud::chat(c, &key, &system, &turns, &mut (Box::new(|_: &str| {}) as super::OnToken)).await.unwrap()
            }
            None => {
                let system = prompt::system_for(&note, &turns).await.unwrap();
                local::chat(system, turns, Box::new(|_| {})).await.unwrap()
            }
        };
        println!("{} → {}", q.id, answer.replace('\n', " "));
        answers.insert(q.id.clone(), answer.clone());
        scores.push(score(q, &answer));
    }

    println!("\n{}", summary_line(&scores.iter().collect::<Vec<_>>()));
    let mut kinds: Vec<&str> = scores.iter().map(|s| s.kind.as_str()).collect();
    kinds.sort_unstable();
    kinds.dedup();
    for kind in kinds {
        println!("  {kind:<12} {}", summary_line(&scores.iter().filter(|s| s.kind == kind).collect::<Vec<_>>()));
    }
    println!("\nTo read by hand:");
    for s in scores.iter().filter(|s| {
        s.correct == Some(false) || s.cites == Some(false) || s.no_invention == Some(false) || !s.language || s.sources == Some(false) || s.asks_back == Some(false) || s.invented > 0
    }) {
        println!("- {} [{}] {}\n  {}", s.id, s.kind, s.q, s.answer.replace('\n', "\n  "));
    }

    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/chat-bench");
    std::fs::create_dir_all(&out).unwrap();
    let day = crate::notes::now_iso()[..10].to_string();
    let file = out.join(format!("{day}-{}{}.json", service.as_deref().unwrap_or("local"), if through_all { "-all" } else { "" }));
    std::fs::write(&file, serde_json::to_string_pretty(&scores).unwrap()).unwrap();
    println!("\nRun saved in {}", file.display());
    // Frees the model before the process ends, as the app does when it quits (otherwise Metal aborts).
    local::stop();
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn correct_needs_every_item_and_accepts_alternatives() {
        let must = vec![json!(["15.000", "15000", "15 mil"]), json!("Ana")];
        assert!(correct("Ana propuso 15.000 euros.", &must));
        assert!(correct("ANA: quince... 15 MIL", &must));
        assert!(!correct("Propuso 15.000 euros.", &must));
        assert!(!correct("Ana propuso 12.000.", &must));
        // Accents and case do not matter.
        assert!(correct("La reunión fue en Málaga", &[json!("malaga"), json!("REUNION")]));
    }

    #[test]
    fn cites_within_the_slack() {
        let times = vec!["12:40".to_string()];
        assert!(cites("Lo dijo Ana [12:40].", &times));
        assert!(cites("Lo dijo Ana [12:55] y [30:00]", &times));
        assert!(!cites("Lo dijo Ana [14:00]", &times));
        assert!(!cites("Lo dijo Ana, sin hora [x:y] [ ]", &times));
        assert_eq!(cited_secs("[1:02:03] [00:05] [7]"), vec![3723, 5]);
    }

    #[test]
    fn unanswerable_must_say_it_is_not_there() {
        assert_eq!(honesty("No se menciona ningún presupuesto en la conversación."), Honesty::Said);
        assert_eq!(honesty("The transcript doesn’t mention it."), Honesty::Said);
        assert_eq!(honesty("La transcripción no menciona dónde será."), Honesty::Said);
        assert_eq!(honesty("It is not mentioned in the call."), Honesty::Said);
        assert_eq!(honesty("El presupuesto fue de 20.000 euros."), Honesty::Review);
    }

    #[test]
    fn language_by_common_words() {
        assert_eq!(language_of("Ana propuso un presupuesto de quince mil euros para la campaña."), "es");
        assert_eq!(language_of("Ana said that the budget is fifteen thousand euros."), "en");
    }

    #[test]
    fn score_fills_only_what_applies() {
        let q: Question = serde_json::from_value(json!({
            "id": "x", "note": "n", "q": "¿Quién?", "kind": "who", "must": ["Ana"], "lang": "es"
        }))
        .unwrap();
        let s = score(&q, "Fue Ana.");
        assert_eq!((s.correct, s.cites, s.no_invention, s.language), (Some(true), None, None, true));
        let q: Question = serde_json::from_value(json!({
            "id": "y", "note": "n", "q": "¿Cuánto?", "kind": "unanswerable", "answerable": false, "lang": "es"
        }))
        .unwrap();
        let s = score(&q, "No se menciona.");
        assert_eq!((s.correct, s.no_invention), (None, Some(true)));
    }

    #[test]
    fn summary_line_counts() {
        let q: Question = serde_json::from_value(json!({ "id": "x", "note": "n", "q": "?", "kind": "fact", "must": ["a"], "time": ["00:10"], "lang": "es" })).unwrap();
        let scores = [score(&q, "a [00:10] de la"), score(&q, "b")];
        assert_eq!(summary_line(&scores.iter().collect::<Vec<_>>()), "Correct 1/2 · Cites 1/2 · No invention - (0 review) · Language 2/2");
    }
}
