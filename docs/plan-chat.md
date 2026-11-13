# Plan: chat with the notes

Status: **in progress** (2026-11-13). Phases 1 and 2 approved; phase 3 (chat
with the session in progress) stays out. **The engine is done** (§0.1, branch
`chat`): the rest builds on it. **Phase 1 is built** (§1.2–1.3, bench code in
§1.5); what is left of it is the by-hand check (§1.4) and the bench's remaining
notes and questions (§1.5). **Phase 2 is built** (§2.6 says how it ended up and
what changed from this plan); what is left is the by-hand check (§2.5).

Ask questions about one note («¿qué tareas quedaron pendientes?») or about
all of them («¿qué dijo Ana del presupuesto?»), on the computer with the
summary model or with the user's own AI key. It turns on the «Chat con
Lingora» card that Home shows locked today (`docs/plan-inicio.md`).

Everything reuses what the summary already has: the local model
(`summarizer.rs`, Qwen3.5-4B, 24K context), the user's key
(`summary_cloud.rs`, consent per service), the transcript as text
(`transcript_text`, `user_notes`) and the source picker
(`useSummarySource`, `SummaryDownload`). **No new crates or npm packages.**

---

## 0. Before starting

- Work on branch `chat` (already created from `main`, with the engine).
- Rust changes restart `pnpm tauri dev`: warn, and group them in one block
  per phase.
- Nothing in the «No tocar» list is touched. `summarizer.rs`, `notes.rs`
  and `summary_cloud.rs` are not on it, but the summary must behave exactly
  as before (same prompt, same sampling, same `MAX_TOKENS`): check it with
  `cargo test` and one real summary at the end.

### 0.1 Done: the engine (`src-tauri/src/chat/`)

The risky parts are built and tested (unit tests, plus the real model:
`cargo test --release chat_real_model -- --ignored --nocapture`). **Use them
as they are; do not rewrite them.** If something is missing, add it beside.

| File | What it has |
|---|---|
| `chat/mod.rs` | `Turn { role, text }` and `Role` (serde: `"user"` / `"assistant"`), `OnToken`, `stop_answer()` (shared by local and cloud), `take_utf8`. |
| `chat/local.rs` | `chat(system, turns, on_token)`: the summary's model kept loaded on its own thread (freed after 3 min idle, before a summary and on quit), streaming. `count_tokens(texts)`. `ROOM`: tokens for system + history + question. |
| `chat/session.rs` | Qwen3.5's multi-turn prompt; **reads only what is new** (measured on a ~7K-token note: first question 20 s, the next ones 0.4 s); drops the oldest questions when the history doesn't fit. |
| `chat/cloud.rs` | `chat(cloud, key, system, turns, on_token)`: the same services as the summary, with the history and streaming (SSE read by hand, no new crate); a server that doesn't stream is read whole. |

`summarizer.rs` and `summary_cloud.rs` only share a few items
(`pub(crate)`); the summary sends and does exactly the same as before.

How to call them (the contract that matters):

- **Pass the history back word for word.** Send `turns` = previous messages
  (user and assistant, with the assistant's text exactly as `chat` returned
  it) + the new question last. Then only the new question is read. Any
  change (edited text, another `system`, a cleared chat) reads it all again:
  correct, just slower.
- **`system` must stay identical between questions** of the same chat (build
  it from the note, not from the time of day or the question). In phase 2
  it changes per question by design.
- `system` + the last question must fit in `local::ROOM` (use
  `count_tokens`); the older history is trimmed by the engine itself.
- «Detener»: `chat::stop_answer()`. The call returns what was written
  (possibly `""` if it was still reading); keep it as the answer and pass it
  back in the history like any other.
- Before a local answer, free the translator:
  `state.pipeline.local_translator().shutdown()` (as `note_summarize`).
- With a key: `crate::summary_cloud::key_for(&cloud.provider)` first, as the
  summary does.
- Both return `Error::Notes` with a message ready for the user.
- Remove the `#[allow(dead_code)]` on `mod chat` in `lib.rs` once the
  commands use it.

---

## 1. Phase 1: chat with one note

### 1.1 What the user sees

- **NotePage** gets a fourth tab, «Chat», after Resumen, Mapa and
  Transcripción.
