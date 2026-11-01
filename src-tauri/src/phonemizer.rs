use crate::config::Lang;
use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

/// Lanza un programa de consola sin abrir su ventana (Windows).
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Fonemiza texto a IPA con espeak-ng.
///
/// Es imprescindible para el español: el fonemizador que trae `kokoro-js` solo
/// soporta inglés y, si se le pasa texto español directamente, lo pronuncia con
/// acento inglés ("Ola, esto es una prueba... Estemos comprobando"). Con los
/// fonemas correctos la transcripción de la salida es exacta (fase 0).
///
/// espeak-ng deletrea las interjecciones sin vocal: "Hmm" sale "hache eme
/// eme". Esas palabras se sustituyen por el sonido real (una m larga) y las
/// que solo tienen haches ("hhh", una respiración transcrita) se omiten.
// Unused since Supertonic replaced Kokoro (it reads plain text). Kept until
// espeak-ng leaves the bundle: Step 4 of docs/plan-voz-supertonic.md.
#[allow(dead_code)]
pub async fn phonemize(bin: &str, text: &str, lang: Lang) -> Result<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut pending: Vec<&str> = Vec::new();
    for word in text.split_whitespace() {
        let Some(hum) = interjection(word) else {
            pending.push(word);
            continue;
        };
        if !pending.is_empty() {
            parts.push(espeak(bin, &pending.join(" "), lang).await?);
            pending.clear();
        }
        parts.extend(hum);
    }
    if !pending.is_empty() {
        parts.push(espeak(bin, &pending.join(" "), lang).await?);
    }
    let ipa = parts.join(" ");
    if ipa.trim().is_empty() {
        return Err(Error::Audio("espeak-ng devolvió fonemas vacíos".into()));
    }
    Ok(ipa)
}

/// Si la palabra es una interjección que espeak-ng deletrearía, devuelve sus
/// fonemas: `Some(Some(ipa))` para "hmm"/"mm-hmm", `Some(None)` para "hhh".
fn interjection(word: &str) -> Option<Option<String>> {
    let letters: String = word.chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).collect();
    if letters.is_empty() || !letters.chars().all(|c| c == 'h' || c == 'm') {
        return None;
    }
    if !letters.contains('m') {
        return Some(None);
    }
    // Se conserva la puntuación final para que la pausa siga sonando.
    let punctuation: String = word.chars().rev().take_while(|c| !c.is_alphabetic()).collect::<Vec<_>>().into_iter().rev().collect();
    Some(Some(format!("mːː{}", punctuation.replace('-', ""))))
}

/// Carpeta que contiene `espeak-ng-data`: en la app, `Contents/Resources`; en
/// desarrollo, junto al ejecutable. Sin ella (un espeak-ng instalado aparte),
/// el programa usa la suya.
pub fn data_dir(bin: &str) -> Option<PathBuf> {
    let dir = Path::new(bin).parent()?;
    [dir.join("../Resources"), dir.to_path_buf()]
        .into_iter()
        .find(|d| d.join("espeak-ng-data/phontab").exists())
}

async fn espeak(bin: &str, text: &str, lang: Lang) -> Result<String> {
    let mut command = tokio::process::Command::new(bin);
    // Desde la carpeta de los datos y con una ruta relativa: espeak-ng corta
    // las rutas largas (en una carpeta con nombre largo no los encontraría).
    if let Some(dir) = data_dir(bin) {
        command.current_dir(dir).arg("--path=.");
    }
    // En Windows cada frase abriría una consola negra un instante.
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args(["-v", lang.espeak_voice(), "-q", "--ipa", text])
        .output()
        .await
        .map_err(|e| Error::Audio(format!("no se pudo ejecutar espeak-ng en {bin}: {e}")))?;

    if !output.status.success() {
        return Err(Error::Audio(format!(
            "espeak-ng falló: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    // espeak-ng separa las cláusulas con saltos de línea. Se conservan (una
    // cláusula por línea) para que el motor de TTS pueda partir textos largos
    // sin cortar palabras; dentro de cada línea se normalizan los espacios.
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
