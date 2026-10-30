# Plan: notes and summaries

Status: part A done (2026-10-29), with the design reviewed by Opus and a new Settings
page. Part B (Sonnet) and C (Opus) remain. The part about speakers (who is
speaking) is done separately by Opus; here only the slot is left.

Goal: save each conversation to disk, view it in the app, export it and
ask for a summary. Inspiration: Sembly's notes view, but **much
simpler**: a list and a detail view, no editor, no participants, no
player or chat.

---

## 0. Rules (read before starting)

**Don't touch what is already tuned.** It took a long time to get it this way.
Don't change, "clean up" or reorganize any of this, even if it seems improvable:

- `src/audio.js` entirely: VAD, sentence cuts, `FILLER`, `LONE_NOD`, thresholds and timings.
- `src/Captions.jsx` and `src/FloatingCaptions.jsx`: word rhythm, animations and cuts.
- In `src/App.jsx`: `speedFor`, `MAX_VOICE_LAG_SECS`, `trimSilence`, the flow
  of `texted` and `playback`, `start` and `stop`, the existing `localStorage` keys
  and the settings of each lane (`LaneCard`).
- In `src-tauri/src`: `audio.rs`, `system_audio.rs`, `listener.rs`,
  `translator.rs`, `tts.rs`, `pipeline.rs`, `phonemizer.rs`,
  `system_voice.rs`, `models.rs`, `doctor.rs` and `config.rs` (except what
  is indicated below). Threads, temperatures, `silence_scale`, speeds and
  timings stay the same.
- `src/Welcome.jsx`, `src/Diagnostics.jsx`, `src-tauri/tauri.conf.json` and the signing.
- Don't add npm dependencies. In Rust only the one for part B (`keyring`).

**How to work:**

- Comments and texts in Spanish, with the same style and density as the
  surrounding code (JSDoc in JS, `///` in Rust). Interface in neutral Spanish.
- Never show model names in the interface ("Parakeet", "Kokoro",
  "HY-MT2", "qwen"…). Use generic texts ("the summary", "the AI").
- Touching `src-tauri` restarts the app of whoever is testing. **Warn first**
  before editing anything there and bundle the Rust changes into a single block.
- The Groq key is **never** put inside the app or in the repository.
- If something in the plan doesn't fit the code, stop and ask. Don't improvise
  a big change.
- When each part finishes: `npx vite build` and `cargo check` (in `src-tauri`)
  without errors, and the manual test list for that part.

---

## On-disk format

A conversation is a JSON file in
`~/Library/Application Support/lingora/notes/<id>.json` (the same base folder
as `models_dir()` in `config.rs`). JSON and not plain text: it stores the
time, who is speaking and the original separate from the translation. Plain text
comes out when exporting.

```json
{
  "version": 1,
  "id": "2026-10-29_10-32-05",
  "title": "Conversación del 29 oct, 10:32",
  "created_at": "2026-10-29T10:32:05.120Z",
  "ended_at": "2026-10-29T11:07:40.002Z",
  "mode": "video",
  "speakers": {},
  "sentences": [
    {
      "t": 3.4,
      "direction": "remote_to_local",
      "source_lang": "en",
      "target_lang": "es",
      "speaker": null,
      "source": "Hi everyone, let's get started.",
      "translation": "Hola a todos, empecemos."
    }
  ],
  "summary": null
}
```

- `t`: seconds from `created_at` until the sentence ended.
- `translation`: `null` in original mode (untranslated, `noTranslate`).
- `speaker` and `speakers` are left for the speakers part: `speaker` will be a
  number (1, 2…) and `speakers` the name the user gives it
  (`{"1": "Ana"}`). For now always `null` and `{}`. The interface has to
  work in both cases: if all are `null`, no labels are shown;
  if there is a number, `speakers[n] ?? "Persona n"` is shown.
- `summary`: `null` or `{ "text": "<markdown>", "created_at": "..." }`.
- `gaps` (optional): the stretches when "Save to notes" was turned off in the middle of
  the conversation, `[{ "at": 12, "secs": 95 }]`: the gap goes before the
  sentence `at` (or at the end if `at` is the number of sentences) and lasted `secs`. The
  view (`transcriptParts` in `src/notes.js`) and the export
  (`transcript_text` in `notes.rs`) mark it the same way: "Not saved · 2 min",
  splitting the paragraph where it falls.
- The `id` comes from the local start date and serves as the file name.
  Rust validates that it only has `[0-9A-Za-z_-]`, so that nobody can
  write outside the folder.

---