- Empty state: one line («Pregunta lo que quieras sobre esta
  conversación») and three suggestion chips: «Resume los puntos clave»,
  «¿Qué tareas quedaron pendientes?», «¿Qué dijo cada persona?».
- Messages: the user's on the right, the answer on the left rendered with
  the existing `Markdown` component. The answer appears **as it is
  written** (token by token), with a «Detener» button while it runs.
- Under the input: where it answers (the same source as the summary:
  «En tu equipo» or the service's name), using `useSummarySource`. If the
  local model is not downloaded, show `SummaryDownload` instead of the
  input, as the Summary tab does.
- «Borrar chat» in the tab's header (with `ConfirmDialog`).
- The chat is **saved in the note** (field `chat`), so it is there when the
  note opens again. Exports (`note_export`) ignore it.
- While a lane is translating (`recording` / `anyRunning`), the **local**
  chat is disabled with a one-line reason («Disponible al terminar la
  traducción»); with a key it works. Reason: the summary model and the
  translator do not fit together on every Mac, and unloading the translator
  mid-session would cut the live translation.

### 1.2 Backend

The engine (local model kept loaded, streaming, reuse of what was read,
cloud streaming) is done: §0.1. What is left in Rust:

#### `chat/prompt.rs` (new): building the conversation

Pure functions, tested without the model:

- `chat_system(note, lang_hint)`: short instructions (answer only from the
  transcript; say so when it is not there; answer in the language of the
  question; cite times as `[mm:ss]`; plain Markdown, no tables), then the
  note's title, date, people names and the transcript
  (`transcript_text(note, false)`, plus `user_notes` only when
  `summary_with_notes` is on, same privacy rule as the summary). If the note
  has a summary, it goes first, marked as such.
- **Fitting.** If system + history + answer room do not fit in the context:
  1. drop the oldest turns (keep the last 6 messages at least);
  2. if the transcript alone does not fit (notes over ~1 h), replace it with
     the summary plus the paragraphs that best match the question (the same
     search as phase 2, inside one note). Say so in the instructions
     («Solo tienes fragmentos de la conversación»).
- Fitting uses `local::count_tokens` and `local::ROOM`. Note helpers it
  needs from `notes.rs` (`transcript_text`, `user_notes`, `read_note`,
  `note_path`, `paragraphs`…) become `pub(crate)`; their bodies don't change.

#### Commands (in `chat/mod.rs` or `chat/commands.rs`, registered in `lib.rs`)

- `note_chat(id, messages, cloud, on_token: Channel<String>) -> String`:
  `messages` is the history plus the new question (`[{ role, text }]`,
  deserialized as `Vec<chat::Turn>`). Local: `chat::local::chat`; with a
  key: `chat::cloud::chat`. `on_token` forwards each piece to the
  `Channel`. Returns the whole answer; the frontend saves it.
- `chat_stop()`: calls `chat::stop_answer()`.
- Saving goes through the existing `note_save` (the frontend owns the note
  object, as with the title); no new command.

### 1.3 Frontend

- `src/utils/chat.js`: pure helpers (message shape, `[mm:ss]` → seconds for
  links, trimming the history sent, suggestion ids). Tests in
  `chat.test.js`.
- `src/hooks/useNoteChat.js`: state of one chat (messages, streaming text,
  busy, error, `ask`, `stop`, `clear`), saving to the note through
  `setNote` + `api.noteSave` when an answer ends. One question at a time.
- `api.js`: `noteChat(id, messages, cloud, onToken)` with a `Channel`, like
  the existing streaming calls; `chatStop()`.
- Shared components (`src/components/shared/`, JSDoc + row in
  `docs/componentes.md`):
  - `ChatThread`: list of messages, sticks to the bottom
    (`useStickToBottom`), the streaming one with a caret.
  - `ChatInput`: auto-growing textarea, Enter sends, Shift+Enter new line,
    send / stop button.
  - `SuggestionChips`: the empty-state chips.
- `src/components/NoteChat/`: the tab (uses the three above, the source
  line, `SummaryDownload`, «Borrar chat»).
- `[mm:ss]` in an answer is a link that goes to the Transcript tab at that
  time (reuse the jump the map already does: `setTab("transcript")` +
  focus).
- Texts: new `src/i18n/es/chat.json` and `en/chat.json`; `notes.tab.chat`.
- The note's JS typedef (`api.js`) gets
  `chat?: { role: "user" | "assistant", text: string, at: string }[]`.

### 1.4 Check phase 1

- `cargo test`: `chat/prompt.rs` building and long-note fallback; the
  engine's and the summary's tests unchanged.
- By hand: short note and a one-hour note; second question noticeably
  faster than the first (the log says `chat: N tokens leídos (M ya en
  memoria)`); «Detener» mid-answer; summary while the chat is loaded; app
  quit while answering (no Metal abort); with a key on OpenAI and Claude
  (streaming, never tried against the real services yet), and a custom
  server; local chat disabled during a live translation; chat saved and
  restored; both themes; keyboard only.
- The question bench (§1.5) passes the bar agreed with the user.

### 1.5 Question bench

A fixed set of questions with known answers over a few fixed notes, scored
automatically. It says with numbers whether the chat answers well, and
whether a change (prompt, fitting, search, model, a future LoRA) makes it
better or worse. Built with phase 1, after `chat/prompt.rs`; phase 2 adds
its own questions.

#### Notes

`tests/fixtures/chat-bench/notes/`: 4–5 note JSON files in the app's
format. They are committed, so **no private conversations**: either
conversations recorded on purpose with synthetic voices (as done to tune
the speakers) or notes the user explicitly chooses. Never copy from
`~/Library/Application Support/lingora/` without asking. Cover:

- a short meeting, 2 people, Spanish;
- a long call (~1 h, over `local::ROOM`, so it exercises the long-note
  fallback of §1.2);
- a call in English with Spanish translation;
- a call with 3+ people;
- for phase 2: 3–4 notes on different dates about the same topic.

#### Questions

`tests/fixtures/chat-bench/questions.json`, 30–50 entries for phase 1:

```json
{
  "id": "budget-ana",
  "note": "reunion-presupuesto",
  "q": "¿Qué presupuesto propuso Ana?",
  "kind": "fact",
  "must": [["15.000", "15000", "15 mil"], "Ana"],
  "time": ["12:40"],
  "lang": "es"
}
```

- `kind`: `fact`, `who` (who said what), `tasks`, `unanswerable`,
  `cross_lang` (question in another language than the call), `late` (said
  in the last 10 minutes of the long note); phase 2 adds `multi_note` and
  `date`.
- `must`: every item must appear; an item that is a list passes if any
  alternative appears. Compared lowercase without accents.
- `time`: optional; one or more correct times.
- `answerable: false` for questions whose answer is not in the note (at
  least 10 of them: inventing is the failure that most hurts trust).
- `lang`: the language the answer must be in.
- A few entries are follow-ups (`"after": "budget-ana"`): asked in the same
  chat after that question, to test the history.
- Phase 2 entries use `"note": null` (all notes) and may add
  `"sources": ["note-id", …]` (the notes the answer must come from) and
  `"today": "2026-11-13"` for date questions.

#### Scoring

Pure functions in `src-tauri/src/chat/bench.rs` (`#[cfg(test)]` only), with
their own unit tests on hand-written answers:

- **Correct:** all `must` items present.
- **Cites:** some `[mm:ss]` in the answer is within 30 s of a `time` (only
  for questions with `time`).
- **No invention:** for `answerable: false`, the answer contains a "not
  found" phrase (a short list per language: «no se menciona», «no
  aparece», «no hay información», "not mentioned", "doesn't say"…). If it
  matches none, the question is marked **review** instead of failed.
