//! Voice with the system's voices, for the languages Kokoro does not have.
//!
//! Which voices exist depends on each computer: the best one installed for the
//! language (Premium > Enhanced > normal) and the requested gender is chosen; if
//! there is none of that gender, the other's. On macOS the voices are listed with
//! `AVSpeechSynthesisVoice` (it gives language, gender and quality) and synthesized
//! with `say`. On Windows `voices` and `synthesize` are still to be implemented
//! (with `Windows.Media.SpeechSynthesis`); meanwhile, those languages have no
//! voice and there are only captions.

use crate::config::Lang;
use crate::error::{Error, Result};
use crate::tts::Gender;

/// Sample rate of the audio `synthesize` returns.
pub const SAMPLE_RATE: u32 = 24_000;

/// A voice installed on the system.
#[derive(Debug, Clone)]
pub struct SystemVoice {
    /// What has to be passed to use it (on macOS, the identifier for `say -v`).
    pub id: String,
    pub name: String,
    /// BCP-47 tag of the language ("ja-JP", "yue-HK", "ar-001"…).
    pub tag: String,
    pub gender: Option<Gender>,
    /// 1 normal, 2 mejorada, 3 premium.
    pub quality: u8,
    /// A voice of the Eloquence family (Eddy, Flo…): it sounds more robotic than
    /// each language's own ones.
    pub eloquence: bool,
}

/// Whether a voice's tag fits a language's tag: "ar" includes
/// "ar-001" and "ar-SA"; "zh-TW" does not include "zh-CN".
fn tag_matches(voice: &str, wanted: &str) -> bool {
    let (v, w) = (voice.to_ascii_lowercase(), wanted.to_ascii_lowercase());
    v == w || v.starts_with(&format!("{w}-"))
}

/// The system voices that fit the language, in the order of its tags.
pub fn voices_for(lang: Lang, voices: &[SystemVoice]) -> Vec<&SystemVoice> {
    lang.info()
        .voice_tags
        .iter()
        .map(|tag| voices.iter().filter(|v| tag_matches(&v.tag, tag)).collect::<Vec<_>>())
        .find(|found| !found.is_empty())
        .unwrap_or_default()
}

pub fn score(voice: &SystemVoice) -> u8 {
    voice.quality * 2 + u8::from(!voice.eloquence)
}

/// The best voice of the language and gender; if there is none of the gender, the best of the other.
fn pick(lang: Lang, gender: Gender, voices: &[SystemVoice]) -> Option<&SystemVoice> {
    let found = voices_for(lang, voices);
    let best = |g: Option<Gender>| found.iter().copied().filter(|v| v.gender == g).max_by_key(|v| score(v));
    best(Some(gender)).or_else(|| found.iter().copied().max_by_key(|v| score(v)))
}

/// Which system voice genders exist for the language (female, male). A voice
/// with no known gender counts as female.
pub fn available(lang: Lang, voices: &[SystemVoice]) -> (bool, bool) {
    let found = voices_for(lang, voices);
    let male = found.iter().any(|v| v.gender == Some(Gender::Male));
    let female = found.iter().any(|v| v.gender != Some(Gender::Male));
    (female, male)
}

/// Synthesizes `text` with the best system voice. Returns mono float32
/// samples at `SAMPLE_RATE`.
pub async fn synthesize(text: &str, lang: Lang, gender: Gender, speed: f32) -> Result<Vec<f32>> {
    let all = voices();
    let voice = pick(lang, gender, &all).ok_or_else(|| {
        Error::Audio(format!(
            "falta una voz de {} en el sistema: descárgala gratis en Ajustes del Sistema → Accesibilidad → Contenido leído → Voz del sistema → Gestionar voces",
            lang.info().spanish.to_lowercase()
        ))
    })?;
    tracing::debug!("voz del sistema: {} ({})", voice.name, voice.tag);
    imp::synthesize(text, &voice.id, speed).await
}

/// Synthesizes with a specific voice (its `id`), the one the user chose.
pub async fn synthesize_with(text: &str, voice_id: &str, speed: f32) -> Result<Vec<f32>> {
    imp::synthesize(text, voice_id, speed).await
}

/// Country name of a tag ("es-MX" → "México"); if unknown, the tag.
pub fn region(tag: &str) -> String {
    let code = tag.rsplit(['-', '_']).next().unwrap_or(tag).to_ascii_uppercase();
    let name = match code.as_str() {
        "ES" => "España",
        "MX" => "México",
        "AR" => "Argentina",
        "CO" => "Colombia",
        "CL" => "Chile",
        "US" => "EE. UU.",
        "GB" => "Reino Unido",
        "AU" => "Australia",
        "IE" => "Irlanda",
        "IN" => "India",
        "ZA" => "Sudáfrica",
        "CA" => "Canadá",
        "FR" => "Francia",
        "BE" => "Bélgica",
        "CH" => "Suiza",
        "BR" => "Brasil",
        "PT" => "Portugal",
        "CN" => "China continental",
        "TW" => "Taiwán",
        "HK" => "Hong Kong",
        _ => return tag.to_string(),
    };
    name.to_string()
}