## Part A: menu, saving and notes view

### A1. Rust: notes commands (a single block of changes; warn first)

New file `src-tauri/src/notes.rs`, with `mod notes;` in `lib.rs` and the
commands added to `generate_handler!`. Errors with the `Error` from
`error.rs`; add a `Notes(String)` variant if needed, with kind `"notes"`.

| Command | What it does |
|---|---|
| `notes_list() -> Vec<NoteSummary>` | Reads the folder and returns `{ id, title, created_at, ended_at, sentences: usize, has_summary, kind, preview, source_lang, target_lang, summary_line }`, from newest to oldest. `preview` is the first ~200 characters of the translations (or of the original), for searching; `source_lang`/`target_lang` are those of the first sentence and `summary_line` the first sentence of the summary (for the list). Ignores files that can't be read. |
| `note_read(id) -> serde_json::Value` | The JSON as is. |
| `note_save(note: serde_json::Value)` | Writes `<id>.json` atomically (to `.tmp` and then `rename`). Creates the folder if it doesn't exist. |
| `note_delete(id)` | Deletes the file. |
| `note_reveal(id)` | `open -R <path>`: shows it in Finder. |
| `note_export(id, format: "md" \| "txt") -> String` | Writes the note to `~/Downloads/<sanitized title>.<ext>` (if it exists, adds ` (2)`, ` (3)`…), shows it in Finder and returns the path. |

Export format (in `.md` the title gets `#` and the summary its heading; in `.txt`,
the same but without `#`):

```
# Conversación del 29 oct, 10:32
29 oct 2026 · 10:32–11:07 · 35 min

## Resumen
...

## Transcripción
[00:03] Persona 1: Hola a todos, empecemos.
        (Hi everyone, let's get started.)
```

Without a speaker, the line is `[00:03] Hola a todos, empecemos.`. The original
in parentheses only appears if there is a translation.

### A2. JS: `src/notes.js` (new)

- Wrappers in `src/api.js`, with JSDoc, following the style of the ones
  that already exist: `notesList`, `noteRead`, `noteSave`, `noteDelete`, `noteReveal`,
  `noteExport`, and the typedefs `Note`, `NoteSentence` and `NoteSummary`.
- A recorder, without React:
  - `createRecorder()` returns `{ add(sentence), finish() }`.
  - `add` creates the note with the first sentence (without sentences there is no file) and
    saves at most every 5 s (debounce) with `api.noteSave`.
  - `finish()` sets `ended_at`, saves right away, and if the note is still empty
    it writes nothing.
  - A failure when saving can't break the translation: `console.warn` and carry on.
- "Save conversations" switch in `localStorage`
  (`lingora.saveNotes`), on by default, with `loadSaveNotes()`
  just like `loadSpeak()` in `App.jsx`.

### A3. Hooking it into `App.jsx` (minimal changes)

- A `useRef` with the current recorder.
- **A single recording point:** in `playback`, right after the last
  `patchEntry(lane.direction, id, { translation: result.translation, ... })`
  (around line 806), call
  `recorder.add({ direction, source_lang, target_lang, source: result.transcript, translation })`.
  - In original mode (`noTranslate`), `translation: null`.
  - Don't add recording anywhere else or change that flow.
- `t` is computed by the recorder (`performance.now()` from the first sentence,
  corrected by `created_at`). No need to touch `info`.
- Session: starts with the first sentence after some lane starts. It
  ends (`finish()`) when `anyRunning` becomes `false`. There is already an effect
  on `anyRunning` (around line 950); add a new one next to it, without
  touching the existing one.
- If `lingora.saveNotes` is off, no recorder is created.

### A4. Hamburger menu (☰)

- ☰ button at the top left, before the logo of the top bar. It is
  the only thing that changes in the bar: the brand, the modes and the languages
  stay the same.
- When pressed, a side panel (`src/Sidebar.jsx`) opens **on top of**
  the content, from the left, about 240 px wide, with a semi-transparent dark background
  behind it. It doesn't push or shrink the view.
- It closes:
  - when choosing an entry;
  - when clicking outside, on the background;
  - with Esc;
  - with a ✕.
- When it opens, focus goes to the first entry. When it closes, it returns to the ☰.
- Two entries, with icon and text: **Translate** (the current view) and
  **Notes**. The active one is highlighted. Nothing else for now; Settings
  and Diagnostics stay where they are.
