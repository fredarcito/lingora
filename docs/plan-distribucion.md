# Plan: local translation and an app without external dependencies

Status: pending. It will be done after the testing phase. The detailed plan
to depend on nothing is in `plan-autonomia.md`.

Goal: the user downloads a single installer, opens it and the app downloads
its models the first time. No Homebrew, Node, espeak-ng or BlackHole setup.

## 1. Local translation with HY-MT2 1.8B (inside the app)

Tested in the scratchpad (M1 Pro, 16 GB):

- HY-MT2 1.8B Q4_K_M (`tencent/Hy-MT2-1.8B-GGUF`, Apache 2.0): 1.1 GB, ~1.4 GB
  of RAM, ~0.3 s per sentence. Faster than qwen on Groq (0.4-0.9 s).
- Q8 tied with Q4 on quality, so Q4 is used.
- TranslateGemma 4B was discarded: twice as slow, twice as large and it
  makes translations longer.
- English → Spanish: good. Colloquial Spanish and cut-off chunks: weak.
  - "Dale" is left untranslated.
  - "buscarle otra vuelta" comes out as "looked up again".
  - Sometimes it drops the final "and" of a chunk.
- Giving it context makes things worse:
  - With the "Background Information" format it sometimes translates the
    context too, and the voice repeats it.
  - With extra instructions it sometimes returns the instructions themselves.
- The official parameters (temperature 0.7) invent more; use a low temperature.

**Done (2026-10-29):** llama.cpp goes inside the app (`llama-cpp-2`, with
Metal), in its own thread of `translator.rs`. No `llama-server` or Homebrew.
It translates the same as before (30 of 30 sentences identical, no randomness). What
was planned then:

- llama.cpp inside the app with the `llama-cpp-2` crate (Metal), without an
  external `llama-server`. Only the inside of `translator.rs` changes, which moves to the
  `listener.rs` pattern (lazy loading in the process); the rest of the list is
  already done.
- HY-MT2's default prompt:
  `Translate the following text into {lang}. Note that you should only output
  the translated result without any additional explanation:\n\n{text}`.
  - No context.
  - Temperature 0.3.
  - `max_tokens` proportional to the text.
- Glossary per direction with the terminology format:
  `Reference the following translations:\n{a} translates to {b}\n\n...`.
  It only includes the entries that appear in the sentence.
- Prior substitution for the cases the glossary doesn't fix
  ("Dale," → "OK,").
- Only in local mode with Precise transcription (with Fast it added ~4 s of
  delay): translate up to the last `.?!` and keep the rest in
  `rt.carry`. If a chunk was already saved, cut at the last comma or send
  everything, the same rule as `splitAtSentenceEnd`.
- Selector per lane: "Translation: Cloud (qwen) / Local (HY-MT2)", which can be
  changed without stopping the lane. The condensed translation doesn't apply in
  local mode.
- Diagnostics: "Local translation" with a "Download" button.
- Future: fine-tune the 1.8B with LoRA (the repository includes scripts) with pairs of
  call sentences generated with qwen.

## 2. Voice with sherpa-onnx instead of Node + Kokoro-js

- **Done (2026-10-28):** Kokoro runs inside the app with sherpa-onnx, the
  same library as Parakeet. Node is no longer needed. The model (`fp32`,
  ~350 MB download) is downloaded from diagnostics and released with the others
  after 3 minutes idle.
- **Done (2026-10-29): espeak-ng** goes inside the app as its own program
  (`externalBin`, because of its GPL license), with 2 MB of data. It is built by
  `scripts/build-espeak.sh`.

## 3. Capture the call audio without BlackHole

- **Done (2026-10-28):** Listen uses a global Core Audio tap that excludes
  Lingora (`src-tauri/src/system_audio.rs`), chosen by default as "Mac audio".
  The permission still needs testing in the signed app (in development it is
  requested for VS Code or the terminal).
- Core Audio process taps (macOS 14.2+) capture other apps' audio
  directly.
- Remove BlackHole and the multi-output device from the remote lane → local.
- The local → remote lane still needs a virtual microphone: macOS
  doesn't allow creating one without a driver.
- **In testing (2026-11-01):** our own driver, "Lingora Mic"
  (`driver/LingoraMic.c`, an AudioServerPlugIn written from scratch on
  Apple's public API: no BlackHole, no GPL). One device with an output and an
  input joined by a ring buffer (48 kHz, stereo); silence when Lingora is not
  speaking. `scripts/build-mic.sh` builds it into
  `src-tauri/resources/LingoraMic.driver` (committed, like espeak-ng). Settings
  → Speak installs it with macOS's password window
  (`src-tauri/src/virtual_mic.rs`); Speak then plays into it. Pending: test it
  in real calls (Meet, Zoom, Teams), sign it with the Developer ID, and unlock
  "Translate call" (`VITE_CALL_MODE`).
- **Works (2026-11-02):** tested in a real call: the other person hears the
  translated voice. With speakers there is an echo loop (the microphone hears
  the call and Lingora's own voice, and Speak sends them back); the Speak card
  warns to use headphones (`useAudioRoute`).
- **Pending: echo filter for Speak with speakers.** Like `src/utils/echo.js` in
  Take notes: drop each Speak sentence that matches what Listen heard at the same
  time or what Lingora just said. It touches the `enqueue` flow in
  `App/index.jsx` (protected) and delays your sentence only while the other
  person is talking (usually under 1 s; cap lower than the 8 s of notes). A
  fallback, not a replacement for headphones.

## 4. First launch and installer

- **Done (2026-10-28):** welcome screen the first time (`src/pages/Welcome/`). It explains
  how it works while it downloads listening, translation and voice (~1.9 GB) with
  real progress and time remaining. Downloads resume where they stopped
  (`src-tauri/src/models.rs`). Plan B: it can be skipped, and if the welcome screen
  fails you enter the app; whatever is missing is downloaded from diagnostics.
- Installer signed locally (`signingIdentity: "-"`). For other Macs, Apple's
  signature (Developer ID) and notarization are missing.
- The app includes the virtual microphone, which is installed with one click
  (Settings → Speak). It is our own driver, so BlackHole's GPL license does not apply.
- The cloud (qwen or Whisper), if offered, goes through our own server. The key
  never goes inside the app.

## Cleanup (done 2026-10-28)

- Deleted the local Whisper (`ggml-large-v3-turbo-q8_0.bin`, 834 MB) and
  `translategemma:4b` from Ollama (3.3 GB).
- Homebrew's `llama.cpp` and `ggml` are no longer needed for the app (they only
  serve to compare with `llama-server` in the tests)
  for local translation.
- `cmake` stays: it is small and may be needed to build sherpa-onnx.

## Estimated size

| Part | Size |
|---|---|
| Installer (.dmg): app, sherpa-onnx, llama.cpp and driver | ~30-60 MB |
| Parakeet v3 int8 (first launch) | ~640 MB |
| HY-MT2 1.8B Q4 (first launch) | ~1.1 GB |
| Kokoro (first launch, depending on precision) | ~100-350 MB |
| Total on disk | ~2-2.2 GB |
