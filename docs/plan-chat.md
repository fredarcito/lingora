# Plan: chat with the notes

Status: **in progress** (2026-11-13). Phases 1 and 2 approved; phase 3 (chat
with the session in progress) stays out. **The engine is done** (§0.1, branch
`chat`): the rest builds on it.

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

### 2.1 What the user sees

- The Home card turns on: input + «Abrir chat». Typing a question and
  pressing it opens the **Chat** page with that question already asked.
- New page `src/pages/Chat` (and a «Chat» entry in the sidebar): the same
  thread and input as the note tab, plus a scope selector at the top:
  «Todas mis notas» (default) or one note (opens that note's Chat tab
  instead).
- Answers cite their sources as chips under the message: note title, date
  and time («Reunión con Ana · 3 nov · 12:40»). A chip opens the note at
  that time (`openNote` + time).
- The all-notes chat is **not saved** (only for the session); a «Nuevo
  chat» button clears it. Simpler and avoids a second store of note text.
- With a key, the first all-notes question asks for consent once per
  service, with its own wording: it sends parts of **several** notes, not
  one.

### 2.2 Backend: search without new dependencies

`src-tauri/src/chat/search.rs` (new), pure and tested:

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
- **Context:** the best units until ~14K tokens, grouped by note and in
  time order, each with a header `[Nota: «título» · fecha · mm:ss · persona]`.
  The instructions ask to cite with that header's note and time; the
  command returns the units used, so the UI shows sources even if the model
  forgets to cite.

### 2.3 Commands

- `notes_chat(messages, cloud, on_token) -> { text, sources }`: search,
  then answer with `chat::local::chat` or `chat::cloud::chat`. Reuse of
  what was read helps less here (the context changes per question), which
  is expected.
- `chat_stop()` is shared.

### 2.4 Frontend

- `src/hooks/useNotesChat.js` (session-only state, sources per message).
- `src/pages/Chat/` with `ChatThread`, `ChatInput`, `SuggestionChips`
  (suggestions: «¿Qué tengo pendiente esta semana?», «¿De qué hablé con…?»,
  «Resume mis reuniones de ayer») and a `SourceChips` shared component.
- `useNavigation`: a `chat` view, an initial question passed from Home,
  and `openNote(id, time)` to open a note at a time (if the time part is
  more than trivial, open the note only and leave it in «Pending»).
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
- Saving all-notes chats.
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