- **Language:** the answer's language matches `lang` (stopword count for
  es / en; no new crate).
- **Sources (phase 2):** the returned `sources` include the expected notes.

#### Running it

- A test marked `#[ignore]`, like `chat_real_model`, so the normal
  `cargo test` never loads the model:
  `cargo test --release chat_bench -- --ignored --nocapture`.
- It goes through the same path as `note_chat` (`chat/prompt.rs` to build
  `system` and fit, then `chat::local::chat`), without Tauri. With
  `LINGORA_BENCH_CLOUD=openai|anthropic` it uses `chat::cloud::chat` with the
  key from `LINGORA_SUMMARY_KEY` (development only, as today).
- Phase 2 needs `search.rs` to index a given folder (not only the app's
  notes folder), so the bench points it at `tests/fixtures/chat-bench/notes/`.
- Output: a table per `kind` plus the total, e.g.
  `Correct 41/48 · Cites 37/42 · No invention 9/10 (1 review) · Language 48/48`,
  then every failed or review question with its answer, to read by hand.
  It also writes the run to `src-tauri/target/chat-bench/<date>-<source>.json`
  (not committed) to compare runs.
- It takes minutes; run it by hand before releasing the chat and after any
  change to the chat prompt, fitting or search.

#### Bar to release

Agreed with the user after the first run. Starting point: correct ≥ 85 %,
no invention ≥ 90 %, language 100 %. Below that, fix the prompt and fitting
first; only if that is not enough, consider the chat LoRA in «Pending».

