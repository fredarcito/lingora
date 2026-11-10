//! The app's log. On Windows it goes to a text file on the desktop
//! (`Lingora-registro.txt`): whoever tests the app on another computer can send
//! it as is. On the Mac it still goes to the terminal.

/// Starts the log. Rust failures close the app without warning
/// (`panic = "abort"`), so on Windows they are written down too.
pub fn init() {
    let filter = || {
        // llama.cpp's own lines say which GPU it found and how many layers it
        // offloaded: the only way to tell from a tester's log whether
        // translation runs on the GPU or fell back to the CPU.
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "lingora_lib=info,llama-cpp-2=info".into())
    };
    #[cfg(windows)]
    if let Some(file) = open() {
        tracing_subscriber::fmt()
            .with_env_filter(filter())
            .with_ansi(false)
            .with_writer(std::sync::Mutex::new(file))
            .init();
        let default = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            tracing::error!("la app falló: {info}");
            default(info);
        }));
        tracing::info!("Lingora {} arranca", env!("CARGO_PKG_VERSION"));
        return;
    }
    tracing_subscriber::fmt().with_env_filter(filter()).init();
}

/// Name of the file on the desktop.
#[cfg(windows)]
const NAME: &str = "Lingora-registro.txt";

/// Past this size it starts over, so it does not grow without end.
#[cfg(windows)]
const MAX_BYTES: u64 = 5_000_000;

/// Opens the log and writes at the end: that way what a previous exit left
/// is not lost. `None` if there is no desktop to write to.
#[cfg(windows)]
fn open() -> Option<std::fs::File> {
    // With OneDrive backup on, the desktop lives inside OneDrive.
    let desktop = [std::env::var_os("OneDrive"), std::env::var_os("USERPROFILE")]
        .into_iter()
        .flatten()
        .map(|base| std::path::PathBuf::from(base).join("Desktop"))
        .find(|dir| dir.is_dir())?;
    let path = desktop.join(NAME);
    let full = std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!full)
        .truncate(full)
        .open(path)
        .ok()
}
