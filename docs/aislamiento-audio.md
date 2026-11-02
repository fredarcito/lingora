# How Lingora isolates the audio it translates

Lingora has to translate **only the voice it should**: in "Listen", the people
in the video or call; in "Speak" and in Take notes, you. Everything else (its
own translated voice, background noise, breaths, the meeting coming out of the
speakers) must not reach the listener, or it gets translated twice, spoken back
or attributed to the wrong person.

This document explains every layer that does that, from the sound card to the
notes, and the echo cancellation on the microphone, at the end. Everything
runs on the device; nothing is sent anywhere.

```
 what plays on the device ──► [1] system capture, Lingora excluded ─┐
                                                                      ├─► [3] voice detection ─► [4] text filters ─► translation
 microphone ──► [2] raw mic ─► [7] echo cancellation (no headphones) ───┘                                │
                                                                                                       ▼
                                                    [5] echo filter (Take notes) ─► [6] who is speaking ─► notes
```

---

## 1. "Listen": capturing the device without hearing ourselves

"Listen" doesn't use the microphone: it takes what is **playing** on the
device (the video, Meet, Zoom…) straight from the operating system, as digital
audio. There is no room noise and no speaker echo in it, because it never goes
through the air.

The key point is that **Lingora's own process is excluded** from that capture,
so its translated voice can never come back in and be translated again (an
endless loop).

| | Mac | Windows |
|---|---|---|
| How | Core Audio "process tap" (macOS 14.2+), read through a private aggregate device only Lingora sees | WASAPI process loopback (Windows 10 2004+) |
| Exclusion | `initStereoGlobalTapButExcludeProcesses:` with Lingora's process | `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` with Lingora's process tree |
| Extra drivers | None (BlackHole is no longer needed) | None |
| Code | `src-tauri/src/system_audio.rs` | same file, `#[cfg(windows)]` |

Details that matter:
- The stereo mix is folded to **mono**, and delivered in blocks of 4096 samples.
- On Windows, WASAPI delivers nothing while the device is silent; the capture
  **fills those gaps with zeros** so the timing stays right.
- The user keeps hearing everything through their usual output: the capture is
  a copy, not a detour.

Extra guards against loops (`src/utils/lanes.js`):
- `feedsCapture`: outputs that would end up in the capture (BlackHole, an old
  "Lingora" multi-output) are flagged so the voice is never played there.
- `VIRTUAL_MIC` ("Lingora Mic"): in a call, "Speak" plays the translation into
  Lingora's own virtual microphone, which the call app uses. "Listen" never
  picks it as an input.

## 2. The microphone ("Speak" and Take notes)

The microphone is opened by the app window (`getUserMedia` in
`src/utils/audio.js`) **with the system's processing switched off on purpose**:

| Setting | Value | Why |
|---|---|---|
| `echoCancellation` | off | On the Mac, with it on, the WebView could deliver pure silence from virtual devices. Also, the window's canceller only knows what the window plays, which is neither the meeting nor Lingora's voice. Lingora's own canceller does it instead (section 7). |
| `noiseSuppression` | off | It also produced silence on virtual devices, and it distorts voices, which hurts recognition. Noise is handled by the voice detection instead (section 3). |
| `autoGainControl` | on for real microphones only | Without it, the voice arrives too quietly for the listener. |
| `channelCount` | 1 | Mono, retried without it if a device refuses. |

Bluetooth headphones: if their microphone isn't already in use, Take notes uses
the **built-in microphone** instead (`prefersMacMic` in `src/utils/route.js`).
Opening a Bluetooth headset's microphone switches it to "call mode" and the
meeting would sound worse. With the headphones on, the built-in microphone only
hears you.

## 3. Voice detection: what counts as speech

Every 85 ms block is measured (RMS) and compared against the **background noise
level, which is learned continuously** (`VAD` in `src/utils/audio.js`):

- **Adaptive threshold:** a block counts as voice only if it is **3 times
  louder than the current background noise** (`noiseFactor: 3`). A noisy room
  raises the bar automatically; a quiet one lowers it.
- **Absolute floor:** below RMS 0.002 nothing is ever speech
  (`minSpeechRms`). It is low on purpose: video audio can arrive quietly.
- **Too short to be a sentence:** chunks under 0.7 s are dropped
  (`minSegmentSecs`). That removes clicks, coughs and keyboard taps.
