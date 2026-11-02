//! The light voice: Piper voices through sherpa-onnx, for computers where the
//! natural voice (Supertonic, `tts.rs`) can't keep up. See
//! docs/plan-voz-ligera.md.
//!
//! Each Piper model is its own download (~67 MB) with one or a few speakers,
//! unlike Supertonic, which is one model with all its voices. sherpa-onnx 2.0
//! has no espeak-ng inside: the phonemes come from the app's own espeak-ng
//! (`phonemizer.rs`).

use crate::config::Lang;
use crate::error::{Error, Result};
use crate::tts::Gender;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsVitsModelConfig};
use std::path::PathBuf;
use std::sync::Arc;

/// Measured at 0.09× real time with 2 threads and 0.05× with 4 (x86 without
/// VNNI): 2 leave room for the listener, which runs at the same time.
const THREADS: i32 = 2;

/// A downloadable Piper model, as sherpa-onnx publishes it
/// (`tts-models/vits-piper-<name>.tar.bz2`).
#[derive(Debug, PartialEq, Eq)]
pub struct PiperModel {
    /// Name in the Piper catalogue ("es_ES-sharvard-medium").
    pub name: &'static str,
    /// Download id for `models.rs` and the UI ("piper:es_ES-sharvard-medium").
    pub id: &'static str,
    /// Folder in the archive and in the models folder.
    pub folder: &'static str,
    /// Size of the archive.
    pub bytes: u64,
    /// The licence of the voice (of its recordings), for Credits.
    pub license: &'static str,
}

macro_rules! model {
    ($name:literal, $bytes:literal, $license:literal) => {
        PiperModel {
            name: $name,
            id: concat!("piper:", $name),
            folder: concat!("vits-piper-", $name),
            bytes: $bytes,
            license: $license,
        }
    };
}

// Only voices whose licence allows commercial use. Gender measured by pitch
// (2026-11-03): women 172–208 Hz, men 91–143 Hz.
static ES_SHARVARD: PiperModel = model!("es_ES-sharvard-medium", 80_318_184, "CC BY 3.0");
static ES_DAVEFX: PiperModel = model!("es_ES-davefx-medium", 67_184_952, "CC0");
static ES_CLAUDE: PiperModel = model!("es_MX-claude-high", 67_207_890, "Apache 2.0");
static ES_ALD: PiperModel = model!("es_MX-ald-medium", 67_196_497, "Unlicense");
static ES_DANIELA: PiperModel = model!("es_AR-daniela-high", 115_562_134, "CC BY-SA 4.0");
static EN_LJSPEECH: PiperModel = model!("en_US-ljspeech-medium", 67_169_893, "Public domain");
static EN_KRISTIN: PiperModel = model!("en_US-kristin-medium", 67_259_230, "Public domain");
static EN_CORI: PiperModel = model!("en_GB-cori-medium", 67_257_412, "Public domain");
static EN_JOHN: PiperModel = model!("en_US-john-medium", 67_249_181, "Public domain");
static EN_NORMAN: PiperModel = model!("en_US-norman-medium", 67_203_672, "Public domain");
static EN_JOE: PiperModel = model!("en_US-joe-medium", 67_169_394, "CC0");

pub static MODELS: &[&PiperModel] = &[
    &ES_SHARVARD,
    &ES_DAVEFX,
    &ES_CLAUDE,
    &ES_ALD,
    &ES_DANIELA,
    &EN_LJSPEECH,
    &EN_KRISTIN,
    &EN_CORI,
    &EN_JOHN,
    &EN_NORMAN,
    &EN_JOE,
];

/// A voice: one speaker of a model.
#[derive(Debug)]
pub struct PiperVoice {
    /// What `speak` gets: "piper:<model name>:<speaker>".
    pub id: &'static str,
    pub model: &'static PiperModel,
    pub speaker: i32,
    pub lang: Lang,
    pub gender: Gender,
    /// The name the UI shows.
    pub name: &'static str,
    /// BCP-47 tag: the UI names the country (`system_voice::region`).
    pub tag: &'static str,
}

