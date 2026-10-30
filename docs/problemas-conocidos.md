# Known problems

Real problems found while testing Lingora on a Mac, with the symptom as the app
user sees it, the cause and what the app does about it.

Most of them are about **macOS audio configuration**, not the code. The app
checks them in the diagnostics panel (at the very top): the dependencies when
it opens and the audio every 5 seconds. When there is an automatic fix, a
button appears.

| Symptom | Cause | Does the app detect it? | Does it fix it? |
|---|---|---|---|
| Only translates the last sentence / it cuts out / sounds "as if inside a tin can" | "Lingora" is an aggregate device, not a multi-output device | Yes | Yes |
| It cuts out at times | BlackHole and the output run at different sample rates | Yes | Yes |
| Doesn't translate anything, the meter doesn't move | The system output doesn't go through BlackHole | Yes, and a notice in the lane | Yes |
| Stopped working when headphones were connected | macOS switched the output (and the input) to the headphones | Yes, within 5 s | Yes |
| The video can't be heard | The system output is plain BlackHole | Yes | Yes |
| Detects little or no voice | BlackHole volume low / video very quiet | Yes | Yes (BlackHole volume) |
| The translated voice repeats in a loop | The translation was played through the output that feeds the capture | — | Impossible by design |
| "Couldn't open the output: the requested device is no longer available" with AirPods | AirPods are two devices with the same name (input and output) | — | Fixed in the code |
| My voice sounds bad / distant | Bluetooth microphone in call mode | Yes (notice) | No |
| My voice comes through very low | Automatic gain disabled on the microphone | — | Fixed in the code |
| The translated voice cuts off midway in long sentences | Kokoro's limit of 510 tokens | — | Fixed in the code |
| Stops working after restarting the system audio | The WebView loses the device | Yes (notice in the lane) | No: restart the app |
| espeak-ng / a model / BlackHole is missing | Incomplete installation | Yes | No: shows the command |
| The voice sounds cut: one sentence doesn't end and another begins | Sentences split by the 5 s cut + the output opened and closed on every sentence | — | Fixed in the code |
| The translation starts 10–15 s late | Long chunks + whole voice generated at once + slow Kokoro | — | Fixed in the code |

---

## Audio routing

Lingora hears the call like this: the system output is a **multi-output device**
called "Lingora" that sends the same audio to the speakers (so you hear it)
and to **BlackHole 2ch** (a virtual cable). The app records from BlackHole.

```
Call / video app
        │
        ▼
System output: "Lingora" (multi-output device)
        ├──► Speakers / headphones  → you hear it
        └──► BlackHole 2ch          → Lingora captures it
```

### "Lingora" is an aggregate device instead of a multi-output device

- **Symptom:** the recording sounds choppy and metallic, "as if inside a tin
  can". Whisper only understands fragments, usually the end, so the app only
  translates the last sentence.
- **Cause:** in Audio MIDI Setup there are two device types that look alike. An
  *aggregate device* joins inputs and outputs from several devices with different
  clocks. A *multi-output device* sends the same audio to several outputs. They
  are told apart because the aggregate has input channels.
- **Detection:** the system output is an aggregate with input channels.
- **Automatic fix:** deletes the previous "Lingora" and creates a multi-output
  device with the current real output (or the speakers) as the main device, plus
  BlackHole 2ch with drift correction.
- **By hand:** Audio MIDI Setup → "+" → *Create Multi-Output Device*. Check the
  speakers and BlackHole 2ch, choose the speakers as the *master device* and
  enable *Drift Correction* only on BlackHole.

### Different sample rates

- **Symptom:** cuts and jumps in the capture.
- **Cause:** BlackHole ran at 48000 Hz and the speakers at 44100 Hz. Drift
  correction doesn't compensate for a difference like that.
- **Automatic fix:** sets BlackHole to the sample rate of the main output.
- **By hand:** Audio MIDI Setup → BlackHole 2ch → *Format*.

### The system output doesn't go through BlackHole

- **Symptom:** when "Translate automatically" is pressed, the meter doesn't move
  and "● voice" never appears. After 8 seconds the lane shows a notice.
- **Cause:** the system output is the speakers or some headphones, so the audio
  never reaches BlackHole.
