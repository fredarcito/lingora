# Plan: an app that depends on nothing

Status: Phases 1, 2 and 6 done (2026-10-29); the rest, pending. Expands points 1, 2 and 4 of
`plan-distribucion.md`.

Goal: whoever receives it downloads a `.dmg`, drags it to Applications and
everything works: listening, translating, voice, notes and summary. No Homebrew,
no Terminal, no security warnings. The only thing downloaded afterwards is the
models, from the app itself.

---

## 0. What currently depends on something external

Reviewed in the code and in the `release` binary (`otool -L`):

| Part | Today | Problem? |
|---|---|---|
| Listening, Kokoro voice, speakers (sherpa-onnx) | Is **inside** the binary (static link) | No |
| Translation (llama.cpp) | Launches `/opt/homebrew/bin/llama-server` as a separate process (`translator.rs`, `config.rs`) | **Yes**: without Homebrew it doesn't translate |
| Voice phonemes (espeak-ng) | Launches `/opt/homebrew/bin/espeak-ng` for each sentence (`phonemizer.rs`) | **Yes**: without Homebrew there is no Kokoro voice |
| Note summary | Groq, with the user's key (`notes.rs`) | It is cloud and requires an account |
| Models | Downloaded from GitHub (sherpa-onnx) and Hugging Face (HY-MT2) | Depend on third parties: if they change a URL, the app breaks |
| Signing | Ad hoc (`signingIdentity: "-"`) | **Yes**: on another Mac, macOS blocks it |
| `tar`, `open`, `say`, `ps`, `kill` | Come with macOS | No |
| Diagnostics | Checks espeak-ng and llama-server from Homebrew (`doctor.rs`) | Has to change along with the above |

Everything marked **Yes** is on CLAUDE.md's "don't touch" list
(`translator.rs`, `phonemizer.rs`, `config.rs`, `models.rs`, `doctor.rs`,
`tauri.conf.json`, the signing and the new crates). **Each phase needs the user's
yes before starting**, and each one is tested in a copy of the
project before touching `src-tauri` (see §2 of CLAUDE.md).

---

## Phase 1: translation, with llama.cpp inside the app

**Today:** `translator.rs` starts `llama-server` (the llama.cpp server) on a
local port, waits for `/health` and requests the translation in streaming over
HTTP.

**Change:** use llama.cpp as a **library**, inside the process, with the
`llama-cpp-2` crate (MIT, with Metal). This is what was already decided: no
separate programs.

- Only the **inside** of `translator.rs` changes; its public shape stays the
  same (`new`, `is_installed`, `warm_up`, `shutdown`, `translate` with
  `on_delta`). `pipeline.rs` and the frontend won't notice.
- It follows the `listener.rs` pattern: lazy loading of the model on first use,
  in its own thread, and it is released after 3 minutes idle like the others.
- **Same parameters as today**, to avoid losing quality: temperature 0.3,
  `max_tokens = min(characters/2 + 32, 512)`, context 4096, all layers on the GPU
  (`-ngl 99`), the same HY-MT2 prompt and the model's chat template. Before changing, take
  30 test sentences with `llama-server` and check that the library gives the same
  output (or nearly).
- `on_delta` is called with each chunk that comes out of the token loop, as it does now with
  HTTP streaming.
- Leftovers to remove: `kill_previous`, the PID file, the port and the log in `/tmp`.
  Also `llama_server_bin` in `config.rs`.
- **Building** needs `cmake` on the development Mac (already there); whoever uses the
  app needs nothing. The binary grows by about 5–10 MB.
- **Risk:** ggml and onnxruntime clashing when linked together. It is checked first in a
  copy with a test `main` that loads both.

**Plan B** (only if `llama-cpp-2` causes problems): put `llama-server`
**inside** the `.app` as its own executable (Tauri's `externalBin`) and
keep launching it as today. It changes one path and little else, but it is still a
separate process.

**New crate:** `llama-cpp-2` (must ask first).

## Phase 2: phonemes, with espeak-ng inside the app

**Today:** `phonemizer.rs` runs `espeak-ng -v <language> -q --ipa <text>`
from Homebrew for each sentence.

**Careful with the license:** espeak-ng is **GPL v3**. If it is linked as a library
inside Lingora, the whole app becomes GPL (mandatory open source). If it goes as a
**separate program inside the `.app`**, it is only distributing it alongside
the app: it is enough to include its license and offer its source code.

**Recommended change:** espeak-ng as the app's own program.

- Build it from its source code for Apple Silicon, without dependencies
  (`--without-pcaudiolib --without-sonic`), with a script in
  `scripts/build-espeak.sh` that leaves the binary and `espeak-ng-data` (~10 MB,
  only the languages Kokoro uses).
- Put it in the `.app` with `externalBin` (the binary, in `Contents/MacOS`)
  and `resources` (the data, in `Contents/Resources`) of `tauri.conf.json`.
- `phonemizer.rs` only changes the path: the binary inside the app, with
  `--path=<Resources>/espeak-ng-data`. The call, the phonemes and the
  interjections stay the same.
- In development, `LINGORA_ESPEAK_BIN` still works to point to another one.
- Add `LICENSES/espeak-ng.txt` and a line in "About" with the link
  to its source code.

**License-free alternative** (more work, for later): a text-to-phonemes converter of our
own or with a permissive license. There is no good one in Rust for all the
Kokoro languages, so it isn't worth it now.

## Phase 3: the summary, locally

**Today:** Groq with the user's key. It is the only exception to "all
local", and the project memory says it was only for testing.

**Change:** the summary with a local model, on the **same llama.cpp** from
phase 1 (no new engine).

- A small instruction model in GGUF (about 2–3 GB in Q4), downloaded separately from
  Settings or the first time a summary is requested. In the interface it is called
  "the summary", without a model name.
- Choose it by testing with 3 real notes (one of 5 min, one of 30 and one of
  55) in Spanish and English: quality, time and memory. The context must be enough
  for a one-hour meeting; if it isn't, summarize in chunks and then join them.
- Memory: the translator (~1.4 GB) and the summary model should not be
  loaded at the same time. The summary is requested with note-taking stopped,
  so one is released before loading the other.
- Groq, the key and the keychain leave the interface. If it is to be kept as an
  advanced option, it goes behind a switch and is off by default.

**User decision:** remove Groq entirely or keep it as an option?

## Phase 4: models, from their own place

**Today:** the URLs point to GitHub (sherpa-onnx) and Hugging Face. If they rename
a file, the welcome screen fails for everyone.

**Change:**

- Upload a copy of each model to our own storage (Cloudflare R2
  or the Releases of an own repository), with its version in the name.
- A manifest (`models.json`) with URL, size and SHA-256 of each one.
  `models.rs` checks the SHA-256 when each download finishes: a corrupt file
  is not installed.
- If our copy fails, the original URL is tried.
- Check each model's license so it can be redistributed (HY-MT2,
  Parakeet, SenseVoice, Kokoro, the speakers one and the summary one).