---

## 2. Phase 2: chat with all the notes

### 2.0 What phase 1 left to build on (checked 2026-11-13, commit `508f1cd`)

Reuse these; do not write second versions of them.

- `chat/search.rs` already exists: `fold`, `words`, `rank(docs, query)`
  (BM25). `rank` tokenizes every document on each call: fine inside one
  note, too slow for every note on every question. Phase 2 adds beside it an
  **inverted** `Index`: a dictionary word → id (`u32`), and per word a list
  of `(unit, count)`; per unit only its note id, start time and length. No
  text is kept in memory: the text of the units picked is read back from
  their note files (a few notes per question). Scored with the same BM25
  (move the formula into one helper that both use, so the numbers are the
  same; the existing tests must still pass). Sized for **1,000 notes**
  (~30 MB of JSON at today's average of 31 KB per note, ~200 MB if they
  were 30-minute calls): built on a background thread when the app starts
  (not on the first question), refreshed per note by modification time;
  a question only touches the lists of its own words (milliseconds).
  `cargo test` includes a timing test with 1,000 synthetic notes (build
  and query, `#[ignore]`, printed, not asserted).
- `chat/prompt.rs`: `search_query(turns)` (question + the one before, for
  follow-ups), `pick_units(cost, scores, budget)`, `question(turns)`,
  `load(id)`. **Careful:** `pick_units` fills the leftover budget with
  paragraphs that share no word with the question, which is right inside one
  note but wrong across all notes (it would stuff unrelated notes in). Phase
  2 keeps only units with score > 0 (plus the summaries of the notes that
  have one); add that as a separate function, don't change `pick_units`.
- `chat/commands.rs`: `note_chat`, `chat_stop`. `notes_chat` goes beside
  them, with the same shape (free the translator before a local answer,
  `key_for` before a cloud one, `Channel<String>` for the pieces).
- `notes.rs`: `notes_dir()` is private; make it `pub(crate)` (body
  unchanged). The index takes a folder (`&Path`) so the bench can point it
  at `tests/fixtures/chat-bench/notes/`; the command passes `notes_dir()`.
  `paragraphs`, `paragraph_text`, `shown_text`, `speaker_label`, `clock`,
  `str_field` are already `pub(crate)`.
- `chat/bench.rs` and `tests/fixtures/chat-bench/` exist (one note so
  far). Phase 2 questions go in the same `questions.json` with
  `"note": null`; the bench calls the same function `notes_chat` uses
  (search + system), without Tauri.
- Frontend: `ChatThread`, `ChatInput`, `SuggestionChips` (shared),
  `useNoteChat` (the pattern for `useNotesChat`: streaming, stop, consent),
  `utils/chat.js` (`[mm:ss]` parsing), `noteChat`/`chatStop` in `api.js`.
- **Consent:** `utils/summarySource.js` stores one consent per service
  (`lingora.summaryConsent.<id>`), shared by the summary and the note chat.
  The all-notes chat needs its own (it sends parts of several notes): a new
  key `lingora.notesChatConsent.<id>` with `hasNotesChatConsent` /
  `storeNotesChatConsent` beside the existing ones. Existing keys are not
  renamed.
- **Opening a note at a time:** `useNavigation.openNote(id)` sets
  `openRequest = { id, nonce }`; `NotePage` already has `jumpTo(secs)`
  (Transcript tab + focus) used by the map and the note chat. Add an
  optional `at` (seconds) to `openNote` / `openRequest` and have `NotePage`
  call `jumpTo(at)` once the note is loaded. Small: do it, don't defer it.
