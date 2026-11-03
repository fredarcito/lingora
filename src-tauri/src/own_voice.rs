//! "Your voice": the translation said in the user's own voice, cloned from a
//! short recording, with Pocket TTS (Kyutai) through sherpa-onnx. It is for
//! Speak in a call: the other person hears you in their language. See
//! docs/plan-tu-voz.md.
//!
//! Only the user's own voice: the model's licence forbids cloning anyone
//! without their consent, so the recording is made in Settings → Speak, never
//! taken from what Listen hears. It stays on this computer
//! (`lingora/voice/sample.wav`, next to the models folder).

use crate::config::Lang;
use crate::error::{Error, Result};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsPocketModelConfig};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// What `speak` gets to use it (`VoiceInfo.id`).
pub const ID: &str = "own";

/// The English model sherpa-onnx publishes. Kyutai also has French, German,
/// Italian, Portuguese and Spanish, not yet in sherpa-onnx's releases.
pub const MODEL_NAME: &str = "sherpa-onnx-pocket-tts-int8-2026-01-26";
/// Size of the archive.
pub const MODEL_BYTES: u64 = 98_336_520;
pub const FILES: &[&str] = &[
    "lm_flow.int8.onnx",
    "lm_main.int8.onnx",
    "encoder.onnx",
    "decoder.int8.onnx",
    "text_conditioner.onnx",
    "vocab.json",
    "token_scores.json",
];

/// The languages the model speaks (app codes). The recording can be in any
/// language: it only gives the timbre.
const LANGS: &[&str] = &["en"];

/// Measured on an M-series Mac: 0.18 s per second of audio with 2 threads and
/// 0.17 with 4, so 2 leave room for the other lane.
const THREADS: i32 = 2;

/// Pocket TTS samples at random: without a fixed seed the same sentence came
/// out different each time (one 2.6 s, the next 3.5 s). With it, the same text
/// always sounds the same.
const SEED: i64 = 42;

/// A recording shorter than this clones badly; a longer one is cut.
pub const MIN_SECS: f32 = 8.0;
pub const MAX_SECS: f32 = 30.0;
/// Recordings come in at very different levels (one at 0.04 peak cloned a
/// muffled voice that cut short sentences): they are brought up to this.
const PEAK: f32 = 0.7;
/// Below this peak there is nothing to clone (a muted microphone).
const SILENT_PEAK: f32 = 0.005;
/// Silence at both ends is trimmed: below this share of the peak, in 20 ms blocks.
const SILENCE_SHARE: f32 = 0.05;
/// A recording made in the app came in ~8× quieter for its first 2 s (the
/// microphone settling), and Pocket TTS took that level: the clone came out at
/// 0.04 peak. Half-second windows at the start below this share of the
/// recording's typical (median) level are dropped, up to `MAX_LEAD_IN_SECS`.
const LEAD_IN_SHARE: f32 = 0.3;
const MAX_LEAD_IN_SECS: f32 = 4.0;
/// Each sentence of the clone is brought to about the level of Lingora's
/// voices (Supertonic peaks at ~0.55), never more than `MAX_OUTPUT_GAIN` times.
const OUTPUT_PEAK: f32 = 0.6;
const MAX_OUTPUT_GAIN: f32 = 10.0;

pub fn speaks(lang: Lang) -> bool {
    LANGS.contains(&lang.info().code)
}

pub fn model_dir() -> PathBuf {
    crate::config::models_dir().join(MODEL_NAME)
}

pub fn is_installed(dir: &Path) -> bool {
    FILES.iter().all(|f| dir.join(f).exists())
}

fn sample_path() -> PathBuf {
    crate::config::models_dir().with_file_name("voice").join("sample.wav")
}

/// What Settings → Speak shows.
#[derive(Debug, serde::Serialize)]
pub struct Status {
    pub model_installed: bool,
    pub model_bytes: u64,
    /// Seconds of the saved recording; 0 without one.
    pub sample_secs: f32,
    /// App codes of the languages it speaks.
    pub langs: &'static [&'static str],
}

pub fn status() -> Status {
    Status {
        model_installed: is_installed(&model_dir()),
        model_bytes: MODEL_BYTES,
        sample_secs: saved_sample().map_or(0.0, |(s, rate)| s.len() as f32 / rate as f32),
        langs: LANGS,
    }
}

pub fn has_sample() -> bool {
    sample_path().exists()
}

/// Why a recording was not kept; the UI explains it.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Problem {
    Silent,
    TooShort,
}

