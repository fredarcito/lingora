//! Escucha local (sherpa-onnx): transcribe en el equipo, sin nube.
//!
//! Dos modelos según el idioma que se oye:
//! - Parakeet v3 para los idiomas europeos.
//! - SenseVoice para chino, cantonés, japonés y coreano (también entiende
//!   inglés, así que un vídeo japonés con frases en inglés sale bien).
//!
//! Los dos son tan rápidos (~0,05–0,1 s por segundo de audio en un M1 Pro)
//! que la UI les pasa la frase en curso cada medio segundo para mostrar
//! subtítulos en vivo y, con las marcas de tiempo por palabra, saber dónde
//! termina cada frase. Así el audio se corta entre dos palabras en cuanto
//! acaba una frase, en vez de esperar a una pausa. El mismo modelo da después
//! la transcripción del trozo entero. Cada modelo se carga la primera vez que
//! hace falta y `release` los suelta para liberar memoria.

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

/// Idiomas que escucha SenseVoice (los europeos los escucha Parakeet).
const SENSE_VOICE_LANGS: &[&str] = &["zh", "zh-hant", "yue", "ja", "ko"];

impl Engine {
    /// El modelo que escucha el idioma, o `None` si aún no se puede escuchar en local.
    pub fn for_lang(lang: Lang) -> Option<Engine> {
        if lang.info().parakeet {
            Some(Engine::Parakeet)
        } else if SENSE_VOICE_LANGS.contains(&lang.info().code) {
            Some(Engine::SenseVoice)
        } else {
            None
        }
    }

    /// Carpeta del modelo dentro de `models/`; es el nombre del archivo publicado.
    pub fn model_name(self) -> &'static str {
        match self {
            Engine::Parakeet => "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
            // La versión de 2025 no pone puntuación y falla en japonés.
            Engine::SenseVoice => "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
        }
    }

    fn files(self) -> &'static [&'static str] {
        match self {
            Engine::Parakeet => &["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
            Engine::SenseVoice => &["model.int8.onnx", "tokens.txt"],
        }
    }

    /// El modelo está descargado en `dir`.
    pub fn is_installed(self, dir: &Path) -> bool {
        self.files().iter().all(|f| dir.join(f).exists())
    }
}

/// Duración que se asume para un token sin duración propia (un fotograma del
/// codificador de Parakeet).
const TOKEN_SECS: f32 = 0.08;

/// Una palabra reconocida, con su posición en segundos desde el inicio del audio.
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

    /// Carga el modelo (~1 s) la primera vez; después lo reutiliza.
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

    /// Carga el modelo que escucha `lang`. Devuelve si está disponible.
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

    /// Suelta los modelos cargados (~0,3–0,9 GB cada uno). Se vuelven a
    /// cargar al escuchar otra vez.
    pub async fn release(&self) {
        self.parakeet.lock().await.take();
        self.sense_voice.lock().await.take();
    }

    /// Reconoce audio mono de 16 kHz en `lang` y devuelve las palabras con sus tiempos.
    pub async fn recognize(&self, samples: Vec<f32>, lang: Lang) -> Result<Vec<Word>> {
        let engine = Engine::for_lang(lang).ok_or_else(|| {
            Error::Audio(format!("aún no se puede escuchar {} en local", lang.info().spanish.to_lowercase()))
        })?;
        let recognizer = self.recognizer(engine).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let stream = recognizer.create_stream();
            stream.accept_waveform(16_000, &samples);
            recognizer.decode(&stream);
            let result = stream
                .get_result()
                .ok_or_else(|| Error::Audio("el reconocedor no devolvió resultado".into()))?;
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
            // "auto": distingue solo chino, cantonés, japonés, coreano e
            // inglés, también mezclados en el mismo vídeo. Con `use_itn` pone
            // puntuación y escribe los números con cifras.
            config.model_config.sense_voice =
                OfflineSenseVoiceModelConfig { model: path("model.int8.onnx"), language: Some("auto".into()), use_itn: true };
        }
    }
    config.model_config.tokens = path("tokens.txt");
    // Con más hilos apenas gana en trozos de pocos segundos y gasta el doble de CPU.
    config.model_config.num_threads = 2;
    let t0 = std::time::Instant::now();
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar el modelo de {}", dir.display())))?;
    tracing::info!("escucha local ({engine:?}) lista en {:?}", t0.elapsed());
    Ok(Arc::new(recognizer))
}

/// Escrituras sin espacios entre palabras (china, japonesa): cada carácter
/// que da SenseVoice cuenta como palabra, para cortar entre ellos.
fn no_spaces(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}')
}

/// Junta los tokens en palabras. Un token que empieza con espacio abre una
/// palabra nueva, y en chino y japonés cada carácter es una; la puntuación
/// se pega a la anterior sin alargar su final, porque Parakeet la marca un
/// poco después de la palabra.
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
        // La puntuación no alarga la palabra.
        assert!((w[2].end - 1.04).abs() < 1e-6);
    }

    #[test]
    fn each_chinese_character_is_a_word() {
        let tokens: Vec<String> = ["开", "饭", "时", "间", "。", " OK"].iter().map(|s| s.to_string()).collect();
        let starts = [0.0, 0.2, 0.4, 0.6, 0.7, 1.0];
        let texts: Vec<_> = words(&tokens, &starts, None).into_iter().map(|w| w.text).collect();
        assert_eq!(texts, ["开", "饭", "时", "间。", "OK"]);
    }

    /// Con el modelo descargado: `cargo test --lib listener -- --ignored`.
    #[test]
    #[ignore]
    fn recognizes_with_downloaded_model() {
        let s = crate::config::Settings::from_env_fallback();
        let listener = Listener::new(s.listener_model_dir, s.sense_voice_model_dir);
        // Un segundo de tono no es voz: no debe inventarse palabras largas.
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
