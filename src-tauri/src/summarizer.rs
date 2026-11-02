//! Local note summaries with Qwen3.5-4B (Alibaba Qwen, Apache-2.0). It
//! replaced Groq (2026-11-02): nothing leaves the Mac and there is no key.
//!
//! Chosen with 3 real notes (8, 13 and 61 min) against Qwen3.5-4B IQ4_XS,
//! Gemma 4 E4B and Qwen3.5-2B, on an M1 Pro: Q4_K_M weighs 2.7 GB, uses
//! ~3.5 GB of RAM and takes ~35 s for a short note and ~85 s for an hour, in
//! one go. IQ4_XS swapped "Persona N" for guessed names, Gemma was slower and
//! heavier with less detail, and the 2B gave every point to Persona 1.
//!
//! Unlike the translator, the model is loaded per summary and dropped right
//! after: summaries are rare, loading takes a second or two next to the half
//! minute of writing, and it frees the memory without an idle timer. One
//! summary at a time, so two notes never load it twice.

use crate::error::{Error, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// File inside `models/`; it is the published name.
pub const MODEL_FILE: &str = "Qwen3.5-4B-Q4_K_M.gguf";
pub const MODEL_URL: &str = "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf";
/// Size of the published file, shown before downloading it.
pub const MODEL_BYTES: u64 = 2_740_937_888;

/// Context in tokens: an hour of conversation (~16K) fits in one go with room
/// for the instructions and the answer. Longer notes go by parts (`notes.rs`).
const CONTEXT_TOKENS: u32 = 24_576;
/// Longest answer, summary plus the short version for the map. The longest
/// one in the tests was ~1,700 tokens.
const MAX_TOKENS: usize = 2_500;
/// All layers on the GPU, like the translator.
const GPU_LAYERS: u32 = 99;
/// Sampling as tested: llama-server's defaults with Groq's temperature.
const TEMPERATURE: f32 = 0.3;

/// Only one summary at a time.
static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// Set when the app quits: the summary in progress stops at the next token.
static CANCEL: AtomicBool = AtomicBool::new(false);

/// Where the model goes.
pub fn model_path() -> PathBuf {
    crate::config::models_dir().join(MODEL_FILE)
}

pub fn is_installed(model: &Path) -> bool {
    model.exists()
}

/// Stops the summary in progress and waits for it to let go of the model.
/// Called when the app quits: with GPU memory still held, Metal aborts.
pub fn shutdown() {
    CANCEL.store(true, Ordering::SeqCst);
    drop(BUSY.blocking_lock());
}

/// Runs `work` with the model loaded, on a thread of its own, and frees it
/// after. `work` may ask for several completions (a long note goes by parts).
pub async fn with_model<T: Send + 'static>(
    work: impl for<'a> FnOnce(&mut Session<'a>) -> Result<T> + Send + 'static,
) -> Result<T> {
    with_model_at(model_path(), work).await
}

/// `with_model` with the model at `path` (the tests use one elsewhere).
pub(crate) async fn with_model_at<T: Send + 'static>(
    path: PathBuf,
    work: impl for<'a> FnOnce(&mut Session<'a>) -> Result<T> + Send + 'static,
) -> Result<T> {
    if !is_installed(&path) {
        return Err(Error::Notes("Falta descargar el resumen.".into()));
    }
    let _busy = BUSY.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let backend = crate::translator::backend();
        let params = LlamaModelParams::default().with_n_gpu_layers(GPU_LAYERS);
        let model = LlamaModel::load_from_file(backend, &path, &params)
            .map_err(|e| Error::Notes(format!("no se pudo cargar el resumen: {e}")))?;
        let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(CONTEXT_TOKENS));
        let ctx = model
            .new_context(backend, params)
            .map_err(|e| Error::Notes(format!("no se pudo preparar el resumen: {e}")))?;
        tracing::info!("resumen: modelo listo en {:?}", t0.elapsed());
        let out = work(&mut Session { model: &model, ctx });
        tracing::info!("resumen: modelo liberado");
        out
    })
    .await
    .map_err(|e| Error::Notes(format!("el resumen se interrumpió: {e}")))?
}

/// The loaded model and its context, for one or more completions.
pub struct Session<'a> {
    model: &'a LlamaModel,
    ctx: LlamaContext<'a>,
}

