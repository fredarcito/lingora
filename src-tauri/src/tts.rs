use crate::config::Lang;
use crate::error::{Error, Result};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsSupertonicModelConfig};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Voz femenina o masculina; la elige el usuario por carril.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Female,
    Male,
}

/// Supertonic 3 model for sherpa-onnx (downloaded by `models.rs`). It replaced
/// Kokoro: better voice, 18 languages instead of 5, less than half the memory
/// and no espeak-ng (it reads plain text). See docs/plan-voz-supertonic.md.
pub const MODEL_NAME: &str = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11";
/// The files the engine needs from the archive (the rest is README/LICENSE).
pub const FILES: &[&str] = &[
    "duration_predictor.int8.onnx",
    "text_encoder.int8.onnx",
    "vector_estimator.int8.onnx",
    "vocoder.int8.onnx",
    "tts.json",
    "unicode_indexer.bin",
    "voice.bin",
];

/// Sample rate of the audio Supertonic returns.
pub const SAMPLE_RATE: u32 = 44_100;

/// Denoising steps. 5 sounds as good as 8 by ear and arrives ~35 % sooner; 8
/// is the lane's "higher-quality voice" switch. 3 sounds bad: never use it.
pub const STEPS: i32 = 5;
pub const STEPS_HQ: i32 = 8;

/// Preset voices in `voice.bin`, per gender: by measured pitch, speakers 0–4
/// are female and 5–9 male.
const FEMALE: [i32; 5] = [0, 1, 2, 3, 4];
const MALE: [i32; 5] = [5, 6, 7, 8, 9];

/// Default voice for the language and gender, or `None` if Supertonic does not
/// speak the language (the system voice is used).
pub fn voice_for(lang: Lang, gender: Gender) -> Option<i32> {
    lang.info().supertonic.then_some(match gender {
        Gender::Female => FEMALE[0],
        Gender::Male => MALE[0],
    })
}

/// A Supertonic voice for the UI, which names it ("Voice 1 · female").
pub struct Voice {
    pub sid: i32,
    /// 1–5 within its gender.
    pub number: usize,
    pub gender: Gender,
}

/// The voices for the language (female first), or none if it is not supported.
pub fn voices(lang: Lang) -> Vec<Voice> {
    if !lang.info().supertonic {
        return Vec::new();
    }
    let group = |sids: [i32; 5], gender| sids.into_iter().enumerate().map(move |(i, sid)| Voice { sid, number: i + 1, gender });
    group(FEMALE, Gender::Female).chain(group(MALE, Gender::Male)).collect()
}

/// Supertonic in-process, with sherpa-onnx (the same library that listens).
/// The model loads on the first sentence and is freed with `release`.
pub struct TtsEngine {
    model_dir: PathBuf,
    loaded: tokio::sync::Mutex<Option<Arc<OfflineTts>>>,
    /// Una frase cada vez: dos a la vez se reparten los núcleos (4 hilos cada
    /// una, más la escucha) y la primera tarda más en sonar. El mutex de tokio
    /// atiende por orden de llegada, que es el orden de las frases.
    busy: tokio::sync::Mutex<()>,
}

impl TtsEngine {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir, loaded: Default::default(), busy: Default::default() }
    }

    /// El modelo está descargado en `dir`.
    pub fn is_installed(dir: &Path) -> bool {
        FILES.iter().all(|f| dir.join(f).exists())
    }

    async fn tts(&self) -> Result<Arc<OfflineTts>> {
        let mut loaded = self.loaded.lock().await;
        if let Some(tts) = loaded.as_ref() {
            return Ok(tts.clone());
        }
        let dir = self.model_dir.clone();
        if !Self::is_installed(&dir) {
            return Err(Error::Audio(format!("falta el modelo de voz en {}", dir.display())));
        }
        let tts = tauri::async_runtime::spawn_blocking(move || load(&dir))
            .await
            .map_err(|e| Error::Audio(format!("la carga del modelo de voz terminó mal: {e}")))??;
        *loaded = Some(tts.clone());
        Ok(tts)
    }

    /// Libera el modelo; se vuelve a cargar en la siguiente frase.
    pub async fn release(&self) {
        self.loaded.lock().await.take();
    }

    /// Synthesizes `text` in `lang` with voice `sid`. Returns mono float32
    /// samples at `SAMPLE_RATE`. `speed` > 1 speeds the voice up (used when
    /// sentences are queued); `steps` is `STEPS` or `STEPS_HQ`.
    pub async fn synthesize(&self, text: &str, lang: Lang, sid: i32, speed: f32, steps: i32) -> Result<Vec<f32>> {
        if !(0..10).contains(&sid) {
            return Err(Error::Audio(format!("voz desconocida: {sid}")));
        }
        let _turn = self.busy.lock().await;
        let tts = self.tts().await?;
        let text = text.to_string();
        tauri::async_runtime::spawn_blocking(move || generate(&tts, &text, lang, sid, speed, steps))
            .await
            .map_err(|e| Error::Audio(format!("la voz terminó mal: {e}")))?
    }
}

