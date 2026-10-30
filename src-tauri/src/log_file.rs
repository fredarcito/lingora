//! Registro de la app. En Windows va a un archivo de texto en el escritorio
//! (`Lingora-registro.txt`): quien prueba la app en otro equipo puede mandarlo
//! tal cual. En el Mac sigue saliendo por la terminal.

/// Pone en marcha el registro. Los fallos de Rust cierran la app sin aviso
/// (`panic = "abort"`), así que en Windows también quedan escritos.
pub fn init() {
    let filter = || {
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "lingora_lib=info".into())
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

/// Nombre del archivo en el escritorio.
#[cfg(windows)]
const NAME: &str = "Lingora-registro.txt";

/// Pasado este tamaño se empieza de nuevo, para que no crezca sin fin.
#[cfg(windows)]
const MAX_BYTES: u64 = 5_000_000;

/// Abre el registro y escribe al final: así no se pierde lo de un cierre
/// anterior. `None` si no hay escritorio donde escribir.
#[cfg(windows)]
fn open() -> Option<std::fs::File> {
    // Con la copia de OneDrive activa, el escritorio vive dentro de OneDrive.
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
