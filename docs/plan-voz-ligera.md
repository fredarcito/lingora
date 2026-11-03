# Plan: a light voice (Piper) for low-end computers

Status: Phases 1 (engine), 2 (UI) and 3 (all voices) built 2026-11-03, not
yet tried on a low-end computer. Approved by the user; it touches protected
files (`models.rs`, `pipeline.rs`, `config.rs`, `phonemizer.rs`, and in Phase 2
`src/pages/Welcome`), each listed below.

## Why

On a friend's Windows laptop (Ryzen 7 3750H: 4 cores / 8 threads, AVX2, no
VNNI, GTX 1650; log of 2026-11-02) the translated voice fell behind and most
sentences were skipped (`MAX_VOICE_LAG_SECS`):

- Supertonic took 0.66–0.94× real time **on its own** and 1.0–2.0× while the
  listener ran. It never had headroom.
- Translation was fine (on the GPU, 15–25 tokens/s). The listener reached 0.9×
  only because it shared the CPU with the voice.
- With Kokoro the voice worked on that laptop: the change to Supertonic (5
  passes per sentence) is what tipped it over.

Benchmarks in the session scratchpad (sherpa-onnx 2.0.1, the app's version;
x86_64 Python under Rosetta on an M1 Pro, so AVX2 and no VNNI like the Ryzen;
same Spanish sentence):

| Voice | 1 thread | 2 threads | 4 threads | On disk |
|---|---|---|---|---|
| Supertonic 3 int8 (today) | – | 0.33× | 0.29× | 145 MB, all voices |
| Supertonic 3 fp32 | – | 0.33× | 0.28× | ~400 MB: no gain, rejected |
| **Piper** (`es_ES-davefx-medium`, `es_MX-claude-high`) | 0.16× | **0.09×** | 0.05× | ~63 MB per voice |
| MeloTTS (English; no Spanish in sherpa-onnx) | 1.56× | 0.81× | 0.47× | 163 MB: rejected |

Piper is ~3.5× faster than Supertonic at 2 threads. Extrapolated (not
measured) to the Ryzen: ~0.2–0.25×, enough headroom with the listener on.
Also considered and rejected: Kitten TTS and Soprano (English only), Pocket TTS
(as big as Supertonic), Dia / Dia2 (1–2B parameters, GPU, English only).

## Decisions (user, 2026-11-03)

1. **Piper is the light voice** for low-end computers. Supertonic stays the
   natural voice everywhere else.
2. **On a low-end computer, Supertonic is not downloaded.** The app starts with
   listening, translation and captions; the voice is downloaded from the lane's
   voice menu when the person wants it, one voice at a time (like Windows).
3. Nothing is hidden, but nobody has to choose: the app picks, and the other
   kind waits behind "More voices…" (see 5).
4. The same on the Mac: Apple Silicon keeps the natural voice; Intel Macs
   (x86 without VNNI) get the light one recommended. Anyone can pick either.
5. In a language with no natural voice, a light voice (licence-clean and good
   to the ear) goes before the system voice. Piper adds 9 of Lingora's 37
   languages: Chinese, Persian, Hebrew, Thai, Urdu, Bengali, Marathi, Telugu,
   Kazakh (Phase 3). Supertonic covers 18; 10 stay system-only.

## How Piper works (and how it differs)

- Each Piper voice is a **separate model** (~63 MB): one language, usually one
  speaker. Supertonic and Kokoro are one big model with all their voices as
  small style vectors. So Piper voices are downloaded one by one.