- `Home` (`src/pages/Home/index.jsx`): the chat card is a placeholder
  (`disabled` input and button, `home.chat.soon` badge).

### 2.1 What the user sees

- The Home card turns on: input + «Abrir chat». Typing a question and
  pressing it opens the **Chat** page with that question already asked.
- New page `src/pages/Chat` (and a «Chat» entry in the sidebar): the same
  thread and input as the note tab. It always asks about all the notes: no
  scope selector (user's decision, 2026-11-13); to ask about one note,
  that note's Chat tab.
- Answers cite their sources as chips under the message: note title, date
  and time («Reunión con Ana · 3 nov · 12:40»). A chip opens the note at
  that time (`openNote` + time).
- Opening a source leaves the Chat page for the note; **coming back finds
  the chat as it was** (thread, scroll, a half-written question, an answer
  still being written). So `useNotesChat` lives above the pages (in `App`,
  like the navigation), not inside `pages/Chat`, and the note shows a
  «Volver al chat» link when it was opened from a source.
- **Saved conversations, as in ChatGPT (user's decision, 2026-11-13).**
  The Chat page has its own left column: «Nuevo chat» on top, then the
  saved conversations grouped «Hoy», «Ayer», «Últimos 7 días»,
  «Anteriores», each with rename and delete (with confirmation). It is
  part of the Chat page, not the app's sidebar (that one stays
  navigation); on a narrow window it folds behind a button (`useWidth`).
  - Stored on the Mac like the notes: one JSON per chat in
    `~/Library/Application Support/lingora/chats/<id>.json`:
    `{ id, title, created_at, updated_at, messages: [{ role, text, at,
    sources?, note_ids? }] }`. Saved when an answer ends (and on rename).
    Commands `chats_list`, `chat_read`, `chat_save`, `chat_delete` in a
    new `chat/store.rs`, following `notes.rs` (same id and atomic-write
    approach). **Reads and writes go through the same two helpers as the
    notes** (`read_note` / `write_note`, made `pub(crate)`, bodies
    unchanged), never their own `fs::read`/`fs::write`: encrypting the
    files later (see «Pending») must be a change in one place.
  - Title: the first question, trimmed to ~60 characters; no model call.
  - Reopening an old chat and asking again works like any follow-up: the
    history is sent back and the context is built for the new question.
  - Sources pointing to a note that was deleted show as a disabled chip
    («Nota borrada»). Deleting a note does not touch the chats; deleting a
    chat does not touch the notes.
  - The chat in progress lives above the pages (point above), so leaving
    and coming back keeps it even before it is saved.
- With a key, the first all-notes question asks for consent once per
  service, with its own wording: it sends parts of **several** notes, not
  one.

### 2.2 Backend: search without new dependencies

`src-tauri/src/chat/search.rs` (extended, see §2.0), pure and tested:

- **Units:** the paragraphs of each note, from the existing `paragraphs()`
  in `notes.rs` (same rules as the transcript; not changed, only made
  `pub(crate)`). Each unit keeps note id, title, date, start time, speaker
  name, original text and translation.
- **Index:** built from the notes folder and kept in memory, rebuilt for a
  note when its file's modification time changes (cheap: notes are JSON
  on disk; hundreds of notes are a few MB).
- **Ranking:** BM25 over words folded to lowercase without accents,
  searching **both** the original and the translation (the question may be
  in a different language from the call). Summaries count as units too,
  with a small boost, so broad questions find the right note.
- **Query:** before searching, the model turns the question into search
  terms in the notes' languages (one short completion, ~1–2 s locally;
  same prompt with a key). Dates in the question («la semana pasada»,
  «en octubre») become a date range: the model is given today's date and
  answers in a fixed format, parsed in Rust; if parsing fails, no filter.
  Build it as a step that can be switched off (a constant, plus an env var
  for the bench), and run the bench with and without it: it costs a model
  call per question, and searching the translation already covers most
  questions in another language. Keep it only if the bench shows it helps.
  The search query is `search_query(turns)`, so follow-ups work.
