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
    }
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
    let name = file_name(str_field(&note, "title"));
    let downloads = Path::new(&std::env::var("HOME").unwrap_or_default()).join("Downloads");
    std::fs::create_dir_all(&downloads)?;
    let ext = &format;
    let mut path = downloads.join(format!("{name}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = downloads.join(format!("{name} ({n}).{ext}"));
        n += 1;
    }
    std::fs::write(&path, export_text(&note, markdown))?;
    reveal(&path)?;
    Ok(path.display().to_string())
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
    out.push_str(&format!("{h2}Transcripción\n"));
    out.push_str(&transcript_text(note, true));
    out
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

/// `{idioma}` es el de la traducción.
const SUMMARY_SYSTEM: &str = "Eres un asistente que resume conversaciones transcritas. Responde en {idioma} con Markdown \
y solo estas secciones, omitiendo las que no tengan contenido:\n\
## Resumen (3-6 frases)\n\
## Puntos clave (lista)\n\
## Decisiones (lista)\n\
## Tareas (lista; \"- [ ] tarea — responsable\" si se menciona)\n\
No inventes nada que no esté en la transcripción. Si aparecen etiquetas \"Persona N\", úsalas tal cual.";

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
    ["/summary_lang", "/sentences/0/target_lang"]
        .iter()
        .filter_map(|p| note.pointer(p).and_then(Value::as_str))
        .find_map(crate::config::Lang::from_code)
        .map_or("español", |l| l.info().spanish)
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

    let transcript = transcript_text(&note, false);
    if transcript.trim().is_empty() {
        return Err(Error::Notes("La nota no tiene frases que resumir.".into()));
    }
    let system = SUMMARY_SYSTEM.replace("{idioma}", summary_language(&note));

    let text = summarize_text(&Groq::new(key), &model, &system, &transcript)
        .await
        .map_err(|e| match e {
            Error::Api { status: 401 | 403, .. } => Error::Notes("La clave de Groq no es válida. Cámbiala en Ajustes.".into()),
            other => other,
        })?;

    // Se vuelve a leer: el título puede haber cambiado mientras se resumía.
    let mut note = read_note(&path)?;
    note["summary"] = serde_json::json!({ "text": text, "created_at": now_iso() });
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
    fn summary_language_prefers_summary_lang() {
        let en = serde_json::json!({ "summary_lang": "en", "sentences": [{ "target_lang": "auto" }] });
        assert_eq!(summary_language(&en), crate::config::Lang::from_code("en").unwrap().info().spanish);
        // Sin `summary_lang`, el de la traducción; sin nada, español.
        let fr = serde_json::json!({ "sentences": [{ "target_lang": "fr" }] });
        assert_eq!(summary_language(&fr), crate::config::Lang::from_code("fr").unwrap().info().spanish);
        assert_eq!(summary_language(&serde_json::json!({ "sentences": [] })), "español");
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
