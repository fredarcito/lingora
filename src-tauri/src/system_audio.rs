//! Captura del audio del Mac sin BlackHole, con las "process taps" de Core
//! Audio (macOS 14.2+).
//!
//! Una tap global copia lo que suena en el Mac, salvo los procesos excluidos:
//! se excluye a la propia Lingora, así su voz traducida nunca vuelve a entrar
//! en la captura. La tap se lee a través de un dispositivo agregado privado
//! (solo lo ve esta app) y quien usa la app sigue oyendo por su salida de
//! siempre. La primera vez macOS pide el permiso "Grabación de audio del
//! sistema"; sin él la tap entrega silencio, no un error.
//!
//! `AudioHardwareCreateProcessTap` y `CATapDescription` se buscan en tiempo de
//! ejecución: enlazarlos directamente impediría abrir la app en macOS 14.0/14.1.

use crate::error::{Error, Result};

/// Muestras por bloque entregado a la UI: lo mismo que su ScriptProcessor.
pub const BLOCK_FRAMES: usize = 4096;

/// Si este Mac permite capturar el audio del sistema sin BlackHole.
pub fn supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        imp::supported()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Captura en curso; se detiene al soltarla.
pub struct Capture {
    #[cfg(target_os = "macos")]
    _inner: imp::Tap,
    pub sample_rate: u32,
}

