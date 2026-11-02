//! Microphone with echo cancellation (WebRTC's AEC3, through `sonora`), for a
//! meeting on speakers: the microphone hears the meeting and Lingora's voice,
//! and the canceller removes them. See docs/aislamiento-audio.md, section 7.
//!
//! Two inputs meet in one worker thread:
//! - the microphone, opened here with cpal;
//! - the reference, everything that plays on the device with Lingora included
//!   (macOS: a process tap without exclusions; Windows: WASAPI loopback of the
//!   default output, through cpal).
//!
//! Both are cut into 10 ms frames and handed to the canceller in arrival order:
//! the reference is captured before it sounds, so the canceller always sees
//! what played before the microphone hears it.

use crate::error::{Error, Result};
use sonora::config::{AdaptiveDigital, EchoCanceller, GainController2, HighPassFilter};
use sonora::{AudioProcessing, Config, StreamConfig};
use std::sync::mpsc;

/// Samples per block delivered to the UI: the same as the system capture.
const BLOCK_FRAMES: usize = crate::system_audio::BLOCK_FRAMES;

/// Audio arriving at the worker thread, mono.
enum Chunk {
    Mic(Vec<f32>),
    Reference(Vec<f32>),
}

/// Capture in progress; it stops when dropped.
pub struct Capture {
    pub sample_rate: u32,
    /// Dropping it ends the thread that holds the streams (cpal's aren't `Send`).
    _stop: mpsc::Sender<()>,
}