/// The voices installed on the system.
pub fn voices() -> Vec<SystemVoice> {
    imp::voices()
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::objc::{class, msg, objc_autoreleasePoolPop, objc_autoreleasePoolPush, Id};
    use std::ffi::{c_char, CStr};
    use tokio::io::AsyncWriteExt;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    /// Words per minute of `say` at normal speed.
    const BASE_RATE: f32 = 185.0;

    /// The Eloquence family does not report its gender.
    const ELOQUENCE_FEMALE: &[&str] = &["Flo", "Sandy", "Shelley", "Grandma"];
    const ELOQUENCE_MALE: &[&str] = &["Eddy", "Reed", "Rocko", "Grandpa"];

    unsafe fn string(ns: Id) -> String {
        if ns.is_null() {
            return String::new();
        }
        let ptr = msg!(ns, "UTF8String") as *const c_char;
        if ptr.is_null() {
            String::new()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }

    pub fn voices() -> Vec<SystemVoice> {
        let cls = class("AVSpeechSynthesisVoice");
        if cls.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let list = msg!(cls, "speechVoices");
            let count = if list.is_null() { 0 } else { msg!(list, "count") as usize };
            for i in 0..count {
                let v = msg!(list, "objectAtIndex:", i => usize);
                let id = string(msg!(v, "identifier"));
                let name = string(msg!(v, "name"));
                let eloquence = id.contains(".eloquence.");
                let gender = match msg!(v, "gender") as isize {
                    1 => Some(Gender::Male),
                    2 => Some(Gender::Female),
                    _ if ELOQUENCE_MALE.contains(&name.as_str()) => Some(Gender::Male),
                    _ if ELOQUENCE_FEMALE.contains(&name.as_str()) => Some(Gender::Female),
                    _ => None,
                };
                out.push(SystemVoice {
                    tag: string(msg!(v, "language")),
                    quality: (msg!(v, "quality") as isize).clamp(1, 3) as u8,
                    id,
                    name,
                    gender,
                    eloquence,
                });
            }
            objc_autoreleasePoolPop(pool);
        }
        out
    }

    pub async fn synthesize(text: &str, voice_id: &str, speed: f32) -> Result<Vec<f32>> {
        let path = std::env::temp_dir().join(format!(
            "lingora-say-{}-{}.wav",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())
        ));
        let data_format = format!("--data-format=LEF32@{SAMPLE_RATE}");
        let rate = format!("{:.0}", BASE_RATE * speed);
        // The text goes through stdin: as an argument, one starting with "-" would be read as an option.
        let mut child = tokio::process::Command::new("say")
            .args(["-v", voice_id, "-r", &rate, "--file-format=WAVE", &data_format, "-o"])
            .arg(&path)
            .args(["-f", "-"])
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| Error::Audio(format!("no se pudo ejecutar la voz del sistema: {e}")))?;
        let mut stdin = child.stdin.take().expect("stdin con pipe");
        stdin.write_all(text.as_bytes()).await?;
        drop(stdin);
        let out = child.wait_with_output().await?;
        let wav = tokio::fs::read(&path).await;
        let _ = tokio::fs::remove_file(&path).await;
        if !out.status.success() {
            return Err(Error::Audio(format!(
                "la voz del sistema ({voice_id}) falló: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        crate::tts::parse_wav(wav?)
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    pub fn voices() -> Vec<SystemVoice> {
        Vec::new()
    }

    pub async fn synthesize(_text: &str, _voice_id: &str, _speed: f32) -> Result<Vec<f32>> {
        Err(Error::Audio("la voz del sistema aún no está disponible en este sistema operativo".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(tag: &str, gender: Option<Gender>, quality: u8, eloquence: bool) -> SystemVoice {
        SystemVoice { id: format!("{tag}-{quality}"), name: String::new(), tag: tag.into(), gender, quality, eloquence }
    }

    #[test]
    fn tags_match_variants_only() {
        assert!(tag_matches("ar-001", "ar"));
        assert!(tag_matches("ja-JP", "ja"));
        assert!(!tag_matches("zh-CN", "zh-TW"));
        assert!(!tag_matches("yue-HK", "yu"));
    }

    #[test]
    fn picks_best_quality_then_falls_back_to_other_gender() {
        let voices = [
            voice("ja-JP", Some(Gender::Female), 1, false),
            voice("ja-JP", Some(Gender::Female), 3, false),
            voice("ja-JP", Some(Gender::Female), 1, true),
        ];
        assert_eq!(pick(Lang::Ja, Gender::Female, &voices).unwrap().quality, 3);
        // With no male voice, the best female one.
        assert_eq!(pick(Lang::Ja, Gender::Male, &voices).unwrap().quality, 3);
        assert_eq!(available(Lang::Ja, &voices), (true, false));
        assert!(pick(Lang::Yue, Gender::Female, &voices).is_none());
    }

    /// Lists the languages with a voice on this computer and speaks a sentence in three.
    #[tokio::test]
    #[ignore]
    async fn speaks_with_system_voices() {
        let all = voices();
        for lang in Lang::all() {
            eprintln!("{:8} {:?}", lang.info().code, available(lang, &all));
        }
        for (lang, text) in [(Lang::Zh, "你好，今天天气很好。"), (Lang::Ja, "こんにちは、今日はいい天気ですね。"), (Lang::Yue, "你好，今日天氣好好。")] {
            let audio = synthesize(text, lang, Gender::Male, 1.0).await.unwrap();
            assert!(audio.len() > SAMPLE_RATE as usize / 2, "{lang:?}");
        }
    }
}
