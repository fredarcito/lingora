# Lingora

Live voice translator and note taker for macOS, **processed on your Mac**.
Lingora listens to what plays on the computer (a video, a class, a call) or to
the microphone, transcribes it, translates it and shows it as captions or speaks
it with a synthetic voice. It can also take notes of a class or a meeting in the
language being spoken, tell the speakers apart and save everything in Notes.

Listening, translation, voice and speaker detection all run locally. The only
thing that ever leaves the machine is the optional **summary** of a note, sent
to Groq with the user's own key and only after asking.

## What it does

| Mode | What it is for |
|---|---|
| **Translate audio** | Translates what you hear: a video, a class, a podcast. Captions in the app or floating over any window (also in full screen), with an optional translated voice. |
| **Take notes** | Transcribes without translating, with speakers and a summary. Listens to the computer audio, the microphone, or both in an **online meeting** (the others from the computer, you from the microphone as "Me"). |
| **Translate call** | Both ways: what you hear and what you say. Locked while it is being finished (see `VITE_CALL_MODE`). |

Also:

- **Notes:** every session can be saved as a note (pause and resume while
  recording). Search, filters by date, rename speakers or merge two that are the
  same person, export to Markdown or text, copy for an AI chat, and summarize.
- **37 languages** to translate between. Listening works for the European
  languages (en, es, fr, it, pt, de, nl, pl, cs, ru, uk) and Chinese, Cantonese,
  Japanese and Korean; the rest are target languages only. See
  [docs/plan-idiomas.md](docs/plan-idiomas.md).
- **Interface** in Spanish and English; any other language is generated on the
  Mac with the translation model. See [docs/i18n.md](docs/i18n.md).
- **First launch:** a welcome screen downloads the models. Afterwards,
  *Settings → Diagnostics and downloads* checks the setup and fixes what it can.
- **Disk space:** *Settings → Disk space* lists everything downloaded with its
  size and deletes it after a warning of what stops working. Anything in the
  models folder that no current model uses (a model an update replaced) shows
  up as "no longer used", with no list to maintain (`models::on_disk`).

## How it works

```
Mac audio ──► Core Audio process tap (Lingora excluded)      Microphone
                            │                                     │
                            └──────────────┬──────────────────────┘
                                           ▼
              Live listening every 0.5 s: captions in progress and sentence cuts
                                           │ 16 kHz WAV per sentence
                                           ▼
              Transcription (European languages, or the CJK model) ─► speaker print (notes)
                                           │ text
                                           ▼
              Translation (llama.cpp inside the app), streamed sentence by sentence
                                           │
                                           ▼
              Voice: Supertonic 3 (sherpa-onnx), or a system voice
                                           │
                                           ▼
              Played on the chosen output, sped up a little if it falls behind
```

Models live in `~/Library/Application Support/lingora/models/` and are released
from memory after 3 minutes idle.

| Model | Used for | Download |
|---|---|---|
| Parakeet v3 int8 (sherpa-onnx) | Listening, European languages | ~490 MB, required |
| Index-Translate-2B Q4_K_M (llama.cpp) | Translation and generated interface languages | ~1.3 GB, required |
| SenseVoice Small int8 | Listening, Chinese/Cantonese/Japanese/Korean | ~165 MB |
| Supertonic 3 int8 | Voice in 18 languages (the rest use a macOS system voice) | ~145 MB |
| 3D-Speaker ERes2Net | Telling speakers apart in notes | ~40 MB |

### Why each decision

- **Core Audio process tap instead of BlackHole** (macOS 14.2+): a global tap
  that excludes Lingora (`system_audio.rs`). No driver, no multi-output device,
  and the translated voice doesn't loop back in. The first time, macOS asks for
  "Screen & System Audio Recording" permission. On older Macs Listen can still
  use BlackHole. Translating a call in the other direction still needs a
  virtual microphone, because macOS doesn't allow creating one without a driver.
- **All local since 2026-10-28** (Groq is now used only for summaries): free for
  any number of users, no quotas, works offline, and the audio never leaves the
  machine. It costs about 2–2.5 GB of RAM with the models loaded.
- **Parakeet listening every half second**: ~0.25 s per pass on an M1 Pro, so the
  audio is cut between two words as soon as a sentence ends instead of waiting
  for a pause.
- **SenseVoice for Chinese, Cantonese, Japanese and Korean**: Parakeet doesn't
  understand them. The 2024-07-17 version adds punctuation; the 2025-09-09 one
  doesn't and fails on Japanese.
- **Index-Translate-2B for translation** (replaced HY-MT2 1.8B on 2026-11-01):
  ~0.24 s per sentence on an M1 Pro, same speed and memory as HY-MT2 but more
  natural and faithful, and it follows the glossary of colloquialisms more
  strictly. Weaker than HY-MT2 in the Indic languages, Khmer and Burmese (not
  a target market for now). Discarded: TranslateGemma 4B (twice as slow, adds
  things), Gemma 4 E2B/E4B (slower and heavier), Qwen3-1.7B (answers or
  explains instead of translating).
