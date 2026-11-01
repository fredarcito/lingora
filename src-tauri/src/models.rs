//! Descarga de los modelos, con progreso y reanudación.
//!
//! Se descarga a `<destino>.part` y se renombra al terminar. Si la descarga
//! se corta (sin conexión, la app se cerró), la siguiente sigue desde lo que
//! ya había con una petición `Range`.

use crate::config::Settings;
use crate::error::{Error, Result};
use crate::listener::Engine;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

/// Los modelos que se descargan. Su `id` es el de su comprobación en el
/// diagnóstico (`doctor.rs`), así el mismo botón sirve en los dos sitios.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Model {
    Listener,
    SenseVoice,
    Translator,
    Voice,
    Speakers,
}

impl Model {
    pub const ALL: [Model; 5] = [Model::Listener, Model::Translator, Model::Voice, Model::SenseVoice, Model::Speakers];

    pub fn id(self) -> &'static str {
        match self {
            Model::Listener => crate::doctor::LISTENER_CHECK,
            Model::SenseVoice => crate::doctor::SENSE_VOICE_CHECK,
            Model::Translator => crate::doctor::TRANSLATOR_CHECK,
            Model::Voice => crate::doctor::VOICE_CHECK,
            Model::Speakers => crate::doctor::SPEAKERS_CHECK,
        }
    }

    pub fn from_id(id: &str) -> Option<Model> {
        Model::ALL.into_iter().find(|m| m.id() == id)
    }

    /// Sin él no se puede empezar: escuchar y traducir.
    pub fn required(self) -> bool {
        matches!(self, Model::Listener | Model::Translator)
    }

    /// Tamaño aproximado de la descarga, para mostrarlo antes de empezar.
    pub fn approx_bytes(self) -> u64 {
        match self {
            Model::Listener => 487_000_000,
            Model::SenseVoice => 165_000_000,
            Model::Translator => 1_312_000_000,
            Model::Voice => 145_000_000,
            Model::Speakers => 39_600_000,
        }
    }

    /// Carpeta (o archivo, en la traducción y las personas) donde queda instalado.
    fn dest(self, settings: &Settings) -> PathBuf {
        match self {
            Model::Listener => settings.listener_model_dir.clone(),
            Model::SenseVoice => settings.sense_voice_model_dir.clone(),
            Model::Translator => settings.translator_model.clone(),
            Model::Voice => settings.tts_model_dir.clone(),
            Model::Speakers => settings.speaker_model.clone(),
        }
    }

    pub fn is_installed(self, settings: &Settings) -> bool {
        let dest = self.dest(settings);
        match self {
            Model::Listener => Engine::Parakeet.is_installed(&dest),
            Model::SenseVoice => Engine::SenseVoice.is_installed(&dest),
            Model::Translator => crate::translator::LocalTranslator::is_installed(&dest),
            Model::Voice => crate::tts::TtsEngine::is_installed(&dest),
            Model::Speakers => crate::speakers::Speakers::is_installed(&dest),
        }
    }

    /// Hay una descarga a medias que se puede continuar.
    pub fn is_partial(self, settings: &Settings) -> bool {
        partial(&self.download_path(settings)).exists()
    }

    fn url(self) -> String {
        match self {
            Model::Listener => asr_url(Engine::Parakeet.model_name()),
            Model::SenseVoice => asr_url(Engine::SenseVoice.model_name()),
            Model::Translator => crate::translator::MODEL_URL.to_string(),
            Model::Speakers => crate::speakers::MODEL_URL.to_string(),
            Model::Voice => {
                format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{}.tar.bz2", crate::tts::MODEL_NAME)
            }
        }
    }

    /// Lo que se descarga: el archivo comprimido junto a la carpeta del
    /// modelo, o el propio modelo si es un solo archivo.
    fn download_path(self, settings: &Settings) -> PathBuf {
        let dest = self.dest(settings);
        if self.single_file() {
            return dest;
        }
        let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        dest.with_file_name(format!("{name}.tar.bz2"))
    }

    /// Se publica como un solo archivo, sin comprimir.
    fn single_file(self) -> bool {
        matches!(self, Model::Translator | Model::Speakers)
    }

    /// Carpeta que trae el archivo comprimido (su nombre en la publicación).
    fn archive_root(self) -> &'static str {
        match self {
            Model::Listener => Engine::Parakeet.model_name(),
            Model::SenseVoice => Engine::SenseVoice.model_name(),
            Model::Voice => crate::tts::MODEL_NAME,
            Model::Translator | Model::Speakers => "",
        }
    }

    /// Del archivo comprimido solo se extrae esto; vacío = todo.
    fn keep(self) -> Vec<String> {
        match self {
            Model::Voice => crate::tts::FILES.iter().map(|f| format!("{}/{f}", self.archive_root())).collect(),
            _ => Vec::new(),
        }
    }
}

fn asr_url(name: &str) -> String {
    format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{name}.tar.bz2")
}

fn partial(path: &Path) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(".part");
    PathBuf::from(p)
}

