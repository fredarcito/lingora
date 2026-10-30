# Plan: "Take notes" mode (transcribe without translating)

Status: phase 1 ready to implement (2026-10-29). Phases 2 and 3 come
afterwards, each with its own confirmation.

Goal: use Lingora to take notes of classes and meetings in the language
being spoken, with speakers, summary and export. Almost everything already
exists internally:

- the Original mode transcribes without translating;
- the notes recorder, the speakers and the summary already work.

What is missing is the mode itself and its interface.

---

## 0. Rules (read before starting)

The same as in `docs/plan-notas.md`, section 0. In addition:

- **"Translate audio" and "Translate call" have to work exactly the same as now.**
  The new mode is added alongside; don't reorganize the flow of the other ones.
- **Don't touch what is tuned:**
  - `src/utils/audio.js`;
  - the `enqueue` / `texted` / `playback` flow of `App.jsx`, except what
    is indicated below;
  - `src/components/Captions/` and `src/pages/FloatingCaptions/`;
  - the speaker grouping in `src/utils/notes.js` (`createSpeakerTracker`);
  - the models and their parameters in Rust.
- **Reuse the design** of Notes and Settings: the components of
  `src/components/shared/` (`Button`, `Switch`…; see `docs/componentes.md`)
  and the `--n-*` variables of `src/styles.css`. The new things go in
  `src/pages/NoteTaking/styles.module.css`.
- Before touching `src-tauri`, warn and wait for the signal: it restarts the app of
  whoever is testing. Bundle all the Rust changes into a single block.
- In the interface, no models are named.

---

## How the language is handled

- The European listening (25 languages) detects the language sentence by sentence: there
  is no need to choose it, and it handles mixed meetings (English and Spanish, for
  example). The one for Chinese, Japanese, Korean and Cantonese also detects on its own
  between those languages and English.
- That is why the user doesn't choose a specific language, only the family:
  - **"Automatic"**, by default: internally it listens with the code
    `"EN"`, which picks the European listening.
  - **"Chinese, Japanese, Korean…"**: internally, `"ZH"`.
- The transcript stays in the language in which each sentence was spoken.
- **Language of the notes:** it is that of the summary, by default `es`. That way a
  meeting in English is transcribed in English and summarized in Spanish.
- Limit: very short or noisy sentences ("OK", "Yeah") sometimes come out in
  another language or are lost.

---

## Phase 1: the basic mode

### 1.1 The mode

- `Mode` becomes `"video" | "call" | "notes"`. It is saved in
  `lingora.mode` like the others.
- In the top bar, a third button in the mode selector:
  - text: **"Take notes"**;
  - hint: "Transcribes classes and meetings without translating, with speakers and a summary".
  - It doesn't depend on `VITE_CALL_MODE`.
- In `notes` mode, the bar doesn't show the language selector (`PairBar`):
  its options go in the mode's card (1.3).

### 1.2 Internally: the Listen lane without translating or speaking

In `notes` mode the `remote_to_local` lane is used as is, with these
changes, applied **only** in the computation of `lanes` (near `const lanes =
laneSettings.map`):

- `sourceLang` and `targetLang` = `"EN"` or `"ZH"`, according to "Meeting language". With the
  same language, the flow already skips the translation (see
  `t.source_lang === t.target_lang` in `enqueue`).
- `speak: false`: no voice.
- `inputDeviceId`: that of "What to listen to" (1.3), not that of the lane. Don't change
  the saved device of Listen.

Also:

- **No unnecessary warm-ups.** Review `start`: in `notes` mode the translation
  (`translateWarmUp`) and the voice (`warmUp`) are not preloaded, and the floating
  captions window is not opened. If `start` already avoids it with the
  same language and no voice, don't touch it.
- **The recorder** (effect on `anyRunning`):
  - in `notes` mode it is **always** created, even if "Save conversations"
    is off: recording is the purpose of the mode;
  - in the other modes it stays as it is.
- **Speakers** are distinguished the same way as now: "Tell speakers apart"
  switch and downloaded model.

### 1.3 Mode screen: `src/pages/NoteTaking/` (new)

In `notes` mode this component is shown instead of the lane cards (`lanes`). The
diagnostics stay the same.

**Before starting** (not recording), a card (`prefs-card`) with:

