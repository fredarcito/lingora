# Plan: Lingora on Windows

Status (2026-10-30): the `.exe` is built in GitHub Actions
(`.github/workflows/windows-check.yml`, branch `windows-build`). Done: Phase 1
(to be tested with real audio), Phase 3 (espeak-ng and processes without a
window) and in 6 the models folder and the `keyring`. Translation runs on CPU;
`vulkan` is tested separately in Actions (see Phase 2). Without Rust for listing
devices, the interface uses the ones from the WebView (`listAudioDevices` in
`api.js`). On Windows the app writes its log to the desktop
(`Lingora-registro.txt`, `log_file.rs`), with the interface errors
(`utils/log.js`) and the Rust failures: that is what must be requested from whoever
tests. It follows `plan-autonomia.md`: since translation and voice already run
inside the app, almost everything left is what touches the system (audio, voices, windows).

Goal: an installer (Tauri `.exe` with NSIS) that opens on Windows 10/11 and
does the same as on the Mac: Translate audio, Take notes (also "Online meeting"),
the translated voice and the floating captions. Without installing anything else.

---

## 0. Where we are

Reviewed in the code (`#[cfg(target_os = "macos")]` and system calls):

| Part | On Windows today | Work |
|---|---|---|
| Interface (React), echo filter, notes, "(Me)" name | Same: pure JS | Nothing (except the texts that say "Mac", see Phase 7) |
| Microphone | `getUserMedia` in WebView2 | Test |
| Listening, Kokoro voice, speakers (sherpa-onnx) | The crate has a Windows version | Build and test |
| Translation (`llama-cpp-2`) | Builds on Windows; `metal` is Mac only | Phase 2: choose GPU |
| Phonemes (espeak-ng) | The `.exe` is missing | Phase 3 |
| **System audio** (`system_audio.rs`) | Returns "only macOS for now" | **Phase 1: the biggest one** |
| What is connected (`route.rs`) | Answers "don't know" → treated as speakers | Phase 4 |
| System voices (`system_voice.rs`) | Empty list | Phase 5 |
| Device list (`audio.rs`) | "only macOS" error | Phase 4 |
| Floating captions (`captions_window.rs`) | The AppKit part (`objc`) doesn't build there, the rest does | Phase 6 |
| Models folder (`config.rs`) | `$HOME/Library/Application Support/…`: `HOME` doesn't exist on Windows | Phase 6 |
| Groq key (`keyring`) | Only with `apple-native` | Phase 6 |
| `open` (show file, open link) | Doesn't exist on Windows | Phase 6 |
| `tar` to decompress models | Windows 10+ includes `tar.exe` (bsdtar, supports `.bz2`) | Test |
| Diagnostics (`doctor.rs`) | The audio checks are Mac only | Phase 6 |
| Scripts `build-espeak.sh` and `check-standalone.sh` | Mac only | Phases 3 and 8 |

The good part: the code already separates Mac from the rest with `cfg`, so each
part can be done separately and the Mac app doesn't change.

All of this is on CLAUDE.md's "don't touch" list (`audio.rs`,
`system_audio.rs`, `system_voice.rs`, `config.rs`, `doctor.rs`,
`tauri.conf.json`, new crates). **Each phase needs the user's yes**, and
the Windows work always goes inside `#[cfg(windows)]`: the Mac code is not
touched.

---

## Before starting: user decisions

1. **A Windows machine for testing.** It can't be done without one: building
   for Windows from the Mac isn't practical (sherpa-onnx, llama.cpp and MSVC), and
   audio is only tuned with real audio. Options: a PC of your own or a
   friend's, or a virtual machine (Parallels with Windows 11 ARM is enough to
   build and test the interface, **not** to tune audio or GPU).
2. **Minimum version.** The capture that excludes the app itself (Phase 1) is from
   Windows 10 2004 (May 2020) onwards. Proposal: Windows 10 2004+ and
   Windows 11.
3. **New crate: `windows`** (by Microsoft, MIT). It is needed for audio,
   voices and knowing what is connected. It is the equivalent of `coreaudio-sys`.
   It is only added for Windows (`[target.'cfg(windows)'.dependencies]`).
