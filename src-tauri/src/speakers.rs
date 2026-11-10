//! Voiceprint to tell who is speaking in the notes ("Persona 1",
//! "Persona 2"…).
//!
//! Here only the voiceprint of each sentence is computed. Grouping them by
//! similarity is done by the UI (`src/notes.js`), where the threshold can be
//! tuned without recompiling. Model: ERes2Net from 3D-Speaker (~40 MB). In tests
//! with 4 voices in English and in Spanish it was the only one that separated
//! them all without errors with a single threshold (0.5); ~80 ms per sentence.

use crate::error::{Error, Result};
use sherpa_onnx::{SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const MODEL_FILE: &str = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";
pub const MODEL_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";

pub struct Speakers {
    model: PathBuf,
    loaded: tokio::sync::Mutex<Option<Arc<SpeakerEmbeddingExtractor>>>,
}

impl Speakers {
    pub fn new(model: PathBuf) -> Self {
        Self { model, loaded: Default::default() }
    }

    pub fn is_installed(model: &Path) -> bool {
        model.is_file()
    }

    async fn extractor(&self) -> Result<Arc<SpeakerEmbeddingExtractor>> {
        let mut loaded = self.loaded.lock().await;
        if let Some(e) = loaded.as_ref() {
            return Ok(e.clone());
        }
        if !Self::is_installed(&self.model) {
            return Err(Error::Audio("falta lo necesario para distinguir personas".into()));
        }
        let config = SpeakerEmbeddingExtractorConfig {
            model: Some(self.model.display().to_string()),
            // It runs off the translation path: with 2 threads it takes no CPU from it.
            num_threads: 2,
            debug: false,
            provider: Some("cpu".into()),
        };
        let e = tauri::async_runtime::spawn_blocking(move || SpeakerEmbeddingExtractor::create(&config))
            .await
            .map_err(|e| Error::Audio(format!("la carga del modelo terminó mal: {e}")))?
            .map(Arc::new)
            .ok_or_else(|| Error::Audio("no se pudo cargar lo necesario para distinguir personas".into()))?;
        *loaded = Some(e.clone());
        Ok(e)
    }

    /// Drops the model; it is loaded again with the next sentence.
    pub async fn release(&self) {
        self.loaded.lock().await.take();
    }

    /// Voiceprint of a sentence (mono, 16 kHz).
    pub async fn voice_print(&self, samples: Vec<f32>) -> Result<Vec<f32>> {
        let extractor = self.extractor().await?;
        tauri::async_runtime::spawn_blocking(move || {
            let stream = extractor
                .create_stream()
                .ok_or_else(|| Error::Audio("no se pudo preparar la huella de voz".into()))?;
            stream.accept_waveform(16_000, &samples);
            stream.input_finished();
            extractor
                .compute(&stream)
                .ok_or_else(|| Error::Audio("la frase es demasiado corta para la huella de voz".into()))
        })
        .await
        .map_err(|e| Error::Audio(format!("la huella de voz terminó mal: {e}")))?
    }
}
