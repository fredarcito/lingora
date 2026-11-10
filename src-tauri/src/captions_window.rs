//! Floating captions window: borderless, transparent and on top of
//! everything, including a full-screen video. It loads the same UI with
//! `window.__LINGORA_VIEW = "captions"`; the main window keeps doing
//! all the work and sends it the text through events.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "captions";

const WIDTH: f64 = 760.0;
const HEIGHT: f64 = 150.0;
/// Distance from the bottom edge of the screen, above the Dock.
const BOTTOM_MARGIN: f64 = 110.0;

/// Closes the window if it is open.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

/// Opens the window or, if it already exists, shows it.
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
        // The buttons respond to the first click, without activating the window first.
        .accept_first_mouse(true);
    // At the bottom and centered, where captions go. The UI moves the window
    // back to where the user last left it.
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

/// macOS puts each full-screen app in its own desktop, where
/// "always on top" windows do not reach. A full-screen auxiliary window,
/// on all desktops and at menu level, does appear on top.
#[cfg(target_os = "macos")]
fn float_over_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use crate::objc::{msg, Id};
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const POP_UP_MENU_LEVEL: isize = 101;

    // The pointer is not Send; it is passed as a number to the main thread.
    let ns_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || unsafe {
        let ns_window = ns_window as Id;
        let behavior = msg!(ns_window, "collectionBehavior") as usize;
        msg!(ns_window, "setCollectionBehavior:", behavior | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY => usize);
        msg!(ns_window, "setLevel:", POP_UP_MENU_LEVEL => isize);
    })
}
