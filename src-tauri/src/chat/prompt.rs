//! Building the conversation for a question about one note: the instructions
//! and the note (`chat_system`), and what to do when the note does not fit in
//! the model's context (`system_for`). The pure parts are tested without the
//! model.

use super::{local, search, Role, Turn};
use crate::error::{Error, Result};
use crate::notes::{
    clock, paragraph_text, paragraphs, read_note, span_line, speaker_names, str_field, summary_with_notes, transcript_text,
    user_notes,
};
use serde_json::Value;

/// Tokens kept free for the history (the engine drops the oldest questions
/// when it does not fit). A fixed number: the same note gives the same
/// instructions in every question of a chat, so what was read is reused.
const HISTORY_RESERVE: usize = 2_500;

const INSTRUCTIONS: &str = "Eres un asistente que responde preguntas sobre una conversación transcrita. \
Responde solo con lo que aparece en la transcripción; si la respuesta no está, dilo claramente en vez de suponerla. \
Responde siempre en el idioma en que está escrita la pregunta, aunque la conversación esté en otro, de forma breve y directa, con Markdown sencillo (sin tablas). \
Cuando cites algo que se dijo, indica el momento con el formato [mm:ss]. \
Si aparecen etiquetas \"Persona N\", úsalas tal cual.";

const EXCERPTS_ONLY: &str = "\nSolo tienes fragmentos de la conversación, los más relacionados con la pregunta; \
los saltos van marcados con […]. Si la respuesta puede estar en una parte que no ves, dilo.";

/// What goes in the instructions as the conversation.
pub enum Body<'a> {
    /// All the transcript.
    Whole,
    /// Only these paragraphs (index in the note, text), in order.
    Excerpts(&'a [(usize, String)]),
}

/// The instructions for the chat with `note`: how to answer, then its title,
/// date, people, the summary (if it has one) and the transcript. It depends only
/// on the note (and on the excerpts), never on the time or the question, so
/// the model can reuse what it read. The user's own notes go in only when they
/// chose to include them in the summary (`summary_with_notes`): same privacy rule.
pub fn chat_system(note: &Value, body: &Body) -> String {
    let mut out = String::from(INSTRUCTIONS);
    if matches!(body, Body::Excerpts(_)) {
        out.push_str(EXCERPTS_ONLY);
    }
    out.push_str("\n\n---\n");
    let title = str_field(note, "title");
    if !title.is_empty() {
        out.push_str(&format!("Título: {title}\n"));
    }
    let span = span_line(note);
    if !span.is_empty() {
        out.push_str(&format!("Fecha: {span}\n"));
    }
    let names = speaker_names(note);
    if !names.is_empty() {
        out.push_str(&format!("Personas: {}\n", names.join(", ")));
    }
    if let Some(summary) = note.pointer("/summary/text").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        out.push_str(&format!("\nResumen hecho antes (puede omitir detalles; lo que dice la transcripción manda):\n{}\n", summary.trim()));
    }
    if summary_with_notes(note) {
        let notes = user_notes(note);
        if !notes.is_empty() {
            out.push_str("\nNotas que escribió el usuario:\n");
            for (t, text) in notes {
                out.push_str(&format!("{} {text}\n", clock(t)));
            }
        }
    }
    match body {
        Body::Whole => out.push_str(&format!("\nTranscripción:\n{}", transcript_text(note, false))),
        Body::Excerpts(units) => {
            out.push_str("\nFragmentos de la transcripción:\n");
            let mut previous: Option<usize> = None;
            for (i, text) in units.iter() {
                if previous.is_some_and(|p| p + 1 != *i) || (previous.is_none() && *i != 0) {
                    out.push_str("[…]\n\n");
                }
                out.push_str(text);
                previous = Some(*i);
            }
            if previous.is_some_and(|p| p + 1 < paragraphs_of(note).len()) {
                out.push_str("[…]\n");
            }
        }
    }
    out
}

fn paragraphs_of(note: &Value) -> Vec<Vec<&Value>> {
    let sentences = note.get("sentences").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    paragraphs(sentences)
}

/// Each paragraph as it goes in the instructions: `[mm:ss] who: text`.
pub fn units(note: &Value) -> Vec<String> {
    paragraphs_of(note).iter().map(|p| paragraph_text(note, p, false)).collect()
}