- Inline SVG icons, simple, like `WaveIcon`.
- **Very important:** when going to Notes, the Translate view **is not unmounted**:
  it is hidden with `hidden` or CSS. If it were unmounted, the
  ongoing translation would be cut. If a lane is running, the Translate entry
  shows a red dot and the ☰ does too, so it is visible with the menu closed.
- The Notes view has its own top bar: ☰, the title "Notes" and nothing
  else.

### A5. Notes view: `src/Notes.jsx`

Two pages, one after the other, not in columns:

1. **Notes list:** all the saved conversations.
2. **A note's page:** opens when a note is pressed, takes up the whole view and
   has a "← Notes" button at the top to go back to the list. The list
   remembers the search and the scroll position when returning.

**Above the list:**
- a search box ("Search by text or date") that filters by title and `preview`, locally;
- the "Save conversations" switch.

**List:**
- each item shows the title, the date (`29 oct · 10:32`), the duration
  and a dot if it already has a summary;
- the note in progress appears at the top, with the label "Recording";
- empty: "No notes yet. When you translate something, it will be saved here."

**A note's page:**
- **Header:**
  - title editable on click, which saves with `noteSave` when leaving the field
    or with Enter;
  - below it: date, start and end time, duration and languages (`English → Spanish`).
- **Actions**, small buttons on the right:
  - Summarize (part B; not shown in part A);
  - Copy for your AI chat;
  - Export, with a small menu: Markdown (.md) / Text (.txt);
  - Show in Finder;
  - Delete, which asks for confirmation with its own dialog, not `window.confirm`.
- **Tabs:** "Summary" and "Transcript".
  - Without a summary it opens on Transcript.
  - In part A, Summary only shows empty text explaining the Copy for your AI chat
    button.
- **Transcript:**
  - one row per sentence: `mm:ss` in gray, the speaker label if there is one, and the
    translation;
  - a "Show original" switch shows the original in small text below.
- **Copy for your AI chat:** copies to the clipboard
  (`navigator.clipboard.writeText`) a few short instructions and the
  transcript in the export format, to paste into any AI chat.
  - Instructions: "Summarize this conversation in {language}: key points, decisions and action items with an owner if one is mentioned."
  - It must show the "Copied" notice.
- The note in progress refreshes itself while recording: a window event
  from the recorder or a 3 s `setInterval`; choose one.

**Style:**
- Use the variables and classes that already exist in `src/styles.css` (dark theme,
  turquoise accent, `icon-button`, `link`). Add the new things at the end of the
  file, in a `/* Notas */` section.
- Visible focus and hover states.
- No horizontal scroll. The list and the note's page take up the whole
  view, up to ~860 px wide, centered.

### Manual tests (part A)

1. Translate a 1–2 minute video. In Notes "Recording" appears, with sentences
   being added. When stopped, it stays with its duration.
2. While translating, go to Notes and back: the translation wasn't cut, nor
   the captions or the voice.
3. With "Save conversations" off nothing is created.
4. Rename, export .md and .txt (the files appear in Downloads),
   show in Finder and delete.
5. Stop it without anything having been said: no empty note is left.
6. Original mode: it is saved without translation, and "Show original" doesn't duplicate the text.
7. The ☰ menu opens on top and closes with Esc, on clicking outside and when
   choosing an entry. Notes → a note → "← Notes" returns to the list with
   the search intact.

---

## Part B: summary with AI

### B1. The key

- Dependency: `keyring = { version = "3", features = ["apple-native"] }`.
- Commands in `notes.rs` (service `com.lingora.app`, account `groq`):
  - `summary_key_status() -> bool`;
  - `summary_key_set(key)`, which before saving checks the key with a
    `GET https://api.groq.com/openai/v1/models` and if it isn't valid returns
    "La clave no es válida" (The key is not valid);
  - `summary_key_clear()`.
- Only in development, if there is no key in the keychain, `GROQ_API_KEY`
  from the environment is used. It is never saved to a file or included in the bundle.

### B2. Summarizing

- `note_summarize(id) -> String`: reads the note, builds the transcript in the
  export format and calls Groq's chat. It reuses the client in `groq.rs`
  by adding a `complete(system, user, model)` method without
  streaming. Don't change `transcribe` or `translate`.
- Model: `LINGORA_SUMMARY_MODEL` in `config.rs`, default
  `qwen/qwen3.8-27b`, which already works on the account. It is the only change in
  `config.rs`. Temperature 0.3.
