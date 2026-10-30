//! Captura y reproducción de audio con Core Audio.
//!
//! Fase 0 validada con scripts sueltos: BlackHole 2ch recibe el audio del
//! sistema (a través de la salida múltiple "Lingora") y la app lo lee; la voz
//! traducida se escribe en BlackHole para que la llamada la use como micrófono.
//! La voz que escucha el usuario se reproduce **directamente** en las bocinas,
//! nunca por la salida múltiple, para no realimentar la captura.

use crate::error::{Error, Result};

/// Lista los dispositivos de audio con sus canales, para que la UI muestre
/// nombres reales en lugar de los que da el WebView.
pub fn list_devices() -> Result<Vec<DeviceInfo>> {
    #[cfg(target_os = "macos")]
    {
        macos::list_devices()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(Error::Audio("solo macOS por ahora".into()))
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub name: String,
    pub uid: String,
    pub input_channels: u32,
    pub output_channels: u32,
}

#[cfg(target_os = "macos")]
pub mod macos {
    use super::*;
    use coreaudio_sys::*;
    use std::ffi::CStr;
    use std::os::raw::c_void;

    fn system_object() -> AudioObjectID {
        kAudioObjectSystemObject
    }

    fn device_ids() -> Vec<AudioObjectID> {
        let addr = AudioObjectPropertyAddress {
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut size: u32 = 0;
        let st = unsafe {
            AudioObjectGetPropertyDataSize(system_object(), &addr, 0, std::ptr::null(), &mut size)
        };
        if st != 0 || size == 0 {
            return Vec::new();
        }
        let count = size as usize / std::mem::size_of::<AudioObjectID>();
        let mut ids = vec![0 as AudioObjectID; count];
        let st = unsafe {
            AudioObjectGetPropertyData(
                system_object(),
                &addr,
                0,
                std::ptr::null(),
                &mut size,
                ids.as_mut_ptr() as *mut c_void,
            )
        };
        if st != 0 {
            return Vec::new();
        }
        ids
    }

    fn string_property(id: AudioObjectID, selector: u32) -> Option<String> {
        let addr = AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut cf: CFStringRef = std::ptr::null();
        let mut size = std::mem::size_of::<CFStringRef>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(
                id,
                &addr,
                0,
                std::ptr::null(),
                &mut size,
                &mut cf as *mut CFStringRef as *mut c_void,
            )
        };
        if st != 0 || cf.is_null() {
            return None;
        }
        // CFStringGetCString con un buffer fijo evita depender de CFStringGetLength.
        let mut buf = [0i8; 512];
        let ok = unsafe { CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as i64, 0x0800_0100) };
        unsafe { CFRelease(cf as CFTypeRef) };
        if ok == 0 {
            return None;
        }
        Some(unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
    }

    fn channel_count(id: AudioObjectID, scope: u32) -> u32 {
        let addr = AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut size: u32 = 0;
        let st = unsafe {
            AudioObjectGetPropertyDataSize(id, &addr, 0, std::ptr::null(), &mut size)
        };
        if st != 0 || size == 0 {
            return 0;
        }
        let mut buf = vec![0u8; size as usize];
        let st = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, buf.as_mut_ptr() as *mut c_void)
        };
        if st != 0 {
            return 0;
        }
        let abl = buf.as_ptr() as *const AudioBufferList;
        let n = unsafe { (*abl).mNumberBuffers } as usize;
        let buffers = unsafe { std::slice::from_raw_parts((*abl).mBuffers.as_ptr(), n) };
        buffers.iter().map(|b| b.mNumberChannels).sum()
    }

    fn nominal_sample_rate(id: AudioObjectID) -> Option<f64> {
        let addr = AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut rate: f64 = 0.0;
        let mut size = std::mem::size_of::<f64>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut rate as *mut f64 as *mut c_void)
        };
        (st == 0 && rate > 0.0).then_some(rate)
    }

    /// Frecuencia nominal y canales de salida de un dispositivo, por nombre.
    pub fn output_format(name: &str) -> Option<(u32, u16)> {
        device_ids().into_iter().find_map(|id| {
            if string_property(id, kAudioObjectPropertyName)? != name {
                return None;
            }
            let channels = channel_count(id, kAudioObjectPropertyScopeOutput);
            let rate = nominal_sample_rate(id)?;
            (channels > 0).then_some((rate as u32, channels.min(u16::MAX as u32) as u16))
        })
    }

    fn address(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn get<T: Copy>(id: AudioObjectID, selector: u32, scope: u32, init: T) -> Option<T> {
        let addr = address(selector, scope);
        let mut value = init;
        let mut size = std::mem::size_of::<T>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut value as *mut T as *mut c_void)
        };
        (st == 0).then_some(value)
    }

    fn set<T>(id: AudioObjectID, selector: u32, scope: u32, value: &T) -> Result<()> {
        let addr = address(selector, scope);
        let st = unsafe {
            AudioObjectSetPropertyData(
                id,
                &addr,
                0,
                std::ptr::null(),
                std::mem::size_of::<T>() as u32,
                value as *const T as *const c_void,
            )
        };
        if st != 0 {
            return Err(Error::Audio(format!("Core Audio rechazó el cambio (código {st})")));
        }
        Ok(())
    }

    /// Dispositivo con lo que necesita el diagnóstico.
    #[derive(Debug, Clone)]
    pub struct Device {
        pub id: AudioObjectID,
        pub name: String,
        pub uid: String,
        pub inputs: u32,
        pub outputs: u32,
        pub rate: f64,
        pub transport: u32,
    }

    impl Device {
        pub fn is_aggregate(&self) -> bool {
            self.transport == kAudioDeviceTransportTypeAggregate
        }

        pub fn is_bluetooth(&self) -> bool {
            self.transport == kAudioDeviceTransportTypeBluetooth
                || self.transport == kAudioDeviceTransportTypeBluetoothLE
        }

        pub fn is_builtin(&self) -> bool {
            self.transport == kAudioDeviceTransportTypeBuiltIn
        }
    }

    pub fn devices() -> Vec<Device> {
        device_ids()
            .into_iter()
            .filter_map(|id| {
                Some(Device {
                    id,
                    name: string_property(id, kAudioObjectPropertyName)?,
                    uid: string_property(id, kAudioDevicePropertyDeviceUID)?,
                    inputs: channel_count(id, kAudioObjectPropertyScopeInput),
                    outputs: channel_count(id, kAudioObjectPropertyScopeOutput),
                    rate: nominal_sample_rate(id).unwrap_or(0.0),
                    transport: get(id, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, 0u32)
                        .unwrap_or(0),
                })
            })
            .collect()
    }

    pub fn default_device(output: bool) -> Option<AudioObjectID> {
        let selector = if output {
            kAudioHardwarePropertyDefaultOutputDevice
        } else {
            kAudioHardwarePropertyDefaultInputDevice
        };
        get(system_object(), selector, kAudioObjectPropertyScopeGlobal, 0 as AudioObjectID)
    }

    pub fn set_default_output(id: AudioObjectID) -> Result<()> {
        set(system_object(), kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, &id)
    }

    pub fn set_nominal_rate(id: AudioObjectID, rate: f64) -> Result<()> {
        set(id, kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, &rate)
    }

    /// Volumen (0–1) y silencio de la entrada de un dispositivo.
    pub fn input_volume(id: AudioObjectID) -> Option<(f32, bool)> {
        let vol = get(id, kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput, 0f32)?;
        let mute = get(id, kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput, 0u32).unwrap_or(0);
        Some((vol, mute != 0))
    }

    pub fn set_input_full_volume(id: AudioObjectID) -> Result<()> {
        // Algunos dispositivos no exponen mute; no es un error.
        let _ = set(id, kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput, &0u32);
        set(id, kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput, &1f32)
    }

    /// UIDs de los subdispositivos de un agregado o salida múltiple.
    pub fn subdevice_uids(id: AudioObjectID) -> Vec<String> {
        use core_foundation::array::CFArray;
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;

        let Some(raw) = get(
            id,
            kAudioAggregateDevicePropertyFullSubDeviceList,
            kAudioObjectPropertyScopeGlobal,
            std::ptr::null::<c_void>(),
        ) else {
            return Vec::new();
        };
        if raw.is_null() {
            return Vec::new();
        }
        let array: CFArray<CFString> = unsafe { CFArray::wrap_under_create_rule(raw as _) };
        array.iter().map(|s| s.to_string()).collect()
    }

    /// Crea una salida múltiple (agregado "stacked": el mismo audio va a
    /// todas las subsalidas). `main_uid` marca el reloj; BlackHole lleva
    /// corrección de deriva.
    pub fn create_multi_output(name: &str, uid: &str, main_uid: &str, capture_uid: &str) -> Result<AudioObjectID> {
        use core_foundation::array::CFArray;
        use core_foundation::base::{CFType, TCFType};
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::number::CFNumber;
        use core_foundation::string::CFString;

        let key = |k: &str| CFString::new(k).as_CFType();
        let text = |v: &str| CFString::new(v).as_CFType();
        let num = |v: i32| CFNumber::from(v).as_CFType();
        let sub = |uid: &str, drift: i32| {
            CFDictionary::<CFType, CFType>::from_CFType_pairs(&[(key("uid"), text(uid)), (key("drift"), num(drift))])
                .as_CFType()
        };
        let subdevices = CFArray::from_CFTypes(&[sub(main_uid, 0), sub(capture_uid, 1)]);
        let desc = CFDictionary::<CFType, CFType>::from_CFType_pairs(&[
            (key("name"), text(name)),
            (key("uid"), text(uid)),
            (key("stacked"), num(1)),
            (key("private"), num(0)),
            (key("master"), text(main_uid)),
            (key("subdevices"), subdevices.as_CFType()),
        ]);

        let mut id: AudioObjectID = 0;
        let st = unsafe { AudioHardwareCreateAggregateDevice(desc.as_concrete_TypeRef() as _, &mut id) };
        if st != 0 {
            return Err(Error::Audio(format!("no se pudo crear la salida múltiple (código {st})")));
        }
        Ok(id)
    }

    pub fn destroy_aggregate(id: AudioObjectID) -> Result<()> {
        let st = unsafe { AudioHardwareDestroyAggregateDevice(id) };
        if st != 0 {
            return Err(Error::Audio(format!("no se pudo borrar el dispositivo (código {st})")));
        }
        Ok(())
    }

    pub fn list_devices() -> Result<Vec<DeviceInfo>> {
        let mut out = Vec::new();
        for id in device_ids() {
            let Some(name) = string_property(id, kAudioObjectPropertyName) else { continue };
            let Some(uid) = string_property(id, kAudioDevicePropertyDeviceUID) else { continue };
            out.push(DeviceInfo {
                name,
                uid,
                input_channels: channel_count(id, kAudioObjectPropertyScopeInput),
                output_channels: channel_count(id, kAudioObjectPropertyScopeOutput),
            });
        }
        Ok(out)
    }
}

