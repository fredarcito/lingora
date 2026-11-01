# Plan: "Several voices", one voice per person

Status: implemented (2026-11-01), pending the manual test with real audio.
One change from the plan: people are **not** cleared when the lane stops.
Pausing and resuming the same video keeps each person's voice; only "Reset
people" clears them. It touches the
protected `enqueue` flow in `App/index.jsx` (described below line by line).
`createSpeakerTracker` and its constants are **reused as they are, not
changed**.

## Goal

A video with two (or more) people speaking: each person's translation is
spoken with its own voice, so the listener can tell who is talking.

In the lane card, the **Voice** selector gets a fourth option:

```
Voice:  [ Off ] [ Female ] [ Male ] [ Several ]
```

Choosing **Several** switches the lane to this mode; choosing Female or Male
goes back to exactly what happens today.

## Decisions to keep

- Only the **Listen lane** (`remote_to_local`). The Speak lane is your
  microphone: only one person.
- Only **Lingora voices** (Supertonic, `tts::voices(lang)` not empty: 18
  languages). For other target languages the option is disabled with a hint.
- Needs the **speakers add-on** (~40 MB, `speakers` in `setup_status`). Without
  it, the option is disabled with the same "download it in Diagnostics" hint
  the notes use (`settings.speakersMissing`).
- Off by default. Everything is read per chunk, like `voice`, `voiceIds` and
  `voiceHq` today, so it can be changed while the lane is running.
- No model names in the UI. People are "Person 1", "Person 2"…, as in notes.

## How it works

1. **Voice print before speaking.** In Several mode, `enqueue` starts
   `api.voicePrint(info.samples)` right away, **in parallel** with the
   transcription. It takes ~80 ms (`docs/plan-notas.md`), well below the
   transcription and the translation, so it should add no latency. Measure it
   (see Verification).
2. **Who is speaking.** A per-lane tracker (`createSpeakerTracker()` from
   `notes.js`, untouched) receives `{ speaker }` objects:
   `tracker.add(slot, print, info.secs)` writes `slot.speaker` (1, 2, …).
   `refine()` is **not** used live: it renumbers people, and a voice must not
   change mid-video.
3. **Which voice.** The first time a person appears, they get a voice and
   keep it:
   - Person 1 gets the lane's current voice (the one chosen in "Specific
     voice", or the default of the gender).
   - Each new person gets the next unused Supertonic voice of **their own
     gender**, estimated from the pitch of the chunk where they first appear
     (`estimatePitch`: median F0 by autocorrelation; female if > 160 Hz,
     measured on the 10 Supertonic voices: women 167–202 Hz, men 89–133 Hz).
   - With more people than voices of a gender, the voices repeat in order.
   - The user can change any person's voice by hand (step 5). That choice is
     kept for the session.
4. **Speak.** `api.speak(phrase, …, voiceId)` with the person's voice
   (`"supertonic:<sid>"`) instead of `current.voiceIds[target]`. Speed,
   `voiceHq`, `speedFor`, `MAX_VOICE_LAG_SECS` and playback stay exactly as
   they are.
5. **Card.** Under the selector, instead of "Specific voice": one row per
   detected person, "Person 1 · [Voice 2 · female ⌄] [▶ Try]". The list is
   empty until someone speaks ("Waiting for someone to speak…"). A
   "Restart" link clears the people (new video).
