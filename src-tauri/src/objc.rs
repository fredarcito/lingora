//! Lo mínimo del runtime de Objective-C para las pocas llamadas a AppKit y
//! Core Audio que Tauri no expone, sin añadir dependencias.

use std::ffi::{c_char, c_void, CString};

pub type Id = *mut c_void;

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Id;
    pub fn objc_msgSend();
    pub fn objc_autoreleasePoolPush() -> *mut c_void;
    pub fn objc_autoreleasePoolPop(pool: *mut c_void);
}

/// Clase por nombre; nula si este macOS no la tiene.
pub fn class(name: &str) -> Id {
    let name = CString::new(name).expect("nombre sin ceros");
    unsafe { objc_getClass(name.as_ptr()) }
}

pub fn sel(name: &str) -> Id {
    let name = CString::new(name).expect("nombre sin ceros");
    unsafe { sel_registerName(name.as_ptr()) }
}

/// `objc_msgSend` con la firma concreta de cada mensaje (obligatorio en arm64).
/// Devuelve lo que haya en el registro de retorno como `Id`.
macro_rules! msg {
    ($obj:expr, $sel:expr) => {{
        let f: unsafe extern "C" fn($crate::objc::Id, $crate::objc::Id) -> $crate::objc::Id =
            std::mem::transmute($crate::objc::objc_msgSend as *const ());
        f($obj, $crate::objc::sel($sel))
    }};
    ($obj:expr, $sel:expr, $arg:expr => $ty:ty) => {{
        let f: unsafe extern "C" fn($crate::objc::Id, $crate::objc::Id, $ty) -> $crate::objc::Id =
            std::mem::transmute($crate::objc::objc_msgSend as *const ());
        f($obj, $crate::objc::sel($sel), $arg)
    }};
}
pub(crate) use msg;