- **What to listen to**, a segmented control like the ones on the card (`Segmented`):
  - "Computer audio": videos, classes or online meetings. Uses
    `SYSTEM_AUDIO`; if it is not available, the option is disabled with its
    hint.
  - "Microphone": in-person meetings. Uses the default microphone.
  - Saved in `lingora.notesInput`.
- **Meeting language:** "Automatic" / "Chinese, Japanese, Korean…". Saved in `lingora.notesListen`.
- **Language of the notes:** a `select` with the languages from
  `api.languages()`, by default Spanish. Hint: "The summary is written in
  this language". Saved in `lingora.notesLang`.
- **The main button:** "Start taking notes".
- A gray line below: "It is transcribed on your Mac. Only the text leaves
  if you ask for a summary."

**The first time** Start is pressed, a dialog (same style as `ConfirmDelete` in
`Notes.jsx`):

> "Before recording: let people know you are transcribing the conversation."

Buttons "Cancel" and "Got it, start". Remembered in `lingora.notesConsent`.

**While recording**, a document-like view:

- **Bar on top:**
  - a pulsing red dot (reuses `note-live`);
  - elapsed time `mm:ss` (or `h:mm:ss` from one hour on);
  - the detected people, with their color and not editable;
  - on the right, the **Stop** button (`note-action`).
- **Center:** the live transcript, in paragraphs, with time, speaker and color,
  just like the Transcript tab of a note.
  - To avoid duplicating code, extract from `Notes.jsx` a `Transcript`
    component (the `note-lines` list) and `speakerColor`, and use them in the
    two places without changing how they look.
  - It scrolls by itself while the user is at the bottom. If they scroll up to read
    something, it doesn't drag them down: a "↓ Jump to end" button appears.
- **Footer, in gray:** what is being heard right now (`heard` + `partial` of the
  lane). That way it doesn't look delayed.
- **No sentences yet:** "Listening… notes will appear here."

**Where the live note comes from.** `notes.js` exposes:

- `getActiveNote()`: a copy of the note in memory;
- a window event `lingora-note-changed` that is emitted when a sentence is added
  and when a speaker is assigned to it.

`NoteTaking` listens to it. **Don't** read the disk every few seconds for this.

### 1.4 The note of this mode

`createRecorder({ mode })` with `mode: "notes"` creates the note with:

- `kind: "notes"`. The other notes don't have `kind`, or have
  `"translation"`.
- Title: `"Notas del 29 oct, 10:32"`.
- `summary_lang`: the chosen language of the notes.
- In each sentence, `source_lang` and `target_lang` = `"auto"` (or `"zh"` with the
  other family), and `translation: null`.

On the note's page (`Notes.jsx`):

- **The language line,** if `kind === "notes"`: "Transcript · automatic language".
- **Summary language:** next to the Summarize button, a small `select`
  ("Summary in: Español"). Changing it saves `summary_lang` in the note.
  Only for notes with `kind: "notes"`.
- **In the list,** a discreet "Notes" label (`badge`) to tell them apart
  from the translations.

### 1.5 When stopping

- The lane stops as now. The recorder finishes and does the speakers review.
- Afterwards **that note's page** opens in the Notes view, with the
  Transcript tab and the Summarize button for manual use.
  - `Notes` accepts a prop to open a specific note, for example
    `openRequest: { id, nonce }`.
  - `App` changes `view` to `"notes"` when `finish()` completes.
  - If the note ended up empty (nothing was said), nothing is opened and it stays on
    the mode's screen.

### 1.6 Rust (a single block, warn first)

Only in `src-tauri/src/notes.rs`:

- **`note_summarize`:** the summary language comes from `summary_lang` if it
  exists (with `Lang::from_code`). If not, what is done now is used: the
  `target_lang` of the first sentence, and if there is none, Spanish.