/// What to search for: the question plus the one before it, so a follow-up
/// («¿y quién lo dijo?») still finds what it is about.
pub fn search_query(turns: &[Turn]) -> String {
    let mut questions = turns.iter().rev().filter(|t| t.role == Role::User).map(|t| t.text.as_str());
    let last = questions.next().unwrap_or_default();
    match questions.next() {
        Some(before) => format!("{last} {before}"),
        None => last.to_string(),
    }
}

/// Which paragraphs to keep: the best scored first until `budget` is spent
/// (`cost` is each one's size, in tokens or characters). Those that do not
/// share a word with the question only fill what is left, in order. Returns
/// their indexes, in the note's order.
pub fn pick_units(cost: &[usize], scores: &[f32], budget: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..cost.len()).collect();
    order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]).then(a.cmp(&b)));
    let (mut used, mut chosen) = (0, Vec::new());
    for i in order {
        if used + cost[i] <= budget {
            used += cost[i];
            chosen.push(i);
        }
    }
    chosen.sort_unstable();
    chosen
}

/// The last message of `turns` must be the question.
fn question(turns: &[Turn]) -> Result<&str> {
    match turns.last() {
        Some(t) if t.role == Role::User && !t.text.trim().is_empty() => Ok(&t.text),
        _ => Err(Error::Notes("Escribe una pregunta.".into())),
    }
}

/// The instructions for this question: all the note if it fits in the model's
/// context with room for the history, and otherwise the summary plus the
/// paragraphs that best match the question.
pub async fn system_for(note: &Value, turns: &[Turn]) -> Result<String> {
    let q = question(turns)?;
    let whole = chat_system(note, &Body::Whole);
    let counts = local::count_tokens(vec![whole.clone(), q.to_string()]).await?;
    if counts[1] > local::ROOM / 4 {
        return Err(Error::Notes("La pregunta es demasiado larga.".into()));
    }
    let budget = local::ROOM.saturating_sub(HISTORY_RESERVE + counts[1]);
    if counts[0] <= budget {
        return Ok(whole);
    }
    let all = units(note);
    let mut texts = vec![chat_system(note, &Body::Excerpts(&[]))];
    texts.extend(all.iter().cloned());
    let tokens = local::count_tokens(texts).await?;
    let room = budget.saturating_sub(tokens[0]);
    let scores = search::rank(&all.iter().map(String::as_str).collect::<Vec<_>>(), &search_query(turns));
    let picked: Vec<(usize, String)> = pick_units(&tokens[1..], &scores, room).into_iter().map(|i| (i, all[i].clone())).collect();
    Ok(chat_system(note, &Body::Excerpts(&picked)))
}

/// The same for a service with a large context: it counts characters, not tokens.
pub fn system_for_cloud(note: &Value, turns: &[Turn]) -> Result<String> {
    question(turns)?;
    let whole = chat_system(note, &Body::Whole);
    if whole.chars().count() <= crate::notes::CLOUD_MAX_CHARS {
        return Ok(whole);
    }
    let all = units(note);
    let base = chat_system(note, &Body::Excerpts(&[])).chars().count();
    let cost: Vec<usize> = all.iter().map(|u| u.chars().count()).collect();
    let scores = search::rank(&all.iter().map(String::as_str).collect::<Vec<_>>(), &search_query(turns));
    let picked: Vec<(usize, String)> =
        pick_units(&cost, &scores, crate::notes::CLOUD_MAX_CHARS.saturating_sub(base)).into_iter().map(|i| (i, all[i].clone())).collect();
    Ok(chat_system(note, &Body::Excerpts(&picked)))
}