/// Indica si una salida acaba en BlackHole 2ch (la captura). Reproducir ahí la voz traducida
/// la vuelve a meter en la captura y la app se traduce a sí misma en bucle.
fn feeds_capture(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("blackhole 2ch") || n == "lingora" || n.contains("salida múltiple") || n.contains("multi-output")
}

/// Reproduce muestras mono en una salida concreta y espera a que terminen.
/// `volume` es una ganancia (1.0 = original); lo que pase de ±1 se recorta.
///
/// Se hace en Rust y no en el WebView porque WKWebView no implementa
/// `AudioContext.setSinkId`: todo sonaba por la salida del sistema (la salida
/// múltiple), entraba en BlackHole y se volvía a traducir. Es bloqueante;
/// llamarla desde `spawn_blocking`.
///
/// La salida se mantiene abierta entre frases (ver `Output`): abrirla y
/// cerrarla en cada frase hacía que los auriculares Bluetooth se comieran el
/// principio de cada una y que las frases sonaran cortadas.
pub fn play_blocking(samples: &[f32], sample_rate: u32, device_name: &str, volume: f32) -> Result<()> {
    let shared = output_for(device_name)?;
    let gain = volume.clamp(0.0, 2.0);
    let data: Vec<f32> = resample_linear(samples, sample_rate, shared.rate)
        .into_iter()
        .map(|v| (v * gain).clamp(-1.0, 1.0))
        .collect();
    let duration = std::time::Duration::from_secs_f64(data.len() as f64 / shared.rate as f64);

    let (done_tx, done_rx) = std::sync::mpsc::channel();
    shared
        .queue
        .lock()
        .expect("cola de audio")
        .push_back(Job { data, pos: 0, done: Some(done_tx) });

    // Margen: la cola puede tener frases de otro carril delante.
    match done_rx.recv_timeout(duration * 3 + std::time::Duration::from_secs(3)) {
        Ok(()) => Ok(()),
        Err(_) if shared.dead.load(std::sync::atomic::Ordering::Relaxed) => Err(Error::Audio(format!(
            "la salida \"{device_name}\" se desconectó"
        ))),
        Err(_) => Err(Error::Audio(format!("la salida \"{device_name}\" dejó de reproducir"))),
    }
}