- System prompt (in Spanish; output language = that of the translation):
  ```
  Eres un asistente que resume conversaciones transcritas. Responde en {idioma}
  con Markdown y solo estas secciones, omitiendo las que no tengan contenido:
  ## Resumen (3-6 frases)
  ## Puntos clave (lista)
  ## Decisiones (lista)
  ## Tareas (lista; "- [ ] tarea — responsable" si se menciona)
  No inventes nada que no esté en la transcripción. Si aparecen etiquetas
  "Persona N", úsalas tal cual.
  ```
- Long texts: if the transcript goes over ~60,000 characters, it is summarized in
  chunks of ~50,000 and then the set of those summaries is summarized.
- Saves the result in `summary` of the note and returns it.
- The `groq.rs` client has a 30 s timeout. For summarizing, create the client
  with 120 s; don't change the one for translation.

### B3. Interface

- **Summarize** button in the detail (or "Summarize again" if there is already a summary),
  with a "Summarizing…" state and errors inline.
- No key: a small panel in the Summary tab itself.
  - Text: "To summarize, Lingora sends the transcript to Groq with your own
    key. It is the only thing that leaves your computer. The key is stored in
    the Mac's keychain."
  - A password field and the Save button.
  - A link to `https://console.groq.com/keys`.
  - Below it, the alternative: "Or use Copy for your AI chat and paste it into your AI chat".
- The first time a summary is requested, a confirmation notice: "The
  transcript will be sent to Groq. Continue?" It is remembered in
  `lingora.summaryConsent`.
- Summary in Markdown: a minimal in-house renderer for `##`, `-` lists,
  `- [ ]` checkboxes (visual only) and `**bold**`. No dependencies and no
  `dangerouslySetInnerHTML` with unescaped text.
- The key is also managed in **Settings → Notes** (`src/Settings.jsx`):
  status ("Key saved" / "No key"), a field to set or
  change it and "Remove key". It is a new row in the existing Notes card,
  with the same style (`prefs-row`).
- Privacy texts: with a key saved, the menu footer
  (`src/Sidebar.jsx`, `drawer-foot`) and "About" in Settings change from
  "Everything runs on your computer" to "Everything runs on your computer, except the summaries you ask for". Without a key they stay as they are.
- Style: use the classes and variables from the `/* Notas */` section of
  `styles.css` (`note-action`, `note-action primary`, `notes-switch`,
  `prefs-*`, `--n-*`), which already follow the shadcn style. Don't change
  the ones that exist; add the new ones at the end of that section.

### Manual tests (part B)

1. Without a key: the panel explains what is sent. A bad key is rejected.
2. With a key: Summarize a 5–10 minute note returns the expected sections
   and stays saved (close and reopen the app).
3. "Summarize again" replaces the summary.
4. No connection: the error is shown inline and the app keeps working.
5. Export with a summary: the Summary section appears.

---

## Part C: speakers (done by Opus, 2026-10-29)

- Rust (`src-tauri/src/speakers.rs`) only computes the voice fingerprint of each
  sentence (`voice_print`). Model: ERes2Net from 3D-Speaker (~40 MB, a single
  file), downloadable from diagnostics (`speakers`, optional).
- 4 models were tested with 4 synthetic voices in English and Spanish. Only
  ERes2Net got every sentence right with a single threshold (0.5), at ~80 ms
  per sentence. CAM++ and TitaNet confused voices and WeSpeaker lumped everyone together.
- The grouping is in JS (`createSpeakerTracker` in `src/notes.js`):
  - each sentence goes to the most similar person if the cosine is above 0.5;
  - otherwise, it is a new person;
  - sentences shorter than 1.2 s always go to the most similar person.
- The microphone (call) is always `speaker: 0`, "Me".
- In the note: colors per person, renaming and merging two people
  (`SpeakerBar` in `src/Notes.jsx`).
- "Tell speakers apart" switch in Settings → Notes (`lingora.speakers`).
- With real audio (a 55 min interview, 2 people) the live grouping
  gave 6 "people": the extra ones were single sentences with laughter, noise or two
  voices at once. That is why there are two settings:
  - live, a sentence shorter than 2 s doesn't create a new person;
  - at the end, a review (`refine`) with the whole conversation:
    1. whoever speaks less than 3% of the time merges into the most similar one;
    2. two people with averages more similar than 0.6 are merged;
    3. each sentence is reassigned to the closest person;
    4. renumbered by order of appearance.
  Result: 2 people and 94% of sentences right, against full sherpa-onnx
  diarization as the reference. The tests with 4 voices stay at
  100%.
- While recording, extra people may be seen; they are corrected when stopping.
- Notes recorded before the review can't be redone: the fingerprints are not
  saved. They are corrected by hand with "Same person as…".
