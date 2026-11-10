//! Local listening (sherpa-onnx): transcribes on the computer, with no cloud.
//!
//! Two models depending on the language heard:
//! - Parakeet v3 for European languages.
//! - SenseVoice for Chinese, Cantonese, Japanese and Korean (it also understands
//!   English, so a Japanese video with English phrases comes out fine).
//!
//! Both are so fast (~0.05–0.1 s per second of audio on an M1 Pro)
//! that the UI passes them the sentence in progress every half second to show
//! live captions and, with the per-word timestamps, know where
//! each sentence ends. So the audio is cut between two words as soon as
//! a sentence ends, instead of waiting for a pause. The same model then gives
//! the transcription of the whole chunk. Each model is loaded the first time
//! it is needed and `release` drops them to free memory.

use crate::config::Lang;
use crate::error::{Error, Result};
use serde::Serialize;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, OfflineTransducerModelConfig};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Modelo de escucha local.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Parakeet,
    SenseVoice,
}

/// Languages SenseVoice listens to (Parakeet listens to the European ones).
const SENSE_VOICE_LANGS: &[&str] = &["zh", "zh-hant", "yue", "ja", "ko"];

impl Engine {
    /// The model that listens to the language, or `None` if it cannot be listened to locally yet.
    pub fn for_lang(lang: Lang) -> Option<Engine> {
        if lang.info().parakeet {
            Some(Engine::Parakeet)
        } else if SENSE_VOICE_LANGS.contains(&lang.info().code) {
            Some(Engine::SenseVoice)
        } else {
            None
        }
    }

    /// Folder of the model inside `models/`; it is the name of the published file.
    pub fn model_name(self) -> &'static str {
        match self {
            Engine::Parakeet => "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
            // The 2025 version adds no punctuation and fails in Japanese.
            Engine::SenseVoice => "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
        }
    }

    fn files(self) -> &'static [&'static str] {
        match self {
            Engine::Parakeet => &["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
            Engine::SenseVoice => &["model.int8.onnx", "tokens.txt"],
        }
    }

    /// The model is downloaded in `dir`.
    pub fn is_installed(self, dir: &Path) -> bool {
        self.files().iter().all(|f| dir.join(f).exists())
    }
}

/// Duration assumed for a token with no duration of its own (one frame of
/// Parakeet's encoder).
const TOKEN_SECS: f32 = 0.08;

/// A recognized word, with its position in seconds from the start of the audio.
#[derive(Debug, Clone, Serialize)]
pub struct Word {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

type Slot = tokio::sync::Mutex<Option<Arc<OfflineRecognizer>>>;

pub struct Listener {
    parakeet_dir: PathBuf,
    sense_voice_dir: PathBuf,
    parakeet: Slot,
    sense_voice: Slot,
}

impl Listener {
    pub fn new(parakeet_dir: PathBuf, sense_voice_dir: PathBuf) -> Self {
        Self { parakeet_dir, sense_voice_dir, parakeet: Slot::default(), sense_voice: Slot::default() }
    }

    fn dir(&self, engine: Engine) -> &Path {
        match engine {
            Engine::Parakeet => &self.parakeet_dir,
            Engine::SenseVoice => &self.sense_voice_dir,
        }
    }

    /// Loads the model (~1 s) the first time; afterwards it reuses it.
    async fn recognizer(&self, engine: Engine) -> Result<Arc<OfflineRecognizer>> {
        let slot = match engine {
            Engine::Parakeet => &self.parakeet,
            Engine::SenseVoice => &self.sense_voice,
        };
        let mut loaded = slot.lock().await;
        if let Some(r) = loaded.as_ref() {
            return Ok(r.clone());
        }
        let dir = self.dir(engine).to_path_buf();
        if !engine.is_installed(&dir) {
            return Err(Error::Audio(format!("falta el modelo para escuchar en local en {}", dir.display())));
        }
        let r = tauri::async_runtime::spawn_blocking(move || load(engine, &dir))
            .await
            .map_err(|e| Error::Audio(format!("la carga del modelo terminó mal: {e}")))??;
        *loaded = Some(r.clone());
        Ok(r)
    }

    /// Loads the model that listens to `lang`. Returns whether it is available.
    pub async fn warm_up(&self, lang: Lang) -> bool {
        let Some(engine) = Engine::for_lang(lang) else { return false };
        match self.recognizer(engine).await {
            Ok(_) => true,
            Err(e) => {
                tracing::warn!("escucha local no disponible: {e}");
                false
            }
        }
    }

    /// Drops the loaded models (~0.3–0.9 GB each). They are loaded
    /// again when listening once more.
    pub async fn release(&self) {
        self.parakeet.lock().await.take();
        self.sense_voice.lock().await.take();
    }

