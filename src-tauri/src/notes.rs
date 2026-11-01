//! Conversaciones guardadas: un JSON por conversación en
//! `~/Library/Application Support/lingora/notes/<id>.json` (formato en
//! docs/plan-notas.md). La UI las escribe frase a frase; aquí solo se lee,
//! se guarda tal cual, se borra y se exporta.

use crate::error::{Error, Result};
use crate::groq::Groq;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

const MONTHS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/// Lo justo de una nota para listarla y buscar sin leer cada transcripción entera.
#[derive(Serialize)]
pub struct NoteSummary {
    id: String,
    title: String,
    created_at: String,
    ended_at: Option<String>,
    sentences: usize,
    has_summary: bool,
    /// `"notes"` en Tomar notas; sin él (o `"translation"`), una traducción.
    kind: Option<String>,
    /// Primeros ~200 caracteres de las traducciones (o del original).
    preview: String,
    /// Idiomas de la primera frase, para ver "ES → EN" en la lista.
    source_lang: Option<String>,
    target_lang: Option<String>,
    /// La primera frase del resumen, si hay: dice más que el principio de la transcripción.
    summary_line: Option<String>,
    /// The names given to the people (not "Yo", `"0"`), to suggest them when
    /// renaming someone in another note.
    speaker_names: Vec<String>,
}

/// Carpeta de notas, junto a la de modelos.
fn notes_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home).join("Library/Application Support/lingora/notes")
}

/// Ruta del archivo de una nota. El id solo puede tener `[0-9A-Za-z_-]`: así
/// nadie escribe ni lee fuera de la carpeta.
fn note_path(id: &str) -> Result<PathBuf> {
    let valid = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(Error::Notes(format!("id de nota no válido: {id}")));
    }
    Ok(notes_dir().join(format!("{id}.json")))
}

fn read_note(path: &Path) -> Result<Value> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|e| Error::Notes(format!("la nota no se puede leer: {e}")))
}

fn str_field<'a>(note: &'a Value, key: &str) -> &'a str {
    note.get(key).and_then(Value::as_str).unwrap_or("")
}

/// La traducción de una frase o, sin ella (modo original), el original.
fn shown_text(sentence: &Value) -> &str {
    sentence
        .get("translation")
        .and_then(Value::as_str)
        .unwrap_or_else(|| str_field(sentence, "source"))
}

/// La primera frase del texto del resumen, sin encabezados ni marcas de lista.
fn first_summary_line(text: &str) -> Option<String> {
    let line = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#'))
        .map(|l| l.trim_start_matches(['-', '*', ' ']).trim_start_matches("[ ]").trim_start_matches("[x]").trim())
        .find(|l| !l.is_empty())?;
    let end = line.find(". ").map_or(line.len(), |i| i + 1);
    let sentence: String = line[..end].chars().take(200).collect();
    Some(sentence.replace("**", ""))
}

fn summarize(id: &str, note: &Value) -> NoteSummary {
    let sentences = note.get("sentences").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let mut preview = String::new();
    for s in sentences {
        if preview.chars().count() >= 200 {
            break;
        }
        if !preview.is_empty() {
            preview.push(' ');
        }
        preview.push_str(shown_text(s));
    }
    // Nothing transcribed (Take notes): the user's notes, so it can be found.
    if preview.is_empty() {
        let notes = note.get("my_notes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        preview = notes.iter().map(|n| str_field(n, "text")).collect::<Vec<_>>().join(" ");
    }
    NoteSummary {
        id: id.to_string(),
        title: str_field(note, "title").to_string(),
        created_at: str_field(note, "created_at").to_string(),
        ended_at: note.get("ended_at").and_then(Value::as_str).map(str::to_string),
        sentences: sentences.len(),
        has_summary: note.get("summary").is_some_and(|s| !s.is_null()),
        kind: note.get("kind").and_then(Value::as_str).map(str::to_string),
        preview: preview.chars().take(200).collect(),
        source_lang: sentences.first().and_then(|s| s.get("source_lang")).and_then(Value::as_str).map(str::to_string),
        target_lang: sentences.first().and_then(|s| s.get("target_lang")).and_then(Value::as_str).map(str::to_string),
        summary_line: note.pointer("/summary/text").and_then(Value::as_str).and_then(first_summary_line),
        speaker_names: speaker_names(note),
    }
}

/// The names in `speakers`, without the user's own (`"0"`) or empty ones.
fn speaker_names(note: &Value) -> Vec<String> {
    let Some(speakers) = note.get("speakers").and_then(Value::as_object) else {
        return Vec::new();
    };
    speakers
        .iter()
        .filter(|(k, _)| k.as_str() != "0")
        .filter_map(|(_, v)| v.as_str().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string))
        .collect()
}

/// Las notas, de la más nueva a la más vieja. Lo que no se pueda leer se ignora.
#[tauri::command]
pub async fn notes_list() -> Result<Vec<NoteSummary>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(dir) = std::fs::read_dir(notes_dir()) else {
            return Ok(Vec::new());
        };
        let mut out: Vec<NoteSummary> = dir
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let path = e.path();
                if path.extension()? != "json" {
                    return None;
                }
                let id = path.file_stem()?.to_str()?.to_string();
                note_path(&id).ok()?;
                Some(summarize(&id, &read_note(&path).ok()?))
            })
            .collect();
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo listar las notas: {e}")))?
}

/// El JSON de la nota, tal cual.
#[tauri::command]
pub fn note_read(id: String) -> Result<Value> {
    read_note(&note_path(&id)?)
}

/// Escribe la nota a un `.tmp` y lo renombra, para que un corte a medias no
/// deje la nota a la mitad.
fn write_note(path: &Path, note: &Value) -> Result<()> {
    std::fs::create_dir_all(notes_dir())?;
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(note).map_err(|e| Error::Notes(e.to_string()))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Crea o reemplaza la nota (`note.id` es el archivo).
#[tauri::command]
pub fn note_save(note: Value) -> Result<()> {
    write_note(&note_path(str_field(&note, "id"))?, &note)
}

#[tauri::command]
pub fn note_delete(id: String) -> Result<()> {
    std::fs::remove_file(note_path(&id)?)?;
    Ok(())
}

/// Muestra el archivo en Finder (en Windows, en el Explorador).
fn reveal(path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `/select,` y la ruta van juntos: el Explorador no entiende las comillas de `arg`.
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).status()?;
    }
    #[cfg(not(windows))]
    std::process::Command::new("open").arg("-R").arg(path).status()?;
    Ok(())
}

