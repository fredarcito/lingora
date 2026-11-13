//! The chat's commands: the interface calls these (`docs/plan-chat.md`).

use super::{cloud, local, prompt, OnToken, Turn};
use crate::error::Result;
use crate::summary_cloud::Cloud;
use tauri::ipc::Channel;

/// Answers the last message of `messages` about the note `id`. `messages` is
/// the whole chat (the answers exactly as this returned them) plus the new
/// question. On the computer, or with `cloud` and the user's key; the answer
/// goes to `on_token` as it is written and the whole text is returned.
#[tauri::command]
pub async fn note_chat(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    messages: Vec<Turn>,
    cloud: Option<Cloud>,
    on_token: Channel<String>,
) -> Result<String> {
    let note = prompt::load(&id)?;
    let mut on_token: OnToken = Box::new(move |piece| {
        let _ = on_token.send(piece.to_string());
    });
    match cloud {
        Some(service) => {
            let key = crate::summary_cloud::key_for(&service.provider).await?;
            let system = prompt::system_for_cloud(&note, &messages)?;
            cloud::chat(&service, &key, &system, &messages, &mut on_token).await
        }
        None => {
            // The translator and the chat's model don't fit in memory together on
            // every computer; the translator loads again by itself when needed.
            state.pipeline.local_translator().shutdown();
            let system = prompt::system_for(&note, &messages).await?;
            local::chat(system, messages, on_token).await
        }
    }
}

/// «Detener»: ends the answer in progress; `note_chat` returns what was written.
#[tauri::command]
pub fn chat_stop() {
    super::stop_answer();
}
