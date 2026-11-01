//! Lingora Mic: the virtual microphone for calls (`driver/LingoraMic.c`).
//! The app carries the driver in its resources and copies it to the folder
//! where macOS looks for audio plug-ins. That needs the admin password once:
//! macOS asks for it in its own window, nobody opens a terminal.

use crate::error::{Error, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const BUNDLE: &str = "LingoraMic.driver";
const BINARY: &str = "Contents/MacOS/LingoraMic";
const HAL_DIR: &str = "/Library/Audio/Plug-Ins/HAL";
/// Must match `kDeviceName` in the driver and `VIRTUAL_MIC` in `src/utils/lanes.js`.
const DEVICE_NAME: &str = "Lingora Mic";

#[derive(Debug, Clone, Serialize)]
pub struct VirtualMicStatus {
    /// The app carries the driver (only on macOS).
    pub available: bool,
    /// The driver is in the plug-ins folder, complete.
    pub installed: bool,
    /// macOS already shows the device (the audio service loaded it).
    pub active: bool,
}

#[tauri::command]
pub async fn virtual_mic_status(app: tauri::AppHandle) -> VirtualMicStatus {
    tauri::async_runtime::spawn_blocking(move || status(&app))
        .await
        .unwrap_or(VirtualMicStatus { available: false, installed: false, active: false })
}

/// Copies the driver and restarts the audio service. Every app loses its
/// sound for a second, so the UI only offers it while nothing is translating.
/// Closing the password window is not an error: the status comes back unchanged.
#[tauri::command]
pub async fn virtual_mic_install(app: tauri::AppHandle) -> Result<VirtualMicStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let bundled = bundled(&app).ok_or_else(|| Error::Audio("la app no trae el micrófono virtual".into()))?;
        // The admin shell cannot read folders macOS protects (Documents, where
        // the app lives in development) even as root: it copies from a
        // temporary folder that Lingora fills first.
        let staging = std::env::temp_dir().join(format!("lingora-mic-{}", std::process::id()));
        let source = staging.join(BUNDLE);
        let _ = std::fs::remove_dir_all(&staging);
        let copied = std::process::Command::new("/usr/bin/ditto").arg(&bundled).arg(&source).status()?;
        if !copied.success() {
            return Err(Error::Audio(format!("no se pudo preparar el micrófono virtual desde {}", bundled.display())));
        }
        let target = installed_path();
        let done = run_as_admin(&format!(
            "cd / && rm -rf {target} && cp -R {source} {target} && chown -R root:wheel {target} && killall coreaudiod",
            target = quote(&target),
            source = quote(&source),
        ));
        let _ = std::fs::remove_dir_all(&staging);
        if done? {
            wait_for_device(true);
        }
        Ok(status(&app))
    })
    .await
    .map_err(|e| Error::Audio(format!("no se pudo instalar el micrófono virtual: {e}")))?
}

#[tauri::command]
pub async fn virtual_mic_uninstall(app: tauri::AppHandle) -> Result<VirtualMicStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        if run_as_admin(&format!("cd / && rm -rf {} && killall coreaudiod", quote(&installed_path())))? {
            wait_for_device(false);
        }
        Ok(status(&app))
    })
    .await
    .map_err(|e| Error::Audio(format!("no se pudo quitar el micrófono virtual: {e}")))?
}

fn status(app: &tauri::AppHandle) -> VirtualMicStatus {
    VirtualMicStatus {
        available: cfg!(target_os = "macos") && bundled(app).is_some(),
        // The binary, not just the folder: a failed copy can leave it empty.
        installed: installed_path().join(BINARY).exists(),
        active: device_visible(),
    }
}

fn installed_path() -> PathBuf {
    Path::new(HAL_DIR).join(BUNDLE)
}

/// In the app, `Contents/Resources`; in development, `src-tauri/resources`.
fn bundled(app: &tauri::AppHandle) -> Option<PathBuf> {
    let from_app = app.path().resource_dir().ok().map(|d| d.join(BUNDLE));
    let from_source = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join(BUNDLE);
    [from_app, Some(from_source)]
        .into_iter()
        .flatten()
        .find(|p| p.join(BINARY).exists())
}

fn device_visible() -> bool {
    crate::audio::list_devices()
        .map(|list| list.iter().any(|d| d.name == DEVICE_NAME))
        .unwrap_or(false)
}

/// After the restart, the audio service takes a moment to list the devices again.
fn wait_for_device(present: bool) {
    for _ in 0..20 {
        if device_visible() == present {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

/// A path as a single-quoted shell word.
fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// Runs a shell command as root behind macOS's own password window. `false`
/// when the person closes the window.
fn run_as_admin(command: &str) -> Result<bool> {
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .current_dir("/")
        .args(["-e", &script])
        .output()
        .map_err(|e| Error::Audio(format!("no se pudo pedir permiso: {e}")))?;
    if output.status.success() {
        return Ok(true);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // -128: "User canceled".
    if stderr.contains("-128") {
        return Ok(false);
    }
    Err(Error::Audio(stderr.trim().to_string()))
}