/// Una frase en la cola de una salida.
struct Job {
    data: Vec<f32>,
    pos: usize,
    /// Avisa a `play_blocking` cuando la frase termina de sonar.
    done: Option<std::sync::mpsc::Sender<()>>,
}

/// Estado compartido entre `play_blocking` y el callback de audio.
struct Shared {
    queue: std::sync::Mutex<std::collections::VecDeque<Job>>,
    /// El dispositivo falló (p. ej. se desconectaron los auriculares).
    dead: std::sync::atomic::AtomicBool,
    rate: u32,
}

/// Salida abierta. El stream de cpal vive en su propio hilo (no es `Send`);
/// al soltar `_stop` el hilo termina y cierra el stream.
struct Output {
    shared: std::sync::Arc<Shared>,
    _stop: std::sync::mpsc::Sender<()>,
}

/// Salidas abiertas por nombre de dispositivo.
fn outputs() -> &'static std::sync::Mutex<std::collections::HashMap<String, Output>> {
    static OUTPUTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, Output>>> =
        std::sync::OnceLock::new();
    OUTPUTS.get_or_init(Default::default)
}

/// Devuelve la salida abierta para ese dispositivo, abriéndola si hace falta.
fn output_for(device_name: &str) -> Result<std::sync::Arc<Shared>> {
    use cpal::traits::{DeviceTrait, HostTrait};

    // La salida del sistema se resuelve a su nombre: si cambia, se abre la nueva.
    let name = if device_name.is_empty() {
        cpal::default_host()
            .default_output_device()
            .and_then(|d| d.name().ok())
            .ok_or_else(|| Error::Audio("no hay salida de audio del sistema".into()))?
    } else {
        device_name.to_string()
    };
    if feeds_capture(&name) {
        return Err(Error::Audio(format!(
            "la salida \"{name}\" lleva a BlackHole y la traducción se volvería a capturar. \
             Elige las bocinas o unos auriculares como salida."
        )));
    }

    let mut map = outputs().lock().expect("salidas abiertas");
    if let Some(out) = map.get(&name) {
        if !out.shared.dead.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(out.shared.clone());
        }
        tracing::info!("la salida \"{name}\" falló; se vuelve a abrir");
    }
    let out = open_output(&name)?;
    let shared = out.shared.clone();
    map.insert(name, out);
    Ok(shared)
}

