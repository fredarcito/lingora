//! Two-way translation pipeline.
//!
//! Two independent directions:
//! - `remote_to_local`: system audio (BlackHole) → Whisper → translation → TTS
//! - `local_to_remote`: microphone → Whisper → translation → TTS
//!
//! Translation goes through qwen on Groq or, if the lane asks for it, through
//! Index-Translate locally (`translator.rs`).
//!
//! Each stage is timed separately so the UI shows where the time goes.

use crate::config::{Lang, Settings};
use crate::error::Result;
use crate::{groq::Groq, own_voice, piper, translator::LocalTranslator, tts};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    RemoteToLocal,
    LocalToRemote,
}

/// Transcription of a chunk of audio. The translation is requested separately
/// because the UI joins the end of a split sentence with the next chunk before
/// translating.
#[derive(Debug, Clone, Serialize)]
pub struct Transcription {
    pub direction: Direction,
    pub source_lang: Lang,
    pub target_lang: Lang,
    pub transcript: String,
    pub stt_ms: u64,
    /// The exact audio sent to Whisper (WAV 16 kHz mono, base64), so
    /// the UI can let the user hear what was recorded.
    pub source_wav_base64: String,
    /// Duration of the audio sent to Whisper, in seconds.
    pub source_duration_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Translation {
    pub translation: String,
    pub translate_ms: u64,
}

/// Synthesized voice for a fragment of text.
#[derive(Debug, Clone, Serialize)]
pub struct Speech {
    /// Mono float32 samples, ready to play.
    pub audio: Vec<f32>,
    pub sample_rate: u32,
    pub phonemize_ms: u64,
    pub tts_ms: u64,
}

impl Speech {
    /// Raw for the UI (`speak` in api.js): sample rate and synthesis time in ms
    /// (u32 LE), then the samples (f32 LE). As JSON, 8 s of voice at 44.1 kHz
    /// were ~7 MB of text to write and parse.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + self.audio.len() * 4);
        out.extend_from_slice(&self.sample_rate.to_le_bytes());
        out.extend_from_slice(&(self.tts_ms.min(u32::MAX as u64) as u32).to_le_bytes());
        out.extend(self.audio.iter().flat_map(|v| v.to_le_bytes()));
        out
    }
}

/// Encodes in standard base64 (no extra dependencies).
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Returns (duration in seconds, absolute peak) of a 16-bit PCM WAV.
fn wav_level(wav: &[u8]) -> Result<(f64, f32)> {
    let mut reader = hound::WavReader::new(std::io::Cursor::new(wav))
        .map_err(|e| crate::error::Error::Audio(format!("WAV inválido: {e}")))?;
    let spec = reader.spec();
    let mut peak: f32 = 0.0;
    let mut count: u64 = 0;
    for s in reader.samples::<i16>() {
        let v = s.map_err(|e| crate::error::Error::Audio(format!("muestras inválidas: {e}")))?;
        peak = peak.max((v as f32 / 32768.0).abs());
        count += 1;
    }
    let frames = count as f64 / spec.channels.max(1) as f64;
    Ok((frames / spec.sample_rate.max(1) as f64, peak))
}

pub struct Pipeline {
    settings: Arc<Settings>,
    groq: Groq,
    tts: tts::TtsEngine,
    /// The light voice (Piper), for low-end computers: docs/plan-voz-ligera.md.
    piper: piper::PiperEngine,
    /// The user's own voice, for Speak in a call: docs/plan-tu-voz.md.
    own: own_voice::OwnVoice,
    /// The last sentence was said with the natural voice (Supertonic).
    natural_last: std::sync::atomic::AtomicBool,
    local: LocalTranslator,
}

impl Pipeline {
    pub fn new(settings: Arc<Settings>) -> Self {
        let groq = Groq::new(settings.groq_api_key.clone());
        let tts = tts::TtsEngine::new(settings.tts_model_dir.clone());
        let local = LocalTranslator::new(settings.translator_model.clone());
        let piper = piper::PiperEngine::new(settings.espeak_bin.clone());
        Self { settings, groq, tts, piper, own: Default::default(), natural_last: Default::default(), local }
    }

