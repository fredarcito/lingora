use crate::config::Lang;
use crate::error::{Error, Result};

/// How long to wait before sending a backup request to Whisper. A normal
/// transcription of a 5 s chunk takes ~1 s.
const HEDGE_AFTER: std::time::Duration = std::time::Duration::from_millis(2000);

/// Returns the first successful result of two parallel requests; if
/// both fail, the last error.
async fn first_ok<T>(
    a: impl std::future::Future<Output = Result<T>>,
    b: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::pin!(a);
    tokio::pin!(b);
    let (mut a_done, mut b_done) = (false, false);
    loop {
        let err = tokio::select! {
            r = &mut a, if !a_done => { a_done = true; match r { Ok(v) => return Ok(v), Err(e) => e } }
            r = &mut b, if !b_done => { b_done = true; match r { Ok(v) => return Ok(v), Err(e) => e } }
        };
        if a_done && b_done {
            return Err(err);
        }
    }
}

/// Groq API client. Used for transcription (Whisper) and for
/// translation (chat). TTS is local and does not go through here.
pub struct Groq {
    http: reqwest::Client,
    api_key: String,
}

#[derive(serde::Deserialize)]
struct TranscriptionResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptionSegment>,
    #[serde(default)]
    duration: f64,
}

#[derive(serde::Deserialize)]
struct TranscriptionSegment {
    #[serde(default)]
    text: String,
}

/// An event of the chat stream (`data: {...}` in SSE).
#[derive(serde::Deserialize)]
struct ChatChunk {
    choices: Vec<ChunkChoice>,
}

#[derive(serde::Deserialize)]
struct ChunkChoice {
    delta: ChunkDelta,
}

#[derive(serde::Deserialize)]
struct ChunkDelta {
    #[serde(default)]
    content: Option<String>,
}