/// Reads the note for a command.
pub fn load(id: &str) -> Result<Value> {
    let note = read_note(&crate::notes::note_path(id)?)?;
    if transcript_text(&note, false).trim().is_empty() {
        return Err(Error::Notes("La nota no tiene frases sobre las que preguntar.".into()));
    }
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn note() -> Value {
        json!({
            "id": "2026-11-03_10-32-00",
            "title": "Reunión con Ana",
            "speakers": { "1": "Ana" },
            "sentences": [
                { "t": 3.0, "speaker": 1, "source": "Propongo quince mil euros.", "translation": "Propongo quince mil euros." },
                { "t": 40.0, "speaker": 0, "source": "Me parece bien.", "translation": "Me parece bien." },
                { "t": 90.0, "speaker": 1, "source": "Hablemos del café.", "translation": "Hablemos del café." }
            ],
            "summary": { "text": "## Resumen\nAna propone un presupuesto." },
            "my_notes": [{ "t": 41.0, "text": "secreto" }]
        })
    }

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    #[test]
    fn system_has_the_note_and_is_always_the_same() {
        let s = chat_system(&note(), &Body::Whole);
        assert!(s.contains("Título: Reunión con Ana") && s.contains("Personas: Ana"));
        assert!(s.contains("Resumen hecho antes") && s.contains("Ana propone un presupuesto."));
        assert!(s.contains("[00:03] Ana: Propongo quince mil euros.") && s.contains("[00:40] Yo: Me parece bien."));
        assert_eq!(s, chat_system(&note(), &Body::Whole));
    }

    #[test]
    fn user_notes_go_in_only_if_the_user_included_them() {
        assert!(!chat_system(&note(), &Body::Whole).contains("secreto"));
        let mut with = note();
        with["summary_with_notes"] = json!(true);
        assert!(chat_system(&with, &Body::Whole).contains("[00:41] secreto"));
    }

    #[test]
    fn excerpts_mark_the_jumps() {
        let all = units(&note());
        assert_eq!(all.len(), 3);
        let picked = vec![(1, all[1].clone())];
        let s = chat_system(&note(), &Body::Excerpts(&picked));
        assert!(s.contains("Solo tienes fragmentos"));
        let body = s.split("Fragmentos de la transcripción:\n").nth(1).unwrap();
        assert!(body.starts_with("[…]\n\n[00:40] Yo:") && body.ends_with("[…]\n"));
        assert!(!s.contains("café"));
        // Everything picked: no jump marks.
        let everything: Vec<_> = all.iter().cloned().enumerate().collect();
        assert!(!chat_system(&note(), &Body::Excerpts(&everything)).contains("[…]\n"));
    }

    #[test]
    fn query_adds_the_question_before() {
        let turns = vec![turn(Role::User, "¿Qué propuso Ana?"), turn(Role::Assistant, "Quince mil."), turn(Role::User, "¿Y quién lo aceptó?")];
        assert_eq!(search_query(&turns), "¿Y quién lo aceptó? ¿Qué propuso Ana?");
        assert_eq!(search_query(&turns[..1]), "¿Qué propuso Ana?");
    }

    #[test]
    fn picks_by_score_within_budget_and_returns_note_order() {
        // 4 paragraphs of 10: the 3rd and the 1st score best; room for two.
        assert_eq!(pick_units(&[10, 10, 10, 10], &[2.0, 0.0, 5.0, 0.0], 20), vec![0, 2]);
        // One that does not fit is skipped, a smaller one still goes.
        assert_eq!(pick_units(&[30, 5, 5], &[9.0, 1.0, 0.0], 12), vec![1, 2]);
        assert!(pick_units(&[10], &[1.0], 5).is_empty());
    }

    #[test]
    fn the_last_message_must_be_a_question() {
        assert!(question(&[]).is_err());
        assert!(question(&[turn(Role::User, "  ")]).is_err());
        assert!(question(&[turn(Role::User, "a"), turn(Role::Assistant, "b")]).is_err());
        assert_eq!(question(&[turn(Role::User, "a")]).unwrap(), "a");
    }

    #[test]
    fn cloud_sends_everything_unless_it_is_huge() {
        let turns = vec![turn(Role::User, "¿Qué propuso Ana?")];
        assert_eq!(system_for_cloud(&note(), &turns).unwrap(), chat_system(&note(), &Body::Whole));
        let mut big = note();
        let sentences: Vec<Value> = (0..4000)
            .map(|i| json!({ "t": i as f64 * 20.0, "speaker": i % 2, "source": "relleno ".repeat(100), "translation": "relleno ".repeat(100) }))
            .collect();
        big["sentences"] = json!(sentences);
        let s = system_for_cloud(&big, &turns).unwrap();
        assert!(s.contains("Solo tienes fragmentos") && s.chars().count() <= crate::notes::CLOUD_MAX_CHARS + 2_000);
    }
}
