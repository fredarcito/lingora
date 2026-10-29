//! Lo que hay conectado para oír y hablar. Lo usa "Reunión en línea" en Tomar
//! notas: con auriculares el micrófono solo oye a quien habla; con altavoces
//! también oye a los demás (eco). Y unos auriculares Bluetooth que nadie usa
//! como micrófono pasarían a modo llamada al abrirlo.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioRoute {
    /// "headphones" (auriculares con cable, USB o Bluetooth), "speakers" (las
    /// bocinas del Mac) u "other" (monitor, altavoz externo, AirPlay…). Con las
    /// dos últimas el micrófono puede oír a los demás.
    pub output: &'static str,
    pub output_name: String,
    /// La entrada por defecto.
    pub input_name: String,
    pub input_bluetooth: bool,
    /// Otra app ya usa la entrada por defecto.
    pub input_busy: bool,
    /// El micrófono del Mac, si lo hay.
    pub builtin_mic: Option<String>,
}

/// Lo que hay conectado ahora. Fuera de macOS no se sabe: se trata como
/// altavoces, que es lo prudente (el filtro de eco apenas cuesta).
#[tauri::command]
pub fn audio_route() -> AudioRoute {
    #[cfg(target_os = "macos")]
    {
        imp::route()
    }
    #[cfg(not(target_os = "macos"))]
    {
        AudioRoute {
            output: "other",
            output_name: String::new(),
            input_name: String::new(),
            input_bluetooth: false,
            input_busy: false,
            builtin_mic: None,
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::AudioRoute;
    use crate::audio::macos::{default_device, devices, Device};
    use coreaudio_sys::*;
    use std::os::raw::c_void;

    /// Fuente de la salida integrada: auriculares por el conector.
    const DATA_SOURCE_HEADPHONES: u32 = u32::from_be_bytes(*b"hdpn");
    /// Fuente de la salida integrada: las bocinas.
    const DATA_SOURCE_SPEAKERS: u32 = u32::from_be_bytes(*b"ispk");

    /// Una propiedad entera de un dispositivo.
    fn property(id: AudioObjectID, selector: u32, scope: u32) -> Option<u32> {
        let addr = AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut value as *mut u32 as *mut c_void)
        };
        (st == 0).then_some(value)
    }

    /// Si la salida son auriculares, bocinas del Mac u otra cosa.
    fn output_kind(out: &Device, all: &[Device]) -> &'static str {
        if out.is_bluetooth() {
            // Unos auriculares Bluetooth traen micrófono (macOS lo lista como otro
            // dispositivo con el mismo nombre); un altavoz Bluetooth, no.
            let has_mic = out.inputs > 0 || all.iter().any(|d| d.name == out.name && d.inputs > 0);
            return if has_mic { "headphones" } else { "other" };
        }
        if out.is_builtin() {
            // Los Mac con Intel cambian la fuente de la misma salida; los Apple
            // Silicon muestran los auriculares como otra salida integrada.
            match property(out.id, kAudioDevicePropertyDataSource, kAudioObjectPropertyScopeOutput) {
                Some(DATA_SOURCE_HEADPHONES) => return "headphones",
                Some(DATA_SOURCE_SPEAKERS) => return "speakers",
                _ => {}
            }
            let name = out.name.to_lowercase();
            let headphones = ["headphone", "auricular", "casque", "kopfhörer", "cuffie"];
            return if headphones.iter().any(|h| name.contains(h)) { "headphones" } else { "speakers" };
        }
        // Unos auriculares USB traen micrófono; un altavoz o un monitor, no siempre
        // se sabe: por si acaso, como altavoz.
        if out.transport == kAudioDeviceTransportTypeUSB && out.inputs > 0 {
            return "headphones";
        }
        "other"
    }

    pub fn route() -> AudioRoute {
        let all = devices();
        let find = |id: Option<AudioObjectID>| id.and_then(|id| all.iter().find(|d| d.id == id));
        let output = find(default_device(true));
        let input = find(default_device(false));
        AudioRoute {
            output: output.map_or("other", |o| output_kind(o, &all)),
            output_name: output.map(|o| o.name.clone()).unwrap_or_default(),
            input_name: input.map(|i| i.name.clone()).unwrap_or_default(),
            input_bluetooth: input.is_some_and(Device::is_bluetooth),
            input_busy: input.is_some_and(|i| {
                property(i.id, kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioObjectPropertyScopeGlobal)
                    .is_some_and(|v| v != 0)
            }),
            builtin_mic: all.iter().find(|d| d.is_builtin() && d.inputs > 0).map(|d| d.name.clone()),
        }
    }
}