4. **The translation GPU** (Phase 2).
5. **Taskbar icon?** On the Mac the app doesn't show in the Dock. On
   Windows it is normal for it to show; hiding it can be confusing.

---

## Phase 1: system audio (the biggest one)

**First real test (2026-10-30, Dell with Windows 10 19041):** with the computer's
audio the app closed by itself (`0xc0000374`, corrupted memory, in
`ntdll.dll`); with the microphone it didn't. `system_audio.rs` (Windows only) was
adjusted to Microsoft's example: a 20 ms buffer (with 0 there is no period to
calculate it with), without `SRC_DEFAULT_QUALITY`, the "agile" activation
notice, the live operation until the response, and the events notice closed after
the client. It kept closing: the desktop log is cut off at
"activating", i.e. inside `ActivateAudioInterfaceAsync` or when collecting its
result. Now the notice only wakes the capture thread, which reads the
result itself (like the `wasapi` crate), and each step of the activation leaves
its line. Second PC (same day): Windows does answer `S_OK`, but it closes
before "activated", i.e. when getting the `IAudioClient` or releasing the
operation and the notice. Now both are kept alive for the whole capture (as in
Microsoft's example) and those steps also leave their line. Third test: it
closed after the last line of `activate_client`, on returning. **Cause found:**
windows-rs 0.61 gives `PROPVARIANT` a `Drop` that calls `PropVariantClear`,
which frees the blob with `CoTaskMemFree`; our blob pointed to the parameters
on the stack. Fix: `ManuallyDrop` around the `PROPVARIANT` (as the `wasapi`
crate does). To be tested. Note: Microsoft considers this capture good from build
20348 on; on Windows 10 (19041-19045) it works in OBS, but it may have failures.

**On the Mac today:** a Core Audio "process tap" copies what plays, except
Lingora itself, so its translated voice doesn't come back in.

**On Windows:** the equivalent API exists and does exactly that: WASAPI
*process loopback* capture (`ActivateAudioInterfaceAsync` with
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` and
`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`, passing Lingora's PID). It is
the same idea as on the Mac, without BlackHole or drivers.

- New `mod imp` for Windows inside `system_audio.rs`, with the **same
  public shape**: `supported()`, `start(on_block)` → `Capture`, mono blocks of
  `BLOCK_FRAMES` samples. `lib.rs`, `pipeline.rs` and the interface don't notice.
- The capture delivers the system mix format (usually 48 kHz stereo,
  `f32`): it is converted to mono as today.
- Careful: WASAPI delivers nothing when nothing plays (on the Mac silence arrived).
  It must be filled with zeros so that the VAD in `audio.js` measures pauses
  correctly. Otherwise the sentence cuts change.
- It doesn't ask for permission (on the Mac it does, "Screen & System Audio Recording").

**Risk:** medium. The API is little used and there are few examples in Rust. On
the Mac, most of what it took (see `problemas-conocidos.md`) came out when testing
with real audio, not when writing the code. The same has to be expected here.

**Test:** an English YouTube video → Translate audio → the translation must not
come back in (no loop) and the sentence cuts should resemble those on the Mac.

## Phase 2: translation with the Windows GPU

On the Mac all machines have the same GPU (Apple Silicon, shared memory). On
Windows it varies a lot, and it is **the biggest performance risk**:

| Option | Works on | Drawback |
|---|---|---|
| `vulkan` | NVIDIA, AMD, Intel (with up-to-date drivers) | The Vulkan SDK is needed only on the machine that builds |
| `cuda` | NVIDIA only | Heavy (hundreds of MB), the CUDA libraries have to be shipped |
| CPU only | All | Slow on laptops: translation can fall far behind the voice |

**Proposal:** `vulkan` and, if it fails to load, CPU (with a notice in the
diagnostics). It must be measured on an ordinary laptop without a dedicated GPU: if on
CPU it takes too long, live translation isn't viable there and the app should
say so.

**Pending (risk, 2026-10-30):** with `vulkan` the `.exe` links `vulkan-1.dll` at
startup. The GPU driver provides it (almost all PCs with up-to-date drivers), but on
a machine without the driver or in a virtual machine **the app doesn't open**. Fix: the
`dynamic-backends` option of `llama-cpp-2` (loads the GPU as a separate DLL only if
possible; otherwise CPU), or loading `vulkan-1.dll` late (`/DELAYLOAD`) and checking
first whether it exists. Also add the notice in the diagnostics.

**Attempt with `vulkan` (2026-10-30), in progress:** the demo runs on CPU and
`vulkan` is an option in `Cargo.toml` (`--features vulkan`) that builds a
separate job outside the main flow. What was seen in GitHub Actions (`windows-latest`, VS 2026, CMake 4):

- The SDK is installed with `jakoch/install-vulkan-sdk-action` (1.4.309.0), but
  `ggml-vulkan` requires `find_package(SPIRV-Headers)` and the SDK doesn't include
  its CMake configuration: it is fixed by building and installing SPIRV-Headers from
  the tag `vulkan-sdk-1.4.309.0` and setting `CMAKE_PREFIX_PATH`.
- Then `vulkan-shaders-gen` (a separate CMake project launched by llama.cpp)
  fails when testing the compiler with `C1041 … use /FS`. The message is misleading: the
  cause is the **path length** of the `.pdb` (~268 characters inside
  `src-tauri/target/…`; `cl.exe` doesn't go past 260). Neither `CL`/`CFLAGS=-FS` nor Ninja
  (which does put `/FS`) fixes it; Ninja also changes `/MT` to `/MD`, which doesn't
  match sherpa-onnx. With `CARGO_TARGET_DIR=C:\t` (MSBuild) it is fixed:
  `vulkan-shaders-gen.exe` now builds.
- Afterwards its installation fails: `Not a file: …/vulkan-shaders-gen-build/
  cmake_install.cmake`, even though the file exists. Same on `windows-2022`
  (VS 2022, CMake 3.31): it isn't the version, it was MSBuild. **With Ninja and `C:\t`
  it builds** (commit `52a8f2b`). Ninja puts `/MD` on top of `/MT`: it is corrected
  with `.github/cmake/msvc-static-crt.cmake` (`CMAKE_TOOLCHAIN_FILE`). The
  `installer-vulkan` job produces a second `.exe` to compare with the CPU one.
- Careful: Git Bash turns `/FS` into a path (`C:/Program Files/Git/FS`) and its
  `/usr/bin/link` shadows Visual Studio's `link.exe`: `cargo` runs in `cmd`.
- Size: the CPU installer is ~10 MB; with Vulkan, about 10-20 MB more
  (shaders), not measured.

- In `Cargo.toml`: `features = ["metal"]` becomes Mac only, and
  `["vulkan"]` for Windows (section per system).
- `translator.rs` doesn't change, except `n_gpu_layers` if it falls back to CPU.
- `build.rs`: `link_clang_runtime` is already Mac only.

## Phase 3: espeak-ng for Windows

- Build `espeak-ng.exe` with CMake and MSVC, with the same options as
  `build-espeak.sh`, and leave it at
  `src-tauri/binaries/espeak-ng-x86_64-pc-windows-msvc.exe`. Tauri picks each
  system's binary by name, so `tauri.conf.json` doesn't change.
- **The data (`espeak-ng-data/`) is the same as on the Mac.** It is worth reusing:
  the Windows disk doesn't distinguish case either, so building the phonemes there
  would have the same problem as on the Mac (`e_short_1` / `E_short_1`).
- `config.rs` (`bundled_espeak`): look for `espeak-ng.exe` on Windows.
- `phonemizer.rs` (`data_dir`): on Windows the resources go next to the `.exe`,
  not in `../Resources`. The search in the binary's folder already covers it. Test it.
- New `scripts/build-espeak.ps1` (PowerShell), with the same SHA-256.

## Phase 4: what is connected and the device list

- `route.rs`: with `IMMDeviceEnumerator`, the default output and input and
  their `PKEY_AudioEndpoint_FormFactor` (Headphones/Headset → "headphones",
  Speakers → "speakers"). Bluetooth: the device identifier starts with
  `BTHENUM` / `BTHHFENUM`.
- Bluetooth on Windows has the same problem as on the Mac: when the microphone of
  some headphones is opened, they switch to "hands-free mode" and the sound
  gets worse. Windows shows it as two devices ("Headphones" and
  "Hands-Free"). `meetingMic` in `route.js` already avoids opening that microphone if
  there is another one; it must be checked that it recognizes the Windows names.
- `input_busy` (another app uses the microphone): on Windows there is no simple
  way. It can be left as `false`.
- `audio.rs` (`list_devices`): with the same enumerator. It only gives real
  names to the devices: if it fails, the interface uses the WebView2 ones.

## Phase 5: system voices

`system_voice.rs` already separates `voices()` and `synthesize()` by system. On
Windows, with `Windows.Media.SpeechSynthesis` (OneCore voices: language and gender)
→ WAV → `tts::parse_wav`, as `say` does today on the Mac. Already noted in
`plan-idiomas.md`. Without this the app works the same with its own voice (Kokoro)
for the languages it covers.

## Phase 6: the small things

- **Models folder** (`config.rs`): on Windows,
  `%LOCALAPPDATA%\lingora\models`. Better to use the app data path that Tauri
  provides than `HOME`.
- **`keyring`:** add the `windows-native` option (Windows Credential Manager)
  for Windows only.
- **`open`** (`notes.rs`): use `explorer /select,` to show the file and
  `cmd /c start` (or Tauri's `opener` plugin, which would be a new crate)
  for the Groq link.
- **Floating captions:** the transparent, always-on-top window is provided by Tauri.
  The AppKit part (`objc`) is Mac only. Test on top of a full-screen video
  in Chrome/Edge.
- **`set_activation_policy`:** already Mac only. On Windows, whatever is decided in
  point 5.
- **Diagnostics:** without the BlackHole checks, which don't apply on Windows. Add
  the GPU check (Phase 2).
- **Processes without a window:** espeak-ng and `tar` would briefly open a black
  console. They must be launched with `CREATE_NO_WINDOW`.

## Phase 7: interface texts

There are 25 texts in `src/i18n/es/` that say "Mac" ("Mac audio", "Only Mac
audio"…). Options: neutral words ("of the computer", "of the system") or a key per
system. The user decides.

## Phase 8: installer and clean test

- `tauri.conf.json`: add the `nsis` target (`.exe` installer), with
  WebView2 included or downloaded during installation (Windows 11 already has it).
- `scripts/check-standalone.ps1`: the equivalent of `check-standalone.sh`.
  It checks that everything the `.exe` loads is from Windows (`dumpbin
  /dependents`), that espeak-ng pronounces, and that no paths from the building
  machine appear.
- **Clean test:** a Windows without development tools.

### How it is distributed

A website or the cloud won't do: the browser doesn't capture system audio or
move the models well, and everything must be local. There is always a program to
install; what changes is the friction.

**Now (demo for friends and family, decided 2026-10-29):** unsigned `.exe`
installer (NSIS), sent by hand (cloud link or USB). Without a signature,
SmartScreen warns; it comes with a one-line note: "if the blue warning appears,
click *More info* → *Run anyway*". It is the same as the ad hoc signature
on the Mac.

**How to build it without having the project on Windows:** work only on the
Mac and on Windows only install and test the `.exe`.
1. Cross-compilation on the Mac (`cargo-xwin` + LLVM + NSIS,
   `pnpm tauri build --target x86_64-pc-windows-msvc`). Experimental in
   Tauri; the risk is llama.cpp and sherpa-onnx (C++). Try it first in a
   copy.
2. If it fails: GitHub Actions builds on a Windows runner (private repository;
   Lingora is not yet a git repository).

**Later (for more people):** Microsoft Store (no warnings, with
updates; developer account and review) or a code-signing certificate. It is the
equivalent of Apple's signing and notarization, also pending. Alternatives discarded for
now: a portable `.zip` (it doesn't uninstall normally) and `winget` (for technical
people).

---

## Order and size

| Phase | Size | Blocks |
|---|---|---|
| 0. Build without errors on Windows (Phases 3 and 6, at minimum) | Small | Everything |
| 1. System audio | **Large** | Translate audio, Take notes |
| 2. Translation GPU | Medium (mostly, measuring) | Translation keeping up |
| 4. What is connected | Medium | Only tunes echo in "Online meeting" |
| 3, 6, 7, 8 | Small | Installer |
| 5. System voices | Medium | Only the languages Kokoro doesn't cover |

First useful milestone: Phases 0 + 1 + 2 → Translate audio works on Windows. The
rest can be done later, without rush.