fn open_output(name: &str) -> Result<Output> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<std::sync::Arc<Shared>>>();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let name = name.to_string();
    std::thread::Builder::new()
        .name(format!("salida {name}"))
        .spawn(move || match start_stream(&name) {
            Ok((stream, shared)) => {
                let _ = ready_tx.send(Ok(shared));
                // Bloquea hasta que se suelte `_stop`; entonces se cierra el stream.
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        })
        .map_err(|e| Error::Audio(format!("no se pudo crear el hilo de audio: {e}")))?;
    let shared = ready_rx
        .recv()
        .map_err(|_| Error::Audio("el hilo de audio terminó sin abrir la salida".into()))??;
    Ok(Output { shared, _stop: stop_tx })
}

fn start_stream(name: &str) -> Result<(cpal::Stream, std::sync::Arc<Shared>)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    // Se busca entre todos los dispositivos: `output_devices` descarta las
    // bocinas integradas porque cpal no sabe leer sus formatos (ver abajo).
    // Hay que filtrar por salida: los auriculares Bluetooth aparecen como dos
    // dispositivos con el mismo nombre, uno de entrada y otro de salida, y el
    // de entrada suele salir primero.
    let device = cpal::default_host()
        .devices()
        .map_err(|e| Error::Audio(format!("no se pudieron listar las salidas: {e}")))?
        .filter(|d| d.name().map(|n| n == name).unwrap_or(false))
        .find(has_output)
        .ok_or_else(|| Error::Audio(format!("no se encontró la salida \"{name}\"")))?;

    // En macOS reciente cpal falla al leer los formatos de las bocinas
    // integradas y de los AirPods ("Invalid property value"). Se usa entonces
    // la frecuencia y los canales actuales según Core Audio, en float32. Pedir
    // otra frecuencia haría que cpal la cambiara y descuadraría la salida
    // múltiple.
    let (config, format) = match device.default_output_config() {
        Ok(supported) => (supported.config(), supported.sample_format()),
        Err(e) => {
            #[cfg(target_os = "macos")]
            let fallback = macos::output_format(name);
            #[cfg(not(target_os = "macos"))]
            let fallback: Option<(u32, u16)> = None;
            let (rate, channels) = fallback
                .ok_or_else(|| Error::Audio(format!("salida \"{name}\" sin configuración: {e}")))?;
            let config = cpal::StreamConfig {
                channels,
                sample_rate: cpal::SampleRate(rate),
                buffer_size: cpal::BufferSize::Default,
            };
            (config, cpal::SampleFormat::F32)
        }
    };

    let shared = std::sync::Arc::new(Shared {
        queue: Default::default(),
        dead: Default::default(),
        rate: config.sample_rate.0,
    });
    let stream = match format {
        cpal::SampleFormat::F32 => build_stream::<f32>(&device, &config, shared.clone()),
        cpal::SampleFormat::I16 => build_stream::<i16>(&device, &config, shared.clone()),
        cpal::SampleFormat::I32 => build_stream::<i32>(&device, &config, shared.clone()),
        other => return Err(Error::Audio(format!("formato de salida no soportado: {other:?}"))),
    }?;
    stream
        .play()
        .map_err(|e| Error::Audio(format!("no se pudo reproducir en \"{name}\": {e}")))?;
    tracing::info!("salida abierta: {name} ({} Hz, {} canales)", config.sample_rate.0, config.channels);
    Ok((stream, shared))
}