- **Supertonic 3 for the voice** (replaced Kokoro on 2026-11-01): it sounds
  better in Spanish and covers 18 of the app's languages instead of 5. It reads
  plain text, with no espeak-ng. It runs at 5 steps (~0.14 s per second of
  speech), or 8 with the lane's "higher-quality voice" switch (~0.21 s, Kokoro's
  speed). Its peak memory is ~360 MB, against ~790 MB for Kokoro. See
  `docs/plan-voz-supertonic.md`.
- **Speakers**: each sentence's voice print is grouped live, and the whole
  conversation is reviewed when it ends. Tuned on a real 55-minute interview
  (94 % right) and synthetic voices (100 %).

## Getting started

Requirements to build: Rust (stable), pnpm, `cmake` and the Xcode command line
tools (llama.cpp and espeak-ng are built into the app).

```bash
pnpm install                 # frontend and Tauri CLI
scripts/build-espeak.sh      # builds espeak-ng to bundle it in the app (once)
pnpm tauri dev               # start the app
```

`tauri dev` and `tauri build` fetch the sherpa-onnx libraries on their own
(`scripts/fetch-sherpa.sh`).

Then follow the welcome screen: it downloads the models and asks for the audio
permission. Whoever uses the built app installs nothing else;
`scripts/check-standalone.sh` checks that the `.app` doesn't depend on anything
external.

The project uses **JavaScript/JSX without TypeScript** (types in JSDoc) and
**pnpm**. pnpm 12 blocks install scripts by default; the only package that needs
them (`esbuild`) is approved in `pnpm-workspace.yaml`.

### Checks

```bash
npx vite build               # frontend
pnpm test                    # JS tests (vitest)
cd src-tauri && cargo check && cargo test
```

## Configuration

Everything works without configuration. Optional variables, in `.env` at the
root (it is in `.gitignore`) or in the environment:

| Variable | What for |
|---|---|
| `GROQ_API_KEY` | Development only: summary key used when there is none in the Keychain. Release builds only read the Keychain. |
| `VITE_CALL_MODE` | `true` unlocks "Translate call". Read when the interface is built. |
| `LINGORA_SUMMARY_MODEL` | Groq model for summaries (default `qwen/qwen3.8-27b`). |
| `LINGORA_LISTENER_MODEL_DIR`, `LINGORA_SENSE_VOICE_MODEL_DIR`, `LINGORA_TRANSLATOR_MODEL`, `LINGORA_TTS_MODEL_DIR`, `LINGORA_SPEAKER_MODEL` | Use a model from another path instead of the downloaded one. |
| `LINGORA_ESPEAK_BIN` | Use another `espeak-ng` instead of the bundled one. |

In development macOS may ask for Keychain access on every Rust rebuild (the
unsigned binary changes); choose "Always Allow".

## Project structure

```
src/
  App/              Shell and the Translate screen (types in App/types.js)
  pages/            Screens: Notes, NoteTaking, Settings, Welcome, FloatingCaptions
  components/       Pieces of a screen; shared/ has the basic ones (catalog in docs/componentes.md)
  hooks/            Own React hooks (devices, languages, meeting notes…)
  utils/            Non-UI code: api (bridge to Rust), audio, notes, prefs, lanes…
  i18n/             Interface texts (es/, en/)
src-tauri/src/
  lib.rs            Tauri commands
  pipeline.rs       Per-direction pipeline, with timings per stage
  system_audio.rs   Mac audio through a Core Audio process tap
  audio.rs, route.rs  Devices and what is connected (headphones, Bluetooth)
  listener.rs       Local listening (Parakeet, SenseVoice)
  translator.rs     Local translation (llama.cpp, on its own thread)
  phonemizer.rs     espeak-ng (unused since Supertonic; to be removed)
  tts.rs, system_voice.rs  Voice (Supertonic) and macOS system voices
  speakers.rs       Voice prints to tell people apart
  notes.rs          Notes on disk, export and summary
  groq.rs           Groq client (summaries only)
  models.rs, doctor.rs  Model downloads and diagnostics
  config.rs         Languages (LANGS) and settings
```

## Status and next steps

- **Works:** Translate audio, Take notes (also online meetings), Notes with
  speakers and summaries, floating captions, 37 languages, everything inside the
  app with no Homebrew.
- **In progress:** Translate call (needs a virtual microphone), notes of your
  own and bookmarks in Take notes, a local summary
  ([docs/plan-autonomia.md](docs/plan-autonomia.md)).
- **Pending:** Apple signing and notarization; Windows (an unsigned `.exe` is
  built in GitHub Actions, see [docs/plan-windows.md](docs/plan-windows.md)).

Known audio problems on macOS, with causes and fixes:
[docs/problemas-conocidos.md](docs/problemas-conocidos.md).

## Known limitations

- Languages other than the 16 listed above can only be translated into, not
  listened to.
- In English, Parakeet makes a few more errors than Whisper in the cloud.
- The voice takes ~0.22× the audio duration; short sentences keep up best.
- macOS 14.2+ for computer audio without BlackHole.
