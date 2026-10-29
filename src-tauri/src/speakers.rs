//! Huella de voz para distinguir quién habla en las notas ("Persona 1",
//! "Persona 2"…).
//!
//! Aquí solo se calcula la huella de cada frase. Agruparlas por parecido lo
//! hace la UI (`src/notes.js`), donde el umbral se puede ajustar sin
//! recompilar. Modelo: ERes2Net de 3D-Speaker (~40 MB). En pruebas con 4
//! voces en inglés y en español fue el único que las separó todas sin
//! errores con un mismo umbral (0,5); ~80 ms por frase.

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
            // Va fuera del camino de la traducción: con 2 hilos no le quita CPU.
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

    /// Suelta el modelo; se vuelve a cargar con la siguiente frase.
    pub async fn release(&self) {
        self.loaded.lock().await.take();
    }

    /// Huella de voz de una frase (mono, 16 kHz).
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
