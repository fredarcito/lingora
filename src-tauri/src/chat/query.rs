//! Understanding a question about all the notes before searching: what kind
//! of question it is, its topic words, the people and dates it names. The
//! model answers a small fixed JSON (`query_system`); this file builds that
//! request and reads the answer. Pure: tested without the model.

use super::{Role, Turn};
use serde::Deserialize;

/// How many earlier messages go with the question, so «¿y con Luis?» or
/// «ese proyecto» still mean something.
const CONTEXT_TURNS: usize = 4;
/// An earlier answer is cut to this many characters: the topic is at the start.
const CONTEXT_CHARS: usize = 400;
/// «Las últimas reuniones» without a number.
pub const DEFAULT_LATEST: usize = 5;

/// What kind of question it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A fact: «¿qué presupuesto propuso Ana?». Answered from the paragraphs that match.
    Detail,
    /// Several meetings at once: «resume las reuniones con Jeff». Answered from their summaries.
    Overview,
    /// It can't tell which meetings: the chat asks back (`ask`).
    Clarify,
}

/// The model's reading of the question.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Query {
    pub kind: Kind,
    /// Topic words (no people or dates), possibly in more than one language.
    #[serde(default)]
    pub terms: Vec<String>,
    /// People as written in the question.
    #[serde(default)]
    pub people: Vec<String>,
    /// Dates, `YYYY-MM-DD`, both included.
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    /// «Las últimas N».
    #[serde(default)]
    pub latest: Option<usize>,
    /// With `Clarify`: the question back, in the language of the question.
    #[serde(default)]
    pub ask: Option<String>,
}

impl Query {
    /// When the model's answer can't be read: search the question's own words.
    pub fn fallback() -> Self {
        Query { kind: Kind::Detail, terms: Vec::new(), people: Vec::new(), from: None, to: None, latest: None, ask: None }
    }

    /// Nothing to choose notes by: no topic, person, date or count.
    pub fn is_vague(&self) -> bool {
        self.terms.iter().all(|t| t.trim().is_empty()) && self.people.is_empty() && self.from.is_none() && self.to.is_none() && self.latest.is_none()
    }
}

/// The instructions for reading the question. `today` is the user's local
/// date (`2026-11-13`), so «ayer» or «la semana pasada» become dates. The
/// examples matter: without them the model asked back about almost anything
/// that didn't name a meeting (bench, 2026-11-13).
pub fn query_system(today: &str) -> String {
    let year = today.get(0..4).filter(|_| is_date(today)).unwrap_or("2026");
    format!(
        "Analizas una pregunta sobre las notas de reuniones del usuario para poder buscarlas. Hoy es {today}{weekday}.\n\
Responde solo con un objeto JSON en una línea, sin explicaciones ni Markdown, con estas claves:\n\
{{\"kind\": \"detail\" | \"overview\" | \"clarify\", \"terms\": [...], \"people\": [...], \"from\": \"AAAA-MM-DD\" | null, \"to\": \"AAAA-MM-DD\" | null, \"latest\": número | null, \"ask\": texto | null}}\n\
Reglas:\n\
- \"detail\": busca un dato o un hecho, aunque no diga en qué reunión (el buscador encuentra la reunión por sus palabras). Es el caso normal.\n\
- \"overview\": pide un resumen o un repaso de varias reuniones: de una persona, de un tema o de un periodo.\n\
- \"clarify\": solo si no hay ninguna persona, tema ni fecha, o si se refiere a algo con \"este\", \"eso\", \"ella\"… y la conversación no dice qué es. Si la pregunta nombra a una persona, un tema o una fecha, nunca es \"clarify\".\n\
- terms: las palabras clave del tema, sin nombres de personas, sin fechas y sin palabras como reunión, nota, resumen o proyecto; si el tema se dice distinto en español y en inglés, pon las dos.\n\
- people: los nombres de personas de la pregunta (o de la conversación, si la pregunta se refiere a ellas).\n\
- from y to: el periodo si la pregunta lo da (\"ayer\", \"la semana pasada\", \"en octubre\"); una semana va de lunes a domingo.\n\
- latest: cuántas reuniones si pide \"las últimas N\"; {DEFAULT_LATEST} si dice \"las últimas\" sin número.\n\
- ask: solo con \"clarify\", una pregunta corta en el idioma de la pregunta que diga qué falta.\n\
Ejemplos:\n\
\"¿Cuándo llega el pedido de sillas?\" → {{\"kind\":\"detail\",\"terms\":[\"pedido\",\"sillas\",\"order\",\"chairs\"],\"people\":[],\"from\":null,\"to\":null,\"latest\":null,\"ask\":null}}\n\
\"¿Qué dijo Pablo del contrato en septiembre?\" → {{\"kind\":\"detail\",\"terms\":[\"contrato\",\"contract\"],\"people\":[\"Pablo\"],\"from\":\"{year}-09-01\",\"to\":\"{year}-09-30\",\"latest\":null,\"ask\":null}}\n\
\"Resume las últimas reuniones con Laura\" → {{\"kind\":\"overview\",\"terms\":[],\"people\":[\"Laura\"],\"from\":null,\"to\":null,\"latest\":{DEFAULT_LATEST},\"ask\":null}}\n\
\"¿Qué se habló del rediseño de la web?\" → {{\"kind\":\"overview\",\"terms\":[\"rediseño\",\"web\",\"redesign\",\"website\"],\"people\":[],\"from\":null,\"to\":null,\"latest\":null,\"ask\":null}}\n\
\"Hazme un resumen de todo\" → {{\"kind\":\"clarify\",\"terms\":[],\"people\":[],\"from\":null,\"to\":null,\"latest\":null,\"ask\":\"¿De qué periodo, o con quién?\"}}\n\
\"¿Qué dijo ella?\" (sin conversación antes) → {{\"kind\":\"clarify\",\"terms\":[],\"people\":[],\"from\":null,\"to\":null,\"latest\":null,\"ask\":\"¿De quién hablas?\"}}",
        weekday = weekday(today).map(|w| format!(" ({w})")).unwrap_or_default()
    )
}

