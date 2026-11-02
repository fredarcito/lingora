//! Summaries with the user's own AI key: optional, off by default (the
//! summary is local, `summarizer.rs`). For computers with little memory, where
//! the local model doesn't fit, and for whoever prefers speed. Only the
//! transcript of the note being summarized is sent, to the service the user
//! chose; the interface asks before the first time with each one.
//!
//! Two clients cover them all: OpenAI's chat completions (OpenAI, Groq,
//! Gemini, OpenRouter and any compatible server, such as LM Studio or Ollama)
//! and Anthropic's Messages API. The key lives in the keychain, one per
//! service, never in a file.

use crate::error::{Error, Result};
use serde::Deserialize;
use serde_json::Value;

/// The services the user can pick. The ids are saved in the interface's
/// preferences and in each summary (`summary.source`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Anthropic,
    Groq,
    Gemini,
    OpenRouter,
    /// Any OpenAI-compatible server at a URL the user types.
    Custom,
}

impl Provider {
    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "openai" => Self::OpenAi,
            "anthropic" => Self::Anthropic,
            "groq" => Self::Groq,
            "gemini" => Self::Gemini,
            "openrouter" => Self::OpenRouter,
            "custom" => Self::Custom,
            _ => return None,
        })
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Groq => "groq",
            Self::Gemini => "gemini",
            Self::OpenRouter => "openrouter",
            Self::Custom => "custom",
        }
    }

    /// Proper names, for the messages.
    fn name(self) -> &'static str {
        match self {
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Claude",
            Self::Groq => "Groq",
            Self::Gemini => "Gemini",
            Self::OpenRouter => "OpenRouter",
            Self::Custom => "el servidor",
        }
    }

    /// The API's base URL; for `Custom`, the one the user typed.
    fn base_url(self, custom: Option<&str>) -> Result<String> {
        Ok(match self {
            Self::OpenAi => "https://api.openai.com/v1".into(),
            Self::Anthropic => "https://api.anthropic.com/v1".into(),
            Self::Groq => "https://api.groq.com/openai/v1".into(),
            Self::Gemini => "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            Self::OpenRouter => "https://openrouter.ai/api/v1".into(),
            Self::Custom => {
                let url = custom.map(str::trim).filter(|u| u.starts_with("http://") || u.starts_with("https://"));
                url.ok_or_else(|| Error::Notes("Escribe la dirección del servidor (empieza por http:// o https://).".into()))?
                    .trim_end_matches('/')
                    .to_string()
            }
        })
    }

    /// Where the key is created. Fixed here: the interface can't ask to open another page.
    fn key_page(self) -> Option<&'static str> {
        match self {
            Self::OpenAi => Some("https://platform.openai.com/api-keys"),
            Self::Anthropic => Some("https://console.anthropic.com/settings/keys"),
            Self::Groq => Some("https://console.groq.com/keys"),
            Self::Gemini => Some("https://aistudio.google.com/apikey"),
            Self::OpenRouter => Some("https://openrouter.ai/keys"),
            Self::Custom => None,
        }
    }

    /// A local server (LM Studio, Ollama) usually has no key.
    fn key_optional(self) -> bool {
        self == Self::Custom
    }
}

/// What the interface sends to summarize with a key.
#[derive(Debug, Deserialize)]
pub struct Cloud {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

/// Room for the answer: some models think before writing, and that counts.
const MAX_TOKENS: u32 = 16_000;
/// A summary takes longer than a sentence; an hour of transcript, well under this.
const TIMEOUT_SECS: u64 = 300;
/// Anthropic's API version (`anthropic-version`).
const ANTHROPIC_VERSION: &str = "2026-10-21";

fn http() -> Result<reqwest::Client> {
    // Groq rejects requests without a User-Agent with a 403.
    reqwest::Client::builder()
        .user_agent(concat!("lingora/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(Error::Network)
}

/// The service's answer to `user` with the instructions `system`.
pub async fn complete(cloud: &Cloud, key: &str, system: &str, user: &str) -> Result<String> {
    let provider = provider(&cloud.provider)?;
    let base = provider.base_url(cloud.base_url.as_deref())?;
    let model = cloud.model.trim();
    if model.is_empty() {
        return Err(Error::Notes("Escribe el modelo que quieres usar.".into()));
    }
    let request = match provider {
        Provider::Anthropic => http()?
            .post(format!("{base}/messages"))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&anthropic_body(model, system, user)),
        _ => {
            let req = http()?.post(format!("{base}/chat/completions")).json(&openai_body(provider, model, system, user));
            if key.is_empty() { req } else { req.bearer_auth(key) }
        }
    };
    let resp = request.send().await?;
    let status = resp.status().as_u16();
    let body = resp.text().await?;
    if !(200..300).contains(&status) {
        return Err(api_error(provider, status, &body));
    }
    let json: Value = serde_json::from_str(&body).map_err(|e| Error::BadResponse(e.to_string()))?;
    let text = match provider {
        Provider::Anthropic => anthropic_text(&json)?,
        _ => openai_text(&json),
    };
    if text.trim().is_empty() {
        return Err(Error::Notes(format!("{} devolvió un resumen vacío. Prueba con otro modelo.", provider.name())));
    }
    Ok(text)
}

/// Chat completions. No `temperature`: some models only take the default.
/// OpenAI's own API names the cap `max_completion_tokens`; the compatible ones
/// still read `max_tokens`.
fn openai_body(provider: Provider, model: &str, system: &str, user: &str) -> Value {
    let cap = if provider == Provider::OpenAi { "max_completion_tokens" } else { "max_tokens" };
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    body[cap] = MAX_TOKENS.into();
    body
}

/// Messages API. No `temperature`: version 2026-10-21 rejects it.
fn anthropic_body(model: &str, system: &str, user: &str) -> Value {
    serde_json::json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    })
}