#[tauri::command]
pub fn note_reveal(id: String) -> Result<()> {
    reveal(&note_path(&id)?)
}

/// Escribe la nota en Descargas (`md` o `txt`), la muestra en Finder y
/// devuelve la ruta. Si el nombre existe, añade " (2)", " (3)"…
#[tauri::command]
pub fn note_export(id: String, format: String) -> Result<String> {
    let markdown = match format.as_str() {
        "md" => true,
        "txt" => false,
        other => return Err(Error::Notes(format!("formato desconocido: {other}"))),
    };
    let note = read_note(&note_path(&id)?)?;
    let path = download_path(str_field(&note, "title"), &format)?;
    std::fs::write(&path, export_text(&note, markdown))?;
    reveal(&path)?;
    Ok(path.display().to_string())
}

/// Writes the note's mind map, drawn by the app as a PNG, to Downloads and
/// shows it in Finder.
#[tauri::command]
pub fn note_export_image(id: String, png: Vec<u8>) -> Result<String> {
    if !png.starts_with(b"\x89PNG") {
        return Err(Error::Notes("la imagen no es un PNG".into()));
    }
    let note = read_note(&note_path(&id)?)?;
    let path = download_path(str_field(&note, "title"), "png")?;
    std::fs::write(&path, png)?;
    reveal(&path)?;
    Ok(path.display().to_string())
}

/// A free name in Downloads for the note: "Title.ext", or "Title (2).ext" if
/// that one exists.
fn download_path(title: &str, ext: &str) -> Result<PathBuf> {
    let name = file_name(title);
    let downloads = Path::new(&std::env::var("HOME").unwrap_or_default()).join("Downloads");
    std::fs::create_dir_all(&downloads)?;
    let mut path = downloads.join(format!("{name}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = downloads.join(format!("{name} ({n}).{ext}"));
        n += 1;
    }
    Ok(path)
}

/// El título como nombre de archivo: sin separadores ni caracteres que
/// Finder o Windows rechazan.
fn file_name(title: &str) -> String {
    let clean: String = title
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .take(80)
        .collect();
    let clean = clean.trim().trim_matches('.').trim();
    if clean.is_empty() { "Conversación".to_string() } else { clean.to_string() }
}

/// Días desde 1970-01-01 de una fecha civil (algoritmo de H. Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Segundos desde 1970 de un ISO 8601 en UTC ("2026-10-29T13:32:05.120Z").
fn iso_secs(iso: &str) -> Option<i64> {
    let num = |range: std::ops::Range<usize>| iso.get(range)?.parse::<i64>().ok();
    let days = days_from_civil(num(0..4)?, num(5..7)?, num(8..10)?);
    Some(days * 86400 + num(11..13)? * 3600 + num(14..16)? * 60 + num(17..19)?)
}

/// "29 oct 2026 · 10:32–11:07 · 35 min". La hora de inicio sale del `id`
/// (fecha local) y el fin se calcula sumándole la duración, sin zonas horarias.
fn span_line(note: &Value) -> String {
    let id = str_field(note, "id");
    let part = |range: std::ops::Range<usize>| id.get(range).and_then(|s| s.parse::<i64>().ok());
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute)) =
        (part(0..4), part(5..7), part(8..10), part(11..13), part(14..16))
    else {
        return String::new();
    };
    let month = MONTHS.get((month - 1) as usize).copied().unwrap_or("");
    let start = format!("{hour:02}:{minute:02}");
    let secs = note
        .get("ended_at")
        .and_then(Value::as_str)
        .zip(note.get("created_at").and_then(Value::as_str))
        .and_then(|(end, begin)| Some(iso_secs(end)? - iso_secs(begin)?))
        .map(|s| s.max(0));
    let Some(secs) = secs else {
        return format!("{day} {month} {year} · {start}");
    };
    let end_of_day = (hour * 3600 + minute * 60 + secs) % 86400;
    let duration = if secs < 60 { format!("{secs} s") } else { format!("{} min", (secs + 30) / 60) };
    format!("{day} {month} {year} · {start}–{:02}:{:02} · {duration}", end_of_day / 3600, end_of_day % 3600 / 60)
}

/// Quién habla: nada sin personas detectadas; si no, su nombre, "Yo" (0, tu
/// micrófono en una llamada) o "Persona n".
fn speaker_label(note: &Value, sentence: &Value) -> String {
    match sentence.get("speaker").and_then(Value::as_i64) {
        None => String::new(),
        Some(n) => note
            .get("speakers")
            .and_then(|s| s.get(n.to_string()))
            .and_then(Value::as_str)
            .map_or_else(|| if n == 0 { "Yo".to_string() } else { format!("Persona {n}") }, str::to_string),
    }
}

/// La nota como texto: título, fecha, resumen (si hay) y transcripción. En
/// Markdown el título y los encabezados llevan `#`; en texto plano, no.
fn export_text(note: &Value, markdown: bool) -> String {
    let (h1, h2) = if markdown { ("# ", "## ") } else { ("", "") };
    let mut out = format!("{h1}{}\n{}\n\n", str_field(note, "title"), span_line(note));
    if let Some(text) = note.pointer("/summary/text").and_then(Value::as_str) {
        out.push_str(&format!("{h2}Resumen\n{text}\n\n"));
    }
    let marks = user_marks_text(note);
    if !marks.is_empty() {
        out.push_str(&format!("{h2}Mis notas\n{marks}\n"));
    }
    out.push_str(&format!("{h2}Transcripción\n"));
    out.push_str(&transcript_text(note, true));
    out
}