/// Words that say nothing about the topic («resume las reuniones del
/// proyecto»): searched, they match every note.
const GENERIC: &[&str] = &[
    "reunion", "reuniones", "nota", "notas", "llamada", "llamadas", "conversacion", "conversaciones", "resumen", "resume", "proyecto",
    "proyectos", "tema", "temas", "meeting", "meetings", "note", "notes", "call", "calls", "summary", "project", "projects", "topic",
];

/// Words that point to something said before («este proyecto», «ella»).
/// Not «él», «he» or «it»: without accents «él» is the article «el», «he» is
/// also Spanish («he hablado») and «it» is in most English questions.
const POINTING: &[&str] = &[
    "este", "esta", "esto", "estos", "estas", "ese", "esa", "eso", "esos", "esas", "aquel", "aquella", "aquello", "ella", "ellos", "ellas",
    "this", "that", "these", "those", "she", "her", "him", "they", "them",
];

/// The model's reading, checked against the question: generic words are
/// not topics, and it only asks back when the question names nothing (no
/// person, date, count or topic) or, with no conversation before, points to
/// something («este proyecto»). With a conversation before, topic words mean
/// the model found what «esa fecha» is. The user names things
/// (docs/plan-chat.md §2.2): a question that does is answered, even if the
/// model hesitated.
pub fn refine(mut q: Query, question: &str, has_history: bool) -> Query {
    let generic = |t: &String| super::search::words(t).iter().all(|w| GENERIC.contains(&w.as_str()));
    q.terms.retain(|t| !generic(t));
    if q.kind == Kind::Clarify {
        let words = super::search::words(question);
        let points = !has_history && words.iter().any(|w| POINTING.contains(&w.as_str()));
        let named = !q.people.is_empty() || q.from.is_some() || q.to.is_some() || q.latest.is_some();
        if named || (!q.terms.is_empty() && !points) {
            q.kind = Kind::Detail;
            q.ask = None;
        }
    }
    q
}

/// The only message sent with `query_system`: the recent conversation and the question.
pub fn query_turns(turns: &[Turn]) -> Vec<Turn> {
    let (question, before) = turns.split_last().map_or(("", &[][..]), |(q, rest)| (q.text.as_str(), rest));
    let mut text = String::new();
    let recent = &before[before.len().saturating_sub(CONTEXT_TURNS)..];
    if !recent.is_empty() {
        text.push_str("Conversación hasta ahora:\n");
        for t in recent {
            let who = if t.role == Role::User { "Usuario" } else { "Asistente" };
            let said: String = t.text.chars().take(CONTEXT_CHARS).collect();
            text.push_str(&format!("{who}: {}\n", said.replace('\n', " ")));
        }
        text.push('\n');
    }
    text.push_str(&format!("Pregunta: {question}"));
    vec![Turn { role: Role::User, text }]
}

/// Reads the model's answer: the JSON object in it, with dates that are not
/// `YYYY-MM-DD` dropped. `None` if there is no object to read.
pub fn parse_query(answer: &str) -> Option<Query> {
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    let mut q: Query = serde_json::from_str(answer.get(start..=end)?).ok()?;
    let valid = |d: &Option<String>| d.as_deref().is_some_and(is_date);
    if !valid(&q.from) {
        q.from = None;
    }
    if !valid(&q.to) {
        q.to = None;
    }
    q.terms.retain(|t| !t.trim().is_empty());
    q.people.retain(|p| !p.trim().is_empty());
    q.latest = q.latest.filter(|n| *n > 0);
    q.ask = q.ask.filter(|a| !a.trim().is_empty());
    if q.kind == Kind::Clarify && q.ask.is_none() {
        // Without the question back there is nothing to say: search what there is.
        q.kind = Kind::Detail;
    }
    Some(q)
}