    /// Loads the voice model with a minimal sentence, so the first real
    /// sentence does not pay for the load.
    pub async fn warm_up(&self) -> Result<()> {
        // A low-end computer uses the light voice, which loads in well under a
        // second: loading the natural one would only take memory and CPU.
        if crate::perf::light_device() {
            return Ok(());
        }
        self.tts
            .synthesize("Hola.", Lang::Es, tts::voice_for(Lang::Es, tts::Gender::Male).expect("Supertonic habla español"), 1.0, tts::STEPS)
            .await
            .map(|_| ())
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// The natural voice is in use and can't keep up on this computer: the UI
    /// suggests the light one.
    pub fn voice_struggling(&self) -> bool {
        self.natural_last.load(std::sync::atomic::Ordering::Relaxed) && self.tts.struggling()
    }

    /// Frees both voice models; they load again on the next sentence.
    pub async fn release_voices(&self) {
        self.tts.release().await;
        self.piper.release().await;
        self.own.release().await;
    }

    pub fn own_voice(&self) -> &own_voice::OwnVoice {
        &self.own
    }

    pub fn local_translator(&self) -> &LocalTranslator {
        &self.local
    }

    /// Transcribes a chunk. `wav` is 16-bit PCM mono 16 kHz. The languages are
    /// chosen by the user per lane; `prompt` is what was transcribed just before
    /// on this lane.
    pub async fn transcribe(
        &self,
        wav: Vec<u8>,
        direction: Direction,
        source: Lang,
        target: Lang,
        prompt: Option<&str>,
    ) -> Result<Transcription> {
        let t0 = std::time::Instant::now();

        // Whisper hallucinates short phrases ("Gracias", "Thank you") when it gets
        // silence. Audio with no signal is rejected before spending a request.
        let (duration_secs, peak) = wav_level(&wav)?;
        let source_wav_base64 = base64_encode(&wav);
        if duration_secs < 0.5 {
            return Err(crate::error::Error::Audio(format!(
                "audio demasiado corto ({duration_secs:.2} s)"
            )));
        }
        if peak < 0.005 {
            return Err(crate::error::Error::Audio(format!(
                "el audio está en silencio (pico {peak:.4}, {duration_secs:.1} s). \
                 Revisa que la salida del sistema sea la salida múltiple \"Lingora\" \
                 y que el dispositivo de entrada tenga señal."
            )));
        }

        tracing::info!(
            "audio recibido: {duration_secs:.2} s, pico {peak:.4} (dirección {:?})",
            direction
        );

        // Diagnostics: the last WAV of each direction is saved to be able to
        // hear exactly what Whisper receives.
        let dump = std::env::temp_dir().join(format!("lingora-{direction:?}.wav"));
        if let Err(e) = std::fs::write(&dump, &wav) {
            tracing::warn!("no se pudo guardar {}: {e}", dump.display());
        }

        let transcript = self
            .groq
            .transcribe(wav, source, &self.settings.stt_model, prompt)
            .await?;
        tracing::info!("transcripción ({duration_secs:.2} s de audio): {transcript}");

        Ok(Transcription {
            direction,
            source_lang: source,
            target_lang: target,
            transcript,
            stt_ms: t0.elapsed().as_millis() as u64,
            source_wav_base64,
            source_duration_secs: duration_secs,
        })
    }

    /// Translates text already transcribed. `context` is the lane's previous text;
    /// `concise` asks for a condensed translation (fast mode); `local` uses
    /// the local model instead of Groq, with no context or condensing (see `translator.rs`);
    /// `on_delta` receives the translation in chunks as it arrives.
    pub async fn translate(
        &self,
        text: &str,
        source: Lang,
        target: Lang,
        context: Option<&str>,
        concise: bool,
        local: bool,
        on_delta: impl FnMut(&str),
    ) -> Result<Translation> {
        let t0 = std::time::Instant::now();
        let translation = if local {
            self.local.translate(text, source, target, on_delta).await?
        } else {
            self.groq
                .translate(text, source, target, &self.settings.translation_model, context, concise, on_delta)
                .await?
        };
        Ok(Translation {
            translation,
            translate_ms: t0.elapsed().as_millis() as u64,
        })
    }

    /// Synthesizes the voice of a fragment of text. `speed` speeds up the voice
    /// when the UI has sentences queued.
    /// Says `text` with the chosen voice (`voice`: "supertonic:5",
    /// "piper:<model>:<speaker>", "system:<id>" or "own", your voice); without one
    /// or if it is gone, with the best of the gender.
    /// Old "kokoro:*" ids saved before Supertonic fall through to the default.
    /// `hq` uses more steps: a slightly slower, higher-quality voice.
    pub async fn speak(&self, text: &str, lang: Lang, gender: tts::Gender, voice: Option<&str>, speed: f32, hq: bool) -> Result<Speech> {
        let speed = speed.clamp(0.8, 1.5);
        // Your voice only speaks some languages; in the rest, the default voice.
        if voice == Some(own_voice::ID) && own_voice::speaks(lang) && own_voice::is_installed(&own_voice::model_dir()) && own_voice::has_sample() {
            return self.speak_own(text, speed).await;
        }
        match voice.and_then(|v| v.split_once(':')) {
            Some(("supertonic", sid)) if tts::voice_for(lang, gender).is_some() => {
                if let Ok(sid) = sid.parse() {
                    return self.speak_supertonic(text, lang, sid, speed, hq).await;
                }
            }
            Some(("piper", _)) => {
                if let Some(v) = voice.and_then(piper::voice).filter(|v| piper::is_installed(v.model())) {
                    return self.speak_piper(text, v, speed).await;
                }
            }
            Some(("system", id)) => match self.speak_system(crate::system_voice::synthesize_with(text, id, speed)).await {
                Ok(speech) => return Ok(speech),
                // A voice that was uninstalled: it goes on with the default one.
                Err(e) => tracing::warn!("la voz elegida no funciona, se usa la de por defecto: {e}"),
            },
            _ => {}
        }
        // Without a choice: the natural voice, unless this is a low-end
        // computer with a light voice downloaded; then the light voice, and
        // last the system's.
        let natural = tts::voice_for(lang, gender).filter(|_| tts::TtsEngine::is_installed(&self.settings.tts_model_dir));
        let light = piper::default_voice(lang, gender);
        match (natural, light) {
            (Some(sid), None) => self.speak_supertonic(text, lang, sid, speed, hq).await,
            (Some(sid), Some(_)) if !crate::perf::light_device() => self.speak_supertonic(text, lang, sid, speed, hq).await,
            (_, Some(v)) => self.speak_piper(text, v, speed).await,
            (None, None) => self.speak_system(crate::system_voice::synthesize(text, lang, gender, speed)).await,
        }
    }

    async fn speak_own(&self, text: &str, speed: f32) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        self.natural_last.store(false, std::sync::atomic::Ordering::Relaxed);
        let (audio, sample_rate) = self.own.synthesize(text, speed).await?;
        Ok(Speech { audio, sample_rate, phonemize_ms: 0, tts_ms: t0.elapsed().as_millis() as u64 })
    }