/// The user's notes and bookmarks (Take notes) in time order, one per line:
/// `[mm:ss] text` or `[mm:ss] (momento marcado)`. Empty if there are none.
/// The same order as `userMarks` in `src/utils/notes.js`.
fn user_marks_text(note: &Value) -> String {
    marks_text(note, true, true)
}

/// Like `user_marks_text`, with only the notes, only the bookmarks or both.
fn marks_text(note: &Value, notes: bool, bookmarks: bool) -> String {
    let list = |key: &str| note.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let t = |v: &Value| v.get("t").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
    let mut marks: Vec<(f64, &str)> = Vec::new();
    if notes {
        marks.extend(
            list("my_notes")
                .iter()
                .map(|n| (t(n), str_field(n, "text").trim()))
                .filter(|(_, text)| !text.is_empty()),
        );
    }
    if bookmarks {
        marks.extend(list("bookmarks").iter().map(|b| (t(b), "(momento marcado)")));
    }
    marks.sort_by(|a, b| a.0.total_cmp(&b.0));
    marks
        .iter()
        .map(|(t, text)| {
            let secs = *t as u64;
            format!("[{:02}:{:02}] {text}\n", secs / 60, secs % 60)
        })
        .collect()
}

/// Whether the summary also uses the user's notes: only if they turned it on
/// for this note (`summary_with_notes`), since notes may be private.
fn summary_with_notes(note: &Value) -> bool {
    note.get("summary_with_notes").and_then(Value::as_bool).unwrap_or(false)
}

/// What is sent to be summarized: the transcript, when the user wrote notes
/// (if they chose to include them) and the moments they marked, which always
/// go. Only the times of the notes: their text never leaves the Mac, nor can
/// it end up in other sections; the app writes it in (`with_user_notes`).
fn summary_input(note: &Value) -> String {
    let mut text = transcript_text(note, false);
    let notes = if summary_with_notes(note) { user_notes(note) } else { Vec::new() };
    if !notes.is_empty() {
        // Numbered: the summary refers to them as N1, N2… and the app writes their text.
        text.push_str("\nMomentos en que el usuario escribió una nota:\n");
        for (i, (t, _)) in notes.iter().enumerate() {
            text.push_str(&format!("N{} {}\n", i + 1, clock(*t)));
        }
    }
    let bookmarks = marks_text(note, false, true);
    if !bookmarks.is_empty() {
        text.push_str("\nMomentos marcados por el usuario:\n");
        text.push_str(&bookmarks);
    }
    text
}

/// The user's notes in time order, each on one line, without the empty ones.
fn user_notes(note: &Value) -> Vec<(f64, String)> {
    let mut notes: Vec<(f64, String)> = note
        .get("my_notes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|n| {
            let t = n.get("t").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
            (t, str_field(n, "text").split_whitespace().collect::<Vec<_>>().join(" "))
        })
        .filter(|(_, text)| !text.is_empty())
        .collect();
    notes.sort_by(|a, b| a.0.total_cmp(&b.0));
    notes
}

/// "[01:52]".
fn clock(t: f64) -> String {
    let secs = t as u64;
    format!("[{:02}:{:02}]", secs / 60, secs % 60)
}

/// The summary writes, for each note, only `- N1: context`; here the line
/// becomes `- [01:52] «the note, as written» — context`, so the model never
/// rewrites the user's words. Notes it left out go after the last one it wrote
/// (or, if it wrote none, in a section of their own). The section goes last:
/// what the user wrote closes the summary.
fn with_user_notes(summary: &str, notes: &[(f64, String)]) -> String {
    if notes.is_empty() {
        return summary.to_string();
    }
    let line_for = |i: usize, context: Option<&str>| {
        let (t, text) = &notes[i];
        match context.filter(|c| !c.is_empty()) {
            Some(c) => format!("- {} «{text}» — {c}", clock(*t)),
            None => format!("- {} «{text}»", clock(*t)),
        }
    };
    let mut used = vec![false; notes.len()];
    let mut ours: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    let mut last = None;
    for line in summary.lines() {
        match note_ref(line).filter(|(i, _)| *i < notes.len() && !used[*i]) {
            Some((i, context)) => {
                used[i] = true;
                ours.push(line_for(i, Some(&context)));
                out.push(line_for(i, Some(&context)));
                last = Some(out.len());
            }
            None => out.push(line.to_string()),
        }
    }
    let missing: Vec<String> = (0..notes.len()).filter(|&i| !used[i]).map(|i| line_for(i, None)).collect();
    match last {
        Some(at) => {
            ours.extend(missing.iter().cloned());
            out.splice(at..at, missing);
            // The section (from its heading to the next one) moves to the end.
            let first = out.iter().position(|l| ours.contains(l)).unwrap_or(at);
            let start = out[..first].iter().rposition(|l| l.trim_start().starts_with('#')).unwrap_or(first);
            let end = out[first..].iter().position(|l| l.trim_start().starts_with('#')).map_or(out.len(), |i| first + i);
            if end < out.len() {
                let section: Vec<String> = out.drain(start..end).collect();
                while out.last().is_some_and(|l| l.trim().is_empty()) {
                    out.pop();
                }
                out.push(String::new());
                out.extend(section.into_iter().rev().skip_while(|l| l.trim().is_empty()).collect::<Vec<_>>().into_iter().rev());
            }
        }
        None => {
            while out.last().is_some_and(|l| l.trim().is_empty()) {
                out.pop();
            }
            out.push(String::new());
            out.push("## Mis notas".to_string());
            out.extend(missing);
        }
    }
    out.join("\n")
}

/// `- N2: context` (also with `*`, bold or a dot) → (1, "context").
fn note_ref(line: &str) -> Option<(usize, String)> {
    let rest = line.trim().strip_prefix(['-', '*'])?.trim_start().trim_start_matches("**");
    let rest = rest.strip_prefix('N')?;
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    let n: usize = rest[..digits].parse().ok()?;
    let context = rest[digits..].trim_start_matches("**").trim_start_matches([':', '.', ')', '—', '-']).trim();
    Some((n.checked_sub(1)?, context.to_string()))
}

