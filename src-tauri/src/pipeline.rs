//! Pipeline de traducción bidireccional.
//!
//! Dos direcciones independientes:
//! - `remote_to_local`: audio del sistema (BlackHole) → Whisper → traducción → TTS
//! - `local_to_remote`: micrófono → Whisper → traducción → TTS
//!
//! La traducción va por qwen en Groq o, si el carril lo pide, por HY-MT2 en
//! local (`translator.rs`).
//!
//! Cada etapa se mide por separado para que la UI muestre dónde se va el tiempo.

use crate::config::{Lang, Settings};
use crate::error::Result;
use crate::{groq::Groq, phonemizer, translator::LocalTranslator, tts};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    RemoteToLocal,
    LocalToRemote,
}

/// Transcripción de un trozo de audio. La traducción se pide aparte porque
/// la UI junta el final de una frase partida con el trozo siguiente antes de
/// traducir.
#[derive(Debug, Clone, Serialize)]
pub struct Transcription {
    pub direction: Direction,
    pub source_lang: Lang,
    pub target_lang: Lang,
    pub transcript: String,
    pub stt_ms: u64,
    /// El audio exacto que se envió a Whisper (WAV 16 kHz mono, base64), para
    /// que la UI permita escuchar qué se grabó.
    pub source_wav_base64: String,
    /// Duración del audio enviado a Whisper, en segundos.
    pub source_duration_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Translation {
    pub translation: String,
    pub translate_ms: u64,
}

/// Voz sintetizada para un fragmento de texto.
#[derive(Debug, Clone, Serialize)]
pub struct Speech {
    /// Muestras mono float32, listas para reproducir.
    pub audio: Vec<f32>,
    pub sample_rate: u32,
    pub phonemize_ms: u64,
    pub tts_ms: u64,
}

/// Codifica en base64 estándar (sin dependencias extra).
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

/// Devuelve (duración en segundos, pico absoluto) de un WAV PCM 16 bits.
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
    local: LocalTranslator,
}

impl Pipeline {
    pub fn new(settings: Arc<Settings>) -> Self {
        let groq = Groq::new(settings.groq_api_key.clone());
        let tts = tts::TtsEngine::new(settings.tts_model_dir.clone());
        let local = LocalTranslator::new(settings.translator_model.clone());
        Self { settings, groq, tts, local }
    }

    /// Carga el modelo de voz con una frase mínima, para que la primera frase
    /// real no pague la carga.
    pub async fn warm_up(&self) -> Result<()> {
        self.tts
            .synthesize("ˈola", tts::voice_for(Lang::Es, tts::Gender::Male).expect("Kokoro tiene español"), 1.0)
            .await
            .map(|_| ())
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    pub fn tts(&self) -> &tts::TtsEngine {
        &self.tts
    }

    pub fn local_translator(&self) -> &LocalTranslator {
        &self.local
    }

    /// Transcribe un trozo. `wav` es PCM 16 bits mono 16 kHz. Los idiomas los
    /// elige el usuario por carril; `prompt` es lo transcrito justo antes en
    /// este carril.
    pub async fn transcribe(
        &self,
        wav: Vec<u8>,
        direction: Direction,
        source: Lang,
        target: Lang,
        prompt: Option<&str>,
    ) -> Result<Transcription> {
        let t0 = std::time::Instant::now();

        // Whisper alucina frases cortas ("Gracias", "Thank you") cuando recibe
        // silencio. Se rechaza el audio sin señal antes de gastar una petición.
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

        // Diagnóstico: se guarda el último WAV de cada dirección para poder
        // escuchar exactamente lo que recibe Whisper.
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

    /// Traduce texto ya transcrito. `context` es el texto anterior del carril;
    /// `concise` pide una traducción condensada (modo rápido); `local` usa
    /// HY-MT2 en vez de Groq, sin contexto ni condensar (ver `translator.rs`);
    /// `on_delta` recibe la traducción a trozos según llega.
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

    /// Sintetiza la voz de un fragmento de texto. `speed` acelera la voz
    /// cuando la UI tiene frases en cola.
    /// Dice `text` con la voz elegida (`voice`: "kokoro:em_alex" o
    /// "system:<id>"); sin ella o si ya no está, con la mejor del género.
    pub async fn speak(&self, text: &str, lang: Lang, gender: tts::Gender, voice: Option<&str>, speed: f32) -> Result<Speech> {
        let speed = speed.clamp(0.8, 1.5);
        match voice.and_then(|v| v.split_once(':')) {
            Some(("kokoro", name)) => return self.speak_kokoro(text, lang, name, speed).await,
            Some(("system", id)) => match self.speak_system(crate::system_voice::synthesize_with(text, id, speed)).await {
                Ok(speech) => return Ok(speech),
                // Una voz que se desinstaló: sigue con la de por defecto.
                Err(e) => tracing::warn!("la voz elegida no funciona, se usa la de por defecto: {e}"),
            },
            _ => {}
        }
        match tts::voice_for(lang, gender) {
            Some(name) => self.speak_kokoro(text, lang, name, speed).await,
            None => self.speak_system(crate::system_voice::synthesize(text, lang, gender, speed)).await,
        }
    }

    async fn speak_kokoro(&self, text: &str, lang: Lang, voice: &str, speed: f32) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        let ipa = phonemizer::phonemize(&self.settings.espeak_bin, text, lang).await?;
        let phonemize_ms = t0.elapsed().as_millis() as u64;

        let t1 = std::time::Instant::now();
        let audio = self.tts.synthesize(&ipa, voice, speed).await?;
        Ok(Speech {
            audio,
            sample_rate: tts::SAMPLE_RATE,
            phonemize_ms,
            tts_ms: t1.elapsed().as_millis() as u64,
        })
    }

    async fn speak_system(&self, synthesis: impl std::future::Future<Output = Result<Vec<f32>>>) -> Result<Speech> {
        let t0 = std::time::Instant::now();
        let audio = synthesis.await?;
        Ok(Speech {
            audio,
            sample_rate: crate::system_voice::SAMPLE_RATE,
            phonemize_ms: 0,
            tts_ms: t0.elapsed().as_millis() as u64,
        })
    }
}