/// Opens the microphone `device_name` ("" for the default one) with echo
/// cancellation. `on_block` gets mono blocks of `BLOCK_FRAMES` samples at
/// `sample_rate`, from its own thread. `auto_gain` adds WebRTC's adaptive
/// gain (AGC2), as the window does for real microphones.
pub fn start(device_name: &str, auto_gain: bool, on_block: impl Fn(Vec<f32>) + Send + 'static) -> Result<Capture> {
    let name = device_name.to_string();
    let on_block: Box<dyn Fn(Vec<f32>) + Send> = Box::new(on_block);
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    std::thread::Builder::new()
        .name("lingora-mic".into())
        .spawn(move || {
            let (tx, rx) = mpsc::channel::<Chunk>();
            let (mic, mic_rate) = match open_mic(&name, tx.clone()) {
                Ok(opened) => opened,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            // Without a reference the microphone still works, just without cancelling.
            let (reference, ref_rate) = match open_reference(tx) {
                Ok((reference, rate)) => (Some(reference), rate),
                Err(e) => {
                    tracing::warn!("cancelación de eco sin referencia: {e}");
                    (None, mic_rate)
                }
            };
            tracing::info!("micrófono con cancelación de eco: {mic_rate} Hz, referencia {ref_rate} Hz");
            let worker = std::thread::Builder::new()
                .name("lingora-echo".into())
                .spawn(move || run(rx, mic_rate, ref_rate, auto_gain, on_block));
            if let Err(e) = worker {
                let _ = ready_tx.send(Err(Error::Audio(format!("no se pudo arrancar la cancelación de eco: {e}"))));
                return;
            }
            let _ = ready_tx.send(Ok(mic_rate));
            // Blocks until `Capture` is dropped; then the streams close and,
            // with no senders left, the worker ends.
            let _ = stop_rx.recv();
            drop(mic);
            drop(reference);
        })
        .map_err(|e| Error::Audio(format!("no se pudo arrancar el micrófono: {e}")))?;
    let sample_rate = ready_rx
        .recv()
        .map_err(|_| Error::Audio("el micrófono no arrancó".into()))??;
    Ok(Capture { sample_rate, _stop: stop_tx })
}

/// The canceller: reference frames go to `process_render_f32`, microphone
/// frames to `process_capture_f32`, and the result to `on_block`.
fn run(rx: mpsc::Receiver<Chunk>, mic_rate: u32, ref_rate: u32, auto_gain: bool, on_block: Box<dyn Fn(Vec<f32>) + Send>) {
    let config = Config {
        echo_canceller: Some(EchoCanceller::default()),
        high_pass_filter: Some(HighPassFilter::default()),
        // Noise suppression stays off, as in the window: it distorts voices
        // and recognition does better without it.
        gain_controller2: auto_gain.then(|| GainController2 {
            adaptive_digital: Some(AdaptiveDigital::default()),
            ..Default::default()
        }),
        ..Default::default()
    };
    let capture = StreamConfig::new(mic_rate, 1);
    let render = StreamConfig::new(ref_rate, 1);
    let (mic_n, ref_n) = (capture.num_frames(), render.num_frames());
    let mut apm = AudioProcessing::builder()
        .config(config)
        .capture_config(capture)
        .render_config(render)
        .build();

    let mut mic: Vec<f32> = Vec::new();
    let mut reference: Vec<f32> = Vec::new();
    let mut out: Vec<f32> = Vec::with_capacity(BLOCK_FRAMES * 2);
    let mut frame = vec![0f32; mic_n.max(ref_n)];
    let mut failed = false;
    while let Ok(chunk) = rx.recv() {
        match chunk {
            Chunk::Reference(samples) => {
                reference.extend_from_slice(&samples);
                let mut start = 0;
                while reference.len() - start >= ref_n {
                    let src = &reference[start..start + ref_n];
                    if let Err(e) = apm.process_render_f32(&[src], &mut [&mut frame[..ref_n]]) {
                        warn_once(&mut failed, &format!("{e:?}"));
                    }
                    start += ref_n;
                }
                reference.drain(..start);
            }
            Chunk::Mic(samples) => {
                mic.extend_from_slice(&samples);
                let mut start = 0;
                while mic.len() - start >= mic_n {
                    let src = &mic[start..start + mic_n];
                    match apm.process_capture_f32(&[src], &mut [&mut frame[..mic_n]]) {
                        Ok(()) => out.extend_from_slice(&frame[..mic_n]),
                        // The raw frame is better than a hole in the audio.
                        Err(e) => {
                            warn_once(&mut failed, &format!("{e:?}"));
                            out.extend_from_slice(src);
                        }
                    }
                    start += mic_n;
                }
                mic.drain(..start);
                while out.len() >= BLOCK_FRAMES {
                    on_block(out.drain(..BLOCK_FRAMES).collect());
                }
            }
        }
    }
    let stats = apm.statistics();
    tracing::info!(
        "cancelación de eco terminada: retraso {:?} ms, mejora {:?} dB",
        stats.delay_ms,
        stats.echo_return_loss_enhancement,
    );
}

fn warn_once(failed: &mut bool, error: &str) {
    if !*failed {
        tracing::warn!("cancelación de eco: {error}");
        *failed = true;
    }
}

/// Opens the microphone and sends it to `tx` in mono. Returns the stream and
/// its sample rate.
fn open_mic(name: &str, tx: mpsc::Sender<Chunk>) -> Result<(cpal::Stream, u32)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = if name.is_empty() {
        host.default_input_device()
    } else {
        // Bluetooth headphones show up as two devices with the same name: the
        // input one is wanted.
        host.devices()
            .map_err(|e| Error::Audio(format!("no se pudieron listar los micrófonos: {e}")))?
            .filter(|d| d.name().map(|n| n == name).unwrap_or(false))
            .find(has_input)
    }
    .ok_or_else(|| Error::Audio(format!("no se encontró el micrófono \"{name}\"")))?;
    let label = device.name().unwrap_or_default();

    // Same as the outputs (`audio::start_stream`): on recent macOS cpal can
    // fail to read the built-in devices' formats; Core Audio's current rate
    // and channels are used then, in float32.
    let (config, format) = match device.default_input_config() {
        Ok(supported) => (supported.config(), supported.sample_format()),
        Err(e) => {
            #[cfg(target_os = "macos")]
            let fallback = crate::audio::macos::input_format(&label);
            #[cfg(not(target_os = "macos"))]
            let fallback: Option<(u32, u16)> = None;
            let (rate, channels) =
                fallback.ok_or_else(|| Error::Audio(format!("micrófono \"{label}\" sin configuración: {e}")))?;
            let config = cpal::StreamConfig {
                channels,
                sample_rate: cpal::SampleRate(rate),
                buffer_size: cpal::BufferSize::Default,
            };
            (config, cpal::SampleFormat::F32)
        }
    };
    let stream = build_input(&device, &config, format, move |mono| {
        let _ = tx.send(Chunk::Mic(mono));
    })?;
    stream
        .play()
        .map_err(|e| Error::Audio(format!("no se pudo abrir el micrófono \"{label}\": {e}")))?;
    tracing::info!("micrófono abierto: {label} ({} Hz, {} canales)", config.sample_rate.0, config.channels);
    Ok((stream, config.sample_rate.0))
}

/// The reference on the Mac: a tap of everything that plays, Lingora included.
#[cfg(target_os = "macos")]
fn open_reference(tx: mpsc::Sender<Chunk>) -> Result<(crate::system_audio::Capture, u32)> {
    let capture = crate::system_audio::start_reference(move |chunk| {
        let _ = tx.send(Chunk::Reference(chunk));
    })?;
    let rate = capture.sample_rate;
    Ok((capture, rate))
}

