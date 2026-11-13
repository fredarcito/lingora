//! The chat with the user's own AI key: the same services, key and consent as
//! the summary (`summary_cloud.rs`), with the history as messages and the
//! answer streamed as it is written.
//!
//! The stream is Server-Sent Events, read by hand from reqwest's chunks: no
//! extra crate. A server that ignores `stream` (some local ones) answers
//! with plain JSON, sent as one piece.

use super::{answer_stopped, start_answer, OnToken, Turn};
use crate::error::{Error, Result};
use crate::summary_cloud::{anthropic_text, api_error, openai_text, request, target, Cloud, Provider, MAX_TOKENS};
use serde_json::Value;

/// The service's answer to the last message of `turns`, with the instructions
/// and the note in `system`, streamed through `on_token`. «Detener»
/// (`stop_answer`) ends it and keeps what was written.
pub async fn chat(cloud: &Cloud, key: &str, system: &str, turns: &[Turn], on_token: &mut OnToken) -> Result<String> {
    start_answer();
    let (provider, model) = target(cloud)?;
    let body = match provider {
        Provider::Anthropic => anthropic_body(model, system, turns),
        _ => openai_body(provider, model, system, turns),
    };
    let mut resp = request(cloud, key, &body)?.send().await?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        let body = resp.text().await?;
        return Err(api_error(provider, status, &body));
    }
    let streamed = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));

    let mut text = String::new();
    let mut add = |piece: &str| {
        // The answer starts at its first letter, as on the computer.
        let piece = if text.is_empty() { piece.trim_start() } else { piece };
        if !piece.is_empty() {
            on_token(piece);
            text.push_str(piece);
        }
    };
    if streamed {
        let mut events = Events::default();
        'read: while let Some(chunk) = resp.chunk().await? {
            for data in events.push(&chunk) {
                match piece(provider, &data)? {
                    Piece::Text(t) => add(&t),
                    Piece::End => break 'read,
                    Piece::Nothing => {}
                }
            }
            // Dropping the response closes the connection: the service stops writing.
            if answer_stopped() {
                break;
            }
        }
    } else {
        let body = resp.text().await?;
        let json: Value = serde_json::from_str(&body).map_err(|e| Error::BadResponse(e.to_string()))?;
        let whole = match provider {
            Provider::Anthropic => anthropic_text(&json)?,
            _ => openai_text(&json),
        };
        add(&whole);
    }
    if text.trim().is_empty() && !answer_stopped() {
        return Err(Error::Notes(format!("{} devolvió una respuesta vacía. Prueba con otro modelo.", provider.name())));
    }
    Ok(text.trim_end().to_string())
}

/// Chat completions with the history. No `temperature`, as in the summary.
fn openai_body(provider: Provider, model: &str, system: &str, turns: &[Turn]) -> Value {
    let mut messages = vec![serde_json::json!({ "role": "system", "content": system })];
    messages.extend(turns.iter().map(|t| serde_json::json!({ "role": t.role, "content": t.text })));
    let mut body = serde_json::json!({ "model": model, "messages": messages, "stream": true });
    body[provider.token_cap()] = MAX_TOKENS.into();
    body
}

/// Messages API with the history: `system` apart, no `temperature`.
fn anthropic_body(model: &str, system: &str, turns: &[Turn]) -> Value {
    let messages: Vec<Value> = turns.iter().map(|t| serde_json::json!({ "role": t.role, "content": t.text })).collect();
    serde_json::json!({ "model": model, "max_tokens": MAX_TOKENS, "system": system, "messages": messages, "stream": true })
}

/// What one event of the stream brings.
#[derive(Debug, PartialEq)]
enum Piece {
    Text(String),
    End,
    Nothing,
}

/// Reads one event's `data`: OpenAI-compatible `choices[0].delta.content`, or
/// Anthropic's `content_block_delta` / `text_delta`. Errors and refusals in
/// the middle of the stream end the answer with a message.
fn piece(provider: Provider, data: &str) -> Result<Piece> {
    if data.trim() == "[DONE]" {
        return Ok(Piece::End);
    }
    // Something that isn't JSON (a keep-alive) is skipped.
    let Ok(json) = serde_json::from_str::<Value>(data) else {
        return Ok(Piece::Nothing);
    };
    let name = provider.name();
    let says = |json: &Value| {
        let message = json.pointer("/error/message").and_then(Value::as_str).unwrap_or("error desconocido");
        Error::Notes(format!("{name} respondió: {message}"))
    };
    let text = |pointer: &str| json.pointer(pointer).and_then(Value::as_str).filter(|t| !t.is_empty()).map(|t| Piece::Text(t.to_string()));
    if provider == Provider::Anthropic {
        return match json.get("type").and_then(Value::as_str) {
            Some("content_block_delta") if json.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") => {
                Ok(text("/delta/text").unwrap_or(Piece::Nothing))
            }
            Some("message_delta") if json.pointer("/delta/stop_reason").and_then(Value::as_str) == Some("refusal") => {
                Err(Error::Notes("Claude no quiso responder a esto. Prueba con otro servicio o en tu equipo.".into()))
            }
            Some("message_stop") => Ok(Piece::End),
            Some("error") => Err(says(&json)),
            _ => Ok(Piece::Nothing),
        };
    }
    if json.get("error").is_some() {
        return Err(says(&json));
    }
    Ok(text("/choices/0/delta/content").unwrap_or(Piece::Nothing))
}

/// Server-Sent Events as they arrive: keeps what isn't a whole event yet and
/// returns the `data` of each whole one (its lines joined). Events end at a
/// blank line; comments (`: …`) and other fields are left out.
#[derive(Default)]
struct Events {
    buf: Vec<u8>,
}

