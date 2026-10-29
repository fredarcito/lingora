use crate::config::Lang;
use crate::error::{Error, Result};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Voz femenina o masculina; la elige el usuario por carril.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Female,
    Male,
}

/// Voz de Kokoro por idioma y género, o `None` si Kokoro no tiene voz para
/// el idioma (se usa la del sistema). Sin voz de hombre (francés) se usa la de
/// mujer. Todas vienen en `voices.bin` (ver `VOICES`).
pub fn voice_for(lang: Lang, gender: Gender) -> Option<&'static str> {
    let (female, male) = lang.info().kokoro?;
    Some(match gender {
        Gender::Male => male.unwrap_or(female),
        Gender::Female => female,
    })
}

/// Modelo de Kokoro para sherpa-onnx (descarga en `download`).
pub const MODEL_NAME: &str = "kokoro-multi-lang-v1_0";
const MODEL_FILE: &str = "model.onnx";
/// Del archivo de sherpa-onnx solo hacen falta estos: los fonemas los da
/// espeak-ng (`phonemizer.rs`), así que sobran sus diccionarios.
pub const FILES: &[&str] = &[MODEL_FILE, "voices.bin", "tokens.txt"];

/// Frecuencia del audio que devuelve Kokoro.
pub const SAMPLE_RATE: u32 = 24_000;

/// Voces de Kokoro y su posición en `voices.bin` (comprobada contra las de
/// `kokoro-js`). La primera letra es el idioma (a: inglés de EE. UU., b:
/// británico, e: español, f: francés, i: italiano, p: portugués de Brasil) y
/// la segunda el género. En cada idioma van de mejor a peor según las notas
/// del propio Kokoro. Faltan las de Santa (de broma) y las de idiomas cuyos
/// fonemas no da bien espeak-ng (hindi, japonés, chino).
const VOICES: &[(&str, i32)] = &[
    ("af_heart", 3),
    ("af_bella", 2),
    ("af_nicole", 6),
    ("af_aoede", 1),
    ("af_kore", 5),
    ("af_sarah", 9),
    ("af_nova", 7),
    ("af_alloy", 0),
    ("af_sky", 10),
    ("af_jessica", 4),
    ("af_river", 8),
    ("am_michael", 16),
    ("am_fenrir", 14),
    ("am_puck", 18),
    ("am_echo", 12),
    ("am_eric", 13),
    ("am_liam", 15),
    ("am_onyx", 17),
    ("am_adam", 11),
    ("bf_emma", 21),
    ("bf_isabella", 22),
    ("bf_alice", 20),
    ("bf_lily", 23),
    ("bm_george", 26),
    ("bm_fable", 25),
    ("bm_lewis", 27),
    ("bm_daniel", 24),
    ("ef_dora", 28),
    ("em_alex", 29),
    ("ff_siwis", 30),
    ("if_sara", 35),
    ("im_nicola", 36),
    ("pf_dora", 42),
    ("pm_alex", 43),
];

/// Una voz de Kokoro para la UI.
pub struct KokoroVoice {
    pub id: &'static str,
    /// "Heart", "Dora"…
    pub name: String,
    pub gender: Gender,
    /// Solo en inglés, donde hay voces de EE. UU. y británicas.
    pub region: Option<&'static str>,
}

/// Las voces de Kokoro del idioma, de mejor a peor.
pub fn voices(lang: Lang) -> Vec<KokoroVoice> {
    let prefixes: &[char] = match lang.info().code {
        "en" => &['a', 'b'],
        "es" => &['e'],
        "fr" => &['f'],
        "it" => &['i'],
        "pt" => &['p'],
        _ => &[],
    };
    VOICES
        .iter()
        .filter(|(id, _)| id.starts_with(prefixes))
        .map(|(id, _)| {
            let raw = &id[3..];
            KokoroVoice {
                id,
                name: raw[..1].to_uppercase() + &raw[1..],
                gender: if id.as_bytes()[1] == b'm' { Gender::Male } else { Gender::Female },
                region: match id.as_bytes()[0] {
                    b'a' => Some("EE. UU."),
                    b'b' => Some("Reino Unido"),
                    _ => None,
                },
            }
        })
        .collect()
}