- Catalogue: 178 voices in 53 languages (`rhasspy/piper-voices/voices.json`);
  Spanish has 9 (Spain, Mexico, Argentina). sherpa-onnx publishes each one as
  `tts-models/vits-piper-<voice>.tar.bz2` (model, `tokens.txt`, `.onnx.json`
  and an 18 MB `espeak-ng-data` we don't extract).
- **sherpa-onnx 2.0 has no built-in espeak-ng:** Piper needs the phonemes
  passed in (`GenerationConfig::phoneme_codepoints`, one list per sentence).
  Lingora still bundles espeak-ng (from Kokoro, Mac and Windows builds) and
  `phonemizer.rs`, so this needs no new dependency. Tested: espeak-ng IPA with
  the punctuation kept between clauses gives correct speech.
- Licences vary **per voice** (training data): CC0, CC BY, CC BY-SA, Apache,
  MIT are fine; anything non-commercial (CC BY-NC…) is excluded.

## Design

### 1. Is this a low-end computer? (`perf.rs`)

`pub fn light_device() -> bool`, decided before anything is downloaded:

- Apple Silicon → no.
- x86_64 without AVX-VNNI (`avxvnni` or `avx512vnni`) → yes. That covers Intel
  before ~2021 and AMD before Zen 4, which matches the laptop.
- Otherwise no.

Safety net, measured: if the natural voice runs above 0.6× real time over the
first 3 sentences of a lane, the card suggests the light voice (it doesn't
switch on its own: the person chose the natural voice). The measurement already
exists in `tts.rs`' log line; it only has to reach the UI.

### 2. The catalogue (`src-tauri/src/piper.rs`, new)

A short, hand-picked list per language, not the 178:

```rust
pub struct PiperVoice {
    pub id: &'static str,        // "es_ES-davefx-medium"
    pub lang: Lang,
    pub gender: Gender,
    pub region: &'static str,    // "ES", "MX", "AR" (the UI names the country)
    pub speaker: i32,            // multi-speaker models (sharvard has 2)
    pub license: &'static str,   // shown in Credits
    pub bytes: u64,
}
```

- Built (Phase 1), licences from each voice's MODEL_CARD, gender by measured
  pitch (women 172–208 Hz, men 91–143 Hz):

  | Voice | Gender | Licence | Download |
  |---|---|---|---|
  | `es_ES-sharvard-medium` (2 speakers: 1 woman, 0 man) | both | CC BY 3.0 | 80 MB |
  | `es_MX-claude-high` | woman | Apache 2.0 | 67 MB |
  | `es_AR-daniela-high` | woman | CC BY-SA 4.0 | 116 MB |
  | `es_ES-davefx-medium` | man | CC0 | 67 MB |
  | `es_MX-ald-medium` | man (143 Hz, confirm by ear) | Unlicense | 67 MB |
  | `en_US-ljspeech-medium` | woman | public domain | 67 MB |
  | `en_US-kristin-medium` | woman | public domain | 67 MB |
  | `en_GB-cori-medium` | woman | public domain | 67 MB |
  | `en_US-john-medium` | man | public domain | 67 MB |
  | `en_US-norman-medium` | man | public domain | 67 MB |
  | `en_US-joe-medium` | man | CC0 | 67 MB |

  Excluded for their licence: `en_US-ryan`, `hfc_*`, `l2arctic`, `semaine`
  (non-commercial) and `lessac`, `amy`, `alan`, `jenny_dioco`, `kusal`,
  `danny`, `arctic` (unclear). Defaults (first of each gender): Sharvard in
  Spanish (one download, both genders), LJ and John in English; to confirm by
  ear.
- Then the rest of Lingora's languages, after checking each licence. Languages
  with no clean Piper voice keep the system voice.

### 3. Download (`models.rs`)

Piper voices don't fit the fixed `Model` enum (one entry per voice). Add a
`Model::Piper(&'static PiperVoice)` variant, or factor the existing
download-with-resume into a function that takes `(url, dest, keep)` and call it
from both. Destination: `models/piper/<id>/` with only `<id>.onnx`,
`tokens.txt` and `<id>.onnx.json` extracted. Storage and Diagnostics list them
like the other models.

### 4. Synthesis (`piper.rs` + `pipeline.rs`)

- Load with `OfflineTtsVitsModelConfig { model, tokens, .. }`, **2 threads**
  (measured: twice as fast as 1, and 4 only shaves 0.04× while competing with
  the listener). Keep the last used voice loaded; free it after the same idle
  time as the other models.
- Phonemize with `phonemizer::phonemize` (espeak-ng, the language's `espeak`
  locale, interjections handled as before) and pass the codepoints per
  sentence. Sample rate comes from the model (22 050 Hz), resampled on output
  as the system voice already is.
- `Pipeline::speak`: a new id prefix `piper:<id>`. The default voice
  (no explicit choice) becomes: natural voice if installed and not a light
  device; else the installed Piper voice of the language and gender; else the
  system voice; else captions only.

### 5. The voice menu (`components/LaneCard`): don't make people choose

- **By default the app picks** and asks nothing. Good computer: as today.
  Low-end computer with no voice: the card shows one button, "Turn on voice ·
  80 MB" ("Chosen so it arrives on time on this computer"), which downloads
  the default light voice of the language and starts speaking.
- **The menu lists only downloaded voices** (plus "Automatic"), then "More
  voices…", which opens a panel with what can be downloaded in two sections,
  the recommended one first and marked: **Natural** ("Sounds more human.
  Needs a powerful computer. 145 MB, all voices") and **Light** ("Arrives
  sooner on modest computers. ~67 MB per voice").
- **One notice, once,** if the natural voice can't keep up (above 0.6× real
  time over 3 sentences): "Your computer is struggling with this voice and
  some sentences are skipped. [Use light voice] [Keep]".
- Names: "Natural" and "Light" (not "Fast": that is a speed mode of the card).
  Voices by name and country. Never "Piper" or "Supertonic"; new texts through
  `t()` in `es`/`en`.
- Captions keep running during a download; the voice starts when it ends.
- Backend ready (Phase 1): `light_voices(lang)` gives `{ recommended,
  voices: [{ id, model, name, gender, detail, installed, bytes }] }`;
  `download_model("piper:<model>")` downloads; installed ones come in
  `voices(lang)` with `engine: "piper"`.

`languages` (`lib.rs`) must stop reporting `female_voice`/`male_voice` as true
just because Supertonic *could* speak the language: on a light device with
nothing downloaded, the lane shows "Download a voice" instead of failing.

**Several voices** (one voice per person, `plan-varias-voces.md`) needs many
voices of one model: it stays natural-voice only. With the light voice the
option is hidden.

### 6. Welcome (`src/pages/Welcome`, protected)

- Light device: no voice step. The person starts with captions; the card
  offers the voice.
- Other devices: unchanged (the natural voice step).

### 7. espeak-ng stays

Cancel Step 4 of `plan-voz-supertonic.md` (removing espeak-ng). Check that the
bundled `espeak-ng-data` (built with only the `espeak` languages of `LANGS`,
`scripts/build-espeak.sh` and the Windows CI step) covers every language in the
Piper catalogue, and fill in the `espeak` field in `config.rs` for them.

### 8. Credits and docs

- Credits: "Piper voices" with each bundled-catalogue voice and its licence
  (`plan-creditos.md`); sherpa-onnx is already listed.
- `plan-windows.md`, `plan-idiomas.md`, `plan-voz-supertonic.md` (Step 4
  cancelled), `CLAUDE.md` (section 4), marketing knowledge base.

## Phases

1. **Done 2026-11-03.** Engine, Spanish and English (Rust only): catalogue with 2–4 voices,
   download, synthesis, `piper:` ids, `light_device()`. Test in a copy of the
   project on the Mac, then a Windows build for the friend's laptop with the
   perf log. This is where the extrapolated 0.2× gets confirmed or not.
2. **Done 2026-11-03.** UI: voice menu with download entries, recommended
   group, Welcome on light devices, the safety-net suggestion.
3. **Done 2026-11-03.** All voices: see "Phase 3" below.

## Verification

- `npx vite build`, `pnpm test`, `cargo check`, `cargo test`; an ignored test
  that speaks a sentence per catalogue voice and writes WAVs to listen to.
- Windows laptop: translate a 5-minute video with the light voice; the log must
  show the voice well below real time and no "frase omitida".
- Mac: natural voice unchanged; a light voice picked by hand works too.

## Phase 1: what was built

- `piper.rs` (new): catalogue, `PiperEngine` (2 threads, last voice kept
  loaded), clause splitting with the punctuation put back, an ignored test that
  downloads Sharvard and one that speaks with every installed voice.
- `perf.rs`: `light_device()` (x86 without VNNI; `LINGORA_LIGHT_VOICE=1/0`
  forces it) and a log line.
- `models.rs` (protected): `Model::Piper`, `Model::every()`; light voices are
  listed in Disk space and their old folders count as leftovers of "voice".
- `pipeline.rs` (protected): `piper:` ids, the default choice above, no
  natural-voice warm-up on low-end computers, `release_voices()`.
- `lib.rs`: `light_voices` command; installed light voices in `voices`; they
  count for `female_voice`/`male_voice` in languages without a natural voice.
- `phonemizer.rs`, `config.rs` (protected): comments only (espeak-ng is used
  again). Step 4 of `plan-voz-supertonic.md` is cancelled.
- Verified: `cargo check`, `cargo test` (38 passed); the download test
  (Sharvard, 73 MB of files kept) and the speech test with both speakers.

## Phase 2: what was built

- `utils/voiceDownloads.js` (+ tests): what "Turn on voice" downloads
  (`voiceOffer`), what "Use light voice" switches to (`lightSwitch`), the light
  downloads grouped (`lightDownloads`) and the `VOICES_CHANGED` event, which
  makes the language and voice lists read again after a download.
- `hooks/useVoiceDownload.js` (download with progress), `hooks/useLightDevice.js`.
- Components: `VoiceOffer` (replaces the "no voice" note in the lane's
  settings), `MoreVoices` (the panel behind "More voices…"),
  `VoiceStruggleNotice` (on the card; polls `voice_struggling` every 10 s while
  the lane runs; "Keep" is remembered in `lingora.lightVoiceKept`).
- `LaneCard`: the three above, a "Light voices" group in the menu, the
  higher-quality switch hidden when the light voice is the automatic one.
- `languages` (Rust) now reports the natural voice only once it is downloaded:
  until then the lane offers it instead of failing on every sentence.
- `tts.rs` (protected): keeps the real-time factor of the last 3 sentences
  (`struggling()`, above 0.6×). `doctor.rs` (protected): on a low-end computer
  the voice check points to the lane instead of offering the natural voice.
- Welcome (protected): no voice step on a low-end computer.
- Disk space names each light voice ("Light voice (Sharvard, es-ES)").
- Credits: "Piper voices" with `public/licenses/Piper-voices.txt` (each voice,
  its dataset and licence).
- Texts in `es` and `en`; "Lingora voices" is now "Natural voices".
- Verified: `npx vite build`, `pnpm test` (115), `cargo check`, `cargo test`
  (38). Not tried in the running app yet.

## Phase 3: every voice (2026-11-03)

The user decided: Lingora is a demo, so it offers every voice, also the
non-commercial ones. Each model keeps `commercial` (licence allows it and not
fine-tuned from "lessac", whose recordings forbid commercial use: 5 of the
first 11 were) to filter them if it is ever sold.

- Source: the 537 Piper archives sherpa-onnx publishes (more than the 178 of
  the official catalogue, community voices included; 29 official ones are not
  in sherpa-onnx, among them every Japanese, Korean, Hebrew, Thai, Bengali,
  Marathi and Telugu voice). Each comes as normal, `-fp16` (doesn't load in
  sherpa-onnx 2.0.1) and `-int8` (2.4× slower without VNNI, and it changes the
  voice): only the normal one.
- `scripts/piper-voices` (README): `fetch_meta.py` → `survey.py` (downloads all
  148 in Lingora's languages, one at a time; pitch per speaker; checked with
  the app's listener: every European and Chinese voice understood ≥ 92 %) →
  `catalog.py` (one quality per voice, medium first; up to 3 speakers per
  gender; GLaDOS/turret out) → `src-tauri/src/piper_voices.json` (119 models,
  174 voices, 20 languages; 22 models clearly commercial) and the Credits text.
- `piper.rs` reads that JSON (`include_str!`). Per model: `espeak` voice,
  `input` ("espeak", "text" for one Ukrainian voice, "lexicon" for two of the
  three Chinese ones, with their rule FSTs), the files to keep. espeak-ng's
  language marks ("(en)…(fa)") are dropped before the model sees them.
- `phonemizer.rs` (protected): `phonemize_with` takes the espeak-ng voice.
- espeak-ng data: `DICTS` grew to the catalogue's languages (2.1 → 13 MB);
  rebuilt with `scripts/build-espeak.sh` (Mac binary and data; Windows builds
  its binary in CI and uses the same data).
- New languages with a local voice: Chinese, Persian, Urdu, Kazakh. Also a
  light voice (besides the natural one) in Arabic, Turkish, Hindi, Indonesian,
  Vietnamese, Russian, Ukrainian, Czech, Polish, German, Dutch, French,
  Italian and Portuguese.
- Verified: `cargo test` (38), `pnpm test` (115), `npx vite build`, the speech
  test with the installed Spanish voices. Not tried in Rust: a Chinese
  (lexicon) voice end to end; the survey did it with the same sherpa-onnx.

## Open questions for the user

1. Detection: is "x86 without VNNI" a good enough first rule? (It also marks
   2019–2020 desktops with 8+ cores as low-end; they'd get the light voice
   recommended but could still pick the natural one.)
2. Which Spanish and English voices sound best (default per gender)?