/// The reference on Windows: loopback of the default output. cpal opens it
/// when an input stream is built on an output device.
#[cfg(windows)]
fn open_reference(tx: mpsc::Sender<Chunk>) -> Result<(cpal::Stream, u32)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| Error::Audio("no hay salida de audio del sistema".into()))?;
    let supported = device
        .default_output_config()
        .map_err(|e| Error::Audio(format!("salida sin configuración: {e}")))?;
    let config = supported.config();
    let stream = build_input(&device, &config, supported.sample_format(), move |mono| {
        let _ = tx.send(Chunk::Reference(mono));
    })?;
    stream
        .play()
        .map_err(|e| Error::Audio(format!("no se pudo capturar la salida: {e}")))?;
    Ok((stream, config.sample_rate.0))
}

#[cfg(not(any(target_os = "macos", windows)))]
fn open_reference(_tx: mpsc::Sender<Chunk>) -> Result<((), u32)> {
    Err(Error::Audio("solo macOS y Windows".into()))
}

/// Whether a device has an input (see `audio::has_output`).
fn has_input(device: &cpal::Device) -> bool {
    use cpal::traits::DeviceTrait;
    !matches!(
        device.default_input_config(),
        Err(cpal::DefaultStreamConfigError::StreamTypeNotSupported)
    )
}

/// Input stream that hands `on_mono` each callback's audio mixed down to mono.
fn build_input(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: cpal::SampleFormat,
    on_mono: impl Fn(Vec<f32>) + Send + 'static,
) -> Result<cpal::Stream> {
    match format {
        cpal::SampleFormat::F32 => build_typed::<f32>(device, config, on_mono),
        cpal::SampleFormat::I16 => build_typed::<i16>(device, config, on_mono),
        cpal::SampleFormat::I32 => build_typed::<i32>(device, config, on_mono),
        other => Err(Error::Audio(format!("formato de entrada no soportado: {other:?}"))),
    }
}

fn build_typed<T>(device: &cpal::Device, config: &cpal::StreamConfig, on_mono: impl Fn(Vec<f32>) + Send + 'static) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    use cpal::traits::DeviceTrait;
    use cpal::Sample;

    let channels = config.channels.max(1) as usize;
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mono = data
                    .chunks_exact(channels)
                    .map(|frame| frame.iter().map(|&v| f32::from_sample(v)).sum::<f32>() / channels as f32)
                    .collect();
                on_mono(mono);
            },
            |e| tracing::warn!("error de audio en la entrada: {e}"),
            None,
        )
        .map_err(|e| Error::Audio(format!("no se pudo abrir la entrada: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The canceller removes a delayed copy of the reference from the
    /// microphone and keeps the near voice: what this module relies on.
    #[test]
    fn removes_the_echo_of_the_reference() {
        let rate = 16_000;
        let config = StreamConfig::new(rate, 1);
        let n = config.num_frames();
        let mut apm = AudioProcessing::builder()
            .config(Config { echo_canceller: Some(EchoCanceller::default()), ..Default::default() })
            .capture_config(config)
            .render_config(config)
            .build();
        // Far end: noise-like speech stand-in; echo: 40 ms later at half level.
        let mut seed = 1u32;
        let far: Vec<f32> = (0..rate as usize * 6)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.4
            })
            .collect();
        let delay = 640;
        let energy = |s: &[f32]| s.iter().map(|v| v * v).sum::<f32>();
        let (mut before, mut after) = (0f32, 0f32);
        let mut out = vec![0f32; n];
        let mut scratch = vec![0f32; n];
        for (i, far_frame) in far.chunks_exact(n).enumerate() {
            apm.process_render_f32(&[far_frame], &mut [&mut scratch]).unwrap();
            let mic: Vec<f32> = (0..n)
                .map(|j| {
                    let t = i * n + j;
                    if t >= delay { far[t - delay] * 0.5 } else { 0.0 }
                })
                .collect();
            apm.process_capture_f32(&[&mic], &mut [&mut out]).unwrap();
            // Skip the first 3 s while it converges.
            if i * n > rate as usize * 3 {
                before += energy(&mic);
                after += energy(&out);
            }
        }
        let erle_db = 10.0 * (before / after.max(1e-9)).log10();
        eprintln!("echo removed: {erle_db:.1} dB");
        assert!(erle_db > 15.0, "only {erle_db:.1} dB removed");
    }
}
