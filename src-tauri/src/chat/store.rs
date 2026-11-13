//! The saved chats with all the notes: one JSON per chat in
//! `~/Library/Application Support/lingora/chats/<id>.json`, like the notes
//! (`{ id, title, created_at, updated_at, messages }`). They are read and
//! written through the notes' own `read_note` / `write_note`, so whatever
//! changes how notes are stored (encrypting them, say) changes this too.

use crate::error::{Error, Result};
use crate::notes::{read_note, str_field, valid_id, write_note};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

/// Chats folder, next to the notes one.
fn chats_dir() -> PathBuf {
    crate::notes::notes_dir().with_file_name("chats")
}

/// Path of a chat's file; the same rule for ids as the notes.
fn chat_path(id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(Error::Notes(format!("id de chat no válido: {id}")));
    }
    Ok(chats_dir().join(format!("{id}.json")))
}

/// Enough of a chat to list it.
#[derive(Debug, Serialize, PartialEq)]
pub struct ChatSummary {
    id: String,
    title: String,
    updated_at: String,
}

/// The chats, the most recently used first. Whatever cannot be read is ignored.
#[tauri::command]
pub async fn chats_list() -> Result<Vec<ChatSummary>> {
    tauri::async_runtime::spawn_blocking(|| Ok(list(&chats_dir())))
        .await
        .map_err(|e| Error::Notes(format!("no se pudo listar los chats: {e}")))?
}

fn list(dir: &std::path::Path) -> Vec<ChatSummary> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<ChatSummary> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "json" {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            if !valid_id(&id) {
                return None;
            }
            let chat = read_note(&path).ok()?;
            Some(ChatSummary { title: str_field(&chat, "title").to_string(), updated_at: str_field(&chat, "updated_at").to_string(), id })
        })
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// The chat's JSON, as is.
#[tauri::command]
pub fn chat_read(id: String) -> Result<Value> {
    read_note(&chat_path(&id)?)
}

/// Creates or replaces the chat (`chat.id` is the file).
#[tauri::command]
pub fn chat_save(chat: Value) -> Result<()> {
    write_note(&chat_path(str_field(&chat, "id"))?, &chat)
}

#[tauri::command]
pub fn chat_delete(id: String) -> Result<()> {
    std::fs::remove_file(chat_path(&id)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ids_cannot_leave_the_folder() {
        assert!(chat_path("2026-11-13_10-00-00").is_ok());
        assert!(chat_path("../notes/x").is_err());
        assert!(chat_path("").is_err());
        assert!(chats_dir().ends_with("lingora/chats"));
    }

    #[test]
    fn list_is_newest_first_and_skips_what_it_cannot_read() {
        let dir = std::env::temp_dir().join(format!("lingora-chats-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for (id, at) in [("a", "2026-11-12T10:00:00Z"), ("b", "2026-11-13T10:00:00Z")] {
            write_note(&dir.join(format!("{id}.json")), &json!({ "id": id, "title": id, "updated_at": at, "messages": [] })).unwrap();
        }
        std::fs::write(dir.join("roto.json"), "{").unwrap();
        let ids: Vec<String> = list(&dir).into_iter().map(|c| c.id).collect();
        assert_eq!(ids, ["b", "a"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
