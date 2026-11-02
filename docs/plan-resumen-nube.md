# Plan: summaries with the user's own AI key (optional)

Status: built 2026-11-02 (not yet tried with every service; see Tests). Follows phase 3 of
[plan-autonomia.md](plan-autonomia.md), which made the summary local
(`summarizer.rs`, Qwen3.5-4B).

## Why

The local summary needs ~3.5 GB of RAM while it runs. On a computer with
4 GB (common in cheap Windows laptops) it doesn't fit next to the system:
it won't crash, but the computer crawls and a one-hour note can take tens of
minutes (on Windows it runs on the CPU). Blocking the summary there would
leave out too many people, so those users get a second path: their own key
for an AI service. Anyone else can also choose it for speed or quality.

## User decisions (2026-11-02)

1. **Local stays the default.** The cloud is something the user turns on, with
   their own key, and the app asks before sending a transcript for the first
   time with each provider.
2. **Both options, always, where the summary is asked for.** When there is
   no summary method yet, the note's panel offers the local download *and*
   the user's AI key. Only the order changes: local first with 8 GB or more,
   the key first (recommended) below 8 GB. Never forced either way.
3. **No small local model** (Qwen3.5-2B was tested and gives everything to
   Persona 1). Low-RAM users choose between the key and the 4B model.
4. **Providers:** OpenAI, Claude (Anthropic), Groq, Gemini, OpenRouter and a
   custom URL (LM Studio, Ollama or any OpenAI-compatible server).

## What the user sees

**Settings → Notes → "Summaries"**

- "Where summaries are made": *On your computer* (default) / *With your AI
  key*.
- With the key: provider (select), key (password field, checked before
  saving, as the old `KeyField` did), model (prefilled with the provider's
  default, editable) and, for *Custom URL*, the URL. "Remove key".
- One line under it, exact: "The transcript of the note you summarize is
  sent to {provider}. Nothing else leaves your computer."

**Note → Summary tab**

| Case | What shows |
|---|---|
| Key on | "Summarize" sends to the provider. First time per provider: confirm dialog ("The transcript will be sent to {provider}. Continue?"). |
| Local model downloaded, key off | As today: summarizes on the computer. |
| Neither, ≥ 8 GB | Panel with both. Primary: "Download the summary (2.7 GB)", with "it is made on your computer: the conversation never leaves it". Secondary: "Use your AI key", with the services listed and "faster; the transcript is sent to the service you choose". |
| Neither, < 8 GB | Same panel, order swapped, under "This computer has little memory: summarizing here can take several minutes and slow it down." Primary: "Use your AI key" (recommended). Secondary: "Download the summary anyway (2.7 GB)". |

"Use your AI key" opens the key form inline, in the panel (no trip to
Settings): service, key (checked before saving), model (prefilled,
optional) and a "Where do I get a key?" link that opens that service's key
page (fixed URLs in Rust, as `summary_key_help` did). Saving it summarizes
the note, after the first-time consent for that service. The download keeps
its progress and ETA, and summarizes when it finishes.

Sketch (≥ 8 GB; below 8 GB the two blocks swap and the memory line goes on
top):

```
To summarize, choose how:

[ Download the summary (2.7 GB) ]        primary
  It is made on your computer: the conversation never leaves it.

Use your AI key                          secondary
  OpenAI · Claude · Gemini · Groq · OpenRouter · other
  Faster. The transcript is sent to the service you choose.
```

Each summary records where it was made (`summary.source`: `"local"` or the
provider id) so the note can say "Summary made with OpenAI".

The sidebar and Settings → About go back to two texts: "Everything runs on
your computer" and, with a key on, "Everything runs on your computer, except
the summaries you send to {provider}".