macro_rules! voice {
    ($model:ident, $name:literal, $speaker:literal, $lang:ident, $gender:ident, $voice:literal, $tag:literal) => {
        PiperVoice {
            id: concat!("piper:", $name, ":", $speaker),
            model: &$model,
            speaker: $speaker,
            lang: Lang::$lang,
            gender: Gender::$gender,
            name: $voice,
            tag: $tag,
        }
    };
}

/// The voices of each language, the default first for each gender. Sharvard
/// comes first: one download gives a woman's and a man's voice.
pub static VOICES: &[PiperVoice] = &[
    voice!(ES_SHARVARD, "es_ES-sharvard-medium", 1, Es, Female, "Sharvard", "es-ES"),
    voice!(ES_SHARVARD, "es_ES-sharvard-medium", 0, Es, Male, "Sharvard", "es-ES"),
    voice!(ES_CLAUDE, "es_MX-claude-high", 0, Es, Female, "Claude", "es-MX"),
    voice!(ES_DANIELA, "es_AR-daniela-high", 0, Es, Female, "Daniela", "es-AR"),
    voice!(ES_DAVEFX, "es_ES-davefx-medium", 0, Es, Male, "Davefx", "es-ES"),
    voice!(ES_ALD, "es_MX-ald-medium", 0, Es, Male, "Ald", "es-MX"),
    voice!(EN_LJSPEECH, "en_US-ljspeech-medium", 0, En, Female, "LJ", "en-US"),
    voice!(EN_KRISTIN, "en_US-kristin-medium", 0, En, Female, "Kristin", "en-US"),
    voice!(EN_CORI, "en_GB-cori-medium", 0, En, Female, "Cori", "en-GB"),
    voice!(EN_JOHN, "en_US-john-medium", 0, En, Male, "John", "en-US"),
    voice!(EN_NORMAN, "en_US-norman-medium", 0, En, Male, "Norman", "en-US"),
    voice!(EN_JOE, "en_US-joe-medium", 0, En, Male, "Joe", "en-US"),
];

/// The voice with this id ("piper:es_ES-sharvard-medium:1").
pub fn voice(id: &str) -> Option<&'static PiperVoice> {
    VOICES.iter().find(|v| v.id == id)
}

/// The catalogue's voices for the language, in order of preference.
pub fn voices(lang: Lang) -> impl Iterator<Item = &'static PiperVoice> {
    VOICES.iter().filter(move |v| v.lang == lang)
}

pub fn dir(model: &PiperModel) -> PathBuf {
    crate::config::models_dir().join(model.folder)
}

/// The files the engine needs, relative to the models folder (as `tar` lists
/// them): the archive also brings an espeak-ng-data that isn't used.
pub fn files(model: &PiperModel) -> [String; 3] {
    let (folder, name) = (model.folder, model.name);
    [format!("{folder}/{name}.onnx"), format!("{folder}/{name}.onnx.json"), format!("{folder}/tokens.txt")]
}

pub fn is_installed(model: &PiperModel) -> bool {
    let base = crate::config::models_dir();
    files(model).iter().all(|f| base.join(f).exists())
}

/// The installed voice to use for the language: of the gender if there is one,
/// if not of the other.
pub fn default_voice(lang: Lang, gender: Gender) -> Option<&'static PiperVoice> {
    let installed = || voices(lang).filter(|v| is_installed(v.model));
    installed().find(|v| v.gender == gender).or_else(|| installed().next())
}

/// Piper with sherpa-onnx. The last voice used stays loaded; `release` frees it.
pub struct PiperEngine {
    espeak_bin: String,
    loaded: tokio::sync::Mutex<Option<(&'static str, Arc<OfflineTts>)>>,
    /// One sentence at a time, like the natural voice (`tts.rs`).
    busy: tokio::sync::Mutex<()>,
}

impl PiperEngine {
    pub fn new(espeak_bin: String) -> Self {
        Self { espeak_bin, loaded: Default::default(), busy: Default::default() }
    }