- **Empty search:** if no unit scores above 0 (and no date filter applies),
  don't call the model to answer: return a fixed «No encontré nada sobre
  eso en tus notas» (i18n on the frontend from an error code or an empty
  `sources` + empty `text`), so it can never invent.
- **Precision first (user's decision, 2026-11-13):** the all-notes chat
  must be as reliable as the one-note chat, which worked well. What makes
  the one-note chat good is that the model sees whole, continuous
  conversation; loose paragraphs from 20 notes is where a small model
  mixes things up. So the context is built to look like the one-note case:
  1. **Pick notes, then paragraphs.** Score each note (best paragraph
     scores plus its summary, after the date filter) and keep the top few
     (start with 3–5; the bench decides). Unrelated notes never get in.
  2. **Paragraphs with their neighbours.** Inside each chosen note, the
     matching paragraphs plus the one before and after (who asked and what
     was answered), merged when they touch, in time order. A note that
     fits whole goes in whole, like the one-note chat.
  3. **Each note as its own block**, with its summary first (if it has
     one), then a header per excerpt
     `[Nota «título» · 3 nov 2026 · 12:40 · Ana]`. Same instructions as
     the one-note chat (answer only from this; say when it is not there;
     language of the question; cite), plus: name the note for each fact,
     never merge facts from different notes into one unless asked to
     compare, and say «en varias reuniones» explicitly when it does.
- **Two kinds of question, two ways to build the context.** The search
  above is for **detail** questions («¿qué presupuesto propuso Ana?»). It
  fails on **overview** questions across notes («dame un resumen de las
  últimas reuniones con Jeff», «¿qué tengo pendiente esta semana?»): Jeff
  may never say his own name, and the answer needs every meeting, not the
  best paragraphs. So:
  - The query step (the model's short completion, ~300 tokens in, a small
    fixed JSON out, parsed in Rust) returns `kind` (`detail` | `overview`),
    `terms`, `people`, `from`/`to`, `latest` (a number, for «las últimas»).
    Here it is not optional: overview questions need it.
  - `people` are matched against the notes' speaker names (folded, as
    `useKnownNames` / `speaker_names` see them) and against the title; dates
    against `created_at`. These are **filters on notes**, not BM25 words.
  - **Overview:** the notes that pass the filters, newest first (`latest`,
    or 5 when «últimas» has no number), each as its **summary** (already in
    the note, ~300–600 tokens) with title and date, oldest to newest so the
    model can tell what changed. A note without a summary goes in as its
    best paragraphs with neighbours, marked «sin resumen». If more notes
    pass than fit, keep the newest and **say it in the answer's sources
    line** («Basado en las 8 reuniones más recientes con Jeff de 14»), from
    Rust, not from the model.
  - **Overview by topic** («resumen de las reuniones sobre el proyecto
    Atlas»), with no person or date to filter on: notes are chosen by BM25
    over the topic `terms` only. Built: every note where they appear gets
    in, the newest 12 (the share-of-the-best rule planned here left out
    meetings that named the topic once; see §2.6). Then as above:
    summaries, oldest to newest.
  - **The notes used are shown and can be changed.** For overview answers,
    the sources line lists the chosen notes as chips with «×», plus
    «Añadir nota» (picker over the notes list). Changing them asks the same
    question again with exactly those notes (`notes_chat` takes an optional
    `note_ids` that skips the choosing). A meeting about Atlas that never
    names it can't be found by words; this is how the user fixes it in one
    click instead of getting a silently partial summary.
  - **Premise (user's decision, 2026-11-13): the user names things; when a
    question is ambiguous, the chat asks for more context instead of
    guessing.** `clarify` covers any question that can't pick its notes:
    no name, topic or date to go on («resume mis reuniones» → «¿De qué
    periodo, o con quién?»), a name that matches several people or
    projects («Hay dos Jeff: …»), a referent with nothing to point to
    (below). The question back is short, says what is missing, and
    the user's reply is read together with the first question. The line
    between asking and answering: ask when a guess would change **which
    notes** are used and nothing sensible decides it (two Jeffs, no name
    at all). When a sensible default exists, use it and say it, don't ask
    («las últimas» → the last 5, shown in the sources line; «esta semana»
    → Monday to today). Asking about everything is a failure too. The bench
    has `clarify` entries: ambiguous questions must ask back, clear ones
    must not.
  - **«Este proyecto», «eso», «ella»** with nothing to point to: the query
    step reads the conversation so far (as `search_query` does); if there
    is still no referent, it returns `kind: "clarify"` and the chat asks
    back («¿Qué proyecto? Dime su nombre o el de alguien de esas reuniones»)
    without searching. Asked from a note's Chat tab, «este proyecto» is
    that note's topic: the one-note chat already covers it.
  - **Detail:** the steps 1–3 above, with the filters applied first.
  - If the filters leave no note («Jeff» matches nobody), the fixed «No
    encontré reuniones con Jeff» without calling the model.
- **Budget:** precise by default, ~14K tokens locally (as the plan had).
  That means ~20–40 s per question on the computer (to measure); with the
  user's key it is fast. A faster mode (~5K tokens, fewer notes) only
  behind the existing Precisa/Rápida idea, never the default, and only if
  the bench shows it stays good enough.
- **Citations are checked in Rust.** After the answer, each `[mm:ss]` /
  note cited must match an excerpt that was given; the `sources` returned
  are those that match. A citation to something not given is dropped from
  `sources` and logged (the bench counts them: «citas inventadas», target
  0). The UI shows sources even if the model forgets to cite.

### 2.3 Commands

- `notes_chat(messages, cloud, on_token) -> { text, sources }`: search,
  then answer with `chat::local::chat` or `chat::cloud::chat`. Reuse of
  what was read helps less here (the context changes per question), which
  is expected. `sources`: `[{ id, title, date, at }]` (`at` in seconds),
  one per note and time actually put in the context, in the order shown.
  Local budget: system + last question within `local::ROOM` (use
  `count_tokens`, as `system_for` does); with a key, `CLOUD_MAX_CHARS`.
- `chat_stop()` is shared.
- Registered in `lib.rs` next to `note_chat`. All Rust changes of the
  phase in one block (it restarts `pnpm tauri dev`).

### 2.4 Frontend

- `src/hooks/useNotesChat.js` (session-only state, sources per message).
- `src/pages/Chat/` with `ChatThread`, `ChatInput`, `SuggestionChips`
  (suggestions: «¿Qué tengo pendiente esta semana?», «¿De qué hablé con…?»,
  «Resume mis reuniones de ayer») and a `SourceChips` shared component.
- `useNavigation`: a `chat` view, an initial question passed from Home,
  and `openNote(id, at)` to open a note at a time (§2.0).
- Texts in the existing `src/i18n/{es,en}/chat.json` (new keys), sidebar
  entry in `sidebar.json`; Home's `home.chat.soon` is no longer shown.
- `Sidebar`: «Chat» entry. Home: the card loses `disabled` and the «Pronto»
  badge.

### 2.5 Check phase 2

- `cargo test`: BM25 ranking with a fixture of 3–4 notes (Spanish call
  with English translation, and the reverse), accent folding, date-range
  parsing, context budget.
- By hand: questions whose answer is in an old note; in a language other
  than the call's; with a date («ayer»); with no answer (must say it did
  not find it); sources open the right note; 100+ notes (index time);
  with a key and locally.