// Margen respecto al límite de 510 tokens (aprox. un token por carácter IPA).
const MAX_CHUNK_CHARS: usize = 400;
const PAUSE_SECS: f32 = 0.15;

/// Kokoro dentro del proceso, con sherpa-onnx (la misma librería que escucha).
/// El modelo se carga en la primera frase y se libera con `release`.
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
        let tts = tauri::async_runtime::spawn_blocking(move || load(&dir, MODEL_FILE))
            .await
            .map_err(|e| Error::Audio(format!("la carga del modelo de voz terminó mal: {e}")))??;
        *loaded = Some(tts.clone());
        Ok(tts)
    }

    /// Libera el modelo; se vuelve a cargar en la siguiente frase.
    pub async fn release(&self) {
        self.loaded.lock().await.take();
    }

    /// Sintetiza voz a partir de fonemas IPA. Devuelve muestras mono float32 a
    /// `SAMPLE_RATE`. `speed` > 1 acelera la voz (se usa cuando hay frases en cola).
    pub async fn synthesize(&self, ipa: &str, voice: &str, speed: f32) -> Result<Vec<f32>> {
        let sid = speaker(voice)?;
        let _turn = self.busy.lock().await;
        let tts = self.tts().await?;
        let ipa = ipa.to_string();
        tauri::async_runtime::spawn_blocking(move || generate(&tts, &ipa, sid, speed))
            .await
            .map_err(|e| Error::Audio(format!("la voz terminó mal: {e}")))?
    }
}

fn speaker(voice: &str) -> Result<i32> {
    VOICES
        .iter()
        .find(|(name, _)| *name == voice)
        .map(|(_, sid)| *sid)
        .ok_or_else(|| Error::Audio(format!("voz desconocida: {voice}")))
}

fn load(dir: &Path, model_file: &str) -> Result<Arc<OfflineTts>> {
    let path = |f: &str| Some(dir.join(f).to_string_lossy().into_owned());
    // Sin tocar los silencios del modelo (1 = tal cual): con el valor por
    // defecto sherpa-onnx los recorta y la voz suena atropellada, con las
    // palabras cortadas al final.
    let mut config = OfflineTtsConfig { silence_scale: 1.0, max_num_sentences: 1, ..Default::default() };
    config.model.kokoro =
        OfflineTtsKokoroModelConfig { model: path(model_file), voices: path("voices.bin"), tokens: path("tokens.txt"), ..Default::default() };
    // Con 2 hilos tarda el doble (2,6 s frente a 1,5 s para 7 s de voz) y la
    // voz es lo que más se nota que llega tarde.
    config.model.num_threads = 4;
    let t0 = std::time::Instant::now();
    let tts = OfflineTts::create(&config)
        .ok_or_else(|| Error::Audio(format!("no se pudo cargar el modelo de voz de {}", dir.display())))?;
    tracing::info!("voz local lista en {:?}", t0.elapsed());
    Ok(Arc::new(tts))
}

/// Kokoro admite unos 510 tokens por llamada y descarta el resto en silencio,
/// lo que cortaba las traducciones largas a mitad: se sintetiza por trozos
/// con una pausa breve entre ellos.
fn generate(tts: &OfflineTts, ipa: &str, sid: i32, speed: f32) -> Result<Vec<f32>> {
    let config = GenerationConfig { sid, speed, silence_scale: 1.0, ..Default::default() };
    let pause = vec![0.0; (SAMPLE_RATE as f32 * PAUSE_SECS) as usize];
    let mut out = Vec::new();
    for chunk in chunk_clauses(ipa) {
        let config = GenerationConfig { phoneme_codepoints: Some(vec![chunk.chars().map(|c| c as i32).collect()]), ..config.clone() };
        let audio = tts
            .generate_with_config("", &config, None::<fn(&[f32], f32) -> bool>)
            .ok_or_else(|| Error::Audio("la voz no generó audio".into()))?;
        out.extend_from_slice(audio.samples());
        out.extend_from_slice(&pause);
    }
    Ok(out)
}