## Phase 5: signing, notarization and installer

- **Apple Developer** account (99 USD per year) and a "Developer ID
  Application" certificate.
- `tauri.conf.json`: `signingIdentity` with that certificate and hardened
  runtime. The permissions (`entitlements.plist`) stay with
  `audio-input`; the permission texts are already in `Info.plist`.
- Tauri also signs the programs in `externalBin` (espeak-ng). Check
  that llama.cpp with Metal works with hardened runtime, without extra permissions.
- Notarize when building (`APPLE_ID`, application `APPLE_PASSWORD`,
  `APPLE_TEAM_ID` in the environment, never in the code).
- Updates with Tauri's `updater` plugin: the app notifies about the new
  version and updates itself. Its signing keys stay outside the repository.
- Apple Silicon and macOS 14.2 or later only: say so on the download page and on
  the welcome screen if the Mac doesn't meet it.

**New crate or plugin:** `tauri-plugin-updater` (must ask first).

## Phase 6: checking on a clean Mac

- **Script** `scripts/check-standalone.sh`, which fails if:
  - `otool -L` of any binary in the `.app` points outside `/usr/lib` and
    `/System`;
  - the binary contains `/opt/homebrew` or `/usr/local` (`strings`);
  - `codesign --verify --deep --strict` or `spctl -a -vv` fail.
- **Real test:** a macOS virtual machine (UTM, on the same Mac) or
  a friend's Mac, without Homebrew. Install the `.dmg` and go through:
  welcome and downloads, Translate audio with voice, Take notes ("Online meeting"
  and microphone) and a summary.
- Meanwhile, on the development Mac: rename `/opt/homebrew/bin/
  llama-server` and `espeak-ng` and check that everything still works.

## Extra: logs for whoever tests

Today the logs go to the terminal, and they can't be seen in the installed app.
Save them also to `~/Library/Logs/Lingora/` (rotating, the last few days)
and add to Settings → Diagnostics a "Copiar registro" (Copy log) button to send them.

---

## Order and size

| Phase | What it fixes | Size | Can go alone |
|---|---|---|---|
| 2. espeak-ng | The voice without Homebrew | Small | Yes |
| 1. llama.cpp | Translation without Homebrew | Medium | Yes |
| 6. Check script | Knowing nothing is left outside | Small | Yes, in parallel |
| 4. Own models | Downloads don't break | Small-medium | Yes |
| 3. Local summary | Removing the cloud and the key | Medium | After 1 |
| 5. Signing and updates | Opens without warnings | Small (plus the Apple account) | At the end |

We start with 2 because it is the shortest and already leaves the voice working.

## User decisions (2026-10-29)

1. Yes to `llama-cpp-2` and to touching the files of phases 1, 2 and 6.
2. Yes to espeak-ng as a program inside the app.
3. Groq stays for the summary while it is a demo; phase 3 waits.
4. Models keep being downloaded from GitHub and Hugging Face; our own copy
   waits. Yes, it is checked that each download arrives complete.
5. Apple signing comes later. For now the goal is that it works without the
   configuration of the development Mac (no Homebrew).

## Done (2026-10-29)

- **Phase 2, espeak-ng:** `scripts/build-espeak.sh` builds it (fixed version and
  SHA-256, on a case-sensitive disk mounted at a short path: with long paths espeak-ng
  truncates file names). It goes to `src-tauri/binaries/` and `src-tauri/resources/espeak-ng-data/` (only en, es,
  fr, it and pt: 2.1 MB). It gives the same phonemes as the Homebrew one in the 5
  languages. `phonemizer.rs` passes it `--path` with the app's data.
- **Phase 1, llama.cpp:** `translator.rs` with `llama-cpp-2` (Metal, without
  `openmp`, which would require libomp from Homebrew). One thread holds the model and its
  context; translations are queued. Same prompt (HY-MT2 template written exactly as
  `llama-server` builds it) and same sampling. With
  `same_as_llama_server` (no randomness): 30 of 30 identical sentences, 150–350 ms
  in test build.
  `shutdown` waits for the thread to release the GPU:
  otherwise Metal aborts on exit.
- **Phase 6:** `scripts/check-standalone.sh`.
- Removed: `llama_server_bin`, `LINGORA_LLAMA_SERVER_BIN`, the "llama.cpp missing"
  warning in diagnostics and the `brew install` in the messages.