- **Automatic fix:** creates (or recreates) "Lingora" and sets it as the output.

### Headphones were connected

- **Symptom:** it was working and suddenly stops translating.
- **Cause:** when headphones are connected (AirPods, for example) macOS moves the
  system *output and input* to them, and the audio stops going through
  "Lingora".
- **Detection:** the diagnostics repeat every 5 seconds and flag it right away.
- **Automatic fix:** creates "Lingora" with the headphones as the main output,
  so you keep hearing through them.

### The system output is plain BlackHole

- **Symptom:** Lingora translates, but you can't hear the call or the video.
- **Cause:** BlackHole is a virtual cable and doesn't play through any speaker.
- **Automatic fix:** same as the previous one.

### BlackHole volume low

- **Symptom:** the meter barely moves and the voice is not detected.
- **Cause:** the BlackHole input was at 73 %, and the video was already coming
  in at a low level.
- **Automatic fix:** raises the BlackHole input to 100 %.
- **In the code:** the voice detection threshold is low (0.002 RMS) and the
  sentences are normalized before being sent to Whisper.
- **By hand:** also raise the volume of the player or the call app.
  With a multi-output device the Mac's volume keys don't work. For the
  translated voice, each lane has its own volume control (0–200 %).

### The translation is heard in a loop

- **Symptom:** the same sentences repeat over and over, and "transcriptions" in
  Spanish appear in the English lane.
- **Cause:** the translated voice played through "Lingora", came back in through
  BlackHole and was translated again. The macOS WebView (WKWebView) doesn't
  implement `AudioContext.setSinkId`, so it can't choose the output.
- **In the code:** the voice is played from Rust (`cpal`) on the chosen device.
  The outputs that feed the capture (BlackHole 2ch, "Lingora") can't be chosen,
  and the backend refuses to play to them.
- **Technical note:** `cpal` can't read the formats of the built-in speakers on
  recent macOS ("Invalid property value") and doesn't list them. The app looks
  for them among all the devices and uses the sample rate that Core Audio gives.
  Requesting another sample rate would make `cpal` change it and throw off the
  multi-output device.

### Error playing through AirPods

- **Symptom:** with the AirPods as the lane's output, every sentence fails with
  "couldn't open the output: The requested device is no longer available".
- **Cause:** macOS registers some Bluetooth headphones as **two devices with the
  same name**: one input-only (microphone) and one output-only. The app looked for
  the output by name and found the microphone first.
- **In the code:** among the devices with that name, the one that has an output is
  used. As with the speakers, `cpal` can't read their formats, so the Core Audio
  sample rate is used.

### Bluetooth microphone

- **Symptom:** your translated voice comes out worse. Whisper makes more mistakes.
- **Cause:** when using the microphone of Bluetooth headphones, macOS switches
  them to call mode: 16 kHz and a lot of compression.
- **Detection:** notice if the system input is Bluetooth.
- **By hand:** use the Mac's microphone as the input and the headphones only
  for listening.

### The system audio was restarted

- **Symptom:** after restarting the audio service (`sudo killall
  coreaudiod`), after changing devices or when a device disconnects, the
  capture stops working.
- **Cause:** the WebView loses its connection to the device.
- **Detection:** the lane stops and shows a notice.
- **By hand:** press "Translate automatically" again; if it doesn't respond,
  restart Lingora.

### Online meeting: your voice doesn't appear until the Mac makes a sound

- **Symptom:** in Take notes → Online meeting, if you start speaking, nothing
  appears (not even the `[lingora] entrada:` line for your microphone) until
  something plays on the Mac (a video, the other person). The clock may stay at
  00:00.
- **Cause:** with the Mac's audio capture just created and nothing playing,
  Core Audio doesn't answer until audio passes through it. Opening the microphone
  afterwards kept waiting, and device queries on the window's thread froze it.
- **Fix:** `startNotes` (`useMeetingNotes.js`) opens your microphone **before**
  capturing the Mac, and `audio_route` and `list_audio_devices` run outside the
  window's thread (`spawn_blocking`). When a device is connected, the devices are
  not reloaded while recording. Don't change that order.

---

## Voice and transcription

### My voice comes through very low

- **Cause:** the capture turns off system processing because, with it on,
  WKWebView can deliver silence on virtual devices such as BlackHole.
  That also turned off the microphone's automatic gain.