/// Agrupa cláusulas (una por línea, como las da espeak-ng) en trozos que caben
/// en una llamada a Kokoro. Una cláusula demasiado larga se parte por palabras.
fn chunk_clauses(ipa: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    for line in ipa.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if line.chars().count() <= MAX_CHUNK_CHARS {
            pieces.push(line.to_string());
            continue;
        }
        let mut current = String::new();
        for word in line.split(' ') {
            if !current.is_empty() && current.chars().count() + 1 + word.chars().count() > MAX_CHUNK_CHARS {
                pieces.push(std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            pieces.push(current);
        }
    }
    pieces
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
    fn every_voice_has_a_speaker() {
        for lang in Lang::all() {
            if let Some((female, male)) = lang.info().kokoro {
                assert!(speaker(female).is_ok() && male.map_or(true, |m| speaker(m).is_ok()), "{lang:?}");
            }
        }
    }

    #[test]
    fn lists_voices_by_language() {
        let es = voices(Lang::Es);
        assert_eq!(es.iter().map(|v| v.id).collect::<Vec<_>>(), ["ef_dora", "em_alex"]);
        assert_eq!((es[1].name.as_str(), es[1].gender), ("Alex", Gender::Male));
        assert!(voices(Lang::En).iter().any(|v| v.id == "bm_george" && v.region == Some("Reino Unido")));
        assert!(voices(Lang::Zh).is_empty());
    }

    #[test]
    fn long_clauses_are_split_by_words() {
        let long = "ab ".repeat(300);
        let chunks = chunk_clauses(&format!("uno\n{long}"));
        assert_eq!(chunks[0], "uno");
        assert!(chunks[1..].iter().all(|c| c.chars().count() <= MAX_CHUNK_CHARS));
    }

    /// Compara velocidad del modelo normal y del int8 (descargados a mano en
    /// la carpeta de modelos) y deja los WAV en el temporal para escucharlos.
    #[tokio::test]
    #[ignore]
    async fn speaks_with_kokoro() {
        let models = PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/lingora/models");
        let ipa = crate::phonemizer::phonemize(
            "espeak-ng",
            "Hola, esto es una prueba de la voz traducida. Debería sonar igual que antes, pero más rápido.",
            Lang::Es,
        )
        .await
        .unwrap();
        for (dir, file) in [(MODEL_NAME, "model.onnx")] {
            let tts = load(&models.join(dir), file).unwrap();
            generate(&tts, "ˈola", 29, 1.0).unwrap();
            let t0 = std::time::Instant::now();
            let audio = generate(&tts, &ipa, 29, 1.0).unwrap();
            let secs = audio.len() as f32 / SAMPLE_RATE as f32;
            eprintln!("{file}: {:?} para {secs:.1} s de voz", t0.elapsed());
            let out = std::env::temp_dir().join(format!("lingora-{file}.wav"));
            let spec = hound::WavSpec { channels: 1, sample_rate: SAMPLE_RATE, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let mut w = hound::WavWriter::create(&out, spec).unwrap();
            audio.iter().for_each(|s| w.write_sample(*s).unwrap());
            w.finalize().unwrap();
            eprintln!("  {}", out.display());
            // Se comprueba que se entiende: Parakeet lo transcribe (a 16 kHz).
            let at16: Vec<f32> = (0..audio.len() * 2 / 3).map(|i| audio[i * 3 / 2]).collect();
            let listener = crate::listener::Listener::new(models.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"), PathBuf::new());
            let words = listener.recognize(at16, Lang::Es).await.unwrap();
            eprintln!("  oído: {}", words.iter().map(|w| w.text.as_str()).collect::<String>());
        }
    }
}