fn openai_text(json: &Value) -> String {
    json.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_string()
}

/// The text blocks, in order (thinking blocks, if any, are left out).
fn anthropic_text(json: &Value) -> Result<String> {
    if json.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        return Err(Error::Notes("Claude no quiso resumir esta conversación. Prueba con otro servicio o en tu equipo.".into()));
    }
    let blocks = json.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    Ok(blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(""))
}

/// A non-2xx answer, in words for whoever uses the app.
fn api_error(provider: Provider, status: u16, body: &str) -> Error {
    let name = provider.name();
    match status {
        401 | 403 => Error::Notes(format!("La clave de {name} no es válida. Cámbiala en Ajustes.")),
        402 => Error::Notes(format!("{name} pide revisar la facturación de tu cuenta.")),
        404 => Error::Notes(format!("{name} no encontró ese modelo. Revisa el nombre en Ajustes.")),
        429 => Error::Notes(format!("{name} dice que llegaste al límite de uso. Espera un poco o revisa tu cuenta.")),
        _ => {
            tracing::warn!("resumen con {name}: {status} {}", body.chars().take(300).collect::<String>());
            Error::Api { status, body: body.chars().take(300).collect() }
        }
    }
}

fn provider(id: &str) -> Result<Provider> {
    Provider::from_id(id).ok_or_else(|| Error::Notes(format!("servicio desconocido: {id}")))
}

// ---------- The key, in the keychain ----------

const KEYCHAIN_SERVICE: &str = "com.lingora.app";

fn keychain_entry(provider: Provider) -> Result<keyring::Entry> {
    // Groq's keeps the account name it had before ("groq"), so a saved key still works.
    keyring::Entry::new(KEYCHAIN_SERVICE, provider.id()).map_err(|e| Error::Notes(format!("no se pudo abrir el llavero: {e}")))
}

fn stored_key(provider: Provider) -> Option<String> {
    keychain_entry(provider).ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

/// Only in development: `LINGORA_SUMMARY_KEY` works when the keychain has none.
fn env_key() -> Option<String> {
    cfg!(debug_assertions).then(|| std::env::var("LINGORA_SUMMARY_KEY").ok()).flatten().filter(|k| !k.trim().is_empty())
}

/// The key to summarize with: the keychain's, the development one, or none
/// (only a custom server can go without).
pub async fn key_for(id: &str) -> Result<String> {
    let provider = provider(id)?;
    let key = tauri::async_runtime::spawn_blocking(move || stored_key(provider).or_else(env_key))
        .await
        .map_err(|e| Error::Notes(format!("no se pudo consultar el llavero: {e}")))?;
    match key {
        Some(key) => Ok(key),
        None if provider.key_optional() => Ok(String::new()),
        None => Err(Error::Notes(format!("Falta la clave de {}. Ponla en Ajustes.", provider.name()))),
    }
}

/// Where the service's key is: `"keychain"`, `"env"` (development only) or `"none"`.
#[tauri::command]
pub async fn summary_key_status(provider: String) -> Result<&'static str> {
    let provider = self::provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        if stored_key(provider).is_some() {
            "keychain"
        } else if env_key().is_some() {
            "env"
        } else {
            "none"
        }
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo consultar el llavero: {e}")))
}