/// Si un dispositivo tiene salida. No basta con pedir su configuración: las
/// bocinas integradas también fallan ahí (ver `start_stream`), pero con otro
/// error; solo `StreamTypeNotSupported` indica que no hay salida.
fn has_output(device: &cpal::Device) -> bool {
    use cpal::traits::DeviceTrait;
    !matches!(
        device.default_output_config(),
        Err(cpal::DefaultStreamConfigError::StreamTypeNotSupported)
    )
}

/// Stream que reproduce la cola de frases una tras otra, sin huecos, y
/// silencio cuando está vacía.
fn build_stream<T>(device: &cpal::Device, config: &cpal::StreamConfig, shared: std::sync::Arc<Shared>) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    use cpal::traits::DeviceTrait;

    let channels = config.channels as usize;
    let on_error = shared.clone();
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _| {
                let mut queue = shared.queue.lock().expect("cola de audio");
                for frame in out.chunks_mut(channels) {
                    let v = loop {
                        let Some(job) = queue.front_mut() else { break 0.0 };
                        if let Some(&v) = job.data.get(job.pos) {
                            job.pos += 1;
                            break v;
                        }
                        if let Some(done) = queue.pop_front().and_then(|j| j.done) {
                            let _ = done.send(());
                        }
                    };
                    for s in frame.iter_mut() {
                        *s = T::from_sample(v);
                    }
                }
                // Avisa ya de las frases que acaban justo al final del búfer.
                while queue.front().is_some_and(|j| j.pos >= j.data.len()) {
                    if let Some(done) = queue.pop_front().and_then(|j| j.done) {
                        let _ = done.send(());
                    }
                }
            },
            move |e| {
                tracing::warn!("error en la salida de audio: {e}");
                on_error.dead.store(true, std::sync::atomic::Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| Error::Audio(format!("no se pudo abrir la salida: {e}")))
}

/// Remuestreo lineal: suficiente para voz y sin dependencias.
fn resample_linear(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let len = (samples.len() as f64 / ratio).floor() as usize;
    (0..len)
        .map(|i| {
            let x = i as f64 * ratio;
            let j = x as usize;
            let f = (x - j as f64) as f32;
            let a = samples[j];
            let b = samples.get(j + 1).copied().unwrap_or(a);
            a + (b - a) * f
        })
        .collect()
}