- **Don't cut the edges:** 0.3 s before the voice starts (`preRollSecs`) and
  0.2 s after it ends (`tailSecs`) are kept, so the first and last syllables
  are not lost.

**Where a sentence ends.** Each second of waiting is a second of delay, so
sentences are cut early but at natural points:
1. A 0.4 s pause closes the sentence (`silenceSecs`).
2. With the local listener, a sentence that already ends in a full stop is
   delivered after only 0.2 s of silence (`sentenceGapSecs`).
3. Someone who talks without pausing is cut at their last comma after 4 s
   (`clauseCutSecs`), or between two words after 4.5 s (`wordCutSecs`), never
   in the middle of a word.
4. The first chunk after a long silence (a new speaker, the video starting) is
   cut after 2 s (`firstCutSecs`), so the translation starts sounding sooner.
5. Last resort: 8 s at most (`maxListenedSegmentSecs`).

**Level before recognition** (`normalize`): each chunk is raised to a peak of
-1 dBFS, because the listener loses whole sentences when the voice is quiet.
The gain is capped at x20, and chunks with a peak under 0.005 are left alone,
so silence is never amplified into noise that the model would "hear" as words.
The backend applies the same 0.005 gate (`src-tauri/src/pipeline.rs`).

These values were tuned over many hours of real audio. They are protected in
`CLAUDE.md`: don't change them without a new round of tests.

## 4. Text filters: noises the listener writes as words

Speech recognisers sometimes turn noise into text. Two filters drop those
chunks before they are translated or spoken (`src/utils/audio.js`):

- `FILLER`: fillers and noises transcribed as words ("Mm.", "Uh,", "Ajá",
  "Hmm"…). Not worth translating or saying out loud.
- `LONE_NOD`: a lone "Yeah." / "Yep" / "Uh-huh". The listener hears them in
  breaths and background noise, and the voice would say "Sí" with nobody
  talking. Only dropped when it is the **whole** chunk; "Yes" is kept because
  it is usually a real answer.

## 5. Echo filter in Take notes (meeting on speakers)

In an online meeting without headphones, the microphone also hears the others
through the speakers. Without a filter, each of their sentences would appear
twice in the notes: once as "Person 1" (from the device audio) and once as "Me"
(from the microphone).

Because Lingora also has an exact copy of what played (section 1), each
microphone sentence is compared with what was heard at the same time
(`src/utils/echo.js`, ±2 s):

1. **By text:** if at least half of its words match what played
   (`ECHO_SHARE = 0.5`), it is echo and dropped. If only part matches (you
   spoke over them), that part is removed and yours is kept, if at least 3
   words remain.
2. **By voice:** if the text doesn't match but something was playing and the
   voice sounds more like that person than like you (by voice print, with a
   0.1 margin), it is also echo. Your voice is learned from your first 3
   sentences spoken while nothing was playing.
3. **With headphones** there is no echo (`echoPossible` in
   `src/utils/route.js`), and sentences pass through without waiting.

The filter waits for the matching text to arrive (up to 8 s), so it adds
delay. That is fine for notes, but **not for live translation**, which is why
it is not used in "Speak" (see section 7).

## 6. Who is speaking (notes)

Each sentence gets a **voice print** (a speaker embedding computed on the
device). `createSpeakerTracker` in `src/utils/notes.js` groups them into
people:

- **Live:** each sentence goes to the most similar person if the similarity
  passes `SAME_SPEAKER = 0.5`; if not, and it is long enough
  (`NEW_SPEAKER_SECS = 2`), it starts a new person. Sentences shorter than
  1.2 s (`SHORT_SECS`, "yes", "ok") always go to the most similar person:
  their print is unreliable.
- **When the meeting ends (`refine`):** with the whole conversation, people
  that were split by mistake are merged (`MERGE = 0.6`), people with too
  little speech (`MIN_SHARE = 3 %`) are folded into the closest one, and
  everyone is renumbered in order of appearance.
- `speaker: 0` is always "Me" (the microphone); the others start at 1.

Tuned with a real 55-minute interview (2 people: 94 % right) and synthetic
voices (100 %).

## 7. Echo cancellation on the microphone

