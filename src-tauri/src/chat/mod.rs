//! Chat with the notes: questions about one note or all of them, answered on
//! the computer (`local`, the summary's model kept loaded) or with the user's
//! own AI key (`cloud`). See `docs/plan-chat.md`.
//!
//! This file has what both share: the messages, stopping an answer and
//! streaming it in whole characters.

#[cfg(test)]
mod bench;
pub mod cloud;
pub mod commands;
pub mod local;
mod prompt;
mod search;
mod session;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

/// Who wrote a chat message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

/// One chat message, as the interface sends it and the APIs take it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Turn {
    pub role: Role,
    pub text: String,
}

/// Receives the answer as it is written, in whole characters.
pub type OnToken = Box<dyn FnMut(&str) + Send>;

/// Set by `stop_answer`: the answer in progress (local or with a key) ends at
/// the next piece and keeps what it wrote. Each answer clears it when it starts.
static STOP_ANSWER: AtomicBool = AtomicBool::new(false);

/// Ends the chat answer in progress; it returns what was written so far.
pub fn stop_answer() {
    STOP_ANSWER.store(true, Ordering::SeqCst);
}

/// Called when an answer starts: an earlier "stop" doesn't cut it.
fn start_answer() {
    STOP_ANSWER.store(false, Ordering::SeqCst);
}

fn answer_stopped() -> bool {
    STOP_ANSWER.load(Ordering::SeqCst)
}

/// Takes the whole characters at the front of `bytes`; an unfinished one at
/// the end stays for the next piece. Invalid bytes become "�".
fn take_utf8(bytes: &mut Vec<u8>) -> String {
    let whole = match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => bytes.len(),
    };
    let rest = bytes.split_off(whole);
    let out = String::from_utf8_lossy(bytes).into_owned();
    *bytes = rest;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_waits_for_whole_letters() {
        let mut bytes = "añ".as_bytes()[..2].to_vec(); // "a" and half of "ñ"
        assert_eq!(take_utf8(&mut bytes), "a");
        assert_eq!(bytes.len(), 1);
        bytes.extend(&"ñ".as_bytes()[1..]);
        assert_eq!(take_utf8(&mut bytes), "ñ");
        assert!(bytes.is_empty());
        let mut bad = vec![b'x', 0xff, b'y'];
        assert_eq!(take_utf8(&mut bad), "x\u{fffd}y");
    }

    #[test]
    fn turns_read_as_the_interface_sends_them() {
        let turn: Turn = serde_json::from_str(r#"{ "role": "assistant", "text": "Hola" }"#).unwrap();
        assert_eq!(turn, Turn { role: Role::Assistant, text: "Hola".into() });
        assert_eq!(serde_json::to_value(Role::User).unwrap(), "user");
    }
}