impl Session<'_> {
    /// Tokens of the prompt for `system` and `user`, as `complete` builds it.
    fn prompt(&self, system: &str, user: &str) -> Vec<LlamaToken> {
        let vocab = self.model.vocab();
        // The template's markers are special tokens; the texts are not, so a
        // transcript that says "<|im_end|>" stays text.
        let special = |s: &str| vocab.tokenize(s.as_bytes(), false, true);
        let text = |s: &str| vocab.tokenize(s.as_bytes(), false, false);
        let mut out = special("<|im_start|>system\n");
        out.extend(text(system));
        out.extend(special("<|im_end|>\n<|im_start|>user\n"));
        out.extend(text(user));
        // Qwen3.5's template with `enable_thinking: false`: an empty thought.
        out.extend(special("<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"));
        out
    }

    /// Whether `system` and `user` fit in one completion, with room for the answer.
    pub fn fits(&self, system: &str, user: &str) -> bool {
        self.prompt(system, user).len() + MAX_TOKENS <= self.ctx.n_ctx() as usize
    }

    /// Tokens of `text`, to split a long transcript by what fits.
    pub fn count(&self, text: &str) -> usize {
        self.model.vocab().tokenize(text.as_bytes(), false, false).len()
    }

    /// Tokens left for the user's text next to `system` and the answer.
    pub fn room(&self, system: &str) -> usize {
        (self.ctx.n_ctx() as usize).saturating_sub(self.prompt(system, "").len() + MAX_TOKENS)
    }

    /// The model's answer to `user` with the instructions `system`.
    pub fn complete(&mut self, system: &str, user: &str) -> Result<String> {
        let fail = |e: &dyn std::fmt::Display| Error::Notes(format!("falló el resumen: {e}"));
        let tokens = self.prompt(system, user);
        if tokens.len() + MAX_TOKENS > self.ctx.n_ctx() as usize {
            return Err(Error::Notes("la conversación es demasiado larga para resumirla de una vez".into()));
        }
        self.ctx.clear_kv_cache();
        let t0 = std::time::Instant::now();
        // The prompt goes in batches of `n_batch`; only the last token needs logits.
        let step = self.ctx.n_batch() as usize;
        let mut batch = LlamaBatch::new(step, 1);
        for (start, chunk) in tokens.chunks(step).enumerate().map(|(i, c)| (i * step, c)) {
            batch.clear();
            for (i, &token) in chunk.iter().enumerate() {
                let pos = start + i;
                batch.add(token, pos as i32, &[0], pos == tokens.len() - 1).map_err(|e| fail(&e))?;
            }
            self.ctx.decode(&mut batch).map_err(|e| fail(&e))?;
            if CANCEL.load(Ordering::SeqCst) {
                return Err(Error::Notes("el resumen se canceló".into()));
            }
        }
        let read = t0.elapsed();

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::min_p(0.05, 1),
            LlamaSampler::temp(TEMPERATURE),
            LlamaSampler::dist(rand_seed()),
        ]);
        let vocab = self.model.vocab();
        // A letter can come split between two tokens: it waits until it is whole.
        let mut bytes: Vec<u8> = Vec::new();
        let mut pos = tokens.len() as i32;
        for _ in 0..MAX_TOKENS {
            if CANCEL.load(Ordering::SeqCst) {
                return Err(Error::Notes("el resumen se canceló".into()));
            }
            // `sample` also accepts the token (the samplers keep their state).
            let token = sampler.sample(&self.ctx, batch.n_tokens() - 1);
            if vocab.is_eog(token) {
                break;
            }
            bytes.extend(vocab.token_to_piece(token, false, None));
            batch.clear();
            batch.add(token, pos, &[0], true).map_err(|e| fail(&e))?;
            pos += 1;
            self.ctx.decode(&mut batch).map_err(|e| fail(&e))?;
        }
        let written = pos as usize - tokens.len();
        let gen = (t0.elapsed() - read).as_secs_f32();
        tracing::info!(
            "resumen: {} tokens leídos en {:.1} s, {written} escritos en {gen:.1} s ({:.1} tokens/s)",
            tokens.len(),
            read.as_secs_f32(),
            written as f32 / gen.max(0.001),
        );
        Ok(String::from_utf8_lossy(&bytes).trim().to_string())
    }
}

/// A different seed each time, so "Summarize again" can give another wording.
fn rand_seed() -> u32 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos())
}
