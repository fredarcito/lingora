//! Ventana flotante de subtítulos: sin bordes, transparente y por encima de
//! todo, también de un vídeo a pantalla completa. Carga la misma UI con
//! `window.__LINGORA_VIEW = "captions"`; la ventana principal sigue haciendo
//! todo el trabajo y le manda el texto por eventos.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "captions";

const WIDTH: f64 = 760.0;
const HEIGHT: f64 = 150.0;
/// Separación del borde inferior de la pantalla, por encima del Dock.
const BOTTOM_MARGIN: f64 = 110.0;

/// Cierra la ventana si está abierta.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

/// Abre la ventana o, si ya existe, la muestra.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?;
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Subtítulos de Lingora")
        .initialization_script("window.__LINGORA_VIEW = 'captions';")
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(320.0, 70.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        // Los botones responden al primer clic, sin activar antes la ventana.
        .accept_first_mouse(true);
    // Abajo y centrada, donde van los subtítulos. La UI recoloca la ventana
    // donde la dejó quien la usa la última vez.
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        builder = builder.position(
            origin.x + (size.width - WIDTH) / 2.0,
            origin.y + size.height - HEIGHT - BOTTOM_MARGIN,
        );
    }
    let window = builder.build()?;
    #[cfg(target_os = "macos")]
    float_over_fullscreen(&window)?;
    Ok(())
}

/// macOS pone cada app a pantalla completa en su propio escritorio, donde no
/// llegan las ventanas "siempre encima". Una ventana auxiliar de pantalla
/// completa, en todos los escritorios y a nivel de menú, sí aparece encima.
#[cfg(target_os = "macos")]
fn float_over_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use crate::objc::{msg, Id};
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const POP_UP_MENU_LEVEL: isize = 101;

    // El puntero no es Send; se pasa como número al hilo principal.
    let ns_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || unsafe {
        let ns_window = ns_window as Id;
        let behavior = msg!(ns_window, "collectionBehavior") as usize;
        msg!(ns_window, "setCollectionBehavior:", behavior | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY => usize);
        msg!(ns_window, "setLevel:", POP_UP_MENU_LEVEL => isize);
    })
}