    async fn speak_piper(&self, text: &str, voice: &'static piper::PiperVoice, speed: f32) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        self.natural_last.store(false, std::sync::atomic::Ordering::Relaxed);
        let (audio, sample_rate) = self.piper.synthesize(voice, text, speed).await?;
        Ok(Speech { audio, sample_rate, phonemize_ms: 0, tts_ms: t0.elapsed().as_millis() as u64 })
    }

    async fn speak_supertonic(&self, text: &str, lang: Lang, sid: i32, speed: f32, hq: bool) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        let steps = if hq { tts::STEPS_HQ } else { tts::STEPS };
        self.natural_last.store(true, std::sync::atomic::Ordering::Relaxed);
        let audio = self.tts.synthesize(text, lang, sid, speed, steps).await?;
        Ok(Speech {
            audio,
            sample_rate: tts::SAMPLE_RATE,
            phonemize_ms: 0,
            tts_ms: t0.elapsed().as_millis() as u64,
        })
    }

    async fn speak_system(&self, synthesis: impl std::future::Future<Output = Result<Vec<f32>>>) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        self.natural_last.store(false, std::sync::atomic::Ordering::Relaxed);
        let audio = synthesis.await?;
        Ok(Speech {
            audio,
            sample_rate: crate::system_voice::SAMPLE_RATE,
            phonemize_ms: 0,
            tts_ms: t0.elapsed().as_millis() as u64,
        })
    }
}

