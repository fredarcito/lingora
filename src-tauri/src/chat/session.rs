//! The chat's model with what it has read: builds Qwen3.5's prompt, reads only
//! what its memory doesn't hold yet and writes the answer.
//!
//! Qwen3.5 is a hybrid model: part of its memory is recurrent, and llama.cpp
//! can't remove just the end of a recurrent memory. So the memory is never
//! trimmed: it is either extended (the same chat plus a new question) or
//! cleared and read again. The answers stay in it as the tokens the model
//! wrote, not re-tokenized, so the extension is exact.

use super::{answer_stopped, take_utf8, OnToken, Role, Turn};
use crate::error::{Error, Result};
use crate::summarizer::{rand_seed, CANCEL, TEMPERATURE};
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use std::sync::atomic::Ordering;

/// Longest chat answer: answers are short next to a summary.
pub const MAX_TOKENS: usize = 1_500;
/// When old messages must go, enough go to leave this much room, so the next
/// questions add to what was read instead of reading it all again.
const SLACK: usize = 4_000;

/// The chat's model, with what its memory holds.
pub struct Session<'a> {
    pub model: &'a LlamaModel,
    pub ctx: LlamaContext<'a>,
    pub read: Option<Read>,
}

/// What the model's memory holds: `system`, then `turns` (the last one, its
/// answer), after leaving out the first `dropped` messages of the chat;
/// `tokens` long.
#[derive(Debug)]
pub struct Read {
    system: String,
    dropped: usize,
    turns: Vec<Turn>,
    tokens: usize,
}

impl Read {
    /// Whether `turns` is this same chat plus one new question.
    fn continues(&self, system: &str, turns: &[Turn]) -> bool {
        self.system == system
            && turns.len() == self.dropped + self.turns.len() + 1
            && turns[self.dropped..turns.len() - 1] == self.turns[..]
    }
}

impl Session<'_> {
    fn special(&self, s: &str) -> Vec<LlamaToken> {
        self.model.vocab().tokenize(s.as_bytes(), false, true)
    }

    /// Text is never parsed for markers: a note that says "<|im_end|>" stays text.
    fn text(&self, s: &str) -> Vec<LlamaToken> {
        self.model.vocab().tokenize(s.as_bytes(), false, false)
    }

    pub fn count(&self, s: &str) -> usize {
        self.text(s).len()
    }

    /// Start of the answer: Qwen3.5's template with thinking off (an empty
    /// thought), as the summary's prompt.
    fn opener(&self) -> Vec<LlamaToken> {
        self.special("<|im_start|>assistant\n<think>\n\n</think>\n\n")
    }

    fn system_tokens(&self, system: &str) -> Vec<LlamaToken> {
        let mut out = self.special("<|im_start|>system\n");
        out.extend(self.text(system));
        out.extend(self.special("<|im_end|>\n"));
        out
    }

    /// A past message. The answers keep the empty thought, as they were written.
    fn turn_tokens(&self, turn: &Turn) -> Vec<LlamaToken> {
        let mut out = match turn.role {
            Role::User => self.special("<|im_start|>user\n"),
            Role::Assistant => self.opener(),
        };
        out.extend(self.text(&turn.text));
        out.extend(self.special("<|im_end|>\n"));
        out
    }

    /// What follows an answer in memory: its end, the new question and the next answer's start.
    fn question_tail(&self, question: &str) -> Vec<LlamaToken> {
        let mut out = self.special("<|im_end|>\n");
        out.extend(self.turn_tokens(&Turn { role: Role::User, text: question.to_string() }));
        out.extend(self.opener());
        out
    }

    /// The whole prompt, without the oldest messages if they don't fit; and how many went.
    fn whole_prompt(&self, system: &str, turns: &[Turn]) -> Result<(Vec<LlamaToken>, usize)> {
        let head = self.system_tokens(system);
        let opener = self.opener();
        let parts: Vec<Vec<LlamaToken>> = turns.iter().map(|t| self.turn_tokens(t)).collect();
        let lens: Vec<usize> = parts.iter().map(Vec::len).collect();
        let roles: Vec<Role> = turns.iter().map(|t| t.role).collect();
        let room = (self.ctx.n_ctx() as usize).saturating_sub(MAX_TOKENS);
        let dropped = first_kept(&lens, &roles, head.len() + opener.len(), room, SLACK)
            .ok_or_else(|| Error::Notes("La conversación es demasiado larga para el chat.".into()))?;
        let mut tokens = head;
        parts[dropped..].iter().for_each(|p| tokens.extend(p));
        tokens.extend(opener);
        Ok((tokens, dropped))
    }

    /// Answers the last message of `turns`, reading only what memory doesn't already hold.
    pub fn answer(&mut self, system: &str, turns: &[Turn], on_token: &mut OnToken) -> Result<String> {
        let Some(question) = turns.last().filter(|t| t.role == Role::User) else {
            return Err(Error::Notes("falta la pregunta".into()));
        };
        let n_ctx = self.ctx.n_ctx() as usize;
        // Until this answer ends well, the memory is not to be trusted.
        let read = self.read.take();
        let tail = self.question_tail(&question.text);
        let reused = read.filter(|r| r.continues(system, turns) && r.tokens + tail.len() + MAX_TOKENS <= n_ctx);
        let (fresh, start, dropped) = match reused {
            Some(r) => (tail, r.tokens, r.dropped),
            None => {
                let (tokens, dropped) = self.whole_prompt(system, turns)?;
                self.ctx.clear_kv_cache();
                (tokens, 0, dropped)
            }
        };
        let t0 = std::time::Instant::now();
        let (text, end, written) = self.generate(&fresh, start, on_token)?;
        tracing::info!(
            "chat: {} tokens leídos ({start} ya en memoria), {written} escritos en {:.1} s",
            fresh.len(),
            t0.elapsed().as_secs_f32(),
        );
        if let Some(tokens) = end {
            let mut kept = turns[dropped..].to_vec();
            kept.push(Turn { role: Role::Assistant, text: text.clone() });
            self.read = Some(Read { system: system.to_string(), dropped, turns: kept, tokens });
        }
        Ok(text)
    }

    /// Reads `tokens` from position `start` and writes the answer. Returns it,
    /// where memory ends (`None` if stopped while reading: memory is half
    /// read) and how many tokens it wrote.
    fn generate(&mut self, tokens: &[LlamaToken], start: usize, on_token: &mut OnToken) -> Result<(String, Option<usize>, usize)> {
        let fail = |e: &dyn std::fmt::Display| Error::Notes(format!("falló el chat: {e}"));
        let cancelled = || Error::Notes("el chat se canceló".into());
        let step = self.ctx.n_batch() as usize;
        let mut batch = LlamaBatch::new(step, 1);
        for (i, chunk) in tokens.chunks(step).enumerate() {
            batch.clear();
            for (j, &token) in chunk.iter().enumerate() {
                let k = i * step + j;
                batch.add(token, (start + k) as i32, &[0], k == tokens.len() - 1).map_err(|e| fail(&e))?;
            }
            self.ctx.decode(&mut batch).map_err(|e| fail(&e))?;
            if CANCEL.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            if answer_stopped() {
                return Ok((String::new(), None, 0));
            }
        }

        // The same sampling as the summary.
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::min_p(0.05, 1),
            LlamaSampler::temp(TEMPERATURE),
            LlamaSampler::dist(rand_seed()),
        ]);
        let vocab = self.model.vocab();
        let mut pos = start + tokens.len();
        let (mut text, mut bytes) = (String::new(), Vec::new());
        for _ in 0..MAX_TOKENS {
            if CANCEL.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            if answer_stopped() {
                break;
            }
            let token = sampler.sample(&self.ctx, batch.n_tokens() - 1);
            if vocab.is_eog(token) {
                break;
            }
            bytes.extend(vocab.token_to_piece(token, false, None));
            let piece = take_utf8(&mut bytes);
            // The answer starts at its first letter.
            let piece = if text.is_empty() { piece.trim_start() } else { &piece };
            if !piece.is_empty() {
                on_token(piece);
                text.push_str(piece);
            }
            // Every token whose text was kept goes into memory, so it matches the answer.
            batch.clear();
            batch.add(token, pos as i32, &[0], true).map_err(|e| fail(&e))?;
            pos += 1;
            self.ctx.decode(&mut batch).map_err(|e| fail(&e))?;
        }
        text.push_str(&String::from_utf8_lossy(&bytes));
        let written = pos - start - tokens.len();
        Ok((text.trim_end().to_string(), Some(pos), written))
    }
}