/// The instructions for the summary, with the lines for the user's notes and
/// bookmarks only when they go in.
fn summary_system(note: &Value) -> String {
    let mut system = SUMMARY_SYSTEM.replace("{idioma}", summary_language(note));
    system.push_str(summary_sections(summary_template(note)));
    system.push_str(SUMMARY_RULES);
    if summary_with_notes(note) && !user_notes(note).is_empty() {
        system.push_str(SUMMARY_NOTES);
    }
    if !marks_text(note, false, true).is_empty() {
        system.push_str(SUMMARY_BOOKMARKS);
    }
    system.push_str(SUMMARY_MAP);
    // Last, so it wins over the Spanish headings and a transcript in another language.
    let english = summary_lang_info(note).map_or("Spanish", |l| l.english);
    system.push_str(&SUMMARY_LANGUAGE.replace("{idioma}", summary_language(note)).replace("{language}", english));
    system
}

/// "Sin guardar · 2 min": la marca de un rato que no se guardó.
fn gap_line(secs: u64) -> String {
    let time = if secs < 60 { format!("{secs} s") } else { format!("{} min", (secs as f64 / 60.0).round() as u64) };
    format!("— Sin guardar · {time} —\n\n")
}

/// Una línea por frase: `[00:03] Persona 1: texto`. Con `with_original`, el
/// original va debajo entre paréntesis (si hay traducción). Los ratos sin
/// guardar (`gaps`) parten el párrafo en el que caen, como `transcriptParts`
/// en `src/notes.js`.
fn transcript_text(note: &Value, with_original: bool) -> String {
    let mut out = String::new();
    let sentences = note.get("sentences").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let mut gaps: Vec<(usize, u64)> = Vec::new();
    for g in note.get("gaps").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default() {
        let at = g.get("at").and_then(Value::as_u64).unwrap_or(0) as usize;
        let secs = g.get("secs").and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u64;
        match gaps.iter_mut().find(|(a, _)| *a == at) {
            Some((_, total)) => *total += secs,
            None => gaps.push((at, secs)),
        }
    }
    let gap_at = |i: usize| gaps.iter().find(|(a, _)| *a == i).map(|(_, secs)| *secs);
    let mut i = 0;
    for paragraph in paragraphs(sentences) {
        let mut block: Vec<&Value> = Vec::new();
        for s in paragraph {
            if let Some(secs) = gap_at(i) {
                if !block.is_empty() {
                    out.push_str(&paragraph_text(note, &block, with_original));
                    block.clear();
                }
                out.push_str(&gap_line(secs));
            }
            block.push(s);
            i += 1;
        }
        out.push_str(&paragraph_text(note, &block, with_original));
    }
    if let Some(secs) = gap_at(i) {
        out.push_str(&gap_line(secs));
    }
    out
}

/// Un párrafo exportado, con su hora, quién habla y, si se pide, el original.
fn paragraph_text(note: &Value, block: &[&Value], with_original: bool) -> String {
    let first = block[0];
    let t = first.get("t").and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u64;
    let who = speaker_label(note, first);
    let who = if who.is_empty() { String::new() } else { format!("{who}: ") };
    let text: Vec<&str> = block.iter().map(|s| shown_text(s)).collect();
    let mut out = format!("[{:02}:{:02}] {who}{}\n", t / 60, t % 60, text.join(" "));
    if with_original && block.iter().any(|s| s.get("translation").is_some_and(|t| !t.is_null())) {
        let source: Vec<&str> = block.iter().map(|s| str_field(s, "source")).collect();
        out.push_str(&format!("({})\n", source.join(" ")));
    }
    out.push('\n');
    out
}

/// Pausa a partir de la cual empieza otro párrafo aunque hable la misma persona.
const PARAGRAPH_GAP_SECS: f64 = 12.0;
/// Largo a partir del cual se parte un párrafo, para que se pueda leer.
const PARAGRAPH_CHARS: usize = 700;

/// Junta las frases seguidas de una misma persona en párrafos, igual que la
/// vista de la nota (`paragraphs` en `src/notes.js`): otro párrafo al
/// cambiar quien habla, tras una pausa larga o si se hace muy largo.
fn paragraphs(sentences: &[Value]) -> Vec<Vec<&Value>> {
    let mut out: Vec<Vec<&Value>> = Vec::new();
    let mut chars = 0;
    let t = |s: &Value| s.get("t").and_then(Value::as_f64).unwrap_or(0.0);
    for (i, s) in sentences.iter().enumerate() {
        let len = shown_text(s).chars().count();
        let split = match i.checked_sub(1).map(|j| &sentences[j]) {
            None => true,
            Some(prev) => {
                s.get("speaker") != prev.get("speaker") || t(s) - t(prev) > PARAGRAPH_GAP_SECS || chars + len > PARAGRAPH_CHARS
            }
        };
        if split {
            out.push(vec![s]);
            chars = 0;
        } else if let Some(last) = out.last_mut() {
            last.push(s);
        }
        chars += len + 1;
    }
    out
}

// ---------- Resumen con IA ----------

/// Dónde se guarda la clave de Groq en el llavero del Mac.
const KEYCHAIN_SERVICE: &str = "com.lingora.app";
const KEYCHAIN_ACCOUNT: &str = "groq";

/// Por encima de esto la transcripción se resume por trozos y luego se
/// resume el conjunto de los resúmenes.
const SUMMARY_MAX_CHARS: usize = 60_000;
const SUMMARY_CHUNK_CHARS: usize = 50_000;