/// `2026-11-03`.
pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// The day of the week of a `YYYY-MM-DD` date, in Spanish (the instructions are in Spanish).
fn weekday(date: &str) -> Option<&'static str> {
    if !is_date(date) {
        return None;
    }
    let num = |r: std::ops::Range<usize>| date[r].parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    // Sakamoto's method: 0 is Sunday.
    const T: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    let day = (y + y / 4 - y / 100 + y / 400 + T.get((m - 1) as usize)? + d).rem_euclid(7);
    Some(["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][day as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    #[test]
    fn reads_the_json_even_with_text_around() {
        let q = parse_query("Claro: {\"kind\": \"overview\", \"terms\": [], \"people\": [\"Jeff\"], \"from\": null, \"to\": null, \"latest\": 5, \"ask\": null} listo").unwrap();
        assert_eq!(q.kind, Kind::Overview);
        assert_eq!(q.people, ["Jeff"]);
        assert_eq!(q.latest, Some(5));
        assert!(parse_query("no sé").is_none());
        assert!(parse_query("{\"kind\": \"otra\"}").is_none());
    }

    #[test]
    fn bad_dates_and_empty_values_are_dropped() {
        let q = parse_query(r#"{"kind":"detail","terms":["presupuesto",""],"people":[" "],"from":"ayer","to":"2026-11-13","latest":0}"#).unwrap();
        assert_eq!(q.terms, ["presupuesto"]);
        assert!(q.people.is_empty() && q.from.is_none() && q.latest.is_none());
        assert_eq!(q.to.as_deref(), Some("2026-11-13"));
    }

    #[test]
    fn clarify_without_a_question_back_searches_instead() {
        assert_eq!(parse_query(r#"{"kind":"clarify"}"#).unwrap().kind, Kind::Detail);
        let q = parse_query(r#"{"kind":"clarify","ask":"¿Qué proyecto?"}"#).unwrap();
        assert_eq!((q.kind, q.ask.as_deref()), (Kind::Clarify, Some("¿Qué proyecto?")));
    }

    #[test]
    fn vague_is_nothing_to_choose_by() {
        assert!(Query::fallback().is_vague());
        assert!(!Query { latest: Some(3), ..Query::fallback() }.is_vague());
        assert!(!Query { terms: vec!["atlas".into()], ..Query::fallback() }.is_vague());
    }

    #[test]
    fn it_only_asks_back_when_nothing_is_named() {
        let clarify = |terms: &[&str], people: &[&str]| Query {
            kind: Kind::Clarify,
            terms: terms.iter().map(|t| t.to_string()).collect(),
            people: people.iter().map(|p| p.to_string()).collect(),
            ask: Some("¿Qué?".into()),
            ..Query::fallback()
        };
        // A topic or a person: answered.
        assert_eq!(refine(clarify(&["Atlas"], &[]), "¿Cuándo sale la primera versión de Atlas?", false).kind, Kind::Detail);
        assert_eq!(refine(clarify(&[], &["Marta"]), "¿Qué tareas tiene Marta?", false).kind, Kind::Detail);
        // Pointing at nothing, or only generic words: asked back.
        assert_eq!(refine(clarify(&["proyecto"], &[]), "¿Cómo va este proyecto?", false).kind, Kind::Clarify);
        let vague = refine(clarify(&["reuniones"], &[]), "Resume mis reuniones", false);
        assert_eq!(vague.kind, Kind::Clarify);
        assert!(vague.terms.is_empty());
        // With a conversation before: a topic means the model found what «esa fecha» is.
        assert_eq!(refine(clarify(&["Atlas", "fecha"], &[]), "¿Y quién confirmó esa fecha?", true).kind, Kind::Detail);
        assert_eq!(refine(clarify(&["proyecto"], &[]), "¿Cómo va este proyecto?", true).kind, Kind::Clarify);
    }

    #[test]
    fn the_system_has_today_and_its_weekday() {
        assert!(query_system("2026-11-13").contains("Hoy es 2026-11-13 (viernes)"));
        assert_eq!(weekday("2026-11-16"), Some("lunes"));
        assert_eq!(weekday("2024-02-29"), Some("jueves"));
        assert!(query_system("raro").contains("Hoy es raro."));
        assert!(query_system("2027-01-02").contains("\"from\":\"2027-09-01\""));
    }

    #[test]
    fn the_request_carries_the_recent_conversation() {
        let turns = vec![turn(Role::User, "¿Qué dijo Jeff del proyecto Atlas?"), turn(Role::Assistant, "Que va con retraso."), turn(Role::User, "¿Y Ana?")];
        let sent = query_turns(&turns);
        assert_eq!(sent.len(), 1);
        assert!(sent[0].text.contains("Usuario: ¿Qué dijo Jeff del proyecto Atlas?"));
        assert!(sent[0].text.contains("Asistente: Que va con retraso."));
        assert!(sent[0].text.ends_with("Pregunta: ¿Y Ana?"));
        assert_eq!(query_turns(&turns[..1])[0].text, "Pregunta: ¿Qué dijo Jeff del proyecto Atlas?");
    }
}