- The bench (§1.5) with the phase 2 questions (`multi_note`, `date`,
  sources) passes the agreed bar, and the phase 1 questions don't get worse.
- **Precision bar:** the phase 1 questions asked through the all-notes chat
  (`"note": null`, with the bench folder holding all the fixture notes)
  must score about the same as through the one-note chat: that is the
  proof the all-notes chat is as reliable. Plus «citas inventadas» = 0 and
  sources pointing at the expected notes. Overview questions get their own
  `kind` (`overview`) in the bench: «resumen de las reuniones con X»,
  «¿qué quedó pendiente esta semana?», where `must` lists one fact from
  each expected note and `sources` all of them. Add 2–3 decoy notes to the
  fixtures (same people or topic, different facts) so mixing notes shows up.

### 2.6 As built (2026-11-13)

- **Backend:** `chat/search.rs` (`Index`: inverted, per-note postings,
  refreshed by modification time; 1,000 half-hour notes build in ~1.2 s,
  a question searches in ~1 ms, `index_timing` test), `chat/query.rs` (the
  query step: prompt with examples, `parse_query`, `refine`), `chat/all.rs`
  (choosing notes, blocks with neighbours, citations checked), `chat/store.rs`
  (saved chats), command `notes_chat` in `chat/commands.rs`. The index is
  built on a thread when the app starts (`all::warm`).
