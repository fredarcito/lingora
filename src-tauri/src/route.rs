//! What is connected for hearing and speaking. "Online meeting" in Take notes
//! uses it: with headphones the microphone only hears the speaker; with speakers
//! it also hears the others (echo). And Bluetooth headphones that nobody uses
//! as a microphone would switch to call mode when it is opened.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioRoute {
    /// "headphones" (wired, USB or Bluetooth headphones), "speakers" (the
    /// Mac's speakers) or "other" (monitor, external speaker, AirPlay…). With the
    /// last two the microphone can hear the others.
    pub output: &'static str,
    pub output_name: String,
    /// The default input.
    pub input_name: String,
    pub input_bluetooth: bool,
    /// Another app is already using the default input.
    pub input_busy: bool,
    /// The Mac's microphone, if there is one.
    pub builtin_mic: Option<String>,
}

/// What is connected now. Outside macOS it is unknown: it is treated as
/// speakers, which is the cautious choice (the echo filter costs very little).
/// Off the window thread: with the Mac capture just created and nothing
/// playing, Core Audio can take a while to answer and would freeze it.
#[tauri::command]
pub async fn audio_route() -> AudioRoute {
    tauri::async_runtime::spawn_blocking(route_now).await.unwrap_or_else(|_| unknown())
}

fn route_now() -> AudioRoute {
    #[cfg(target_os = "macos")]
    {
        imp::route()
    }
    #[cfg(not(target_os = "macos"))]
    {
        unknown()
    }
}

/// Without knowing what is connected: like speakers.
fn unknown() -> AudioRoute {
    AudioRoute {
        output: "other",
        output_name: String::new(),
        input_name: String::new(),
        input_bluetooth: false,
        input_busy: false,
        builtin_mic: None,
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::AudioRoute;
    use crate::audio::macos::{default_device, devices, Device};
    use coreaudio_sys::*;
    use std::os::raw::c_void;

    /// Source of the built-in output: headphones on the jack.
    const DATA_SOURCE_HEADPHONES: u32 = u32::from_be_bytes(*b"hdpn");
    /// Source of the built-in output: the speakers.
    const DATA_SOURCE_SPEAKERS: u32 = u32::from_be_bytes(*b"ispk");

    /// An integer property of a device.
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

    /// Whether the output is headphones, the Mac's speakers or something else.
    fn output_kind(out: &Device, all: &[Device]) -> &'static str {
        if out.is_bluetooth() {
            // Bluetooth headphones carry a microphone (macOS lists it as another
            // device with the same name); a Bluetooth speaker does not.
            let has_mic = out.inputs > 0 || all.iter().any(|d| d.name == out.name && d.inputs > 0);
            return if has_mic { "headphones" } else { "other" };
        }
        if out.is_builtin() {
            // Intel Macs switch the source of the same output; Apple
            // Silicon ones show the headphones as another built-in output.
            match property(out.id, kAudioDevicePropertyDataSource, kAudioObjectPropertyScopeOutput) {
                Some(DATA_SOURCE_HEADPHONES) => return "headphones",
                Some(DATA_SOURCE_SPEAKERS) => return "speakers",
                _ => {}
            }
            let name = out.name.to_lowercase();
            let headphones = ["headphone", "auricular", "casque", "kopfhörer", "cuffie"];
            return if headphones.iter().any(|h| name.contains(h)) { "headphones" } else { "speakers" };
        }
        // USB headphones carry a microphone; with a speaker or a monitor it is not
        // always known: just in case, like a speaker.
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