    pub async fn release(&self) {
        self.loaded.lock().await.take();
    }

    async fn tts(&self, model: &'static PiperModel) -> Result<Arc<OfflineTts>> {
        let mut loaded = self.loaded.lock().await;
        if let Some((name, tts)) = loaded.as_ref() {
            if *name == model.name {
                return Ok(tts.clone());
            }
        }
        if !is_installed(model) {
            return Err(Error::Audio(format!("falta la voz {} en {}", model.name, dir(model).display())));
        }
        let t0 = std::time::Instant::now();
        let tts = tauri::async_runtime::spawn_blocking(move || load(model))
            .await
            .map_err(|e| Error::Audio(format!("la carga de la voz ligera terminó mal: {e}")))??;
        tracing::info!("voz ligera {} lista en {:?} ({THREADS} hilos)", model.name, t0.elapsed());
        *loaded = Some((model.name, tts.clone()));
        Ok(tts)
    }

    /// Says `text` with `voice`. Returns mono float32 samples and their rate.
    /// `speed` > 1 speeds the voice up.
    pub async fn synthesize(&self, voice: &'static PiperVoice, text: &str, speed: f32) -> Result<(Vec<f32>, u32)> {
        let t0 = std::time::Instant::now();
        let _turn = self.busy.lock().await;
        let queued = t0.elapsed();
        let tts = self.tts(voice.model).await?;
        let t1 = std::time::Instant::now();
        let phonemes = phonemes(&self.espeak_bin, text, voice.lang).await?;
        let phonemize = t1.elapsed();
        let t2 = std::time::Instant::now();
        let speaker = voice.speaker;
        let audio = tauri::async_runtime::spawn_blocking(move || {
            let config = GenerationConfig { sid: speaker, speed, phoneme_codepoints: Some(phonemes), ..Default::default() };
            tts.generate_with_config("", &config, None::<fn(&[f32], f32) -> bool>)
                .map(|a| (a.samples().to_vec(), a.sample_rate() as u32))
        })
        .await
        .map_err(|e| Error::Audio(format!("la voz ligera terminó mal: {e}")))?
        .ok_or_else(|| Error::Audio("la voz ligera no generó audio".into()))?;
        let took = t2.elapsed().as_secs_f32();
        let audio_secs = audio.0.len() as f32 / audio.1.max(1) as f32;
        tracing::info!(
            "voz ligera: {} caracteres → {audio_secs:.1} s de audio en {took:.2} s ({:.2}× tiempo real) · fonemas {:.2} s · cola {:.2} s · velocidad {speed:.2}",
            text.chars().count(),
            took / audio_secs.max(0.01),
            phonemize.as_secs_f32(),
            queued.as_secs_f32(),
        );
        Ok(audio)
    }
}

fn load(model: &PiperModel) -> Result<Arc<OfflineTts>> {
    let path = |f: String| Some(crate::config::models_dir().join(f).to_string_lossy().into_owned());
    let [onnx, _, tokens] = files(model);
    let mut config = OfflineTtsConfig::default();
    config.model.vits = OfflineTtsVitsModelConfig { model: path(onnx), tokens: path(tokens), ..Default::default() };
    config.model.num_threads = THREADS;
    OfflineTts::create(&config)
        .map(Arc::new)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar la voz {}", model.name)))
}

/// Piper's own frontend phonemizes clause by clause and keeps the punctuation,
/// which shapes the pauses and the intonation. `espeak-ng --ipa` drops it, so
/// the text is split here and each mark put back. One list per sentence.
async fn phonemes(bin: &str, text: &str, lang: Lang) -> Result<Vec<Vec<i32>>> {
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();
    for (clause, mark) in clauses(text) {
        let ipa = crate::phonemizer::phonemize(bin, clause, lang).await?;
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&ipa.split_whitespace().collect::<Vec<_>>().join(" "));
        if let Some(mark) = mark {
            current.push(mark);
            if matches!(mark, '.' | '!' | '?') {
                sentences.push(std::mem::take(&mut current));
            }
        }
    }
    if !current.is_empty() {
        sentences.push(current);
    }
    if sentences.is_empty() {
        return Err(Error::Audio("no hay nada que decir".into()));
    }
    Ok(sentences.into_iter().map(|s| s.chars().map(|c| c as i32).collect()).collect())
}