/// Empieza a capturar. `on_block` recibe bloques mono de `BLOCK_FRAMES`
/// muestras a `sample_rate`, desde un hilo propio.
pub fn start(on_block: impl Fn(Vec<f32>) + Send + 'static) -> Result<Capture> {
    #[cfg(target_os = "macos")]
    {
        let (tap, sample_rate) = imp::Tap::start(Box::new(on_block))?;
        Ok(Capture { _inner: tap, sample_rate })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = on_block;
        Err(Error::Audio("solo macOS por ahora".into()))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use coreaudio_sys::*;
    use std::ffi::{c_char, c_void, CString};
    use std::sync::mpsc;

    use crate::objc::{class, msg, objc_autoreleasePoolPop, objc_autoreleasePoolPush, Id};

    type CreateTap = unsafe extern "C" fn(Id, *mut AudioObjectID) -> OSStatus;
    type DestroyTap = unsafe extern "C" fn(AudioObjectID) -> OSStatus;

    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    fn symbol(name: &str) -> *mut c_void {
        let name = CString::new(name).expect("nombre sin ceros");
        unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) }
    }

    pub fn supported() -> bool {
        !symbol("AudioHardwareCreateProcessTap").is_null() && !class("CATapDescription").is_null()
    }

    fn address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn get<T: Copy>(id: AudioObjectID, selector: u32, init: T) -> Option<T> {
        let addr = address(selector);
        let mut value = init;
        let mut size = std::mem::size_of::<T>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut value as *mut T as *mut c_void)
        };
        (st == 0).then_some(value)
    }

    /// El objeto de Core Audio de este proceso, para excluirlo de la tap.
    fn own_process_object() -> Option<AudioObjectID> {
        let addr = address(kAudioHardwarePropertyTranslatePIDToProcessObject);
        let pid = std::process::id() as i32;
        let mut object: AudioObjectID = kAudioObjectUnknown;
        let mut size = std::mem::size_of::<AudioObjectID>() as u32;
        let st = unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject,
                &addr,
                std::mem::size_of::<i32>() as u32,
                &pid as *const i32 as *const c_void,
                &mut size,
                &mut object as *mut AudioObjectID as *mut c_void,
            )
        };
        (st == 0 && object != kAudioObjectUnknown).then_some(object)
    }

    /// Crea la tap global estéreo sin este proceso. Devuelve su ID y su UUID.
    fn create_tap() -> Result<(AudioObjectID, String)> {
        let create = symbol("AudioHardwareCreateProcessTap");
        if create.is_null() {
            return Err(Error::Audio("este Mac no permite capturar el audio del sistema (hace falta macOS 14.2)".into()));
        }
        let create: CreateTap = unsafe { std::mem::transmute(create) };

        let excluded: Vec<CFNumber> = own_process_object().map(|id| CFNumber::from(id as i32)).into_iter().collect();
        if excluded.is_empty() {
            tracing::warn!("no se encontró el proceso de Lingora en Core Audio: su voz entrará en la captura");
        }
        let excluded = CFArray::from_CFTypes(&excluded);

        unsafe {
            let pool = objc_autoreleasePoolPush();
            let desc = msg!(class("CATapDescription"), "alloc");
            let desc = msg!(desc, "initStereoGlobalTapButExcludeProcesses:", excluded.as_concrete_TypeRef() as Id => Id);
            let result = if desc.is_null() {
                Err(Error::Audio("no se pudo describir la captura del sistema".into()))
            } else {
                msg!(desc, "setPrivate:", true => bool);
                // NSUUID → NSString, puente sin coste con CFString.
                let uuid = msg!(msg!(desc, "UUID"), "UUIDString");
                let uuid = CFString::wrap_under_get_rule(uuid as _).to_string();
                let mut tap: AudioObjectID = kAudioObjectUnknown;
                let st = create(desc, &mut tap);
                msg!(desc, "release");
                if st != 0 || tap == kAudioObjectUnknown {
                    Err(Error::Audio(format!("macOS no dejó capturar el audio del sistema (código {st})")))
                } else {
                    Ok((tap, uuid))
                }
            };
            objc_autoreleasePoolPop(pool);
            result
        }
    }

    fn destroy_tap(tap: AudioObjectID) {
        let destroy = symbol("AudioHardwareDestroyProcessTap");
        if !destroy.is_null() {
            let destroy: DestroyTap = unsafe { std::mem::transmute(destroy) };
            unsafe { destroy(tap) };
        }
    }

    /// Agregado privado cuya única entrada es la tap.
    fn create_aggregate(tap_uuid: &str) -> Result<AudioObjectID> {
        let key = |k: &str| CFString::new(k).as_CFType();
        let text = |v: &str| CFString::new(v).as_CFType();
        let num = |v: i32| CFNumber::from(v).as_CFType();
        let tap = CFDictionary::<CFType, CFType>::from_CFType_pairs(&[(key("uid"), text(tap_uuid)), (key("drift"), num(1))]);
        let desc = CFDictionary::<CFType, CFType>::from_CFType_pairs(&[
            (key("name"), text("Lingora · audio del Mac")),
            (key("uid"), text(&format!("com.lingora.system-audio.{tap_uuid}"))),
            (key("private"), num(1)),
            (key("stacked"), num(0)),
            (key("tapautostart"), num(1)),
            (key("taps"), CFArray::from_CFTypes(&[tap.as_CFType()]).as_CFType()),
        ]);
        let mut id: AudioObjectID = 0;
        let st = unsafe { AudioHardwareCreateAggregateDevice(desc.as_concrete_TypeRef() as _, &mut id) };
        if st != 0 {
            return Err(Error::Audio(format!("no se pudo preparar la captura del sistema (código {st})")));
        }
        Ok(id)
    }

    /// Lo que comparte el hilo de audio con el resto: solo un canal.
    struct Shared {
        tx: mpsc::Sender<Vec<f32>>,
    }

    /// Callback de Core Audio: mezcla a mono y lo pasa al hilo de entrega.
    unsafe extern "C" fn io_proc(
        _device: AudioObjectID,
        _now: *const AudioTimeStamp,
        input: *const AudioBufferList,
        _input_time: *const AudioTimeStamp,
        _output: *mut AudioBufferList,
        _output_time: *const AudioTimeStamp,
        client: *mut c_void,
    ) -> OSStatus {
        if input.is_null() || client.is_null() {
            return 0;
        }
        let shared = &*(client as *const Shared);
        let n = (*input).mNumberBuffers as usize;
        if n == 0 {
            return 0;
        }
        let buffers = std::slice::from_raw_parts((*input).mBuffers.as_ptr(), n);
        let data = |b: &AudioBuffer| {
            if b.mData.is_null() {
                &[][..]
            } else {
                std::slice::from_raw_parts(b.mData as *const f32, b.mDataByteSize as usize / 4)
            }
        };
        let mono: Vec<f32> = if n == 1 {
            // Intercalado: L R L R…
            let channels = buffers[0].mNumberChannels.max(1) as usize;
            data(&buffers[0])
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            // Un búfer por canal.
            let frames = buffers.iter().map(|b| data(b).len()).min().unwrap_or(0);
            (0..frames)
                .map(|i| buffers.iter().map(|b| data(b)[i]).sum::<f32>() / n as f32)
                .collect()
        };
        let _ = shared.tx.send(mono);
        0
    }

    pub struct Tap {
        tap: AudioObjectID,
        aggregate: AudioObjectID,
        proc_id: AudioDeviceIOProcID,
        shared: *mut Shared,
    }

    // Los IDs son números de Core Audio y `shared` solo se libera en Drop.
    unsafe impl Send for Tap {}

    impl Tap {
        pub fn start(on_block: Box<dyn Fn(Vec<f32>) + Send>) -> Result<(Tap, u32)> {
            let (tap, uuid) = create_tap()?;
            let aggregate = match create_aggregate(&uuid) {
                Ok(id) => id,
                Err(e) => {
                    destroy_tap(tap);
                    return Err(e);
                }
            };

            let format = get(tap, kAudioTapPropertyFormat, unsafe { std::mem::zeroed::<AudioStreamBasicDescription>() });
            let rate = get(aggregate, kAudioDevicePropertyNominalSampleRate, 0f64)
                .filter(|r| *r > 0.0)
                .or(format.map(|f| f.mSampleRate))
                .unwrap_or(48_000.0);
            if let Some(f) = format {
                tracing::info!(
                    "captura del sistema: {} Hz, {} canales, flags {:#x}",
                    f.mSampleRate,
                    f.mChannelsPerFrame,
                    f.mFormatFlags
                );
                if f.mFormatFlags & kAudioFormatFlagIsFloat == 0 {
                    unsafe { AudioHardwareDestroyAggregateDevice(aggregate) };
                    destroy_tap(tap);
                    return Err(Error::Audio("la captura del sistema no llega en float".into()));
                }
            }

            // Se agrupa en bloques fijos fuera del hilo de audio.
            let (tx, rx) = mpsc::channel::<Vec<f32>>();
            std::thread::Builder::new()
                .name("lingora-system-audio".into())
                .spawn(move || {
                    let mut pending = Vec::with_capacity(BLOCK_FRAMES * 2);
                    while let Ok(chunk) = rx.recv() {
                        pending.extend_from_slice(&chunk);
                        while pending.len() >= BLOCK_FRAMES {
                            on_block(pending.drain(..BLOCK_FRAMES).collect());
                        }
                    }
                })
                .map_err(|e| Error::Audio(format!("no se pudo arrancar la captura: {e}")))?;

            let shared = Box::into_raw(Box::new(Shared { tx }));
            let mut proc_id: AudioDeviceIOProcID = None;
            let st = unsafe { AudioDeviceCreateIOProcID(aggregate, Some(io_proc), shared as *mut c_void, &mut proc_id) };
            let mut tap = Tap { tap, aggregate, proc_id, shared };
            if st != 0 {
                tap.proc_id = None;
                return Err(Error::Audio(format!("no se pudo leer la captura del sistema (código {st})")));
            }
            let st = unsafe { AudioDeviceStart(aggregate, tap.proc_id) };
            if st != 0 {
                return Err(Error::Audio(format!("no se pudo empezar a capturar (código {st})")));
            }
            Ok((tap, rate as u32))
        }
    }

    impl Drop for Tap {
        fn drop(&mut self) {
            unsafe {
                if self.proc_id.is_some() {
                    AudioDeviceStop(self.aggregate, self.proc_id);
                    AudioDeviceDestroyIOProcID(self.aggregate, self.proc_id);
                }
                AudioHardwareDestroyAggregateDevice(self.aggregate);
                destroy_tap(self.tap);
                // Al soltar el emisor termina el hilo de entrega.
                drop(Box::from_raw(self.shared));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captura mientras `say` habla y comprueba que llega sonido. Necesita el
    /// permiso de grabación de audio del sistema.
    #[test]
    #[ignore]
    fn captures_system_audio() {
        assert!(supported());
        let peak = std::sync::Arc::new(std::sync::Mutex::new(0f32));
        let blocks = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (p, b) = (peak.clone(), blocks.clone());
        let capture = start(move |block| {
            let max = block.iter().fold(0f32, |m, v| m.max(v.abs()));
            let mut p = p.lock().unwrap();
            *p = p.max(max);
            b.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        std::process::Command::new("say").arg("Testing the system audio capture").status().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let rate = capture.sample_rate;
        drop(capture);
        let peak = *peak.lock().unwrap();
        let blocks = blocks.load(std::sync::atomic::Ordering::Relaxed);
        eprintln!("{rate} Hz, {blocks} bloques, pico {peak}");
        assert!(blocks > 0, "no llegaron bloques");
        assert!(peak > 0.01, "solo llegó silencio (¿falta el permiso?)");
    }
}
