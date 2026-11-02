//! Performance numbers for the log, so a tester's `Lingora-registro.txt` shows
//! where the CPU goes: the machine at startup (processor, cores, instruction
//! sets, RAM, GPU) and, on Windows, every 10 s while the app works, how much
//! CPU Lingora and the whole computer use and how busy listening was.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Listening since the last monitor line: calls, compute time and audio time.
static LISTEN_CALLS: AtomicU64 = AtomicU64::new(0);
static LISTEN_MS: AtomicU64 = AtomicU64::new(0);
static LISTEN_AUDIO_MS: AtomicU64 = AtomicU64::new(0);

/// Counts one listening call (live captions and final sentences alike).
pub fn listened(audio_secs: f32, took: Duration) {
    LISTEN_CALLS.fetch_add(1, Ordering::Relaxed);
    LISTEN_MS.fetch_add(took.as_millis() as u64, Ordering::Relaxed);
    LISTEN_AUDIO_MS.fetch_add((audio_secs * 1000.0) as u64, Ordering::Relaxed);
}

/// Writes what the machine has: processor, threads, instruction sets that
/// matter to the int8 models, RAM and whether translation can use the GPU.
pub fn log_system() {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0);
    tracing::info!("equipo: {} · {threads} hilos · {}", cpu_brand(), cpu_features());
    if let Some(ram) = ram_gb() {
        tracing::info!("equipo: {ram:.1} GB de RAM");
    }
    tracing::info!(
        "compilado con GPU para la traducción: {}",
        if cfg!(feature = "vulkan") { "Vulkan" } else if cfg!(target_os = "macos") { "Metal" } else { "no (solo CPU)" }
    );
}

#[cfg(target_arch = "x86_64")]
fn cpu_brand() -> String {
    use std::arch::x86_64::__cpuid;
    #[allow(unused_unsafe)]
    let leaf = |n: u32| unsafe { __cpuid(n) };
    if leaf(0x8000_0000).eax < 0x8000_0004 {
        return "procesador desconocido".into();
    }
    let mut bytes = Vec::with_capacity(48);
    for n in 0x8000_0002..=0x8000_0004 {
        let r = leaf(n);
        for v in [r.eax, r.ebx, r.ecx, r.edx] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
    }
    String::from_utf8_lossy(&bytes).trim_matches('\0').trim().to_string()
}

#[cfg(not(target_arch = "x86_64"))]
fn cpu_brand() -> String {
    std::env::consts::ARCH.into()
}

/// The vector instructions ONNX Runtime and llama.cpp use: without AVX2 (or
/// VNNI for int8) the voice and listening models run much slower.
#[cfg(target_arch = "x86_64")]
fn cpu_features() -> String {
    let all = [
        ("avx2", is_x86_feature_detected!("avx2")),
        ("fma", is_x86_feature_detected!("fma")),
        ("avx512f", is_x86_feature_detected!("avx512f")),
        ("avx512vnni", is_x86_feature_detected!("avx512vnni")),
        ("avxvnni", is_x86_feature_detected!("avxvnni")),
    ];
    let present: Vec<&str> = all.iter().filter(|(_, on)| *on).map(|(name, _)| *name).collect();
    if present.is_empty() { "sin AVX2".into() } else { present.join(" ") }
}

#[cfg(not(target_arch = "x86_64"))]
fn cpu_features() -> String {
    "neon".into()
}

#[cfg(windows)]
fn ram_gb() -> Option<f64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some(status.ullTotalPhys as f64 / 1e9)
}

#[cfg(not(windows))]
fn ram_gb() -> Option<f64> {
    None
}

/// Every 10 s, one line with Lingora's and the computer's CPU and what
/// listening did. Quiet while the app is idle.
#[cfg(windows)]
pub fn start_monitor() {
    const EVERY: Duration = Duration::from_secs(10);
    let spawned = std::thread::Builder::new().name("perf".into()).spawn(|| {
        let Some(mut last) = cpu_times() else { return };
        loop {
            std::thread::sleep(EVERY);
            let Some(now) = cpu_times() else { return };
            let total = (now.system - last.system).max(1) as f64;
            let app = 100.0 * (now.process - last.process) as f64 / total;
            let busy = 100.0 * (1.0 - (now.idle - last.idle) as f64 / total);
            last = now;
            let calls = LISTEN_CALLS.swap(0, Ordering::Relaxed);
            let listen_ms = LISTEN_MS.swap(0, Ordering::Relaxed);
            let audio_ms = LISTEN_AUDIO_MS.swap(0, Ordering::Relaxed);
            if app < 5.0 && calls == 0 {
                continue;
            }
            tracing::info!(
                "rendimiento: Lingora {app:.0} % de CPU, todo el equipo {busy:.0} % · escucha: {calls} trozos, {:.1} s de cálculo para {:.1} s de audio",
                listen_ms as f64 / 1000.0,
                audio_ms as f64 / 1000.0,
            );
        }
    });
    if let Err(e) = spawned {
        tracing::warn!("no se pudo medir el rendimiento: {e}");
    }
}

#[cfg(not(windows))]
pub fn start_monitor() {}

/// CPU time in 100 ns units: this process, and the whole system (kernel time
/// includes idle time, so `system` is all the time of all cores).
#[cfg(windows)]
struct CpuTimes {
    process: u64,
    system: u64,
    idle: u64,
}

#[cfg(windows)]
fn cpu_times() -> Option<CpuTimes> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes, GetSystemTimes};
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    let [mut created, mut exited, mut kernel, mut user] = [FILETIME::default(); 4];
    let [mut idle, mut sys_kernel, mut sys_user] = [FILETIME::default(); 3];
    unsafe {
        GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user).ok()?;
        GetSystemTimes(Some(&raw mut idle), Some(&raw mut sys_kernel), Some(&raw mut sys_user)).ok()?;
    }
    Some(CpuTimes {
        process: ticks(kernel) + ticks(user),
        system: ticks(sys_kernel) + ticks(sys_user),
        idle: ticks(idle),
    })
}