/// `{idioma}` es el de la traducción. The template's sections and
/// `SUMMARY_RULES` follow.
const SUMMARY_SYSTEM: &str = "Eres un asistente que resume conversaciones transcritas. Responde en {idioma} con Markdown \
y solo estas secciones, omitiendo las que no tengan contenido. Lo que va entre paréntesis es una instrucción \
para ti: el título de cada sección es solo el texto antes del paréntesis.\n";
/// Closes the section list, whatever the template.
const SUMMARY_RULES: &str = "No inventes nada que no esté en la transcripción. Si aparecen etiquetas \"Persona N\", úsalas tal cual.";
/// The summary templates: `(id, sections)`. The ids are saved in the notes
/// (`summary_template`) and match `SUMMARY_TEMPLATES` in `src/utils/notes.js`.
/// The first one, General, is the summary every note had before templates.
const SUMMARY_TEMPLATES: &[(&str, &str)] = &[
    (
        "general",
        "## Resumen (3-6 frases)\n\
## Puntos clave (lista)\n\
## Decisiones (lista)\n\
## Tareas (lista; \"- [ ] tarea — responsable\" si se menciona)\n",
    ),
    (
        "team",
        "## Objetivo (1-2 frases)\n\
## Temas tratados (lista: cada tema con lo esencial de lo que se dijo)\n\
## Avances (lista: lo que contó cada persona de su trabajo)\n\
## Decisiones (lista)\n\
## Tareas (lista; \"- [ ] tarea — responsable — fecha\", solo con lo que se mencione)\n\
## Bloqueos (lista)\n\
## Para la próxima (lista: temas que quedaron pendientes)\n",
    ),
    (
        "one_on_one",
        "## Resumen (2-4 frases)\n\
## Cómo está (lista: solo lo que la persona contó de sí misma; no interpretes su ánimo)\n\
## Avance del trabajo (lista: proyectos u objetivos que se repasaron y cómo van)\n\
## Bloqueos (lista)\n\
## Feedback (lista; di si se dio o se recibió y quién lo dio)\n\
## Crecimiento y carrera (lista)\n\
## Acuerdos (lista)\n\
## Tareas (lista; \"- [ ] tarea — responsable\" si se menciona)\n\
## Para la próxima (lista)\n",
    ),
    (
        "client",
        "## Resumen (3-5 frases)\n\
## Contexto del cliente (lista: su situación y lo que usa ahora)\n\
## Quién decide (lista: personas y roles del lado del cliente)\n\
## Necesidades y problemas (lista)\n\
## Dudas y objeciones (lista)\n\
## Alternativas (lista: otras opciones o competidores que mencionó)\n\
## Presupuesto y plazos (lista; solo lo que se dijo)\n\
## Riesgos (lista: señales de alerta)\n\
## Compromisos (lista; \"- Nosotros: …\" o \"- Cliente: …\". \"Yo\" es quien usa la app y está del lado \"Nosotros\")\n\
## Próximos pasos (lista; \"- [ ] paso — responsable — fecha\", solo con lo que se mencione)\n",
    ),
    (
        "interview",
        "## Perfil o tema (2-4 frases)\n\
## Preguntas y respuestas (lista: solo las preguntas principales, \"- Pregunta: lo esencial de la respuesta\")\n\
## Citas destacadas (lista: \"- cita — Persona N\"; escribe cada cita traducida al idioma del resumen, fiel a lo que se dijo, sin resumirla)\n\
## Por verificar (lista: datos, cifras o afirmaciones que conviene comprobar)\n\
## Próximos pasos (lista)\n",
    ),
    (
        "class",
        "## Resumen (3-5 frases)\n\
## Estructura (lista: los temas en el orden en que se explicaron)\n\
## Conceptos principales (lista: cada concepto con una explicación de 1-2 frases)\n\
## Definiciones (lista; \"- término: definición\")\n\
## Ejemplos (lista)\n\
## Lo que se remarcó (lista: lo que se dijo que es importante, que entra en el examen o que se repitió)\n\
## Recursos mencionados (lista: libros, autores, enlaces, herramientas)\n\
## Tareas y fechas (lista: lo que se pidió hacer y para cuándo)\n\
## Dudas abiertas (lista)\n\
## Para repasar (lista: 3-5 preguntas para comprobar si se entendió, \"- pregunta — respuesta breve\"; la respuesta tiene que estar en la transcripción)\n",
    ),
    (
        "executive",
        "## Resumen (un párrafo de 6-10 frases: contexto, qué se decidió y por qué importa)\n\
## Decisiones (lista)\n\
## Riesgos (lista)\n\
## Cifras clave (lista: importes, fechas y números que se mencionaron)\n\
## Qué se necesita (lista: decisiones, recursos o aprobaciones que se piden a quien lo lee)\n\
## Próximos pasos (lista: qué pasa ahora, quién y cuándo)\n",
    ),
];

/// The note's template id (`summary_template`); missing or unknown → General.
fn summary_template(note: &Value) -> &'static str {
    let id = note.get("summary_template").and_then(Value::as_str);
    SUMMARY_TEMPLATES.iter().find(|(t, _)| Some(*t) == id).unwrap_or(&SUMMARY_TEMPLATES[0]).0
}

/// The sections a template asks for.
fn summary_sections(id: &str) -> &'static str {
    SUMMARY_TEMPLATES.iter().find(|(t, _)| *t == id).unwrap_or(&SUMMARY_TEMPLATES[0]).1
}
/// Added when the user includes their notes in the summary.
const SUMMARY_NOTES: &str = "\nEl usuario escribió notas en ciertos momentos (N1, N2…, con su hora). Añade la sección \
## Mis notas al final de todo (después de Momentos destacados), con una línea por nota: \"- N1: qué se decía en ese momento\" \
(una frase, según la transcripción). No las menciones en las demás secciones.";
/// Added when the note has bookmarks: they always go, in their own section.
/// Closes the instructions: without it, the model follows the Spanish headings
/// and the transcript and ignores the chosen language.
const SUMMARY_LANGUAGE: &str = "\nIMPORTANTE: escribe todo el resumen, también los títulos de las secciones, en {idioma} \
({language}), aunque la transcripción y estas instrucciones estén en otro idioma. Write the whole summary in {language}.";
/// Times on each point, and a short version of the lists for the mind map, which
/// the app keeps apart from the summary (`split_map`).
const SUMMARY_MAP: &str = "\nEn cada sección que sea una lista, termina cada viñeta con la hora de la transcripción \
en que se dijo, así: \" [mm:ss]\". Después de todo lo demás (también de Momentos destacados y Mis notas), escribe una \
línea que diga exactamente <<<MAP>>> y, debajo, esas mismas secciones de lista con los mismos títulos, en versión corta \
para un mapa mental: cada viñeta de 12 palabras como máximo, con su misma hora.";
/// Where the short version for the map starts in the model's answer.
const MAP_MARKER: &str = "<<<MAP>>>";
const SUMMARY_BOOKMARKS: &str = "\nHay momentos marcados por el usuario: añade al final la sección ## Momentos destacados, \
con una línea por momento: \"- [mm:ss] qué se dijo en ese momento\" (una frase, según la transcripción).";

