# Lingora

Real-time voice translator for macOS, **fully local**: nothing leaves the
machine and nothing depends on an API. Lingora listens to the Mac's audio (a
video, a call), transcribes it, translates it and shows it as captions or
speaks it with a synthetic voice; in call mode it does the same with your
microphone in the opposite direction. 37 target languages; the 11 European
languages of Parakeet can be listened to, plus Chinese, Cantonese, Japanese and
Korean (see docs/plan-idiomas.md).

## Status

Phase 0 (validation) is complete and the app scaffold has been generated. What
has been checked with real runs is marked below; what hasn't, is marked too.

| Part | Status |
|---|---|
| System audio capture (BlackHole 2ch) | Verified |
| Microphone capture | Verified |
| Sending voice to BlackHole (virtual microphone for the call) | Verified |
| No feedback loop (translated voice → speakers, not → BlackHole) | Verified |
| Local transcription (Parakeet v3; SenseVoice for zh/yue/ja/ko) | Verified |
| Local translation (HY-MT2 1.8B with llama.cpp inside the app) | Verified |
| Groq (Whisper / qwen) | Out of the UI since 2026-10-28; the code remains in `groq.rs` |
| Spanish/English phonemes (`espeak-ng`, inside the app) | Verified |
| Voice (Kokoro in sherpa-onnx, voices `em_alex` / `am_michael`) | Verified |
| Rust backend compiles | Verified |
| Frontend compiles (`vite build`, JS/JSX) | Verified |
| App starts (`tauri dev`) | Verified |
| Recording from the UI in WKWebView | **Not verified** (pending manual test) |
| Direction B with a real call | **Not verified** |

## Architecture

```
System audio ──► Core Audio process tap (Lingora excluded, no BlackHole)
                          │ every 0.5 s
                          ▼
                  Rust: Parakeet (local) → live subtitles and sentence boundaries
                          │ 16 kHz WAV per sentence
                          ▼
                  Rust: transcription and translation of the sentence
                          │ text
                          ▼
                  Voice: espeak-ng → IPA phonemes → Kokoro (sherpa-onnx) → PCM 24 kHz
                          │   (or the system voice where Kokoro has none)
                          ▼
                  Played on the chosen output device (never the multi-output device)
```

Call mode uses BlackHole 2ch as a virtual microphone, so the other party hears the translated voice.

The opposite direction uses the microphone as input and BlackHole 2ch as
output (the call app selects it as the microphone).

### Why each decision

- **Core Audio taps for Listen, BlackHole for Speak**: on macOS 14.2+ Listen
  hears the Mac's audio through a global tap that excludes Lingora
  (`system_audio.rs`): no driver, no multi-output device, and the translated
  voice doesn't loop back in. The first time, macOS asks for "Screen & System
  Audio Recording" permission. Speak still needs BlackHole as a virtual
  microphone, because macOS doesn't allow creating one without a driver. On
  older Macs Listen can still use BlackHole.
- **Fully local, no Groq** (since 2026-10-28): free for any number of users,
  no quotas or 429 errors, no internet, and the audio never leaves the machine.
  In exchange, slightly lower quality than Whisper + qwen in the cloud, and
  about 2–2.5 GB of RAM with the models loaded (they are released after 3
  minutes idle). Groq was used before: `qwen3.8-27b` was the fastest and most
  stable (344 ms on average).
- **SenseVoice for Chinese, Cantonese, Japanese and Korean**: Parakeet doesn't
  understand them. SenseVoice Small int8 (2024-07-17, ~240 MB) takes ~0.3 s for
  7 s of audio and adds punctuation; the 2025-09-09 version doesn't add
  punctuation and fails on Japanese. Languages that neither of the two can
  listen to (Arabic, Hindi…) only work as targets until there is a local
  Whisper.
- **Parakeet locally to cut sentences** (history: the text used to come from
  Whisper): measured on an M1 Pro. Parakeet v3 int8 (sherpa-onnx) takes ~0.25 s
  to listen to the sentence in progress, so it can be repeated every half
  second and the audio can be cut between two words as soon as a sentence ends,
  instead of waiting for a pause or cutting at 5 s in the middle of a word. But
  in English it makes more errors than Whisper (7 versus 3 in the tests), so the
  text that is translated still comes from Whisper. Whisper locally (whisper.cpp
  with Metal) gives the same quality as Groq but takes ~0.9 s per chunk: it
  adds no speed.
