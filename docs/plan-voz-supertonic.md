# Plan: replace Kokoro with Supertonic 3 (the voice)

Status: Steps 1, 2, 3 and 5 done (2026-11-01); Step 4 pending its own confirmation. It touches protected
files (`tts.rs`, `models.rs`, `config.rs`, `pipeline.rs`, `doctor.rs`, and one
line of the `enqueue` flow in `App/index.jsx`). The user approved the change
itself; each protected touch is listed below so it can be reviewed.

## Why

Measured on the user's Mac (M-series, 4 threads, same sherpa-onnx 2.0.1,
2026-11-01; bench in the session scratchpad, not in the repo):

| | Kokoro (today) | Supertonic 3, 5 steps | Supertonic 3, 8 steps |
|---|---|---|---|
| Synthesis time per second of speech | 0.22 s | 0.14 s | 0.21 s |
| Long Spanish sentence (~7–8 s of audio) | 1.5 s | 1.1 s | 1.7 s |
| Peak memory (process, model + generation) | ~790 MB | ~357 MB | ~357 MB |
| On disk | 338 MB | 145 MB | 145 MB |
| Load time | 0.7 s | 0.4 s | 0.4 s |
| Lingora languages with a local neural voice | 5 | 18 | 18 |

- The user listened to both: 5 and 8 steps sound good, 3 steps sounds bad
  (never offer 3).
- Supertonic reads plain text: no espeak-ng and no IPA on its path.
- Same library (`OfflineTtsSupertonicModelConfig` is in sherpa-onnx 2.0.1).
  **No new dependency.**

## Decisions (user, 2026-11-01)

1. Supertonic **replaces** Kokoro. There is one voice model, not two.
2. **5 steps by default.** A per-lane switch, "Higher-quality voice", moves to
   8 steps. It is read on every chunk, so you can compare without stopping the
   lane.
3. No model names in the UI. The voices are labeled "Voice 1…5 · female" and
   "Voice 1…5 · male" (`app.voices.numbered` plus the existing gender label).

## Facts to rely on

- Model: `sherpa-onnx-supertonic-3-tts-int8-2026-05-11` from the
  `tts-models` release of k2-fsa/sherpa-onnx (.tar.bz2). Files:
  `duration_predictor.int8.onnx`, `text_encoder.int8.onnx`,
  `vector_estimator.int8.onnx`, `vocoder.int8.onnx`, `tts.json`,
  `unicode_indexer.bin`, `voice.bin` (+ `LICENSE`, `README.md`).
- 10 voices (`sid` 0–9). From measured pitch: **0–4 are female** (167–202 Hz)
  and **5–9 are male** (89–133 Hz). Default per gender: `sid 0` and `sid 5`
  until the user picks favorites by ear.
- Language goes per call: `GenerationConfig.extra = {"lang": "<code>"}`.
  Steps go in `GenerationConfig.num_steps`, speed in `speed`.
- The sample rate comes from `tts.sample_rate()`. Don't hard-code it; it
  differs from Kokoro's 24 kHz. `Speech.sample_rate` already carries it to the
  UI, and `trimSilence` / `playAudio` already take it.
- At the same speed, Supertonic speaks ~20 % slower than Kokoro (8.5 s against
  6.9 s for the same sentence). `speedFor` already compensates when a queue
  builds up; check it in the manual test below.
- Supertonic languages that Lingora also has (18): en es fr it pt ja ko de nl
  pl cs ru uk tr ar hi vi id. The other 19 Lingora languages (zh, zh-hant,
  yue, he, fa, bn, ur, gu, mr, ta, te, th, ms, tl, km, my, bo, kk, mn) keep
  the system voice, as they do today.
- License: the sample code is MIT (the `LICENSE` in the archive). The
  **model weights are OpenRAIL-M**; take the text from
  huggingface.co/Supertone/supertonic-3.

---

## Step 1: Rust (one block; warn the user first, it restarts the app)

### `src-tauri/src/tts.rs` (protected)
- `MODEL_NAME` → the Supertonic folder name; `FILES` → the 7 files above.
- `load()`: `config.model.supertonic = OfflineTtsSupertonicModelConfig { … }`.
  Keep `num_threads = 4` and `silence_scale: 1.0`. Check by ear that
  `max_num_sentences: 1` doesn't cut long text. Supertonic has its own
  splitting (`split` in `tts.json`).
- `synthesize(text, lang, sid, speed, steps)`: plain text. Drop `ipa`,
  `chunk_clauses`, `MAX_CHUNK_CHARS` and `PAUSE_SECS` if a 700-character text
  comes out whole; otherwise keep the chunking on sentence boundaries.
- Remove `VOICES` and `KokoroVoice`. Add `voices(lang) -> Vec<Voice>` (10 entries
  when the language is supported, empty otherwise) and
  `voice_for(lang, gender) -> Option<i32>` (0 / 5).
- `pub const STEPS: i32 = 5; pub const STEPS_HQ: i32 = 8;`
- Expose `sample_rate()` from the loaded model instead of `SAMPLE_RATE`, or
  read it once at load.
- Tests: rewrite `lists_voices_by_language`. The ignored test becomes
  `speaks_with_supertonic` (Spanish, 5 and 8 steps, transcribed back with
  Parakeet as today).

