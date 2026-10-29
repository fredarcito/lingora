use crate::config::Lang;
use crate::error::{Error, Result};

/// Tiempo de espera antes de lanzar una petición de respaldo a Whisper. Una
/// transcripción normal de un trozo de 5 s tarda ~1 s.
const HEDGE_AFTER: std::time::Duration = std::time::Duration::from_millis(2000);

/// Devuelve el primer resultado correcto de dos peticiones en paralelo; si
/// fallan ambas, el último error.
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

/// Cliente de la API de Groq. Se usa para transcripción (Whisper) y para
/// traducción (chat). El TTS es local y no pasa por aquí.
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

/// Un evento del streaming de chat (`data: {...}` en SSE).
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

/// Respuesta de chat sin streaming.
#[derive(serde::Deserialize)]
struct CompletionResponse {
    choices: Vec<CompletionChoice>,
}

#[derive(serde::Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}

#[derive(serde::Deserialize)]
struct CompletionMessage {
    #[serde(default)]
    content: Option<String>,
}

impl Groq {
    pub fn new(api_key: String) -> Self {
        // Groq rechaza peticiones sin User-Agent con un 403 (comprobado en la
        // fase 0). El cliente lo fija aquí para que ningún llamador lo olvide.
        let http = reqwest::Client::builder()
            .user_agent(concat!("lingora/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("cliente HTTP");
        Self { http, api_key }
    }

    /// Transcribe un WAV (PCM 16 bits, mono, 16 kHz) con Whisper.
    ///
    /// La latencia de Groq varía mucho: la misma petición tarda 1 s o 8 s. En
    /// una traducción en tiempo real eso es inaceptable, así que si no hay
    /// respuesta en `HEDGE_AFTER` se lanza una segunda petición idéntica y se
    /// usa la primera que llegue. Un fallo rápido se reintenta una vez.
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

    /// Una petición de transcripción.
    ///
    /// Se pide `verbose_json` y se unen los segmentos. Se llegó a creer que
    /// con `json` el campo `text` solo traía el último segmento, pero al
    /// probarlo devuelve el texto completo: el audio llegaba ya recortado por
    /// un enrutado mal montado (ver docs/problemas-conocidos.md). Se mantiene
    /// porque los segmentos sirven para diagnosticar.
    ///
    /// `prompt` es lo último que se transcribió: con trozos cortos ayuda a
    /// Whisper a mantener nombres y a no partir mal las palabras del borde.
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

    /// Traduce texto entre inglés y español. `context` es lo dicho justo antes:
    /// el audio se corta en trozos de pocos segundos y una frase puede quedar
    /// partida entre dos.
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
            // Modo rápido: la voz en español dura más que el inglés y se queda
            // atrás. Medido con una intro de YouTube: condensar acorta la voz
            // un 20 % (sin efecto en habla densa, que no tiene relleno).
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
            // 0.3 da traducciones más naturales que 0 sin perder fidelidad;
            // con 0 qwen tiende a calcar el inglés ("me está volviendo a dar").
            "temperature": 0.3,
            "max_tokens": 400,
            // En streaming: la UI empieza la voz con la primera frase
            // traducida, sin esperar al resto.
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
            // Ocurre con modelos de razonamiento que gastan todos los tokens
            // pensando (gpt-oss sin `reasoning_effort: low`). Mejor fallar
            // explícitamente que devolver una traducción vacía.
            return Err(Error::BadResponse(
                "la traducción llegó vacía; revisa el modelo configurado".into(),
            ));
        }
        Ok(out)
    }

    /// Una respuesta de chat completa, sin streaming. La usan los resúmenes de
    /// las notas: tardan más que una frase, así que la petición lleva su propio
    /// tiempo de espera (en reqwest sustituye al del cliente, que sigue en 30 s
    /// para la traducción).
    pub async fn complete(&self, system: &str, user: &str, model: &str) -> Result<String> {
        let payload = serde_json::json!({
            "model": model,
            "temperature": 0.3,
            "max_tokens": 2000,
            "stream": false,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ]
        });
        let resp = self
            .http
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .timeout(std::time::Duration::from_secs(120))
            .json(&payload)
            .send()
            .await?;
        let body = self.check(resp).await?;
        let parsed: CompletionResponse = serde_json::from_str(&body).map_err(|e| Error::BadResponse(e.to_string()))?;
        let content = parsed.choices.into_iter().next().and_then(|c| c.message.content).unwrap_or_default();
        // Los modelos que razonan pueden devolver su pensamiento entre <think>.
        let text = content.rsplit("</think>").next().unwrap_or_default().trim().to_string();
        if text.is_empty() {
            return Err(Error::BadResponse("el resumen llegó vacío; revisa el modelo configurado".into()));
        }
        Ok(text)
    }

    /// Convierte una respuesta no-2xx en un error tipado y devuelve el cuerpo
    /// como texto si fue correcta.
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

/// Lee una respuesta de chat en streaming (SSE con el formato de OpenAI),
/// pasa cada trozo a `on_delta` y devuelve el texto completo. La usan Groq y
/// el traductor local, que habla el mismo formato.
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