/// The first message to keep so the prompt fits in `room`: all of them if
/// they fit; otherwise from a question on, leaving `slack` free if it can.
/// `None` if not even the last question fits.
fn first_kept(lens: &[usize], roles: &[Role], fixed: usize, room: usize, slack: usize) -> Option<usize> {
    let total = |from: usize| fixed + lens[from..].iter().sum::<usize>();
    if total(0) <= room {
        return Some(0);
    }
    let starts = || (1..lens.len()).filter(|&i| roles[i] == Role::User);
    starts().find(|&i| total(i) + slack <= room).or_else(|| starts().find(|&i| total(i) <= room))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    #[test]
    fn old_questions_go_first_with_slack() {
        use Role::{Assistant as A, User as U};
        let roles = [U, A, U, A, U];
        let lens = [100, 100, 100, 100, 100];
        assert_eq!(first_kept(&lens, &roles, 50, 1_000, 200), Some(0));
        // 550 > 500: from the second question (350 + slack 100 fits).
        assert_eq!(first_kept(&lens, &roles, 50, 500, 100), Some(2));
        // With a big slack: as far as it takes.
        assert_eq!(first_kept(&lens, &roles, 50, 500, 300), Some(4));
        // Slack can't be had: the most that fits.
        assert_eq!(first_kept(&lens, &roles, 50, 360, 1_000), Some(2));
        // Not even the last question.
        assert_eq!(first_kept(&lens, &roles, 50, 120, 0), None);
    }

    #[test]
    fn memory_continues_only_the_same_chat() {
        let read = Read {
            system: "sys".into(),
            dropped: 2,
            turns: vec![turn(Role::User, "b"), turn(Role::Assistant, "B")],
            tokens: 10,
        };
        let chat = |last: &str| {
            vec![
                turn(Role::User, "a"),
                turn(Role::Assistant, "A"),
                turn(Role::User, "b"),
                turn(Role::Assistant, "B"),
                turn(Role::User, last),
            ]
        };
        assert!(read.continues("sys", &chat("c")));
        assert!(!read.continues("otro", &chat("c")));
        let mut edited = chat("c");
        edited[3].text = "B editado".into();
        assert!(!read.continues("sys", &edited));
        assert!(!read.continues("sys", &chat("c")[2..])); // the chat was cleared
    }
}