6. **When it's unsure.** Phrases shorter than `SHORT_SECS` (1.2 s) go to the
   most similar person (that's what the tracker does). Nothing new is
   invented. If the tracker is wrong, the phrase sounds with another
   person's voice. That is the accepted risk; it's measured in the manual test.
7. **Notes.** If the recorder is saving, it reuses the print already
   computed (`voice: { print, secs }`) instead of calling `voicePrint` again.
   The note's tracker stays its own, with its `refine()` at the end, untouched.

## Files

| File | Change |
|---|---|
| `src/utils/multiVoice.js` (new) | Pure functions with JSDoc: `estimatePitch(samples, sampleRate)`, `genderFromPitch(hz)`, `nextVoice(voices, used, gender)`. Tests in `multiVoice.test.js`. |
| `src/hooks/useMultiVoice.js` (new) | The per-lane state: tracker, `people: { voiceId, gender }[]`, `assign(print, samples, secs) → voiceId`, `setVoice(person, voiceId)`, `reset()`. `people` is exposed to the card. Kept in a ref for `enqueue` (read per chunk), plus state for rendering. |
| `src/App/index.jsx` (**protected**) | In `enqueue` only: (a) if `current.voice === "multi"` and `info.samples`, start `const printing = api.voicePrint(info.samples)` next to `stt`; (b) in the `phraseSplitter` callback, the voice id is `await` of the person's voice instead of `current.voiceIds[…]`. To keep the splitter synchronous, the speech promise becomes `voiceFor.then((id) => api.speak(…, id, …))`, pushed in the same order; (c) in the recorder block, reuse `printing` instead of calling `api.voicePrint` again. Nothing else in `enqueue`, `texted`, `playback`, `start` or `stop` changes. `reset()` is only called from the card ("Reset people"), not on stop. |
| `src/App/types.js` | `voice: "female" \| "male" \| "multi"`. |
| `src/utils/prefs.js` | Nothing new: `voice` is already saved per lane (`lanes.js` defaults). Check that a saved `"multi"` on a target language without Lingora voices falls back to `"female"` when loading the card (same rule as today: "If the chosen gender has no voice in this language, Rust uses the other one"). |
| `src-tauri` | **Nothing.** `speak` receives `gender` + `voice_id`; with `"multi"` the UI always sends a concrete `voice_id`, and as `gender` the person's gender (Rust never sees `"multi"`). |
| `src/components/LaneCard/index.jsx` + `styles.module.css` | The fourth option in the `Segmented`, and in `VoiceControls` the people list when `voice === "multi"` (uses `Select`/the existing voice select markup, `LinkButton` for "Restart"). The "Higher-quality voice" switch and the speed stay. |
| `src/i18n/es` + `en` (`app.json`) | `app.lane.voice.multi` ("Varias" / "Several"), `.hint` ("Una voz para cada persona que habla" / "One voice per person speaking"), `.missing` (needs the add-on / no Lingora voice for this language), `app.voices.person` ("Persona {n}" / "Person {n}"), `app.voices.waiting`, `app.voices.restart`. |
| `docs/componentes.md` | Only if a new shared component is created (not expected). |

## Verification

- `npx vite build`, `pnpm test` (with the new `multiVoice.test.js`: pitch of
  a synthetic 120 Hz and 200 Hz sine, gender, voice rotation), `cargo check`.
- Latency: log `voicePrint` time and check it finishes before the first phrase
  of the translation is ready. If not, measure the extra delay. It must be
  ~0 on the user's Mac.
- Manual, with real audio:
  1. An interview video with a man and a woman: each one keeps their voice for
     the whole video. Count the phrases spoken with the wrong voice.
  2. Two people of the same gender: two different voices of that gender.
  3. Change Person 2's voice by hand mid-video: the next phrase uses it.
  4. "Restart" and switch to Female: everything is as before.
  5. Target language without Lingora voices (e.g. Chinese) and without the
     add-on: the option is disabled with its hint.
  6. Saving notes at the same time: the note still gets its speakers (and
     `voicePrint` is called once per chunk, not twice).

## Out of scope

- Voices that copy each speaker (needs Supertone's paid tool).
- The Speak lane (your microphone).
- Changing `createSpeakerTracker`'s thresholds. If live labelling turns out
  too unstable for voices, propose a change separately, with measurements.

## After the first real test (2026-11-01)

A video with 2 women came out as 7 people. Live, without `refine()`, the
tracker splits one person into several (another tone, music, a laugh). The
gender was right: all 7 were female. Mitigations, all in `useMultiVoice` and
the card (the tracker is untouched):

- **People: Auto / 2 / 3 / 4.** With a number, no one beyond it: whoever
  else shows up gets the most similar person's voice for good.
- **Provisional people.** Someone gets their own voice only after speaking
  `MIN_PERSON_SECS` (8 s) in total. Until then they borrow the most similar
  person's voice. Person 1 gets a voice at once. Trade-off: a real second
  person speaks their first ~8 s with Person 1's voice.
- **Speaking now.** A dot next to whoever spoke last, for 6 s.
- **"Same as…"** on each person merges them by hand: from then on they
  speak with the other one's voice and leave the list.
- **Design (same day):** everything for this mode lives in its own box,
  `components/PeoplePanel`. It holds the people count in its header, and one
  compact row per person: a dot with their color from the notes
  (`speakerColor`), lit while they speak; the voice; ▶ to test it; and ⋯ with
  "Same person as…", as in the notes' `SpeakerBar`. "Reset people" goes at
  the bottom.