- **Optional local translation with HY-MT2 1.8B**: qwen on Groq runs out of
  quota on the free plan (1,000 requests per day, 8,000 tokens per minute) and
  drops chunks. HY-MT2 Q4_K_M (1.1 GB) takes ~0.3 s per sentence on an M1 Pro.
  It works well from English to Spanish; with colloquial Spanish and cut-off
  sentences it is weaker, so in local mode it runs with a glossary of
  colloquialisms and without context (with context it sometimes translates the
  context too). With Precise transcription it also waits for each sentence to
  end; with Fast it cuts at commas, because waiting for the period added ~4 s of
  delay.
  TranslateGemma 4B was discarded: twice as slow and it makes translations longer.
- **Kokoro for the voice**: Groq TTS only has English and requires accepting terms.
- **espeak-ng for phonemes**: with direct Spanish text Kokoro sounds like it has
  an English accent. With espeak-ng phonemes the output transcription is exact.
  They are passed to Kokoro already computed (`phoneme_codepoints`).
- **Kokoro inside the app, with sherpa-onnx** (before, Node + `kokoro-js` in a
  separate process): no Node, less memory and the same speed with 4 threads
  (~0.22× the audio duration). `fp32` model: `int8` takes 2.5 times longer on
  Apple Silicon.

## Known problems

The app checks its own configuration (diagnostics panel) and fixes what it
can. Symptoms, causes and solutions are in
[docs/problemas-conocidos.md](docs/problemas-conocidos.md).

## Requirements

```bash
pnpm install                 # frontend and Tauri CLI
scripts/build-espeak.sh      # builds espeak-ng to bundle it in the app (once)
```

To build, you need `cmake` and the Xcode tools (llama.cpp and espeak-ng are
built inside the app). Whoever uses the app installs nothing:
`scripts/check-standalone.sh` checks that the `.app` doesn't depend on anything
external.

The live captions model (Parakeet, ~470 MB) is downloaded from the diagnostics
panel ("Download") to `~/Library/Application Support/lingora/models/`. Without
it the app works the same, cutting sentences only at pauses.

Local translation uses llama.cpp inside the app and the HY-MT2 model (~1.1 GB),
which is also downloaded from the diagnostics panel.

The project uses **pnpm** and **JavaScript/JSX** without TypeScript. The types
of the bridge with Rust are documented with JSDoc.

Rust (stable) is required to build the app.

## Configuration

Create a `.env` file in the root (it is in `.gitignore`):

```
GROQ_API_KEY=tu_clave
```

Optional variables:

| Variable | Default |
|---|---|
| `LINGORA_STT_MODEL` | `whisper-large-v3-turbo` |
| `LINGORA_TRANSLATION_MODEL` | `qwen/qwen3.8-27b` |
| `LINGORA_ESPEAK_BIN` | The `espeak-ng` bundled inside the app |
| `LINGORA_TTS_MODEL_DIR` | `models/kokoro-multi-lang-v1_0` |
| `VITE_CALL_MODE` | `false`: "Translate call" stays blocked while it is being finished. It is read when the interface is built (`.env` or environment). |
| `LINGORA_TRANSLATOR_MODEL` | `models/Hy-MT2-1.8B-Q4_K_M.gguf` |
| `LINGORA_SPEAKER_MODEL` | `models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (tells people apart in notes) |

## Usage

1. Create the **Lingora** multi-output device (Speakers + BlackHole 2ch) in
   *Audio MIDI Setup* and select it as the system output.
2. Start the app: `pnpm tauri dev`.
3. In the app, choose the input for each direction (BlackHole for remote audio,
   microphone for yours) and the output where you want to hear the translation.
4. In the call app, select **BlackHole 2ch** as the microphone.

## Structure

```
src/                  Frontend React en JS/JSX (UI, captura y reproducción)
src-tauri/src/
  lib.rs              Comandos Tauri
  pipeline.rs         Pipeline por dirección, con tiempos por etapa
  groq.rs             Whisper y traducción
  listener.rs         Escucha local (Parakeet)
  translator.rs       Traducción local (HY-MT2 con llama.cpp, en su hilo)
  phonemizer.rs       espeak-ng (el de la app, ver scripts/build-espeak.sh)
  tts.rs              Voz (Kokoro en sherpa-onnx)
  audio.rs            Enumeración de dispositivos (Core Audio)
  config.rs           Ajustes por entorno
```

## Package manager

**pnpm** is used. pnpm 12 blocks install scripts by default; the only package
that needs them (`esbuild`) is approved in `pnpm-workspace.yaml`
(`allowBuilds`).

## Known limitations

- In English, Parakeet makes a few more errors than Whisper in the cloud.
- Kokoro takes ~0.22× the audio duration. For fluid conversation, short
  sentences work best.
- macOS only.