- **Citations** are `[Nota 2, 12:40]`; Rust returns the checked ones and the
  notes used; the UI links only those.
- **Changed from the plan after the bench:**
  - The model asked back far too often (9 of 17 questions). Fixed with
    examples in the query prompt plus `query::refine`: it only asks back
    when nothing is named (no person, date, count or non-generic topic) or,
    with no conversation before, the question points at something («este
    proyecto», «ella»).
  - Overview by topic takes every note where the topic's words appear (the
    newest 12), searched with the topic words only; the 40 % share and «at
    least two paragraphs» both left out meetings that named the topic once.
    A note too many is visible and can be removed from the chips.
  - When the question has dates, the instructions say the notes are already
    those of that period (the model was recomputing «esta semana»).
- **Frontend:** `pages/Chat` (with `components/ChatList` and
  `components/AnswerSources`), `hooks/useNotesChat` (in `App`, above the
  pages), shared `SourceChips`, `Markdown` `cite` prop, `openNote(id, { at,
  fromChat })` + «Volver al chat», Home card and sidebar entry on.
- **Bench fixtures:** six synthetic notes added (Atlas meetings with changing
  facts, a call in English with Spanish translation, a second «Jeff», a decoy
  campaign from 2025) and 17 phase 2 questions.

---

## 3. Finish (each phase)

- `npx vite build`, `pnpm test`, `cargo check` and `cargo test` without
  errors. Say what was tested by hand and what was not.
- `CLAUDE.md` §3/§4 (the chat, this plan, `src-tauri/src/chat/`), `docs/componentes.md` (new shared components) and
  `marketing/lingora-base-conocimiento.md` (chat with one note and with all
  of them; local or with your key; what is sent with a key).
- No model names in the interface.

## Pending (out of this plan)

- Phase 3: chat with the session in progress (needs the key, or a Mac with
  room for both models).
- Search by meaning (embeddings): better recall, but another model to
  download; only if keyword search falls short in real use.
- Encrypting notes and chats on disk (raised by the user 2026-11-13; a
  plan of its own, after Apple signing). Today they are plain JSON,
  protected by the macOS account (`~/Library` is 700) and FileVault, like
  most apps; not protected from other programs run by the same user or
  from unencrypted backups. Idea: key in the Keychain (`keyring`, already
  used), files encrypted through `read_note`/`write_note`, plain files
  migrated on first read. Needs a crypto crate (ask) and the signed app
  (an unsigned build changes identity and the Keychain asks every time).
- Projects or tags on notes (the user groups them): the exact answer to
  «resumen de las reuniones del proyecto X» when meetings don't name it.
  Until then, the editable list of notes used (§2.2) covers it.
- **A chat LoRA (distillation), only if the bench (1.5) shows clear
  failures** that prompt and fitting cannot fix (wrong citations, invented
  answers, bad search terms or date ranges in phase 2).
  - What: a LoRA adapter trained on top of Qwen3.5-4B, loaded only for the
    chat. The base model stays as is, so the summary does not change
    (§0). llama-cpp-2 0.1.160 supports it
    (`LlamaModel::lora_adapter_init`, `LlamaContext::lora_adapter_set`), so
    it would be applied in `chat/local.rs` when the chat context is created.
    The adapter is a separate download of tens of MB.
  - Data: a large open model (e.g. a big Qwen) on a rented GPU answers
    questions over many transcripts in the exact format of `chat_system`;
    the bench's failure kinds say which examples to generate. Not Claude or
    OpenAI outputs: their terms forbid training models on them. Bench notes
    and questions are never used for training.
  - Cost: a few hours of GPU, under 10 USD.
  - Check: the bench before and after; ship only if it improves and no
    `kind` gets worse.
  - A 2B model is not a candidate for answering (it already lost to the 4B
    on summaries, and long transcripts are where small models fail most).
    It could do only the phase 2 query rewriting, if that step is slow.