/// Splits `text` at clause punctuation followed by a space or the end (so
/// "3.5" stays whole), with the mark of each clause ("…" counts as "."). Pieces
/// with nothing to say ("¿", "--") are left out.
fn clauses(text: &str) -> Vec<(&str, Option<char>)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let mark = match c {
            ',' | ';' | ':' | '.' | '!' | '?' => c,
            '…' => '.',
            _ => continue,
        };
        if chars.peek().is_some_and(|(_, next)| !next.is_whitespace()) {
            continue;
        }
        out.push((&text[start..i], Some(mark)));
        start = i + c.len_utf8();
    }
    out.push((&text[start..], None));
    out.into_iter()
        .map(|(clause, mark)| (clause.trim(), mark))
        .filter(|(clause, _)| clause.chars().any(char::is_alphanumeric))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_clauses_and_keeps_numbers() {
        assert_eq!(
            clauses("Hola, son las 3.5 de la tarde… ¿Vienes? Sí"),
            [("Hola", Some(',')), ("son las 3.5 de la tarde", Some('.')), ("¿Vienes", Some('?')), ("Sí", None)]
        );
        assert_eq!(clauses("¡Vale! -- "), [("¡Vale", Some('!'))]);
    }

    #[test]
    fn catalogue_ids_match_their_models() {
        for v in VOICES {
            assert_eq!(v.id, format!("piper:{}:{}", v.model.name, v.speaker));
            assert!(MODELS.contains(&v.model), "{} no está en MODELS", v.model.name);
            assert!(v.model.name.starts_with(v.tag.replace('-', "_").as_str()), "{}", v.id);
        }
        for m in MODELS {
            assert!(VOICES.iter().any(|v| v.model == *m), "{} sin voces", m.name);
        }
    }

    /// Downloads one light voice (~80 MB) into the real models folder, as
    /// the voice menu does, and checks it is installed.
    #[tokio::test]
    #[ignore]
    async fn downloads_a_light_voice() {
        let settings = crate::config::Settings::from_env_fallback();
        crate::models::download(crate::models::Model::Piper(&ES_SHARVARD), &settings, &|_, _| {}).await.unwrap();
        assert!(is_installed(&ES_SHARVARD));
        assert!(!dir(&ES_SHARVARD).join("espeak-ng-data").exists());
    }

    /// Says a sentence with every installed catalogue voice and writes the WAVs
    /// to the temp folder, to listen to them. Uses the espeak-ng on the PATH.
    #[tokio::test]
    #[ignore]
    async fn speaks_with_piper() {
        let engine = PiperEngine::new("espeak-ng".into());
        for v in VOICES.iter().filter(|v| is_installed(v.model)) {
            let text = match v.lang {
                Lang::Es => "Hola, esto es una prueba de la voz ligera. ¿Se entiende bien?",
                _ => "Hello, this is a test of the light voice. Is it clear?",
            };
            let (audio, rate) = engine.synthesize(v, text, 1.0).await.unwrap();
            assert!(audio.len() > rate as usize, "{}", v.id);
            let out = std::env::temp_dir().join(format!("lingora-{}-{}.wav", v.model.name, v.speaker));
            let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let mut wav = hound::WavWriter::create(&out, spec).unwrap();
            audio.iter().for_each(|s| wav.write_sample(*s).unwrap());
            wav.finalize().unwrap();
            eprintln!("{} → {}", v.id, out.display());
        }
    }
}