/// The recording as it is kept: silence trimmed at both ends, without a quiet
/// lead-in, at most `MAX_SECS`, brought up to `PEAK`.
fn prepare(samples: &[f32], rate: u32) -> std::result::Result<Vec<f32>, Problem> {
    let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
    if peak < SILENT_PEAK {
        return Err(Problem::Silent);
    }
    let block = (rate as usize / 50).max(1);
    let loud = |c: &[f32]| c.iter().any(|s| s.abs() >= peak * SILENCE_SHARE);
    let blocks: Vec<&[f32]> = samples.chunks(block).collect();
    let first = blocks.iter().position(|c| loud(c)).unwrap_or(0);
    let last = blocks.iter().rposition(|c| loud(c)).unwrap_or(0);
    let voiced = &samples[first * block..((last + 1) * block).min(samples.len())];
    let start = first * block + lead_in(voiced, rate);
    let end = ((last + 1) * block).min(samples.len()).min(start + (MAX_SECS * rate as f32) as usize);
    let kept = &samples[start..end];
    if (kept.len() as f32) < MIN_SECS * rate as f32 {
        return Err(Problem::TooShort);
    }
    let gain = PEAK / peak;
    Ok(kept.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect())
}

/// How many samples at the start of `voiced` are much quieter than the rest
/// (`LEAD_IN_SHARE`), in half-second windows.
fn lead_in(voiced: &[f32], rate: u32) -> usize {
    let window = (rate as usize / 2).max(1);
    let rms: Vec<f32> = voiced
        .chunks(window)
        .map(|c| (c.iter().map(|s| s * s).sum::<f32>() / c.len() as f32).sqrt())
        .collect();
    let mut sorted = rms.clone();
    sorted.sort_by(f32::total_cmp);
    let median = sorted.get(sorted.len() / 2).copied().unwrap_or(0.0);
    let max_windows = (MAX_LEAD_IN_SECS * 2.0) as usize;
    let quiet = rms.iter().take(max_windows).take_while(|r| **r < median * LEAD_IN_SHARE).count();
    quiet * window
}

/// Keeps a new recording in place of the old one, or says why not.
pub fn save_sample(samples: &[f32], rate: u32) -> Result<std::result::Result<(), Problem>> {
    let prepared = match prepare(samples, rate) {
        Ok(p) => p,
        Err(problem) => return Ok(Err(problem)),
    };
    let path = sample_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let write = || -> std::result::Result<(), hound::Error> {
        let mut wav = hound::WavWriter::create(&path, spec)?;
        for s in &prepared {
            wav.write_sample((s * i16::MAX as f32) as i16)?;
        }
        wav.finalize()
    };
    write().map_err(|e| Error::Audio(format!("no se pudo guardar tu voz: {e}")))?;
    Ok(Ok(()))
}

