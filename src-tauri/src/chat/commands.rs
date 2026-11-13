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

/// Answers the last message of `messages` from all the notes (the Chat page).
/// `today` is the user's local date (`2026-11-13`), for «ayer» or «esta
/// semana»; `note_ids`, the notes the user chose for this question (the
/// chips under an answer), which skip the choosing. On the computer or with
/// `cloud` and the user's key; the answer goes to `on_token` as it is written.
#[tauri::command]
pub async fn notes_chat(
    state: tauri::State<'_, crate::AppState>,
    messages: Vec<Turn>,
    today: String,
    cloud: Option<Cloud>,
    note_ids: Option<Vec<String>>,
    on_token: Channel<String>,
) -> Result<super::all::AllAnswer> {
    let on_token: OnToken = Box::new(move |piece| {
        let _ = on_token.send(piece.to_string());
    });
    let dir = crate::notes::notes_dir();
    match cloud {
        Some(service) => {
            let key = crate::summary_cloud::key_for(&service.provider).await?;
            super::all::answer(dir, messages, &today, Some((&service, &key)), note_ids, on_token).await
        }
        None => {
            // As in `note_chat`: the translator and the chat's model don't fit together everywhere.
            state.pipeline.local_translator().shutdown();
            super::all::answer(dir, messages, &today, None, note_ids, on_token).await
        }
    }
}

/// «Detener»: ends the answer in progress; `note_chat` returns what was written.
#[tauri::command]
pub fn chat_stop() {
    super::stop_answer();
}
