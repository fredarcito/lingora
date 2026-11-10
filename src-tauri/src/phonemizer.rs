use crate::config::Lang;
use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

/// Runs a console program without opening its window (Windows).
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Phonemizes text to IPA with espeak-ng.
///
/// It is essential for Spanish: the phonemizer that ships with `kokoro-js` only
/// supports English and, if given Spanish text directly, pronounces it with an
/// English accent ("Ola, esto es una prueba... Estemos comprobando"). With the
/// right phonemes the transcription of the output is exact (phase 0).
///
/// espeak-ng spells out interjections with no vowel: "Hmm" comes out "hache eme
/// eme". Those words are replaced with the real sound (a long m) and the ones
/// with only h's ("hhh", a transcribed breath) are skipped.
// Used by the light voice (`piper.rs`); Supertonic reads plain text.
#[allow(dead_code)]
pub async fn phonemize(bin: &str, text: &str, lang: Lang) -> Result<String> {
    phonemize_with(bin, text, lang.espeak_voice()).await
}

/// Like `phonemize`, with an espeak-ng voice ("en-us", "pt-br", "fa"…): each
/// light voice says which one it was trained with.
pub async fn phonemize_with(bin: &str, text: &str, voice: &str) -> Result<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut pending: Vec<&str> = Vec::new();
    for word in text.split_whitespace() {
        let Some(hum) = interjection(word) else {
            pending.push(word);
            continue;
        };
        if !pending.is_empty() {
            parts.push(espeak(bin, &pending.join(" "), voice).await?);
            pending.clear();
        }
        parts.extend(hum);
    }
    if !pending.is_empty() {
        parts.push(espeak(bin, &pending.join(" "), voice).await?);
    }
    let ipa = parts.join(" ");
    if ipa.trim().is_empty() {
        return Err(Error::Audio("espeak-ng devolvió fonemas vacíos".into()));
    }
    Ok(ipa)
}

/// If the word is an interjection espeak-ng would spell out, returns its
/// phonemes: `Some(Some(ipa))` for "hmm"/"mm-hmm", `Some(None)` for "hhh".
fn interjection(word: &str) -> Option<Option<String>> {
    let letters: String = word.chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).collect();
    if letters.is_empty() || !letters.chars().all(|c| c == 'h' || c == 'm') {
        return None;
    }
    if !letters.contains('m') {
        return Some(None);
    }
    // The final punctuation is kept so the pause still sounds.
    let punctuation: String = word.chars().rev().take_while(|c| !c.is_alphabetic()).collect::<Vec<_>>().into_iter().rev().collect();
    Some(Some(format!("mːː{}", punctuation.replace('-', ""))))
}

/// Folder that contains `espeak-ng-data`: in the app, `Contents/Resources`; in
/// development, next to the executable. Without it (an espeak-ng installed
/// separately), the program uses its own.
pub fn data_dir(bin: &str) -> Option<PathBuf> {
    let dir = Path::new(bin).parent()?;
    [dir.join("../Resources"), dir.to_path_buf()]
        .into_iter()
        .find(|d| d.join("espeak-ng-data/phontab").exists())
}

async fn espeak(bin: &str, text: &str, voice: &str) -> Result<String> {
    let mut command = tokio::process::Command::new(bin);
    // From the data folder and with a relative path: espeak-ng truncates
    // long paths (in a folder with a long name it would not find them).
    if let Some(dir) = data_dir(bin) {
        command.current_dir(dir).arg("--path=.");
    }
    // On Windows each sentence would open a black console for an instant.
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args(["-v", voice, "-q", "--ipa", text])
        .output()
        .await
        .map_err(|e| Error::Audio(format!("no se pudo ejecutar espeak-ng en {bin}: {e}")))?;

    if !output.status.success() {
        return Err(Error::Audio(format!(
            "espeak-ng falló: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    // espeak-ng separates clauses with line breaks. They are kept (one
    // clause per line) so the TTS engine can split long texts
    // without cutting words; inside each line the spaces are normalized.
    let ipa = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(ipa)
}

#[cfg(test)]
mod tests {
    use super::interjection;

    #[test]
    fn recognizes_hums_and_breaths() {
        assert_eq!(interjection("Hmm,"), Some(Some("mːː,".into())));
        assert_eq!(interjection("Mm-hmm."), Some(Some("mːː.".into())));
        assert_eq!(interjection("hhhh"), Some(None));
        assert_eq!(interjection("Ah,"), None);
        assert_eq!(interjection("me"), None);
    }
}