/// Descarga e instala el modelo. `progress` recibe (bytes descargados, total).
pub async fn download(model: Model, settings: &Settings, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<()> {
    let failed = |what: &str| Error::Download(format!("No se pudo {what}. Revisa la conexión y vuelve a intentarlo: seguirá donde lo dejó."));
    let target = model.download_path(settings);
    tracing::info!("descargando {:?} en {}", model, target.display());
    fetch(&model.url(), &target, progress).await.map_err(|e| {
        tracing::warn!("descarga de {model:?}: {e}");
        failed("completar la descarga")
    })?;
    if !model.single_file() {
        let ok = extract(&target, &model.keep()).await;
        let _ = tokio::fs::remove_file(&target).await;
        if !ok {
            return Err(failed("descomprimir la descarga"));
        }
        // El archivo trae su propia carpeta; si la configurada se llama
        // distinto (variables de entorno), se mueve a su sitio.
        let dest = model.dest(settings);
        let unpacked = target.with_file_name(model.archive_root());
        if unpacked != dest {
            let _ = tokio::fs::remove_dir_all(&dest).await;
            tokio::fs::rename(&unpacked, &dest).await?;
        }
    }
    if !model.is_installed(settings) {
        return Err(failed("instalar la descarga"));
    }
    Ok(())
}

/// Descarga `url` en `dest`, siguiendo desde `dest.part` si existe.
async fn fetch(url: &str, dest: &Path, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part = partial(dest);
    let mut have = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Audio(e.to_string()))?;
    let mut request = client.get(url);
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().await.map_err(|e| Error::Audio(e.to_string()))?;
    let status = response.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // Lo que había ya era el archivo entero.
        tokio::fs::rename(&part, dest).await?;
        return Ok(());
    }
    if !status.is_success() {
        return Err(Error::Audio(format!("HTTP {status}")));
    }
    // Sin 206 el servidor manda el archivo entero: se empieza de cero.
    if status != reqwest::StatusCode::PARTIAL_CONTENT {
        have = 0;
    }
    let total = have + response.content_length().unwrap_or(0);
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(&part)
        .await?;
    progress(have, total);
    let mut reported = std::time::Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| Error::Audio(e.to_string()))? {
        file.write_all(&chunk).await?;
        have += chunk.len() as u64;
        if reported.elapsed() >= std::time::Duration::from_millis(200) {
            progress(have, total);
            reported = std::time::Instant::now();
        }
    }
    file.flush().await?;
    drop(file);
    progress(have, total.max(have));
    tokio::fs::rename(&part, dest).await?;
    Ok(())
}

/// Descomprime un `.tar.bz2` en su carpeta; `only` limita lo que se extrae.
#[cfg(not(windows))]
async fn extract(archive: &Path, only: &[String]) -> bool {
    let Some(parent) = archive.parent() else { return false };
    tokio::process::Command::new("tar")
        .arg("xjf")
        .arg(archive)
        .arg("-C")
        .arg(parent)
        .args(only)
        .stdout(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Windows: su `tar` no trae bzip2 («unable to run program bzip2 -d»). Se descomprime
/// el bzip2 en Rust a un `.tar` temporal y ese sí lo extrae `tar`.
#[cfg(windows)]
async fn extract(archive: &Path, only: &[String]) -> bool {
    let Some(parent) = archive.parent() else { return false };
    let tar_path = archive.with_extension("");
    let (src, dst) = (archive.to_path_buf(), tar_path.clone());
    let unpacked = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut input = bzip2::read::BzDecoder::new(std::fs::File::open(src)?);
        std::io::copy(&mut input, &mut std::fs::File::create(dst)?)?;
        Ok(())
    })
    .await;
    if !matches!(unpacked, Ok(Ok(()))) {
        let _ = tokio::fs::remove_file(&tar_path).await;
        return false;
    }
    let ok = tokio::process::Command::new("tar")
        .creation_flags(crate::phonemizer::CREATE_NO_WINDOW)
        .arg("xf")
        .arg(&tar_path)
        .arg("-C")
        .arg(parent)
        .args(only)
        .stdout(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    let _ = tokio::fs::remove_file(&tar_path).await;
    ok
}

/// Kokoro, the voice before Supertonic: users who downloaded it keep ~340 MB
/// that nothing uses. It is only deleted when they press the button in
/// Diagnostics (`doctor::OLD_VOICE_CHECK`).
const OLD_VOICE: &str = "kokoro-multi-lang-v1_0";

/// The old voice's folder, next to the current one, if it is still there.
pub fn old_voice(settings: &Settings) -> Option<PathBuf> {
    let dir = settings.tts_model_dir.parent()?.join(OLD_VOICE);
    dir.is_dir().then_some(dir)
}

/// Deletes the old voice's folder, and nothing else.
pub fn remove_old_voice(settings: &Settings) -> Result<()> {
    match old_voice(settings) {
        Some(dir) => std::fs::remove_dir_all(&dir)
            .map_err(|e| Error::Audio(format!("no se pudo borrar {}: {e}", dir.display()))),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Corta una descarga a la mitad y comprueba que la siguiente sigue desde ahí.
    #[tokio::test]
    #[ignore]
    async fn resumes_a_partial_download() {
        let url = "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/README.md";
        let full = reqwest::get(url).await.unwrap().bytes().await.unwrap();
        let dest = std::env::temp_dir().join("lingora-resume-test.md");
        let _ = std::fs::remove_file(&dest);
        std::fs::write(partial(&dest), &full[..full.len() / 2]).unwrap();
        let first = std::sync::Mutex::new(None);
        fetch(url, &dest, &|have, total| {
            first.lock().unwrap().get_or_insert((have, total));
        })
        .await
        .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), full.to_vec());
        assert_eq!(first.lock().unwrap().unwrap(), ((full.len() / 2) as u64, full.len() as u64));
    }

    /// Downloads the voice (~145 MB) into a temp folder and checks that it
    /// extracts the files the engine needs.
    #[tokio::test]
    #[ignore]
    async fn downloads_the_voice() {
        let dir = std::env::temp_dir().join("lingora-voice-test").join(crate::tts::MODEL_NAME);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        let mut settings = Settings::from_env_fallback();
        settings.tts_model_dir = dir.clone();
        assert!(!Model::Voice.is_installed(&settings));
        download(Model::Voice, &settings, &|_, _| {}).await.unwrap();
        assert!(crate::tts::TtsEngine::is_installed(&dir));
        assert!(old_voice(&settings).is_none());
    }
}
