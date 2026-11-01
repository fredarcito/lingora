//! Diagnóstico del entorno.
//!
//! Comprueba lo que, en la práctica, impide que Lingora funcione en un Mac
//! recién configurado: dependencias que faltan y un enrutado de audio mal
//! montado. Cada comprobación explica el síntoma en lenguaje llano y, cuando se
//! puede, ofrece un arreglo automático. Ver `docs/problemas-conocidos.md`.

use crate::config::Settings;
use crate::error::{Error, Result};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    /// Identificador estable; es el que recibe `fix`.
    pub id: &'static str,
    pub status: Status,
    pub title: String,
    pub detail: String,
    /// Texto del botón de arreglo automático, si lo hay.
    pub fix: Option<&'static str>,
}

impl Check {
    fn ok(id: &'static str, title: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { id, status: Status::Ok, title: title.into(), detail: detail.into(), fix: None }
    }

    fn problem(
        id: &'static str,
        status: Status,
        title: impl Into<String>,
        detail: impl Into<String>,
        fix: Option<&'static str>,
    ) -> Self {
        Self { id, status, title: title.into(), detail: detail.into(), fix }
    }
}

/// Id de la comprobación del modelo de escucha local; su arreglo (descargar)
/// es asíncrono y lo atiende `lib.rs`.
pub const LISTENER_CHECK: &str = "listener";

/// Id de la comprobación del modelo de escucha para chino, japonés, coreano y
/// cantonés (SenseVoice); su arreglo también lo atiende `lib.rs`.
pub const SENSE_VOICE_CHECK: &str = "sense_voice";

/// Id de la comprobación del modelo de voz (Supertonic); su arreglo (descargar)
/// también lo atiende `lib.rs`.
pub const VOICE_CHECK: &str = "voice_model";

/// Id de la comprobación de la traducción local; su arreglo (descargar)
/// también lo atiende `lib.rs`.
pub const TRANSLATOR_CHECK: &str = "translator";

/// Id de la comprobación del modelo que distingue personas en las notas; su
/// arreglo (descargar) también lo atiende `lib.rs`.
pub const SPEAKERS_CHECK: &str = "speakers";

/// UID de BlackHole 2ch: es fijo en el driver.
const CAPTURE_UID: &str = "BlackHole2ch_UID";
const MULTI_OUTPUT_NAME: &str = "Lingora";
const MULTI_OUTPUT_UID: &str = "lingora-multi-output";

/// `full` incluye las dependencias (lanza procesos); sin él solo se revisa
/// el audio, que es barato y la UI repite cada pocos segundos para detectar,
/// por ejemplo, que se conectaron unos auriculares y macOS cambió la salida.
pub async fn run(settings: &Settings, full: bool) -> Vec<Check> {
    let mut checks = if full { dependency_checks(settings).await } else { Vec::new() };
    #[cfg(target_os = "macos")]
    checks.extend(audio_checks());
    checks
}

