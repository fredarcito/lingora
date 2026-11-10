//! The bare minimum of the Objective-C runtime for the few calls to AppKit and
//! Core Audio that Tauri does not expose, without adding dependencies.

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

/// Class by name; null if this macOS does not have it.
pub fn class(name: &str) -> Id {
    let name = CString::new(name).expect("nombre sin ceros");
    unsafe { objc_getClass(name.as_ptr()) }
}

pub fn sel(name: &str) -> Id {
    let name = CString::new(name).expect("nombre sin ceros");
    unsafe { sel_registerName(name.as_ptr()) }
}

/// `objc_msgSend` with the exact signature of each message (required on arm64).
/// Returns whatever is in the return register as an `Id`.
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