pub fn delete_sample() -> Result<()> {
    match std::fs::remove_file(sample_path()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// The saved recording, as it is kept (`prepare`): mono samples and their rate.
pub fn saved_sample() -> Option<(Vec<f32>, u32)> {
    let mut wav = hound::WavReader::open(sample_path()).ok()?;
    let rate = wav.spec().sample_rate;
    let samples = wav.samples::<i16>().filter_map(|s| s.ok()).map(|s| s as f32 / i16::MAX as f32).collect();
    Some((samples, rate))
}

/// Pocket TTS with sherpa-onnx. The model and the recording stay loaded;
/// `release` frees them, `forget_sample` after a new recording.
#[derive(Default)]
pub struct OwnVoice {
    tts: tokio::sync::Mutex<Option<Arc<OfflineTts>>>,
    sample: tokio::sync::Mutex<Option<Arc<(Vec<f32>, u32)>>>,
    /// One sentence at a time, like the other voices.
    busy: tokio::sync::Mutex<()>,
}

impl OwnVoice {
    pub async fn release(&self) {
        self.tts.lock().await.take();
        self.forget_sample().await;
    }

    pub async fn forget_sample(&self) {
        self.sample.lock().await.take();
    }

    async fn tts(&self) -> Result<Arc<OfflineTts>> {
        let mut tts = self.tts.lock().await;
        if let Some(tts) = tts.as_ref() {
            return Ok(tts.clone());
        }
        let dir = model_dir();
        if !is_installed(&dir) {
            return Err(Error::Audio(format!("falta el modelo de tu voz en {}", dir.display())));
        }
        let t0 = std::time::Instant::now();
        let loaded = tauri::async_runtime::spawn_blocking(move || load(&dir))
            .await
            .map_err(|e| Error::Audio(format!("la carga de tu voz terminó mal: {e}")))??;
        tracing::info!("tu voz lista en {:?} ({THREADS} hilos)", t0.elapsed());
        *tts = Some(loaded.clone());
        Ok(loaded)
    }

    async fn sample(&self) -> Result<Arc<(Vec<f32>, u32)>> {
        let mut sample = self.sample.lock().await;
        if let Some(s) = sample.as_ref() {
            return Ok(s.clone());
        }
        let read = Arc::new(saved_sample().ok_or_else(|| Error::Audio("aún no has grabado tu voz".into()))?);
        *sample = Some(read.clone());
        Ok(read)
    }

    /// Says `text` in the user's voice. Returns mono float32 samples and their rate.
    pub async fn synthesize(&self, text: &str, speed: f32) -> Result<(Vec<f32>, u32)> {
        let _turn = self.busy.lock().await;
        let tts = self.tts().await?;
        let sample = self.sample().await?;
        let t0 = std::time::Instant::now();
        let chars = text.chars().count();
        let text = text.to_string();
        let audio = tauri::async_runtime::spawn_blocking(move || {
            // sherpa-onnx keeps the recording's embedding (`load`): only the
            // first sentence pays for it.
            let config = GenerationConfig {
                speed,
                reference_audio: Some(sample.0.clone()),
                reference_sample_rate: sample.1 as i32,
                extra: Some(std::collections::HashMap::from([("seed".to_string(), serde_json::json!(SEED))])),
                ..Default::default()
            };
            tts.generate_with_config(&text, &config, None::<fn(&[f32], f32) -> bool>)
                .map(|a| (a.samples().to_vec(), a.sample_rate() as u32))
        })
        .await
        .map_err(|e| Error::Audio(format!("tu voz terminó mal: {e}")))?
        .ok_or_else(|| Error::Audio("tu voz no generó audio".into()))?;
        let peak = audio.0.iter().fold(0f32, |m, s| m.max(s.abs()));
        let gain = if peak > 0.0 { (OUTPUT_PEAK / peak).min(MAX_OUTPUT_GAIN) } else { 1.0 };
        let audio = (audio.0.into_iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect::<Vec<f32>>(), audio.1);
        let took = t0.elapsed().as_secs_f32();
        let audio_secs = audio.0.len() as f32 / audio.1.max(1) as f32;
        tracing::info!(
            "tu voz: {chars} caracteres → {audio_secs:.1} s de audio en {took:.2} s ({:.2}× tiempo real) · velocidad {speed:.2}",
            took / audio_secs.max(0.01)
        );
        Ok(audio)
    }
}

fn load(dir: &Path) -> Result<Arc<OfflineTts>> {
    let path = |f: &str| Some(dir.join(f).to_string_lossy().into_owned());
    let mut config = OfflineTtsConfig::default();
    config.model.pocket = OfflineTtsPocketModelConfig {
        lm_flow: path(FILES[0]),
        lm_main: path(FILES[1]),
        encoder: path(FILES[2]),
        decoder: path(FILES[3]),
        text_conditioner: path(FILES[4]),
        vocab_json: path(FILES[5]),
        token_scores_json: path(FILES[6]),
        // One recording: its embedding is computed once and reused.
        voice_embedding_cache_capacity: 1,
    };
    config.model.num_threads = THREADS;
    OfflineTts::create(&config)
        .map(Arc::new)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar el modelo de tu voz de {}", dir.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn tone(secs: f32, amplitude: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize).map(|i| amplitude * (i as f32 * 0.05).sin()).collect()
    }

    #[test]
    fn brings_a_quiet_recording_up_and_trims_the_silence() {
        let mut samples = vec![0.0; RATE as usize];
        samples.extend(tone(10.0, 0.04));
        samples.extend(vec![0.0; 2 * RATE as usize]);
        let kept = prepare(&samples, RATE).unwrap();
        let peak = kept.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - PEAK).abs() < 0.01, "{peak}");
        assert!((kept.len() as f32 / RATE as f32 - 10.0).abs() < 0.05, "{}", kept.len());
    }

    #[test]
    fn drops_a_quiet_lead_in() {
        // Like a recording made in the app: 2 s ~8× quieter, then the voice.
        let mut samples = tone(2.0, 0.04);
        samples.extend(tone(12.0, 0.3));
        let kept = prepare(&samples, RATE).unwrap();
        assert!((kept.len() as f32 / RATE as f32 - 12.0).abs() < 0.1, "{}", kept.len());
    }

    #[test]
    fn refuses_silence_and_short_recordings() {
        assert_eq!(prepare(&tone(10.0, 0.001), RATE), Err(Problem::Silent));
        assert_eq!(prepare(&tone(5.0, 0.3), RATE), Err(Problem::TooShort));
    }

    #[test]
    fn cuts_long_recordings() {
        let kept = prepare(&tone(45.0, 0.3), RATE).unwrap();
        assert_eq!(kept.len(), (MAX_SECS * RATE as f32) as usize);
    }

    #[test]
    fn speaks_english_only_for_now() {
        assert!(speaks(Lang::En));
        assert!(!speaks(Lang::Es));
    }
}