impl Events {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        // "\r" only appears in line ends: JSON escapes its own.
        self.buf.extend(chunk.iter().filter(|&&b| b != b'\r'));
        let mut out = Vec::new();
        while let Some(end) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let event: Vec<u8> = self.buf.drain(..end + 2).collect();
            // Whole events split at ASCII, so no letter is cut.
            let event = String::from_utf8_lossy(&event[..end]);
            let data: Vec<&str> =
                event.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.strip_prefix(' ').unwrap_or(d)).collect();
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::Role;

    fn turns() -> Vec<Turn> {
        vec![
            Turn { role: Role::User, text: "¿Presupuesto?".into() },
            Turn { role: Role::Assistant, text: "3.000 €".into() },
            Turn { role: Role::User, text: "¿Y la fecha?".into() },
        ]
    }

    #[test]
    fn bodies_carry_the_history_and_stream() {
        let openai = openai_body(Provider::OpenAi, "m", "sys", &turns());
        assert_eq!(openai["stream"], true);
        assert_eq!(openai["max_completion_tokens"], MAX_TOKENS);
        let messages = openai["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[3]["content"], "¿Y la fecha?");
        assert_eq!(openai_body(Provider::Groq, "m", "s", &turns())["max_tokens"], MAX_TOKENS);

        let claude = anthropic_body("m", "sys", &turns());
        assert_eq!(claude["system"], "sys");
        assert_eq!(claude["stream"], true);
        assert_eq!(claude["messages"].as_array().unwrap().len(), 3);
        assert!(claude.get("temperature").is_none());
    }

    #[test]
    fn events_wait_until_whole() {
        let mut events = Events::default();
        assert!(events.push(b": OPENROUTER PROCESSING\n\ndata: {\"a\":").is_empty());
        assert_eq!(events.push(b"1}\r\n\r\ndata: [DONE]\n\n"), vec!["{\"a\":1}", "[DONE]"]);
        // A letter split between two chunks comes out whole.
        let ene = "data: {\"t\":\"ñ\"}\n\n".as_bytes();
        assert!(events.push(&ene[..13]).is_empty());
        assert_eq!(events.push(&ene[13..]), vec!["{\"t\":\"ñ\"}"]);
        // Several data lines are one event; other fields are left out.
        assert_eq!(events.push(b"event: x\ndata: a\ndata: b\n\n"), vec!["a\nb"]);
    }

    /// A one-shot local server that answers with `content_type` and writes
    /// `parts` with a pause between them, as a service streaming its answer.
    fn fake_server(content_type: &'static str, parts: Vec<&'static [u8]>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 8192];
            let _ = stream.read(&mut request);
            let head = format!("HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\nconnection: close\r\n\r\n");
            stream.write_all(head.as_bytes()).unwrap();
            for part in parts {
                stream.write_all(part).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
        });
        url
    }

    fn custom(url: String) -> Cloud {
        Cloud { provider: "custom".into(), model: "local".into(), base_url: Some(url) }
    }

    #[tokio::test]
    async fn streams_from_a_server() {
        let ene = "data: {\"choices\":[{\"delta\":{\"content\":\"año\"}}]}\n\n".as_bytes();
        let url = fake_server(
            "text/event-stream",
            vec![
                b": keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
                b"data: {\"choices\":[{\"delta\":{\"content\":\"\\nEl \"}}]}\n\n",
                &ene[..41], // half of the "ñ"
                &ene[41..],
                b"data: [DONE]\n\n",
            ],
        );
        let pieces = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let sink = pieces.clone();
        let mut on_token: OnToken = Box::new(move |p| sink.lock().unwrap().push(p.to_string()));
        let text = chat(&custom(url), "", "sys", &turns(), &mut on_token).await.unwrap();
        assert_eq!(text, "El año");
        assert_eq!(*pieces.lock().unwrap(), vec!["El ", "año"]);
    }

    #[tokio::test]
    async fn reads_a_server_that_does_not_stream() {
        let url = fake_server("application/json", vec![br#"{"choices":[{"message":{"content":"Todo junto"}}]}"#]);
        let mut on_token: OnToken = Box::new(|_| {});
        assert_eq!(chat(&custom(url), "", "sys", &turns(), &mut on_token).await.unwrap(), "Todo junto");
    }

    #[test]
    fn pieces_of_each_service() {
        let open = |d: &str| piece(Provider::OpenAi, d).unwrap();
        assert_eq!(open(r#"{"choices":[{"delta":{"content":"Hola"}}]}"#), Piece::Text("Hola".into()));
        assert_eq!(open(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), Piece::Nothing);
        assert_eq!(open(r#"{"choices":[{"delta":{"reasoning":"pienso"}}]}"#), Piece::Nothing);
        assert_eq!(open("[DONE]"), Piece::End);
        assert_eq!(open("keep-alive"), Piece::Nothing);
        assert!(piece(Provider::Groq, r#"{"error":{"message":"rate limit"}}"#).is_err());

        let claude = |d: &str| piece(Provider::Anthropic, d);
        let delta = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hola"}}"#;
        assert_eq!(claude(delta).unwrap(), Piece::Text("Hola".into()));
        let thinking = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"…"}}"#;
        assert_eq!(claude(thinking).unwrap(), Piece::Nothing);
        assert_eq!(claude(r#"{"type":"message_stop"}"#).unwrap(), Piece::End);
        assert!(claude(r#"{"type":"message_delta","delta":{"stop_reason":"refusal"}}"#).is_err());
        let error = claude(r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#);
        assert_eq!(error.unwrap_err().to_string(), "Claude respondió: Overloaded");
    }
}