/// The last 4 characters of the saved key, so the interface can show which one
/// it is ("…a1B2") without the key itself ever leaving the keychain. `None`
/// without a key, or with one too short to hide the rest.
#[tauri::command]
pub async fn summary_key_hint(provider: String) -> Result<Option<String>> {
    let provider = self::provider(&provider)?;
    let key = tauri::async_runtime::spawn_blocking(move || stored_key(provider))
        .await
        .map_err(|e| Error::Notes(format!("no se pudo consultar el llavero: {e}")))?;
    Ok(key.and_then(|k| hint(&k)))
}

/// "…" and the last 4 characters, only if at least 8 more stay hidden.
fn hint(key: &str) -> Option<String> {
    let chars: Vec<char> = key.trim().chars().collect();
    (chars.len() >= 12).then(|| format!("…{}", chars[chars.len() - 4..].iter().collect::<String>()))
}

/// Checks the key with the service and, if it works, saves it in the keychain.
/// Returns the models the account can use for a summary, for the interface to
/// choose from. A custom server is checked with its URL; without a key
/// nothing is saved (and its list may be empty if it has none).
#[tauri::command]
pub async fn summary_key_set(provider: String, key: String, base_url: Option<String>) -> Result<Vec<String>> {
    let provider = self::provider(&provider)?;
    let key = key.trim().to_string();
    if key.is_empty() && !provider.key_optional() {
        return Err(Error::Notes("La clave no es válida".into()));
    }
    let models = list_models(provider, &key, base_url.as_deref()).await?;
    if !key.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            keychain_entry(provider)?.set_password(&key).map_err(|e| Error::Notes(format!("no se pudo guardar en el llavero: {e}")))
        })
        .await
        .map_err(|e| Error::Notes(format!("no se pudo guardar en el llavero: {e}")))??;
    }
    Ok(models)
}

/// The models of the account whose key is already saved (or of the custom server).
#[tauri::command]
pub async fn summary_models(provider: String, base_url: Option<String>) -> Result<Vec<String>> {
    let key = key_for(&provider).await?;
    list_models(self::provider(&provider)?, &key, base_url.as_deref()).await
}

/// The account's models that write text, sorted. Asking for them also checks
/// the key: the list only comes with a valid one (on OpenRouter, where the list
/// is public, the key's own details are asked for first).
async fn list_models(provider: Provider, key: &str, base_url: Option<&str>) -> Result<Vec<String>> {
    let base = provider.base_url(base_url)?;
    if provider == Provider::OpenRouter {
        let resp = send(provider, http()?.get(format!("{base}/key")).bearer_auth(key)).await?;
        check_status(provider, resp).await?;
    }
    let request = match provider {
        Provider::Anthropic => http()?
            .get(format!("{base}/models?limit=1000"))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION),
        Provider::OpenRouter => http()?.get(format!("{base}/models")),
        _ if key.is_empty() => http()?.get(format!("{base}/models")),
        _ => http()?.get(format!("{base}/models")).bearer_auth(key),
    };
    let resp = send(provider, request).await?;
    let custom = provider == Provider::Custom;
    let body = match check_status(provider, resp).await {
        Ok(body) => body,
        // A local server may not list its models: then the name is typed.
        Err(_) if custom => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let json: Value = serde_json::from_str(&body).unwrap_or_default();
    Ok(text_models(&json))
}

async fn send(provider: Provider, request: reqwest::RequestBuilder) -> Result<reqwest::Response> {
    request.send().await.map_err(|e| {
        tracing::warn!("conectar con {}: {e}", provider.name());
        Error::Notes(format!("No se pudo conectar con {}. Revisa la conexión o la dirección.", provider.name()))
    })
}

/// The body of a 2xx answer; otherwise the error in words.
async fn check_status(provider: Provider, resp: reqwest::Response) -> Result<String> {
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    match status {
        200..=299 => Ok(body),
        401 | 403 => Err(Error::Notes("La clave no es válida".into())),
        _ => Err(api_error(provider, status, &body)),
    }
}

/// Words in a model's id that mean it doesn't write text for a summary
/// (voice, images, embeddings, moderation…). The lists bring them all mixed.
const NOT_TEXT: &[&str] = &[
    "embed", "whisper", "tts", "transcribe", "audio", "realtime", "image", "dall-e", "moderation", "guard", "rerank",
    "veo", "imagen", "aqa", "sora", "babbage", "davinci", "computer-use", "search-preview", "native-audio", "live",
];

