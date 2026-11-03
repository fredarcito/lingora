# Your voice: Speak in your own voice

In a call, the Speak lane says your translation in **your own voice**, cloned
from a short recording, instead of a Lingora voice. Done (2026-11-03); untested
in a real call.

## What it does

- **Settings → Speak → Your voice:** downloads the model (98 MB), records
  about 15 s of you reading a text (up to 30 s; at least 8), plays a sample,
  records again or deletes it. The recording stays on this computer, in
  `~/Library/Application Support/lingora/voice/sample.wav`.
- **Speak card → voice:** "Your voice" is a fourth choice next to No voice /
  Female / Male (not in the list of specific voices), when the recording exists
  and the other person's language is one the model speaks. It is saved as
  `voiceIds[<lang>] = "own"`, which `enqueue` already passes to `speak`. In
  other languages the lane keeps its automatic voice.
- The recording can be in any language: it only gives the timbre. The voice
  speaks the translation, in the other person's language.

## How

- Model: **Pocket TTS** (Kyutai, ~100M parameters) through the sherpa-onnx
  crate we already use (`OfflineTtsPocketModelConfig`, `reference_audio`). No
  new dependency. Only English for now: it is the only Pocket TTS model in
  sherpa-onnx's releases (`sherpa-onnx-pocket-tts-int8-2026-01-26`).
- `src-tauri/src/own_voice.rs`: the engine (2 threads, released with the other
  voices), the recording (silence trimmed, brought up to 0.7 peak, refused if
  silent or under 8 s) and its status.
- `pipeline.rs`: `speak` takes the voice id `"own"`; `models.rs`:
  `Model::OwnVoice` (id `own_voice`, also in Disk space).
- `lib.rs`: `voices` lists it first; `own_voice_status`, `save_own_voice` (raw
  samples, like `play_audio`) and `delete_own_voice`.
- UI: `components/OwnVoice` (in `LaneSettings`, after Lingora Mic),
  `hooks/useVoiceRecorder`, the "Your voice" choice on the card (`LaneCard`).

## Measured (M-series Mac, 2026-11-03)

| | Seconds per second of audio | 5 s sentence |
|---|---|---|
| Your voice, 2 threads | 0.18–0.20 | ~0.95 s |
| Natural voice, 5 steps (today) | 0.13 | ~0.98 s (7 s of slower speech) |
| Natural voice, 8 steps | 0.20 | ~1.5 s |

- **No speed gain:** similar to the natural voice. sherpa-onnx gives no early
  audio for Pocket TTS (the first chunk arrives near the end).
- **Similarity** (speaker model of the notes, 1 = same): cloned from English
  0.58, from Spanish 0.44, from Chinese 0.37 (closer to another voice: weak).
  A real recording at very low level (0.04 peak) cloned a muffled voice and cut
  short sentences; normalizing fixed it. Hence the level step in `prepare`.
- It sounds like you, but less clean than a studio voice: the clone copies the
  recording's microphone and room.
- Pocket TTS samples at random: without a seed the same sentence came out
  different each time (2.6 s once, 3.5 s the next). `own_voice.rs` fixes the
  seed (`SEED`), so the same text always sounds the same.
- Settings plays back both the recording and the clone saying the same text
  in English, to compare them.

## Licence

The weights are CC-BY-4.0 (Kyutai), with a ban on cloning anyone without
consent: only the user's own voice, recorded in Settings. The sherpa-onnx
export's README says "for non-commercial" use: fine for the demo, **check it
before selling Lingora**.

## Pending

- Test it in a real call (Meet, Zoom) with Lingora Mic.
- More languages: Kyutai has French, German, Italian, Portuguese and Spanish
  (community ONNX exports: `KevinAHM/pocket-tts-onnx`); check whether they load
  in sherpa-onnx or convert them.
- Recording in Chinese, Japanese… clones weakly: test with real people; maybe
  suggest reading in English.
- Windows: the recorder uses the webview microphone like the rest; untested.