### `src-tauri/src/config.rs` (protected)
- `LangInfo.kokoro` → `supertonic: Option<&'static str>` (the Supertonic code,
  usually the same as `code`). Fill it for the 18 languages above.
- Leave `espeak` in place for now (see Step 4).

### `src-tauri/src/pipeline.rs` (protected)
- `speak(..., voice, speed, hq: bool)`: the `"supertonic:<sid>"` prefix goes
  to `speak_supertonic`. **Old saved ids `"kokoro:*"` fall through to the
  default for the gender** (they live in `lingora.voiceIds`; don't rename
  that key).
- `speak_supertonic` calls `tts.synthesize(text, lang, sid, speed, if hq {
  STEPS_HQ } else { STEPS })` with `phonemize_ms: 0`.
- `warm_up`: a short Spanish phrase with `sid 5`.

### `src-tauri/src/lib.rs`
- `speak` command: new `hq: Option<bool>` argument.
- `voices`: the `"supertonic"` engine; ids `supertonic:<sid>`; names come
  from the UI (send `gender` + an index), not from Rust.
- `languages()`: `female_voice`/`male_voice` = `(true, true)` for the 18
  languages; the rest stay as they are.

### `src-tauri/src/models.rs` (protected)
- `Model::Voice`: new URL, `archive_root`, `keep` (the 7 files), size
  `145_000_000`. `tts_model_dir` (in `config.rs`) points to the new folder.
- **The old Kokoro folder is not deleted.** Rule: don't delete downloaded
  models without asking. See Step 3.

### `src-tauri/src/doctor.rs` (protected)
- Voice check text: ~150 MB, "to hear the translation in 18 languages".

## Step 2: UI

- `src/utils/api.js`: the `speak` signature gets `hq`, the VoiceInfo typedef
  becomes `"supertonic" | "system"`.
- `src/components/LaneCard/index.jsx`: optgroup `supertonic`. Label each voice
  with `t("app.voices.woman", { n })` or `t("app.voices.man", { n })`. New
  switch under the voice selector: "Higher-quality voice (slightly slower)".
  Use the existing `shared` components (see `docs/componentes.md`).
- `src/utils/prefs.js`: a new per-lane key `lingora.voiceHq` (default `false`)
  in `loadLanes`/`storeLanes`, and add it to `prefs.test.js`. Don't touch
  existing keys.
- `src/App/index.jsx` (protected `enqueue` flow): **only** add
  `current.voiceHq` as the last argument of `api.speak` at line ~472. It's
  read from `lanesRef`, so a change applies to the next chunk.
- i18n (`es` + `en`): `app.voices.group.supertonic` ("Voces de Lingora" /
  "Lingora voices"), `app.voices.woman`, `app.voices.man`,
  `app.voices.hq`, `app.voices.hq.hint`, `diagnostics.fix.voice_model` →
  "Descargar (145 MB)". Then remove `app.voices.group.kokoro`.

## Step 3: freeing the old voice

Users who already downloaded Kokoro keep 338 MB they no longer use. In
Diagnostics, when the old folder exists, show a row "Previous voice (338
MB) — no longer used" with a "Delete" button. It deletes only after the
user clicks. This needs a small Rust command (`remove_old_voice`) that
deletes **only** `models/kokoro-multi-lang-v1_0`.

## Step 4 (separate confirmation): espeak-ng

After Step 1, nothing calls espeak-ng or `phonemizer.rs`. Removing them saves
bundle size, but it touches `tauri.conf.json` (protected), the build scripts
and `docs/plan-autonomia.md`. Propose it apart, after the user has tested the
new voice for a few days. Until then, keep the binary and mark `phonemizer`
`#[allow(dead_code)]` with a comment pointing here.

## Step 5: credits and docs

- `src/utils/credits.js`, `src/i18n/*/credits.json`,
  `docs/plan-creditos.md`: replace the Kokoro entry with "Supertonic 3",
  Supertone Inc., OpenRAIL-M, `public/licenses/OpenRAIL-M-Supertonic.txt`
  (the model license text) + MIT for the sample code if any of it is used
  (it isn't: only the weights).
- Mentions of Kokoro in `README.md`, `docs/plan-idiomas.md`,
  `docs/plan-distribucion.md`, `docs/plan-autonomia.md`,
  `docs/plan-windows.md`, `docs/problemas-conocidos.md`: update or mark as
  historical. In `CLAUDE.md`, keep `tts.rs` in the protected list.

## Verification

- `npx vite build`, `pnpm test`, `cargo check`, `cargo test` (plus
  `cargo test speaks_with_supertonic -- --ignored` by hand).
- Manual, with real audio:
  1. Fresh download from Welcome and from Diagnostics (145 MB, progress, resume).
  2. Translate a video to Spanish and to English, with a woman's voice and a
     man's voice. Toggle "Higher-quality voice" mid-lane and compare the
     `tts_ms` logs.
  3. German and Japanese (newly covered): they speak with Lingora's voice.
     Chinese still uses the system voice.
  4. A fast speaker: the queue builds, `speedFor` speeds up, and the voice
     doesn't fall behind more than `MAX_VOICE_LAG_SECS`.
  5. A long translation (>700 characters): nothing cut off or repeated.
  6. An old profile with `lingora.voiceIds = {"es":"kokoro:em_alex"}`: it
     falls back to the default male voice without errors.
  7. Activity Monitor: memory during a call is ~400 MB lower than before.