- **In the code:** automatic gain is enabled only on the microphone lane, and each
  sentence is normalized to −1 dBFS (at most ×20) before going to Whisper. What is
  below the silence threshold is not amplified, so that Whisper doesn't invent
  sentences out of the noise.

### The translated voice cuts off midway

- **Cause:** Kokoro accepts about 510 tokens per call and silently discards the
  rest. A translation longer than about 30 s was being cut.
- **In the code:** espeak-ng returns one clause per line; the engine groups them
  into chunks of up to 400 characters, synthesizes them separately and joins them
  with a short pause.

### Whisper "only returns the last segment"

An earlier note in `groq.rs` attributed to Whisper that the `text` field came
back with only the last segment. When tested with 22 s of speech, Whisper returned
everything with both `json` and `verbose_json`. The most likely explanation is
that the audio already arrived truncated because of the aggregate device problem.

### The translation starts 10–15 s late

- **Symptom:** in a video or a call, the translated voice starts playing long
  after the person finishes speaking.
- **Cause:** three things added up. Someone speaking without pauses reached the
  maximum of 10 s per chunk, so 10 s had to pass before anything was translated.
  The voice was generated in full before playing. And Kokoro in `q8` took half
  the audio's duration to generate it.
- **In the code:**
  - Chunks of 5 s at most; a 0.4 s pause closes the sentence.
  - The translation is split into sentences and the first one is cut at its first
    comma. Each sentence is synthesized separately and plays as soon as it is ready.
  - Kokoro in `fp32`: 2.25 times faster than `q8` on Apple Silicon, ~0.22 s per
    second of voice. The first short sentence is ready in ~0.4 s.
  - Whisper and the translator receive the previous chunk as context, so that
    split sentences are translated well.
- **Measured:** Whisper + translation ~1.4 s, first voice sentence ~0.4 s. About
  2 s from the end of the chunk, plus the 0.4 s pause that closes it.

### The voice sounds cut: one sentence doesn't end and another begins

- **Cause 1, split sentences:** someone speaking without pauses gets cut every 5 s.
  If the cut falls in the middle of a sentence, half a sentence was translated and
  spoken ("and then we went to the…") and the next one started just as lamely.
  Also, Whisper usually puts a period at the end of the chunk even when the
  sentence continues.
- **In the code:** each chunk indicates whether it ended at a pause or at a forced
  cut. At a forced cut only the text up to the last internal sentence end (or the
  last comma) is translated; the rest is kept and joined with the next chunk. The
  final period that Whisper adds doesn't count. If a text has no sentence end at
  all, it is kept once; the second time it is translated as is, so as not to
  accumulate delay. At a pause, everything is translated.
- **Cause 2, the output opened on every sentence:** opening and closing the audio
  device for each sentence made Bluetooth headphones eat the beginning of each one.
- **In the code:** each output is opened once and stays open (it emits silence when
  there is nothing to say). Sentences are queued and play one after another. If the
  device disconnects, it is reopened on the next sentence.

### Whisper sometimes takes 8 s or fails

- **Symptom:** some sentences arrive much later than others, or a stray API error
  appears.
- **Cause:** Groq's latency is very variable: the same request takes 1 s or 8 s,
  and now and then it fails for no reason.
- **In the code:** if Whisper doesn't respond within 2 s, an identical second
  request is sent and whichever arrives first is used. A fast failure is retried
  once.

---

## Installation

| Check | If it fails |
|---|---|
| Groq key | Add `GROQ_API_KEY=...` to the `.env` in the root and restart |
| espeak-ng | It is inside the app: reinstall Lingora. In development, `scripts/build-espeak.sh` |
| Voice model | "Descargar" (Download) in the diagnostics |
| BlackHole 2ch | `brew install blackhole-2ch` and restart the Mac |

---

## Last resort

If BlackHole seems to receive nothing even though the diagnostics are green,
restarting the audio service can help (requires the administrator password):

```bash
sudo killall coreaudiod
```

Afterwards Lingora has to be restarted. It is not confirmed that this was
necessary in the tests, where the fault turned out to be the measuring tool, but
it is the usual recommendation when virtual drivers get stuck.