**Names:** services are named (OpenAI, Claude, Gemini, Groq, OpenRouter): the
user needs them to know which key to paste, and the privacy notice must say
who receives the transcript. Models are not named (CLAUDE.md's rule stays):
the only model name is in the optional, prefilled "model" field, which is the
user's own account.

## Backend (Rust)

- **`summary_cloud.rs` (new):** two clients over `reqwest`, which is already a
  dependency:
  - **OpenAI-compatible** (`POST {base}/chat/completions`, `Authorization:
    Bearer`): OpenAI `https://api.openai.com/v1`, Groq
    `https://api.groq.com/openai/v1`, Gemini
    `https://generativelanguage.googleapis.com/v1beta/openai`, OpenRouter
    `https://openrouter.ai/api/v1`, custom URL as typed (the key may be
    empty for local servers).
  - **Anthropic** (`POST https://api.anthropic.com/v1/messages`, headers
    `x-api-key` and `anthropic-version`, `system` as its own field). Check
    the current API reference and model ids when implementing.
  - Same request as the local one: the system prompt and transcript from
    `summary_system` / `summary_input`, temperature 0.3, ~2,500 output
    tokens, a timeout of its own (summaries take longer than a sentence).
  - Errors mapped to clear messages: 401/403 invalid key, 429 quota,
    network.
- **Key in the keychain again:** `keyring` back in `Cargo.toml` (it was
  removed with Groq on 2026-11-02; it is the standard way to store a secret on
  macOS and Windows). One entry per provider (`service com.lingora.app`,
  account = provider id). Never in a file or in `localStorage`.
  `LINGORA_SUMMARY_KEY` in `.env` only as a development fallback, never read
  in release builds (as `env_key` did).
- **Commands:** `summary_key_status(provider)`, `summary_key_set(provider,
  key)` (checks it with a cheap request, e.g. listing models),
  `summary_key_clear(provider)`, and `note_summarize(id, cloud)` where `cloud`
  is `None` for local or `{ provider, model, base_url }`.
- **`notes.rs`:** `summarize_text` keeps the split by parts, with the budget
  from the provider (large contexts: an hour always fits) instead of the
  local `Session`. `tidy_answer` and `without_repeat` apply to every source.
- **`system_memory` command:** total RAM from `perf::ram_gb()` (exists on Mac
  and Windows), so the interface can choose the panel. Threshold 8 GB in one
  constant.

Files: new `summary_cloud.rs`; `notes.rs`, `lib.rs`, `perf.rs` (make
`ram_gb` public), `Cargo.toml` (`keyring`). Rust changes go in one block
(the app restarts).

## Interface

- `utils/summarySource.js` (+ test): the services and their default models,
  the 8 GB threshold and the `localStorage` keys `lingora.summarySource`,
  `lingora.summaryModels` (a model per service), `lingora.summaryBaseUrl`.
- `hooks/useSummarySource.js`: the source, whether its key is there (from
  Rust) and the RAM.
- `components/SummaryKeyForm` (service, key, model, URL; used in the note and
  in Settings), `components/SummaryOptions` (the note's panel with both
  options, ordered by RAM; `SummaryDownload` is its local block) and
  `components/SummarySource` (Settings → Notes).
- Consent per provider in `localStorage` (`lingora.summaryConsent.<provider>`).
  The old `lingora.summaryConsent` was Groq's; it is not reused.
- Texts with `t()` in `src/i18n/es` and `en`.

## Tests

- Unit: request bodies per client (OpenAI-compatible and Anthropic), error
  mapping, the RAM threshold, the prefs keys.
- With the bench in the session (same 3 notes, the same prompt): OpenAI,
  Claude, Gemini and Groq. Check that each one keeps the format the app
  parses: `## ` headings, one `[mm:ss]` at the end of each point, the
  `<<<MAP>>>` marker and the "Persona N" labels. Fix differences in
  `tidy_answer`, not with a prompt per provider.
- By hand: a summary per provider in the app, the first-time dialog, key
  removal, a note summarized locally after switching back.

## Docs to update when it ships

- `CLAUDE.md` section 3: "All local" gets its one exception back (summaries
  with the user's own key, off by default, with consent).
- `README.md` (variables, privacy line), `marketing/lingora-base-conocimiento.md`
  (privacy: "100 % on your Mac unless you turn on your own key"),
  `plan-autonomia.md` phase 3 (link here).

## Also, small and separate

The local model sometimes writes "No se tomaron decisiones…" instead of
leaving the section out. Drop sections whose only bullet says there is
nothing, in `tidy_answer`. Found in the A/B of 2026-11-02.

## A/B of stricter prompt rules (2026-11-02)

Tested adding six fidelity rules (keep doubt as doubt, no invented
deadlines, no guessed owners, only real times, same names) to every
template, 2 runs × 3 notes each. They didn't help: proposals still came out
as decisions ("Se decidirá…"), owners were still wrong, the model started
putting guessed names in parentheses ("Persona 3 (Trent)") and once moved the
times to the start of each point. Run-to-run variation was larger than the
effect. Not added; fixes go in `tidy_answer` instead.

## Open questions

- Default model per provider: pick cheap, fast ones when implementing and
  check that each exists that day.
- Should a summary made with a key say so on the note? (Proposed: yes, a
  small "Made with {provider}" under it.)