async fn command_works(bin: &str, arg: &str) -> bool {
    let mut command = tokio::process::Command::new(bin);
    #[cfg(windows)]
    command.creation_flags(crate::phonemizer::CREATE_NO_WINDOW);
    command
        .arg(arg)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn dependency_checks(settings: &Settings) -> Vec<Check> {
    let mut out = Vec::new();

    // Va dentro de la app: si falla, la app está incompleta (no hay nada que instalar).
    out.push(if command_works(&settings.espeak_bin, "--version").await {
        Check::ok("espeak", "Pronunciación", "Lista; prepara lo que dice la voz.")
    } else {
        Check::problem(
            "espeak",
            Status::Error,
            "Falta una parte de la voz",
            format!(
                "No se encontró {}. Sin él no hay voz traducida. Vuelve a instalar Lingora.",
                settings.espeak_bin
            ),
            None,
        )
    });

    out.push(if crate::tts::TtsEngine::is_installed(&settings.tts_model_dir) {
        Check::ok(VOICE_CHECK, "Voz", "Descargada.")
    } else {
        Check::problem(
            VOICE_CHECK,
            Status::Warning,
            "Falta la voz",
            "Para oír la traducción en español, inglés y otros 16 idiomas hay que descargar la \
             voz (~145 MB). Sin ella solo hay subtítulos.",
            Some("Descargar"),
        )
    });

    use crate::listener::Engine;
    // Todo se hace en el equipo: sin estos dos modelos no se puede traducir.
    out.push(if Engine::Parakeet.is_installed(&settings.listener_model_dir) {
        Check::ok(LISTENER_CHECK, "Escuchar", "Descargado.")
    } else {
        Check::problem(
            LISTENER_CHECK,
            Status::Error,
            "Falta lo necesario para escuchar",
            "Lingora entiende lo que se dice en tu equipo (~470 MB): inglés, español, francés, \
             alemán, italiano, portugués, neerlandés, polaco, checo, ruso y ucraniano.",
            Some("Descargar"),
        )
    });

    out.push(if Engine::SenseVoice.is_installed(&settings.sense_voice_model_dir) {
        Check::ok(SENSE_VOICE_CHECK, "Escuchar chino, japonés y coreano", "Descargado.")
    } else {
        Check::problem(
            SENSE_VOICE_CHECK,
            Status::Warning,
            "Falta lo necesario para chino, japonés y coreano",
            "Para escuchar chino, cantonés, japonés o coreano hay que descargar un complemento \
             (~165 MB). Solo hace falta si vas a usar esos idiomas.",
            Some("Descargar"),
        )
    });

    out.push(if !crate::translator::LocalTranslator::is_installed(&settings.translator_model) {
        Check::problem(
            TRANSLATOR_CHECK,
            Status::Error,
            "Falta lo necesario para traducir",
            "Lingora traduce en tu equipo (~1,3 GB), sin internet ni cuotas.",
            Some("Descargar"),
        )
    } else {
        Check::ok(TRANSLATOR_CHECK, "Traducir", "Descargado.")
    });

    out.push(if crate::speakers::Speakers::is_installed(&settings.speaker_model) {
        Check::ok(SPEAKERS_CHECK, "Distinguir personas", "Descargado.")
    } else {
        Check::problem(
            SPEAKERS_CHECK,
            Status::Warning,
            "Falta lo necesario para distinguir personas",
            "Para marcar en las notas quién habla (Persona 1, Persona 2…) hay que descargar un \
             complemento (~40 MB). Sin él las notas se guardan igual, sin personas.",
            Some("Descargar"),
        )
    });

    out
}

#[cfg(target_os = "macos")]
fn audio_checks() -> Vec<Check> {
    use crate::audio::macos;

    let devices = macos::devices();
    let Some(capture) = devices.iter().find(|d| d.uid == CAPTURE_UID) else {
        return vec![Check::problem(
            "blackhole",
            Status::Error,
            "Falta BlackHole 2ch",
            "Es el cable virtual por el que Lingora oye la llamada o el vídeo. Instálalo con \
             `brew install blackhole-2ch` y reinicia el Mac.",
            None,
        )];
    };
    let mut out = vec![Check::ok("blackhole", "BlackHole 2ch", "Instalado.")];

    let default_out = macos::default_device(true).and_then(|id| devices.iter().find(|d| d.id == id));
    let fix_routing = Some("Configurar salida «Lingora»");
    out.push(match default_out {
        None => Check::problem(
            "routing",
            Status::Error,
            "No hay salida de audio del sistema",
            "macOS no tiene ninguna salida seleccionada.",
            fix_routing,
        ),
        Some(d) if d.uid == CAPTURE_UID => Check::problem(
            "routing",
            Status::Error,
            "La salida del sistema es BlackHole",
            "Lingora oye la llamada, pero tú no: BlackHole es un cable virtual y no suena por ningún \
             altavoz. Hace falta una salida múltiple que mande el audio a las bocinas y a BlackHole a la vez.",
            fix_routing,
        ),
        Some(d) if d.is_aggregate() => {
            let subs = macos::subdevice_uids(d.id);
            if d.inputs > 0 {
                Check::problem(
                    "routing",
                    Status::Error,
                    format!("«{}» es un dispositivo agregado, no una salida múltiple", d.name),
                    "Un dispositivo agregado mezcla relojes de audio distintos: la captura sale \
                     entrecortada y con sonido metálico («como dentro de un pote»), y la escucha solo \
                     entiende trozos. Hay que usar una salida múltiple.",
                    fix_routing,
                )
            } else if !subs.iter().any(|u| u == CAPTURE_UID) {
                Check::problem(
                    "routing",
                    Status::Error,
                    format!("La salida múltiple «{}» no incluye BlackHole", d.name),
                    "El audio suena por los altavoces pero no llega a BlackHole, así que Lingora no oye nada.",
                    fix_routing,
                )
            } else {
                let others: Vec<_> = subs
                    .iter()
                    .filter(|u| *u != CAPTURE_UID)
                    .filter_map(|u| devices.iter().find(|x| &x.uid == u).map(|x| x.name.clone()))
                    .collect();
                Check::ok(
                    "routing",
                    "Salida del sistema",
                    format!(
                        "«{}» envía el audio a {} y a BlackHole 2ch. Con una salida múltiple las \
                         teclas de volumen del Mac no funcionan: ajusta el volumen en la app de la llamada.",
                        d.name,
                        others.join(", ")
                    ),
                )
            }
        }
        Some(d) => Check::problem(
            "routing",
            Status::Error,
            format!("La salida del sistema es «{}»", d.name),
            "El audio no pasa por BlackHole, así que Lingora no oye la llamada ni el vídeo.",
            fix_routing,
        ),
    });

    // Frecuencias: dentro de la salida múltiple, si BlackHole no va a la misma
    // que la salida principal, la corrección de deriva no basta y el audio se
    // corta. Fuera de ella no aplica: el problema es el enrutado.
    let main = default_out
        .filter(|d| d.is_aggregate() && macos::subdevice_uids(d.id).iter().any(|u| u == CAPTURE_UID))
        .and_then(|d| {
            macos::subdevice_uids(d.id)
                .into_iter()
                .find(|u| u != CAPTURE_UID)
                .and_then(|u| devices.iter().find(|x| x.uid == u))
        });
    if let Some(main) = main {
        out.push(if (main.rate - capture.rate).abs() > 1.0 {
            Check::problem(
                "sample_rate",
                Status::Error,
                "Frecuencias de audio distintas",
                format!(
                    "BlackHole va a {:.0} Hz y «{}» a {:.0} Hz. Con relojes distintos la captura se \
                     corta y suena mal.",
                    capture.rate, main.name, main.rate
                ),
                Some("Igualar frecuencias"),
            )
        } else {
            Check::ok("sample_rate", "Frecuencias de audio", format!("Todo a {:.0} Hz.", main.rate))
        });
    }

    if let Some((vol, muted)) = macos::input_volume(capture.id) {
        out.push(if muted || vol < 0.99 {
            Check::problem(
                "capture_volume",
                Status::Warning,
                "BlackHole tiene el volumen bajo",
                format!(
                    "La entrada de BlackHole está {}. La voz llega débil y la detección de voz puede no dispararse.",
                    if muted { "silenciada".to_string() } else { format!("al {:.0} %", vol * 100.0) }
                ),
                Some("Subir al 100 %"),
            )
        } else {
            Check::ok("capture_volume", "Volumen de BlackHole", "Al 100 %.")
        });
    }

    let default_in = macos::default_device(false).and_then(|id| devices.iter().find(|d| d.id == id));
    if let Some(mic) = default_in {
        out.push(if mic.is_bluetooth() {
            Check::problem(
                "microphone",
                Status::Warning,
                format!("El micrófono es Bluetooth («{}»)", mic.name),
                "Al usar el micrófono de unos auriculares Bluetooth, macOS los pasa a modo llamada: \
                 audio a 16 kHz muy comprimido y la traducción empeora. Usa el micrófono del Mac \
                 como entrada (Ajustes del Sistema → Sonido → Entrada) y los auriculares solo para oír.",
                None,
            )
        } else {
            Check::ok("microphone", "Micrófono", format!("«{}».", mic.name))
        });
    }

    out
}

/// Aplica el arreglo automático de una comprobación.
pub fn fix(id: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        use crate::audio::macos;

        let devices = macos::devices();
        let capture = devices
            .iter()
            .find(|d| d.uid == CAPTURE_UID)
            .ok_or_else(|| Error::Audio("BlackHole 2ch no está instalado".into()))?;

        // Salida real a la que acompañar BlackHole: la actual si es un
        // dispositivo físico; si no, las bocinas integradas.
        let main_output = || {
            let current = macos::default_device(true).and_then(|id| devices.iter().find(|d| d.id == id));
            current
                .filter(|d| !d.is_aggregate() && d.uid != CAPTURE_UID && d.outputs > 0)
                .or_else(|| devices.iter().find(|d| d.is_builtin() && d.outputs > 0))
                .or_else(|| devices.iter().find(|d| !d.is_aggregate() && d.uid != CAPTURE_UID && d.outputs > 0))
                .ok_or_else(|| Error::Audio("no hay ninguna salida física disponible".into()))
        };

        match id {
            "routing" => {
                let main = main_output()?;
                // Se sustituye cualquier "Lingora" anterior (agregado mal
                // montado o salida múltiple incompleta).
                for d in devices.iter().filter(|d| {
                    d.is_aggregate() && (d.uid == MULTI_OUTPUT_UID || d.name == MULTI_OUTPUT_NAME)
                }) {
                    macos::destroy_aggregate(d.id)?;
                }
                if (capture.rate - main.rate).abs() > 1.0 {
                    macos::set_nominal_rate(capture.id, main.rate)?;
                }
                let id = macos::create_multi_output(MULTI_OUTPUT_NAME, MULTI_OUTPUT_UID, &main.uid, CAPTURE_UID)?;
                macos::set_default_output(id)?;
                tracing::info!("salida múltiple creada: {} + BlackHole 2ch", main.name);
                Ok(())
            }
            "sample_rate" => {
                let current = macos::default_device(true).and_then(|id| devices.iter().find(|d| d.id == id));
                let reference = current
                    .filter(|d| d.is_aggregate())
                    .and_then(|d| {
                        macos::subdevice_uids(d.id)
                            .into_iter()
                            .find(|u| u != CAPTURE_UID)
                            .and_then(|u| devices.iter().find(|x| x.uid == u))
                    })
                    .map_or_else(main_output, Ok)?;
                macos::set_nominal_rate(capture.id, reference.rate)
            }
            "capture_volume" => macos::set_input_full_volume(capture.id),
            other => Err(Error::Audio(format!("no hay arreglo automático para «{other}»"))),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(Error::Audio(format!("arreglo no disponible fuera de macOS: {id}")))
    }
}