**The problem.** In a meeting on speakers, the microphone hears the meeting
(and Lingora's translated voice, if "Listen" plays it on the speakers). "Speak"
would then translate the others as if you had said it, and send it to the call.
This happens on the Mac and on Windows; it is just more common on Windows
laptops, where speakers and microphone sit close together. Meet, Zoom and Teams
cancel their own echo, but only in the audio they send: they don't clean what
Lingora records.

**The solution: acoustic echo cancellation (AEC)**, the same technique Chrome
and Meet use, with **WebRTC's AEC3** through the
[`sonora`](https://github.com/dignifiedquire/sonora) crate (a pure Rust port of
WebRTC's audio processing, BSD-3-Clause). It was chosen over the C++ bindings
(`webrtc-audio-processing`) because it builds and is tested on Windows with no
extra C++ toolchain. The text filter of Take notes (section 5) was ruled out
because it adds delay.

**How it works.** The canceller gets two signals:
- the **microphone** (your voice + the echo);
- the **reference**: everything that is playing on the device.

It learns how the room turns the reference into echo (delay, volume,
reverberation), predicts that echo and subtracts it from the microphone, in
10 ms blocks. What remains is your voice. A 10 ms block adds no noticeable
delay next to the seconds that translation takes, and it finds the delay
between the two signals by itself. In the unit test (a delayed copy of the
reference at half level) it removes **46 dB** of echo.

**In Lingora** (`src-tauri/src/echo_cancel.rs`):
1. When cancellation is on, **Rust opens the microphone** (cpal) instead of the
   window, so the microphone and the reference meet in one thread, in arrival
   order. The cleaned audio reaches `audio.js` the same way the device audio
   already does; voice detection (section 3) doesn't change.
2. **The reference includes Lingora's voice**, unlike the capture of section 1:
   - Mac: a second process tap, with no process excluded
     (`system_audio::start_reference`);
   - Windows: WASAPI loopback of the default output (cpal opens it when an
     input stream is built on an output device).
3. Same processing as Chrome's microphone: echo canceller, high-pass filter,
   and adaptive gain (AGC2) for real microphones. Noise suppression stays off
   (section 2).
4. If anything fails (no reference, the microphone can't be opened from Rust),
   the microphone opens in the window as before, without cancellation.

**When it is on: automatically, like Chrome.** Chrome and Meet keep echo
cancellation on by default, headphones or not: with headphones the canceller
learns there is no echo and removes nothing. Lingora only skips it when it
knows headphones are connected (`echoPossible` in `src/utils/route.js`), and
only for real microphones ("Speak", and the microphone in Take notes).
- On the Mac, headphones are detected reliably (`src-tauri/src/route.rs`).
- On Windows, `audio_route` doesn't detect anything yet and reports "other",
  so cancellation is always on, which is what Chrome would do. Windows can
  report the output's type (`PKEY_AudioEndpoint_FormFactor`), which is
  reliable for Bluetooth and USB headsets, but not for the 3.5 mm jack on many
  laptops.

**Limits.**
- It removes most of the echo, not all: with poor laptop speakers some residue
  remains (usually below what voice detection treats as speech), and when you
  and the others talk at once it may clip part of your voice. Headphones are
  still the most reliable setup.
- Whether to cancel is decided when the lane starts: plugging in headphones
  mid-session doesn't switch it off (harmless: there is just no echo left to
  remove).
- On the Mac the reference also contains what Lingora plays into its virtual
  microphone for a call, which never reaches the speakers. The canceller
  learns that part has no echo, but it is extra signal it doesn't need.
- On Windows the reference is the **default** output: if the meeting plays on
  another device, its echo isn't removed.
- With the microphone opened from Rust, a disconnection isn't reported to the
  lane (`onEnded`) the way the window does.

---

## Summary

| Layer | Removes | Where | Delay |
|---|---|---|---|
| 1. System capture without Lingora | Lingora's own voice, room noise (digital audio) | `system_audio.rs` | None |
| 2. Raw microphone | Silences from system processing on virtual devices | `audio.js` | None |
| 3. Voice detection | Background noise, clicks, coughs, silences | `audio.js` (`VAD`) | Pauses of 0.2–0.4 s |
| 4. Text filters | "Mm", "Uh", lone "Yeah" from noise | `audio.js` (`FILLER`, `LONE_NOD`) | None |
| 5. Echo filter | The meeting heard by the microphone (notes only) | `echo.js` | Up to 8 s (notes only) |
| 6. Voice prints | Mixing up people | `notes.js` | None (refined at the end) |
| 7. Echo cancellation | The meeting and Lingora's voice heard by the microphone | `echo_cancel.rs` (`sonora`) | ~10 ms |