impl Groq {
    pub fn new(api_key: String) -> Self {
        // Groq rejects requests without a User-Agent with a 403 (checked in
        // phase 0). The client sets it here so no caller forgets it.
        let http = reqwest::Client::builder()
            .user_agent(concat!("lingora/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("cliente HTTP");
        Self { http, api_key }
    }

    /// Transcribes a WAV (16-bit PCM, mono, 16 kHz) with Whisper.
    ///
    /// Groq's latency varies a lot: the same request takes 1 s or 8 s. In
    /// real-time translation that is unacceptable, so if there is no
    /// answer within `HEDGE_AFTER` a second identical request is sent and the
    /// first one to arrive is used. A fast failure is retried once.
    pub async fn transcribe(&self, wav: Vec<u8>, lang: Lang, model: &str, prompt: Option<&str>) -> Result<String> {
        let first = self.transcribe_once(wav.clone(), lang, model, prompt);
        tokio::pin!(first);
        let early = tokio::select! {
            r = &mut first => Some(r),
            _ = tokio::time::sleep(HEDGE_AFTER) => None,
        };
        match early {
            Some(Ok(text)) => Ok(text),
            Some(Err(e)) => {
                tracing::warn!("whisper falló ({e}); se reintenta");
                self.transcribe_once(wav, lang, model, prompt).await
            }
            None => {
                tracing::info!("whisper tarda más de {HEDGE_AFTER:?}; se lanza una petición de respaldo");
                first_ok(first, self.transcribe_once(wav, lang, model, prompt)).await
            }
        }
    }

    /// A transcription request.
    ///
    /// It asks for `verbose_json` and joins the segments. It was once believed
    /// that with `json` the `text` field only carried the last segment, but
    /// when tested it returns the full text: the audio arrived already cut by
    /// badly built routing (see docs/problemas-conocidos.md). It is kept
    /// because the segments help to diagnose.
    ///
    /// `prompt` is the last thing transcribed: with short chunks it helps
    /// Whisper keep names and not split the words at the edge badly.
    async fn transcribe_once(&self, wav: Vec<u8>, lang: Lang, model: &str, prompt: Option<&str>) -> Result<String> {
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| Error::BadResponse(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", model.to_string())
            .text("language", lang.iso())
            .text("response_format", "verbose_json");
        if let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) {
            form = form.text("prompt", prompt.to_string());
        }

        let resp = self
            .http
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;
        let body = self.check(resp).await?;
        let parsed: TranscriptionResponse =
            serde_json::from_str(&body).map_err(|e| Error::BadResponse(e.to_string()))?;

        let joined = parsed
            .segments
            .iter()
            .map(|s| s.text.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let text = if joined.is_empty() {
            parsed.text.trim().to_string()
        } else {
            joined
        };

        tracing::info!(
            "whisper: {} segmentos, {:.1} s de audio, {} caracteres",
            parsed.segments.len(),
            parsed.duration,
            text.len()
        );
        Ok(text)
    }

    /// Translates text between English and Spanish. `context` is what was said just
    /// before: the audio is cut into chunks of a few seconds and a sentence can
    /// end up split between two.
    pub async fn translate(
        &self,
        text: &str,
        from: Lang,
        to: Lang,
        model: &str,
        context: Option<&str>,
        concise: bool,
        mut on_delta: impl FnMut(&str),
    ) -> Result<String> {
        let mut system = format!(
            "You are a professional simultaneous interpreter. Translate the user's text from {} to {}. \
             Be faithful: do not add, remove or reinterpret anything that is not in the original. \
             Keep the same register and formality as the original (tú/usted, informal/formal). \
             The text comes from speech recognition, so it may lack punctuation; add only what is needed to read naturally. \
             Output ONLY the translation, with no quotes, notes or explanations.",
            from.english_name(),
            to.english_name()
        );
        if concise {
            // Fast mode: the Spanish voice lasts longer than the English and falls
            // behind. Measured with a YouTube intro: condensing shortens the voice
            // by 20 % (no effect on dense speech, which has no filler).
            system.push_str(
                " This will be spoken aloud while the speaker keeps talking, so be concise like a professional \
                 interpreter: drop fillers and discourse markers (honestly, you know, guys, basically, without \
                 further ado) and use the shortest natural wording that keeps the full meaning.",
            );
        }
        if let Some(context) = context.filter(|c| !c.trim().is_empty()) {
            system.push_str(&format!(
                " The text is a fragment of an ongoing conversation and may start or end mid-sentence; \
                 translate it as a fragment, without completing it. For reference only, this is what was \
                 said just before (do NOT translate or repeat it): \"{context}\""
            ));
        }
        let payload = serde_json::json!({
            "model": model,
            // 0.3 gives more natural translations than 0 without losing fidelity;
            // with 0 qwen tends to copy the English word for word ("me está volviendo a dar").
            "temperature": 0.3,
            "max_tokens": 400,
            // Streaming: the UI starts the voice with the first translated
            // sentence, without waiting for the rest.
            "stream": true,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": text }
            ]
        });

        let resp = self
            .http
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;
        if !resp.status().is_success() {
            self.check(resp).await?;
            unreachable!("check devuelve error en respuestas no-2xx");
        }

        let out = read_chat_stream(resp, &mut on_delta).await?;
        if out.is_empty() {
            // Happens with reasoning models that spend all their tokens
            // thinking (gpt-oss without `reasoning_effort: low`). Better to fail
            // explicitly than to return an empty translation.
            return Err(Error::BadResponse(
                "la traducción llegó vacía; revisa el modelo configurado".into(),
            ));
        }
        Ok(out)
    }

    /// Turns a non-2xx response into a typed error and returns the body
    /// as text if it succeeded.
    async fn check(&self, resp: reqwest::Response) -> Result<String> {
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            return Err(Error::RateLimited {
                retry_after_secs: retry,
            });
        }
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(Error::Api {
                status: status.as_u16(),
                body: body.chars().take(400).collect(),
            });
        }
        Ok(body)
    }
}

/// Reads a streamed chat response (SSE in OpenAI's format), passes
/// each chunk to `on_delta` and returns the full text. Used by Groq and
/// the local translator, which speaks the same format.
pub(crate) async fn read_chat_stream(mut resp: reqwest::Response, on_delta: &mut impl FnMut(&str)) -> Result<String> {
    let mut out = String::new();
    let mut pending = String::new();
    'stream: while let Some(chunk) = resp.chunk().await? {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = pending.find('\n') {
            let line: String = pending.drain(..=end).collect();
            let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else { continue };
            if data == "[DONE]" {
                break 'stream;
            }
            let parsed: ChatChunk = serde_json::from_str(data).map_err(|e| Error::BadResponse(e.to_string()))?;
            if let Some(delta) = parsed.choices.first().and_then(|c| c.delta.content.as_deref()) {
                if !delta.is_empty() {
                    out.push_str(delta);
                    on_delta(delta);
                }
            }
        }
    }
    Ok(out.trim().to_string())
}