    /// Recognizes 16 kHz mono audio in `lang` and returns the words with their times.
    pub async fn recognize(&self, samples: Vec<f32>, lang: Lang) -> Result<Vec<Word>> {
        let engine = Engine::for_lang(lang).ok_or_else(|| {
            Error::Audio(format!("aún no se puede escuchar {} en local", lang.info().spanish.to_lowercase()))
        })?;
        let recognizer = self.recognizer(engine).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let t0 = std::time::Instant::now();
            let audio_secs = samples.len() as f32 / 16_000.0;
            let stream = recognizer.create_stream();
            stream.accept_waveform(16_000, &samples);
            recognizer.decode(&stream);
            let result = stream
                .get_result()
                .ok_or_else(|| Error::Audio("el reconocedor no devolvió resultado".into()))?;
            crate::perf::listened(audio_secs, t0.elapsed());
            let starts = result.timestamps.unwrap_or_default();
            Ok(words(&result.tokens, &starts, result.durations.as_deref()))
        })
        .await
        .map_err(|e| Error::Audio(format!("el reconocimiento terminó mal: {e}")))?
    }
}

fn load(engine: Engine, dir: &Path) -> Result<Arc<OfflineRecognizer>> {
    let path = |f: &str| Some(dir.join(f).display().to_string());
    let mut config = OfflineRecognizerConfig::default();
    match engine {
        Engine::Parakeet => {
            config.model_config.transducer = OfflineTransducerModelConfig {
                encoder: path("encoder.int8.onnx"),
                decoder: path("decoder.int8.onnx"),
                joiner: path("joiner.int8.onnx"),
            };
            config.model_config.model_type = Some("nemo_transducer".into());
        }
        Engine::SenseVoice => {
            // "auto": it tells apart only Chinese, Cantonese, Japanese, Korean and
            // English, also mixed in the same video. With `use_itn` it adds
            // punctuation and writes numbers as digits.
            config.model_config.sense_voice =
                OfflineSenseVoiceModelConfig { model: path("model.int8.onnx"), language: Some("auto".into()), use_itn: true };
        }
    }
    config.model_config.tokens = path("tokens.txt");
    // With more threads it barely gains on chunks of a few seconds and uses twice the CPU.
    config.model_config.num_threads = 2;
    let t0 = std::time::Instant::now();
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar el modelo de {}", dir.display())))?;
    tracing::info!("escucha local ({engine:?}) lista en {:?} ({} hilos)", t0.elapsed(), config.model_config.num_threads);
    Ok(Arc::new(recognizer))
}

/// Scripts without spaces between words (Chinese, Japanese): each character
/// SenseVoice gives counts as a word, to cut between them.
fn no_spaces(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}')
}

/// Joins the tokens into words. A token that starts with a space opens a
/// new word, and in Chinese and Japanese each character is one; punctuation
/// sticks to the previous one without extending its end, because Parakeet marks
/// it a little after the word.
fn words(tokens: &[String], starts: &[f32], durations: Option<&[f32]>) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        let Some(&start) = starts.get(i) else { break };
        let duration = durations.and_then(|d| d.get(i)).copied().filter(|d| *d > 0.0);
        let end = start + duration.unwrap_or(TOKEN_SECS);
        let punctuation = !token.trim().chars().any(char::is_alphanumeric);
        let new_word = token.starts_with(' ')
            || token.chars().next().is_some_and(no_spaces)
            || out.last().and_then(|w| w.text.chars().last()).is_some_and(no_spaces);
        match out.last_mut() {
            Some(last) if punctuation || !new_word => {
                last.text.push_str(token.trim());
                if !punctuation {
                    last.end = end;
                }
            }
            _ if token.trim().is_empty() => {}
            _ => out.push(Word { text: token.trim().to_string(), start, end }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_subword_tokens_and_punctuation() {
        let tokens: Vec<String> = [" Hi", ",", " than", "ks", " for", "."].iter().map(|s| s.to_string()).collect();
        let starts = [0.0, 0.4, 0.56, 0.8, 0.96, 1.3];
        let w = words(&tokens, &starts, None);
        let texts: Vec<_> = w.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["Hi,", "thanks", "for."]);
        assert!((w[1].start - 0.56).abs() < 1e-6 && (w[1].end - 0.88).abs() < 1e-6);
        // Punctuation does not extend the word.
        assert!((w[2].end - 1.04).abs() < 1e-6);
    }

    #[test]
    fn each_chinese_character_is_a_word() {
        let tokens: Vec<String> = ["开", "饭", "时", "间", "。", " OK"].iter().map(|s| s.to_string()).collect();
        let starts = [0.0, 0.2, 0.4, 0.6, 0.7, 1.0];
        let texts: Vec<_> = words(&tokens, &starts, None).into_iter().map(|w| w.text).collect();
        assert_eq!(texts, ["开", "饭", "时", "间。", "OK"]);
    }

    /// With the model downloaded: `cargo test --lib listener -- --ignored`.
    #[test]
    #[ignore]
    fn recognizes_with_downloaded_model() {
        let s = crate::config::Settings::from_env_fallback();
        let listener = Listener::new(s.listener_model_dir, s.sense_voice_model_dir);
        // A second of tone is not speech: it must not make up long words.
        let tone: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.05).sin() * 0.01).collect();
        tauri::async_runtime::block_on(async {
            for lang in [Lang::Es, Lang::Zh] {
                assert!(listener.warm_up(lang).await);
                let words = listener.recognize(tone.clone(), lang).await.unwrap();
                assert!(words.len() <= 2, "{words:?}");
            }
        });
    }
}