fn keychain_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| Error::Notes(format!("no se pudo abrir el llavero: {e}")))
}

/// La clave guardada en el llavero, si hay.
fn stored_key() -> Option<String> {
    keychain_entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

/// Solo en desarrollo, la `GROQ_API_KEY` del entorno sirve si no hay clave en
/// el llavero. En producción nunca se mira.
fn env_key(from_env: &str) -> Option<String> {
    (cfg!(debug_assertions) && !from_env.trim().is_empty()).then(|| from_env.to_string())
}

/// Dónde está la clave: `"keychain"`, `"env"` (solo desarrollo) o `"none"`.
#[tauri::command]
pub async fn summary_key_status(state: tauri::State<'_, crate::AppState>) -> Result<&'static str> {
    let from_env = state.pipeline.settings().groq_api_key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if stored_key().is_some() {
            "keychain"
        } else if env_key(&from_env).is_some() {
            "env"
        } else {
            "none"
        }
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo consultar el llavero: {e}")))
}

/// Comprueba la clave con Groq y, si vale, la guarda en el llavero.
#[tauri::command]
pub async fn summary_key_set(key: String) -> Result<()> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(Error::Notes("La clave no es válida".into()));
    }
    // Groq rechaza peticiones sin User-Agent con un 403.
    let http = reqwest::Client::builder()
        .user_agent(concat!("lingora/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(Error::Network)?;
    let resp = http.get("https://api.groq.com/openai/v1/models").bearer_auth(&key).send().await?;
    match resp.status().as_u16() {
        401 | 403 => return Err(Error::Notes("La clave no es válida".into())),
        s if !resp.status().is_success() => return Err(Error::Api { status: s, body: String::new() }),
        _ => {}
    }
    tauri::async_runtime::spawn_blocking(move || {
        keychain_entry()?.set_password(&key).map_err(|e| Error::Notes(format!("no se pudo guardar en el llavero: {e}")))
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo guardar en el llavero: {e}")))?
}

/// Borra la clave del llavero (si no había, no pasa nada).
#[tauri::command]
pub async fn summary_key_clear() -> Result<()> {
    tauri::async_runtime::spawn_blocking(|| match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Notes(format!("no se pudo borrar la clave: {e}"))),
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo borrar la clave: {e}")))?
}

/// Abre en el navegador la página donde se crea la clave. La URL está fija
/// aquí: la interfaz no puede pedir que se abra otra.
#[tauri::command]
pub fn summary_key_help() -> Result<()> {
    // En Windows el Explorador abre la URL en el navegador por defecto, sin consola.
    let opener = if cfg!(windows) { "explorer" } else { "open" };
    std::process::Command::new(opener).arg("https://console.groq.com/keys").status()?;
    Ok(())
}

/// Parte la transcripción en trozos de ~`SUMMARY_CHUNK_CHARS` sin cortar líneas.
fn chunks(transcript: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut len = 0;
    for line in transcript.lines() {
        let n = line.chars().count() + 1;
        if len > 0 && len + n > SUMMARY_CHUNK_CHARS {
            out.push(String::new());
            len = 0;
        }
        out.last_mut().expect("siempre hay un trozo").push_str(&format!("{line}\n"));
        len += n;
    }
    out
}

/// The model's answer split into the summary and the short version for the
/// map ("" if it did not write one).
/// `- - point` → `- point`. The model sometimes copies the "- " of the format
/// asked for after its own bullet; then `note_ref` and the times at the start
/// would not find the line.
fn tidy_bullets(text: &str) -> String {
    text.lines()
        .map(|line| {
            let body = line.trim_start();
            let indent = &line[..line.len() - body.len()];
            let mut rest = body;
            let mut bullets = 0;
            while let Some(r) = rest.strip_prefix("- ").or_else(|| rest.strip_prefix("* ")) {
                rest = r.trim_start();
                bullets += 1;
            }
            if bullets > 1 { format!("{indent}- {rest}") } else { line.to_string() }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_map(text: &str) -> (String, String) {
    match text.find(MAP_MARKER) {
        // With a long transcript, the parts can bring their own marker: only the first counts.
        Some(at) => (text[..at].trim_end().to_string(), text[at + MAP_MARKER.len()..].replace(MAP_MARKER, "").trim().to_string()),
        None => (text.trim_end().to_string(), String::new()),
    }
}

/// Resume la transcripción; si es muy larga, por trozos y luego el conjunto.
async fn summarize_text(groq: &Groq, model: &str, system: &str, transcript: &str) -> Result<String> {
    if transcript.chars().count() <= SUMMARY_MAX_CHARS {
        return groq.complete(system, transcript, model).await;
    }
    let mut parts = Vec::new();
    for chunk in chunks(transcript) {
        parts.push(groq.complete(system, &chunk, model).await?);
    }
    let joined = format!(
        "Estos son los resúmenes de las partes consecutivas de una misma conversación. Haz un único resumen de toda ella:\n\n{}",
        parts.join("\n\n---\n\n")
    );
    groq.complete(system, &joined, model).await
}

/// El idioma del resumen: `summary_lang` si la nota lo trae (Tomar notas); si
/// no, el de la traducción de la primera frase y, sin él, español.
fn summary_language(note: &Value) -> &'static str {
    summary_lang_info(note).map_or("español", |l| l.spanish)
}

/// The summary language's entry, as `summary_language` chooses it.
fn summary_lang_info(note: &Value) -> Option<&'static crate::config::LangInfo> {
    ["/summary_lang", "/sentences/0/target_lang"]
        .iter()
        .filter_map(|p| note.pointer(p).and_then(Value::as_str))
        .find_map(crate::config::Lang::from_code)
        .map(|l| l.info())
}

/// Resume la nota con Groq, guarda el resumen en ella y lo devuelve.
#[tauri::command]
pub async fn note_summarize(state: tauri::State<'_, crate::AppState>, id: String) -> Result<String> {
    let path = note_path(&id)?;
    let note = read_note(&path)?;
    let settings = state.pipeline.settings();
    let from_env = settings.groq_api_key.clone();
    let model = settings.summary_model.clone();
    let key = tauri::async_runtime::spawn_blocking(move || stored_key().or_else(|| env_key(&from_env)))
        .await
        .map_err(|e| Error::Notes(format!("no se pudo consultar el llavero: {e}")))?
        .ok_or_else(|| Error::Notes("Falta la clave de Groq. Ponla en la pestaña Resumen o en Ajustes.".into()))?;

    // Bookmarks alone are not enough: they point at what was said.
    let notes = if summary_with_notes(&note) { user_notes(&note) } else { Vec::new() };
    let has_notes = !notes.is_empty();
    if transcript_text(&note, false).trim().is_empty() && !has_notes {
        return Err(Error::Notes("La nota no tiene frases que resumir.".into()));
    }
    let transcript = summary_input(&note);
    let system = summary_system(&note);

    let text = summarize_text(&Groq::new(key), &model, &system, &transcript)
        .await
        .map_err(|e| match e {
            Error::Api { status: 401 | 403, .. } => Error::Notes("La clave de Groq no es válida. Cámbiala en Ajustes.".into()),
            other => other,
        })?;
    let template = summary_template(&note);
    let (text, map) = split_map(&tidy_bullets(&text));
    let text = with_user_notes(&text, &notes);

    // Se vuelve a leer: el título puede haber cambiado mientras se resumía.
    let mut note = read_note(&path)?;
    note["summary"] = if map.is_empty() {
        serde_json::json!({ "text": text, "template": template, "created_at": now_iso() })
    } else {
        serde_json::json!({ "text": text, "map": map, "template": template, "created_at": now_iso() })
    };
    write_note(&path, &note)?;
    Ok(text)
}

/// Fecha civil de un día desde 1970-01-01 (algoritmo de H. Hinnant).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Ahora en ISO 8601 UTC ("2026-10-29T13:32:05.120Z"), sin dependencias.
fn now_iso() -> String {
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs() as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86400));
    let rest = secs.rem_euclid(86400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        since.subsec_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tidy_bullets_joins_repeated_ones() {
        let text = "## Mis notas\n- - N1: algo\n  * - [08:04] fin\n- [ ] tarea\n- bien";
        assert_eq!(tidy_bullets(text), "## Mis notas\n- N1: algo\n  - [08:04] fin\n- [ ] tarea\n- bien");
        assert_eq!(note_ref(&tidy_bullets("- - N2: contexto")), Some((1, "contexto".to_string())));
    }

    #[test]
    fn speaker_names_skip_me_and_empty_ones() {
        let note = serde_json::json!({ "speakers": { "0": "Freddy", "1": " Marta ", "2": "", "3": null } });
        assert_eq!(speaker_names(&note), vec!["Marta".to_string()]);
        assert!(speaker_names(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn summary_templates_pick_their_sections() {
        let with = |id: &str| summary_system(&serde_json::json!({ "summary_template": id, "sentences": [] }));
        let general = "## Resumen (3-6 frases)\n## Puntos clave (lista)\n## Decisiones (lista)\n";
        // Without a template (notes from before), the summary asks for what it always did.
        let before = summary_system(&serde_json::json!({ "sentences": [] }));
        assert!(before.contains(general));
        assert!(before.contains(SUMMARY_RULES));
        assert_eq!(with("nope"), before);
        assert_eq!(with("general"), before);
        for (id, sections) in SUMMARY_TEMPLATES {
            let system = with(id);
            assert!(system.contains(sections), "{id}");
            assert!(system.contains(MAP_MARKER) && system.contains(SUMMARY_RULES), "{id}");
            assert_eq!(summary_template(&serde_json::json!({ "summary_template": id })), *id);
        }
        assert!(with("one_on_one").contains("## Cómo está") && !with("one_on_one").contains("## Puntos clave"));
    }

    #[test]
    fn summary_language_prefers_summary_lang() {
        let en = serde_json::json!({ "summary_lang": "en", "sentences": [{ "target_lang": "auto" }] });
        assert_eq!(summary_language(&en), crate::config::Lang::from_code("en").unwrap().info().spanish);
        // Sin `summary_lang`, el de la traducción; sin nada, español.
        let fr = serde_json::json!({ "sentences": [{ "target_lang": "fr" }] });
        assert_eq!(summary_language(&fr), crate::config::Lang::from_code("fr").unwrap().info().spanish);
        assert_eq!(summary_language(&serde_json::json!({ "sentences": [] })), "español");
    }

    #[test]
    fn summary_system_ends_with_the_language() {
        let zh = serde_json::json!({ "summary_lang": "zh", "sentences": [] });
        let info = crate::config::Lang::from_code("zh").unwrap().info();
        let system = summary_system(&zh);
        assert!(system.ends_with(&format!("Write the whole summary in {}.", info.english)));
        assert!(system.contains(info.spanish));
    }

    #[test]
    fn map_version_goes_apart() {
        let (text, map) = split_map("## Puntos clave\n- Algo largo [01:00]\n\n<<<MAP>>>\n## Puntos clave\n- Algo [01:00]\n");
        assert_eq!(text, "## Puntos clave\n- Algo largo [01:00]");
        assert_eq!(map, "## Puntos clave\n- Algo [01:00]");
        assert_eq!(split_map("## Resumen\nSin mapa.\n"), ("## Resumen\nSin mapa.".to_string(), String::new()));
        assert!(summary_system(&serde_json::json!({ "sentences": [] })).contains(MAP_MARKER));
    }

    #[test]
    fn user_marks_merge_in_time_order() {
        let note = serde_json::json!({
            "my_notes": [{ "t": 65.4, "text": " Fecha límite: viernes " }, { "t": 3.0, "text": "" }],
            "bookmarks": [{ "t": 12.0 }]
        });
        assert_eq!(user_marks_text(&note), "[00:12] (momento marcado)\n[01:05] Fecha límite: viernes\n");
        assert_eq!(user_marks_text(&serde_json::json!({ "sentences": [] })), "");
    }

    #[test]
    fn export_and_summary_include_user_notes() {
        let plain = serde_json::json!({
            "title": "Notas", "speakers": {},
            "sentences": [{ "t": 1.0, "speaker": null, "source": "hola", "translation": null }]
        });
        assert!(!export_text(&plain, true).contains("Mis notas"));
        assert!(!summary_input(&plain).contains("Notas del usuario"));

        let mut with_notes = plain.clone();
        with_notes["my_notes"] = serde_json::json!([{ "t": 1.0, "text": "importante" }]);
        with_notes["bookmarks"] = serde_json::json!([{ "t": 2.0 }]);
        // The export is the whole record: notes and bookmarks.
        assert!(export_text(&with_notes, true).contains("## Mis notas\n[00:01] importante\n[00:02] (momento marcado)\n"));
        // The summary: bookmarks always, notes only if the user includes them.
        let input = summary_input(&with_notes);
        assert!(!input.contains("importante"));
        assert!(input.contains("Momentos marcados por el usuario:\n[00:02] (momento marcado)"));
        assert!(summary_system(&with_notes).contains("Momentos destacados"));
        assert!(!summary_system(&with_notes).contains("notas del usuario"));
        with_notes["summary_with_notes"] = serde_json::json!(true);
        // Included: only when they were written, never what they say.
        let input = summary_input(&with_notes);
        assert!(input.contains("Momentos en que el usuario escribió una nota:\nN1 [00:01]\n"));
        assert!(!input.contains("importante"));
        assert!(summary_system(&with_notes).contains("## Mis notas"));
    }

    #[test]
    fn user_notes_go_in_as_written() {
        let notes = vec![(112.0, "me encantó esta parte".to_string()), (200.0, "llamar a Ana".to_string())];
        // The model writes only the context; the note's text is the user's.
        let summary = "## Resumen\nAlgo.\n\n## My notes\n- N1: they talked about the water park\n- **N2**: se habló del precio";
        assert_eq!(
            with_user_notes(summary, &notes),
            "## Resumen\nAlgo.\n\n## My notes\n- [01:52] «me encantó esta parte» — they talked about the water park\n- [03:20] «llamar a Ana» — se habló del precio"
        );
        // One left out goes after the last one written, and the section goes last.
        assert_eq!(
            with_user_notes("## Mis notas\n- N2: precio\n\n## Momentos destacados\n- [07:26] Pikachu", &notes),
            "## Momentos destacados\n- [07:26] Pikachu\n\n## Mis notas\n- [03:20] «llamar a Ana» — precio\n- [01:52] «me encantó esta parte»"
        );
        // None written: a section of their own at the end.
        assert_eq!(
            with_user_notes("## Resumen\nAlgo.\n", &notes),
            "## Resumen\nAlgo.\n\n## Mis notas\n- [01:52] «me encantó esta parte»\n- [03:20] «llamar a Ana»"
        );
        assert_eq!(with_user_notes("## Resumen", &[]), "## Resumen");
    }

    #[test]
    fn gaps_split_paragraphs() {
        let note = serde_json::json!({
            "speakers": {},
            "sentences": [
                { "t": 1.0, "speaker": null, "source": "a", "translation": null },
                { "t": 2.0, "speaker": null, "source": "b", "translation": null },
                { "t": 40.0, "speaker": null, "source": "c", "translation": null }
            ],
            "gaps": [{ "at": 1, "secs": 30 }, { "at": 3, "secs": 125 }]
        });
        assert_eq!(
            transcript_text(&note, true),
            "[00:01] a\n\n— Sin guardar · 30 s —\n\n[00:02] b\n\n[00:40] c\n\n— Sin guardar · 2 min —\n\n"
        );
    }

    #[test]
    fn summary_line_skips_headings() {
        let text = "## Resumen\nPersona 2 cuenta su **recorrido**. Luego trabajó en una tienda.\n## Puntos clave\n- uno";
        assert_eq!(first_summary_line(text).as_deref(), Some("Persona 2 cuenta su recorrido."));
        assert_eq!(first_summary_line("## Tareas\n- [ ] Llamar a Ana").as_deref(), Some("Llamar a Ana"));
        assert_eq!(first_summary_line("## Resumen\n"), None);
    }

    /// Same cases as `paragraphs` in src/utils/notes.test.js: both sides must
    /// group the same way.
    #[test]
    fn paragraphs_match_shared_fixture() {
        let cases: Vec<Value> = serde_json::from_str(include_str!("../../tests/fixtures/paragraphs.json")).unwrap();
        for case in &cases {
            let sentences = case["sentences"].as_array().unwrap();
            let groups: Vec<Vec<usize>> = paragraphs(sentences)
                .iter()
                .map(|block| block.iter().map(|s| sentences.iter().position(|x| std::ptr::eq(x, *s)).unwrap()).collect())
                .collect();
            let expected: Vec<Vec<usize>> = serde_json::from_value(case["groups"].clone()).unwrap();
            assert_eq!(groups, expected, "{}", case["name"]);
        }
    }

    #[test]
    fn groups_sentences_into_paragraphs() {
        let note = serde_json::json!({
            "speakers": {},
            "sentences": [
                { "t": 1.0, "speaker": 1, "source": "a", "translation": "Hola." },
                { "t": 3.0, "speaker": 1, "source": "b", "translation": "¿Qué tal?" },
                { "t": 5.0, "speaker": 2, "source": "c", "translation": "Bien." },
                { "t": 30.0, "speaker": 2, "source": "d", "translation": "Tras una pausa." }
            ]
        });
        let text = transcript_text(&note, true);
        assert_eq!(
            text,
            "[00:01] Persona 1: Hola. ¿Qué tal?\n(a b)\n\n[00:05] Persona 2: Bien.\n(c)\n\n[00:30] Persona 2: Tras una pausa.\n(d)\n\n"
        );
    }
}
