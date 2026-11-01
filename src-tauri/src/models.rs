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

/// Something downloaded that is on disk, for Settings → Disk space: a current
/// model, or what an older version left behind (a replaced model).
#[derive(Debug, serde::Serialize)]
pub struct OnDisk {
    /// The model's id (`Model::id`) or, for a leftover, its file or folder name.
    pub id: String,
    /// A leftover that nothing uses any more.
    pub obsolete: bool,
    /// What a leftover was, when known (`"translator"`, `"voice"`); empty if not.
    pub was: &'static str,
    /// Without it Lingora can't listen or translate.
    pub required: bool,
    /// Only a download left halfway (current models).
    pub partial: bool,
    pub bytes: u64,
}

impl Model {
    /// Everything of this model that can be on disk: the installed model, the
    /// archive and a download left halfway.
    fn paths(self, settings: &Settings) -> Vec<PathBuf> {
        let dest = self.dest(settings);
        let download = self.download_path(settings);
        let mut out = vec![partial(&download), dest];
        if !self.single_file() {
            out.push(download);
        }
        out
    }
}

/// What is downloaded: the current models (installed or halfway) and the
/// leftovers in the models folder.
pub fn on_disk(settings: &Settings) -> Vec<OnDisk> {
    let mut out: Vec<OnDisk> = Model::ALL
        .into_iter()
        .filter_map(|m| {
            let bytes: u64 = m.paths(settings).iter().map(|p| size(p)).sum();
            (bytes > 0).then(|| OnDisk {
                id: m.id().to_string(),
                obsolete: false,
                was: "",
                required: m.required(),
                partial: !m.is_installed(settings),
                bytes,
            })
        })
        .collect();
    out.extend(leftovers(&crate::config::models_dir(), settings).into_iter().map(|(name, path)| OnDisk {
        was: previous(&name),
        id: name,
        obsolete: true,
        required: false,
        partial: false,
        bytes: size(&path),
    }));
    out
}

/// Deletes a current model (with its archive and any half download) or a
/// leftover, by the id `on_disk` gave. Nothing outside the models folder: a
/// leftover must be one `on_disk` lists.
pub fn remove(id: &str, settings: &Settings) -> Result<()> {
    remove_in(&crate::config::models_dir(), id, settings)
}

fn remove_in(dir: &Path, id: &str, settings: &Settings) -> Result<()> {
    let paths = match Model::from_id(id) {
        Some(m) => m.paths(settings),
        None => leftovers(dir, settings)
            .into_iter()
            .filter(|(name, _)| name == id)
            .map(|(_, path)| path)
            .collect(),
    };
    if paths.is_empty() {
        return Err(Error::Download(format!("no hay nada descargado con el nombre {id}")));
    }
    for path in paths {
        let gone = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
        match gone {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(Error::Download(format!("no se pudo borrar {}: {e}", path.display())));
            }
            _ => {}
        }
    }
    Ok(())
}

/// What is in `dir` that no current model uses: a model an update replaced,
/// with no list to keep up to date. Hidden files (`.DS_Store`) don't count.
fn leftovers(dir: &Path, settings: &Settings) -> Vec<(String, PathBuf)> {
    let current: Vec<PathBuf> = Model::ALL.into_iter().flat_map(|m| m.paths(settings)).collect();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.path())))
        .filter(|(name, path)| !name.starts_with('.') && !current.contains(path))
        .collect();
    out.sort();
    out
}

/// What a leftover was, by the names past versions used. Unknown ones are
/// still listed, as "from an older version".
fn previous(name: &str) -> &'static str {
    if name.starts_with("Hy-MT2") {
        "translator"
    } else if name.starts_with("kokoro") {
        "voice"
    } else {
        ""
    }
}

/// Bytes of a file, or of a folder with everything inside; 0 if it isn't there.
fn size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if !meta.is_dir() {
        return meta.len();
    }
    std::fs::read_dir(path).map_or(0, |entries| entries.filter_map(|e| e.ok()).map(|e| size(&e.path())).sum())
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
    }

    /// Lists (without deleting anything) what is in the real models folder:
    /// `cargo test --lib models::tests::lists_the_real_folder -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lists_the_real_folder() {
        for item in on_disk(&Settings::from_env_fallback()) {
            eprintln!("{item:?}");
        }
    }

    /// In a temp models folder: the current models and their downloads are
    /// not leftovers; a replaced model and an unknown file are; hidden files
    /// are ignored. Deleting a model takes its half download too.
    #[test]
    fn finds_leftovers_and_removes_a_model() {
        let dir = std::env::temp_dir().join(format!("lingora-leftovers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("kokoro-multi-lang-v1_0")).unwrap();
        let mut settings = Settings::from_env_fallback();
        settings.translator_model = dir.join(crate::translator::MODEL_FILE);
        settings.tts_model_dir = dir.join(crate::tts::MODEL_NAME);
        std::fs::write(&settings.translator_model, b"model").unwrap();
        std::fs::write(partial(&Model::Voice.download_path(&settings)), b"half").unwrap();
        std::fs::write(dir.join("Hy-MT2-1.8B-Q4_K_M.gguf"), b"old").unwrap();
        std::fs::write(dir.join("kokoro-multi-lang-v1_0/model.onnx"), b"older").unwrap();
        std::fs::write(dir.join("something-else.bin"), b"?").unwrap();
        std::fs::write(dir.join(".DS_Store"), b"").unwrap();

        let names: Vec<String> = leftovers(&dir, &settings).into_iter().map(|(n, _)| n).collect();
        assert_eq!(names, ["Hy-MT2-1.8B-Q4_K_M.gguf", "kokoro-multi-lang-v1_0", "something-else.bin"]);
        assert_eq!(previous("Hy-MT2-1.8B-Q4_K_M.gguf"), "translator");
        assert_eq!(previous("kokoro-multi-lang-v1_0"), "voice");
        assert_eq!(previous("something-else.bin"), "");
        assert_eq!(size(&dir.join("kokoro-multi-lang-v1_0")), 5);
        assert_eq!(Model::Voice.paths(&settings).iter().map(|p| size(p)).sum::<u64>(), 4);

        remove_in(&dir, Model::Voice.id(), &settings).unwrap();
        assert!(!partial(&Model::Voice.download_path(&settings)).exists());
        assert!(settings.translator_model.exists());
        remove_in(&dir, "kokoro-multi-lang-v1_0", &settings).unwrap();
        assert!(!dir.join("kokoro-multi-lang-v1_0").exists());
        // Only what is listed: nothing outside the folder, nor a current model by name.
        assert!(remove_in(&dir, "../etc", &settings).is_err());
        assert!(remove_in(&dir, crate::translator::MODEL_FILE, &settings).is_err());
        assert!(settings.translator_model.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