- **`span_line` and the export:** check that they work with
  `source_lang: "auto"` (they shouldn't depend on it).
- A unit test: a note with `summary_lang: "en"` chooses English.

### Manual tests (phase 1)

1. "Translate audio" and "Translate call" work as before: voice, captions,
   floating, original.
2. Take notes with the Mac's audio on a video with 2 people:
   - the live transcript appears, with people;
   - when stopped, the note opens, with the people already reviewed.
3. A meeting in English with "Language of the notes: Español": the
   transcript stays in English and the summary comes out in Spanish.
4. Change "Summary in" in the note and summarize again: it comes out in the other
   language.
5. With "Save conversations" off, Take notes records just the same and
   "Translate audio" doesn't record.
6. With the microphone: speak and see the transcript. Lingora's voice never
   plays at any point.
7. The privacy notice appears only the first time.
8. Stop without having said anything: no note is created and the view doesn't change.
9. During recording, scroll up to read: it doesn't drag you down, and "↓ Jump to
   end" brings you back.
10. A "Take notes" note and a translation note in the list: the "Notes" label
    only appears on the first.

---

## Phase 2: online meeting, with "Me" (done by Opus)

Goal: in an online meeting the note contains **the other people and you**,
whatever you use to listen and speak. The Mac's **default output and input** are
always used; whoever uses the app chooses and configures nothing.

### 2.1 What the person sees

- "What to listen to" now has three options:
  - **"Online meeting"** (new, the first one and the default if there is computer
    audio): the Mac's audio and your microphone at the same time.
  - "Computer audio only": videos and classes, where you don't speak.
  - "Microphone": in-person meetings.
- Below it, a hint that changes by itself according to what is connected (see 2.3):
  - Headphones: "With headphones: your voice and everyone else's stay separate."
  - Speakers: "With speakers, Lingora removes from your microphone what was already
    heard through the Mac. With headphones it's cleaner."
  - AirPods as microphone: "Your microphone is the AirPods: it sounds lower quality."
    (the hint that already exists in diagnostics).
- In the note: the microphone is always **"Me"** (`speaker: 0`); the Mac's audio
  is Person 1, 2… as now.
- Nothing is sent to the call: no voice and no virtual microphone.

### 2.2 How it is recorded

- Two lanes at the same time, like the call mode, both with `notes: true` and
  no voice:
  - `remote_to_local` with `SYSTEM_AUDIO` (the other people);
  - `local_to_remote` with the default input (you). The recorder already sets
    `speaker: 0` for this direction.
- **The order:** before, `createRecorder.add` stacked in arrival order and `t` was the
  arrival time. With two sources, a short sentence can jump ahead of another. Now `t` is when
  the sentence **finished being heard** (`info.endedAt`, as the `NoteSentence` type
  says; the pauses of `paragraphs` rely on it) and the sentence is inserted in its place by `t`.
- **The captions** of the notes screen show both sources in a single list, by
  time, with "Me" marked.

### 2.3 What is connected (automatic detection)

It is checked when starting and **every time** the default output or input changes
(connecting or removing AirPods in the middle of a meeting):

| Default output | How it is recognized | Can there be echo? |
|---|---|---|
| AirPods / Bluetooth headphones | Bluetooth transport | No |
| Wired headphones on the Mac | built-in with source `hdpn` | No |
| USB headphones (with microphone) | USB with input and output | No |
| Mac speakers | built-in with source `ispk` | **Yes** |
| Monitor, HDMI, USB/Bluetooth speaker without microphone, AirPlay | the rest | **Yes** (just in case) |

If it is not known, it is treated as speakers: removing the echo when there is none
barely costs anything; not removing it when there is fills the note with repeated
sentences.

**The AirPods microphone.** If the default input is the AirPods microphone but
the meeting app uses the Mac's, opening it would switch the AirPods to call mode and **the
meeting would sound worse**. Rule:

- if the AirPods microphone is already used by another app (Core Audio:
  `DeviceIsRunningSomewhere`), that one is used (they are already in call mode, nothing
  is lost);
- if not, the Mac's microphone is used, which with headphones only hears you.

**Changes in the middle of a meeting.** If the default input changes, the microphone
lane is closed and reopened with the new one, without stopping the note or
showing an error. The Mac's capture keeps going by itself: the tap is global, it doesn't depend
on the output.

### 2.4 Echo with speakers

With speakers the microphone also hears the others: without doing anything, each of their
sentences would come out twice, once as "Person 1" and once as "Me". We have the
advantage that **we know exactly what was played** (the Mac's audio), so
it is compared against that. It is done in three layers, in `src/utils/echo.js` (new;
it doesn't touch `audio.js` or the speakers tracker):

1. **Short wait.** Each sentence from the microphone waits until the Mac lane has
   delivered everything that was heard at the same time (at most about 4 s).
2. **Text.** If in that window (±1.5 s) there was a sentence from the Mac and almost all
   the words of the microphone one are in it (≥ 60 %, without accents or filler
   words), it is echo and is discarded. If only part matches (you spoke at the same time), those
   words are removed and yours is kept, if something meaningful remains (3 words or more).
3. **Voice.** If the voice fingerprint of the microphone sentence is more similar to a
   person from the Mac than to "Me", it is discarded. The "Me" fingerprint is learned by itself
   from the microphone sentences that the Mac doesn't explain. It is only applied when
   the output may have echo.

With headphones no layer is applied: the microphone goes straight through as "Me",
with no waits.

Plan B (only if with real audio the layers aren't enough): real echo cancellation
with the Mac's audio as reference. It needs a new crate
(WebRTC-style echo cancellation) and you must ask first. WKWebView's echo
cancellation is no use: it only removes what plays from the page itself, not what
plays through the meeting app.

### 2.5 Other cases

- **You mute yourself in the meeting:** Lingora doesn't know it and keeps noting
  what you say. It is accepted; it is noted in the option's hint.
- **Hybrid room** (several people next to your microphone): everything from the microphone
  comes out as "Me". That is what the "Microphone" option is for, which tells people apart.
- **No Mac audio** (macOS before 14.2): the new option is disabled with its
  hint, like "Computer audio only".
- **No microphone permission:** a notice is shown and it carries on only with the Mac's
  audio (the meeting isn't lost).
- **The microphone is lost** (you disconnect it): it is retried with the new
  default input; the Mac lane doesn't stop.

### 2.6 What it touches (done)

- `src/utils/route.js`: `readRoute`, `echoPossible`, `prefersMacMic`,
  `meetingMic` (which microphone to open).
- `src/utils/echo.js`: `compareEcho` (text) and `withEchoFilter` (wraps the
  recorder with the same shape).
- `src/hooks/useMeetingNotes.js`: starting and stopping the two lanes, reopening the
  microphone if it changes or is lost, closing if the Mac lane is lost.
- `src/hooks/useAudioRoute.js`: what is connected, for the hint.
- `utils/notes.js`: `add(sentence, voice, info)` with `t` from the audio and
  ordered insertion; `lingora.notesInput` gains `"meeting"` (default if
  nothing was saved). `createSpeakerTracker` untouched.
- `App/index.jsx`: the notes lanes and the hooks. In `enqueue` only `info`
  is passed to the recorder; `start` and `stop` untouched.
- `NoteTaking`: third option, hint according to what is connected, notice if the
  microphone fails and "Me" marked live.
- Rust: `src-tauri/src/route.rs` (new, command `audio_route`) and its
  registration in `lib.rs`. `audio.rs` untouched. Instead of an event, the
  frontend checks again every 2 s while recording.

### 2.7 Tests with real audio

1. AirPods (microphone and output) in Meet or Zoom.
2. AirPods to listen and the Mac's microphone in the meeting: the AirPods must not
   switch to call mode.
3. Wired headphones.
4. Mac speakers: none of the others' sentences should come out as "Me"; speak
   at the same time as another person and check that yours is kept.
5. External monitor with speakers.
6. Connect and remove the AirPods in the middle of a meeting: the note carries on without cuts.
7. Check the order of the sentences in a fast conversation.

## Phase 3: my notes and bookmarks (later)

- **My notes:** a side panel "My notes" while recording (at the bottom on narrow
  windows). Each line stores the minute it was written and goes in
  `my_notes: [{ t, text }]`.
- **Bookmarks:** "Mark moment" (⌘B) saves `bookmarks: [{ t }]`. In the transcript a
  bookmark is seen next to that paragraph.
- **In the summary and the export:** the summary receives the notes and the
  bookmarks as "what the user considered important", and the export
  includes them.

## Phase 4: optional translation (later on)

The small translation below each paragraph, for those who want both
things.

---

## New note fields

Without breaking the notes that already exist; all are optional when reading.

| Field | Phase | What it is |
|---|---|---|
| `kind` | 1 | `"notes"` or `"translation"` (without it, translation) |
| `summary_lang` | 1 | Summary language |
| `my_notes` | 3 | `[{ t, text }]` |
| `bookmarks` | 3 | `[{ t }]` |