/// The ids in an OpenAI-style (`data[].id`) or Anthropic (`data[].id`) list,
/// without the ones that don't write text, sorted and without repeats. Gemini
/// writes them as "models/…": the prefix goes (chat completions takes it
/// without). OpenRouter says what each one outputs: only text ones stay.
fn text_models(json: &Value) -> Vec<String> {
    let mut out: Vec<String> = json
        .get("data")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|m| {
            m.pointer("/architecture/output_modalities")
                .and_then(Value::as_array)
                .map_or(true, |outputs| outputs.iter().any(|o| o == "text"))
        })
        .filter_map(|m| m.get("id").and_then(Value::as_str))
        .map(|id| id.strip_prefix("models/").unwrap_or(id).to_string())
        .filter(|id| {
            let lower = id.to_lowercase();
            !NOT_TEXT.iter().any(|w| lower.contains(w))
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Deletes the service's key from the keychain (if there was none, nothing happens).
#[tauri::command]
pub async fn summary_key_clear(provider: String) -> Result<()> {
    let provider = self::provider(&provider)?;
    tauri::async_runtime::spawn_blocking(move || match keychain_entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Notes(format!("no se pudo borrar la clave: {e}"))),
    })
    .await
    .map_err(|e| Error::Notes(format!("no se pudo borrar la clave: {e}")))?
}

/// Opens in the browser the page where the service's key is created.
#[tauri::command]
pub fn summary_key_help(provider: String) -> Result<()> {
    let Some(url) = self::provider(&provider)?.key_page() else {
        return Ok(());
    };
    // On Windows the Explorer opens the URL in the default browser, with no console.
    let opener = if cfg!(windows) { "explorer" } else { "open" };
    std::process::Command::new(opener).arg(url).status()?;
    Ok(())
}

/// The computer's RAM in GB, so the interface can recommend a key when the
/// local summary would not fit. `None` if it can't be read.
#[tauri::command]
pub fn system_memory() -> Option<f64> {
    crate::perf::ram_gb()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_body_names_the_cap_per_service() {
        let openai = openai_body(Provider::OpenAi, "m", "sys", "hola");
        assert_eq!(openai["max_completion_tokens"], MAX_TOKENS);
        assert!(openai.get("max_tokens").is_none() && openai.get("temperature").is_none());
        assert_eq!(openai["messages"][0]["role"], "system");
        assert_eq!(openai["messages"][1]["content"], "hola");
        assert_eq!(openai_body(Provider::Groq, "m", "s", "u")["max_tokens"], MAX_TOKENS);
    }

    #[test]
    fn anthropic_body_has_system_apart_and_no_temperature() {
        let body = anthropic_body("claude-x", "sys", "hola");
        assert_eq!(body["system"], "sys");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn reads_the_text_of_each_service() {
        let openai = serde_json::json!({ "choices": [{ "message": { "content": "## Resumen" } }] });
        assert_eq!(openai_text(&openai), "## Resumen");
        let claude = serde_json::json!({ "stop_reason": "end_turn", "content": [
            { "type": "thinking", "thinking": "" }, { "type": "text", "text": "## A" }, { "type": "text", "text": "\nB" }
        ] });
        assert_eq!(anthropic_text(&claude).unwrap(), "## A\nB");
        assert!(anthropic_text(&serde_json::json!({ "stop_reason": "refusal", "content": [] })).is_err());
    }

    #[test]
    fn model_lists_keep_text_ones() {
        let openai = serde_json::json!({ "data": [
            { "id": "gpt-5.4-nano" }, { "id": "text-embedding-3-small" }, { "id": "gpt-4o-mini-tts" },
            { "id": "whisper-1" }, { "id": "gpt-5.4-mini" }, { "id": "gpt-image-1" }
        ] });
        assert_eq!(text_models(&openai), vec!["gpt-5.4-mini", "gpt-5.4-nano"]);
        let gemini = serde_json::json!({ "data": [{ "id": "models/gemini-3.5-flash-lite" }, { "id": "models/gemini-embedding-001" }] });
        assert_eq!(text_models(&gemini), vec!["gemini-3.5-flash-lite"]);
        let openrouter = serde_json::json!({ "data": [
            { "id": "a/text", "architecture": { "output_modalities": ["text"] } },
            { "id": "b/pics", "architecture": { "output_modalities": ["image"] } }
        ] });
        assert_eq!(text_models(&openrouter), vec!["a/text"]);
        assert!(text_models(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn hint_shows_only_the_end() {
        assert_eq!(hint("gsk_abcdefghij1234").as_deref(), Some("…1234"));
        assert_eq!(hint("short"), None);
    }

    #[test]
    fn custom_url_must_be_http() {
        assert!(Provider::Custom.base_url(None).is_err());
        assert!(Provider::Custom.base_url(Some("localhost:1234")).is_err());
        assert_eq!(Provider::Custom.base_url(Some(" http://localhost:1234/v1/ ")).unwrap(), "http://localhost:1234/v1");
        assert_eq!(Provider::from_id("openai").map(Provider::id), Some("openai"));
        assert!(Provider::from_id("otro").is_none());
    }
}