fn load(dir: &Path) -> Result<Arc<OfflineTts>> {
    let path = |f: &str| Some(dir.join(f).to_string_lossy().into_owned());
    let mut config = OfflineTtsConfig::default();
    config.model.supertonic = OfflineTtsSupertonicModelConfig {
        duration_predictor: path(FILES[0]),
        text_encoder: path(FILES[1]),
        vector_estimator: path(FILES[2]),
        vocoder: path(FILES[3]),
        tts_json: path(FILES[4]),
        unicode_indexer: path(FILES[5]),
        voice_style: path(FILES[6]),
    };
    // Same as Kokoro: with 2 threads the voice takes about twice as long, and
    // the voice is what is most noticeable when it arrives late.
    config.model.num_threads = 4;
    let t0 = std::time::Instant::now();
    let tts = OfflineTts::create(&config)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar el modelo de voz de {}", dir.display())))?;
    if tts.sample_rate() != SAMPLE_RATE as i32 {
        return Err(Error::Audio(format!("el modelo de voz da {} Hz, se esperaban {SAMPLE_RATE}", tts.sample_rate())));
    }
    tracing::info!("voz local lista en {:?}", t0.elapsed());
    Ok(Arc::new(tts))
}

/// Supertonic splits long text into sentences itself (a 620-character text
/// comes out whole), so it is synthesized in one call.
fn generate(tts: &OfflineTts, text: &str, lang: Lang, sid: i32, speed: f32, steps: i32) -> Result<Vec<f32>> {
    let extra = HashMap::from([("lang".to_string(), serde_json::json!(lang.info().code))]);
    let config = GenerationConfig { sid, speed, num_steps: steps, extra: Some(extra), ..Default::default() };
    let audio = tts
        .generate_with_config(text, &config, None::<fn(&[f32], f32) -> bool>)
        .ok_or_else(|| Error::Audio("la voz no generó audio".into()))?;
    Ok(audio.samples().to_vec())
}

pub(crate) fn parse_wav(wav: Vec<u8>) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::new(std::io::Cursor::new(wav))
        .map_err(|e| Error::Audio(format!("WAV inválido: {e}")))?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.sample_format != hound::SampleFormat::Float {
        return Err(Error::Audio(format!(
            "formato de WAV inesperado: {:?} {} canales",
            spec.sample_format, spec.channels
        )));
    }
    let samples: std::result::Result<Vec<f32>, _> = reader.samples::<f32>().collect();
    samples.map_err(|e| Error::Audio(format!("muestras inválidas: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_voices_by_language() {
        let es = voices(Lang::Es);
        assert_eq!(es.len(), 10);
        assert_eq!((es[0].sid, es[0].number, es[0].gender), (0, 1, Gender::Female));
        assert_eq!((es[5].sid, es[5].number, es[5].gender), (5, 1, Gender::Male));
        assert_eq!(voices(Lang::Ja).len(), 10);
        assert!(voices(Lang::Zh).is_empty());
        assert_eq!(voice_for(Lang::Es, Gender::Male), Some(5));
        assert_eq!(voice_for(Lang::Zh, Gender::Female), None);
    }

    /// Speaks Spanish at both step counts with the downloaded model, leaves the
    /// WAVs in the temp dir to listen to, and checks Parakeet understands them.
    #[tokio::test]
    #[ignore]
    async fn speaks_with_supertonic() {
        let models = PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/lingora/models");
        // LINGORA_TTS_MODEL_DIR can point to a test download.
        let tts = load(&crate::config::Settings::from_env_fallback().tts_model_dir).unwrap();
        let text = "Hola, esto es una prueba de la voz traducida. Debería sonar natural y llegar rápido.";
        generate(&tts, "Hola.", Lang::Es, 5, 1.0, STEPS).unwrap();
        for steps in [STEPS, STEPS_HQ] {
            let t0 = std::time::Instant::now();
            let audio = generate(&tts, text, Lang::Es, 5, 1.0, steps).unwrap();
            let secs = audio.len() as f32 / SAMPLE_RATE as f32;
            eprintln!("{steps} pasos: {:?} para {secs:.1} s de voz", t0.elapsed());
            let out = std::env::temp_dir().join(format!("lingora-supertonic-{steps}.wav"));
            let spec = hound::WavSpec { channels: 1, sample_rate: SAMPLE_RATE, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let mut w = hound::WavWriter::create(&out, spec).unwrap();
            audio.iter().for_each(|s| w.write_sample(*s).unwrap());
            w.finalize().unwrap();
            eprintln!("  {}", out.display());
            // Parakeet transcribes at 16 kHz: take every 2.75th sample.
            let at16: Vec<f32> = (0..audio.len() * 16 / 44).map(|i| audio[i * 44 / 16]).collect();
            let listener = crate::listener::Listener::new(models.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"), PathBuf::new());
            let words = listener.recognize(at16, Lang::Es).await.unwrap();
            eprintln!("  oído: {}", words.iter().map(|w| w.text.as_str()).collect::<String>());
        }
    }
}
