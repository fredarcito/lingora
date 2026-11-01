# Plan: third-party licenses screen

> **Status (2026-10-31): done** (pending: see the end). Written by Opus for Sonnet to implement.

**For whoever implements it:** read `CLAUDE.md` first. If anything here
conflicts with it, stop and ask. **No Rust changes** (the app is not
restarted) and **no new dependencies**.

## Why

The user wants to be able to sell Lingora. The models and libraries that go
inside it, or that it downloads, may be sold with it, but their licenses ask
for credit:

- CC-BY-4.0 (the European listening model) requires attribution.
- The FunASR Model License (the CJK listening model) requires keeping the
  source, the author **and the model name** (clause 2.2).
- Apache 2.0 and MIT require keeping the copyright and license notice.
- espeak-ng is GPL v3 and goes inside the app as a separate program: its
  license must be shown and its source code offered.

Today the app shows none of this.

## User decisions

- **Where:** Settings → "Acerca de", as an expandable "Third-party licenses"
  block. Not a new page or route.
- **Model names are allowed there, and only there.** It is an exception to
  CLAUDE.md §3 ("Nada de nombres de modelos en la interfaz"), forced by the
  licenses. The rest of the interface keeps the generic texts. Update
  CLAUDE.md §3 with that exception (in Spanish, like the rest of the file):
  "…salvo en Ajustes → Acerca de → Licencias de terceros, donde las licencias
  obligan a citarlos."

## What to build

### 1. The list: `src/utils/credits.js`

A pure module with the exported list (data, not interface):

```js
/**
 * @typedef {{ id: string, kind: "model" | "library", name: string, author: string,
 *   license: string, licenseFile: string, url: string }} Credit
 */
/** @type {Credit[]} */
export const CREDITS = [ … ];
```

- `name`, `author`, `license` (the SPDX id or the license's own name) and `url`
  are proper names and **are not translated**. What each one does in Lingora
  is translated: `t("credits.purpose.<id>")`.
- `licenseFile` is the name of the text in `public/licenses/` (see 2).
- `url` is where the original is published (the model card or the
  repository), shown as selectable text (see 3).

Starting entries. **Check each license against its own LICENSE file or model
card before writing it** (not from this table or from memory). Where it does
not match, stop and tell the user.

| id | kind | name | author | license (expected) | Used for | Where to check |
|---|---|---|---|---|---|---|
| `parakeet` | model | Parakeet TDT 0.6B v3 | NVIDIA | CC-BY-4.0 | listening (European languages) | huggingface.co/nvidia/parakeet-tdt-0.6b-v3 |
| `sensevoice` | model | SenseVoice Small | Alibaba (FunAudioLLM) | FunASR Model License v1.1 | listening (zh, yue, ja, ko) | huggingface.co/FunAudioLLM/SenseVoiceSmall and github.com/modelscope/FunASR/blob/main/MODEL_LICENSE |
| `hymt` | model | Hy-MT2 1.8B | Tencent | Apache-2.0 | translation and generated interface languages | `LICENSE.txt` in huggingface.co/tencent/Hy-MT2-1.8B-GGUF (the exact file in `translator.rs` `MODEL_URL`) |
| `supertonic` | model | Supertonic 3 | Supertone Inc. | OpenRAIL-M (`OpenRAIL-M-Supertonic.txt`) | voice (replaced Kokoro on 2026-11-01) | huggingface.co/Supertone/supertonic-3 |
| `eres2net` | model | ERes2Net (3D-Speaker) | Alibaba (3D-Speaker) | Apache-2.0 | telling speakers apart | github.com/modelscope/3D-Speaker (model in `speakers.rs` `MODEL_URL`) |
| `sherpa` | library | sherpa-onnx | k2-fsa / Next-gen Kaldi | Apache-2.0 | runs listening, voice and speakers | github.com/k2-fsa/sherpa-onnx |
| `onnxruntime` | library | ONNX Runtime | Microsoft | MIT | comes inside sherpa-onnx | github.com/microsoft/onnxruntime |
| `llamacpp` | library | llama.cpp | ggml authors | MIT | runs the translation | github.com/ggml-org/llama.cpp |
| `llamacpp2` | library | llama-cpp-2 | utilityai | MIT OR Apache-2.0 | connects llama.cpp to the app | crates.io/crates/llama-cpp-2 |
| `espeak` | library | espeak-ng 1.52.0 | espeak-ng contributors | GPL-3.0-or-later | phonemes for the voice (separate program) | github.com/espeak-ng/espeak-ng |
| `tauri` | library | Tauri | Tauri Programme | MIT OR Apache-2.0 | the app's frame | github.com/tauri-apps/tauri |
| `react` | library | React | Meta | MIT | the interface | github.com/facebook/react |

For espeak-ng, the version must match `VERSION` in `scripts/build-espeak.sh`.
Its `url` points to that exact release's source
(`…/espeak-ng/archive/refs/tags/1.52.0.tar.gz`), which is the code Lingora
builds without changes. That is the "offer of the source code". Add a comment
in `build-espeak.sh` next to `VERSION`: "if you change it, change it in
`src/utils/credits.js` too".

### 2. License texts: `public/licenses/`

One `.txt` per license, **copied verbatim from the official source**:

- `Apache-2.0.txt` (apache.org/licenses/LICENSE-2.0.txt)
- `MIT.txt`: MIT carries each project's copyright line, so write one per
  project (`MIT-llama.cpp.txt`, `MIT-onnxruntime.txt`, `MIT-react.txt`…)
  with its own `LICENSE` text.
- `CC-BY-4.0.txt` (creativecommons.org/licenses/by/4.0/legalcode.txt)
- `FunASR-Model-License.txt` (the `MODEL_LICENSE` of FunASR)
- `GPL-3.0.txt`: the same `COPYING` that `build-espeak.sh` already copies
  next to the espeak-ng data.

Vite copies `public/` into the build, so the texts go inside the app
**without touching `tauri.conf.json`** (protected). They are read with
`fetch("/licenses/<file>")`. Check in `pnpm tauri build` (or in the built
`dist/`) that they are there.

### 3. The block: `src/components/Credits/`

`Credits/index.jsx` and `Credits/styles.module.css`, with JSDoc. It shows:

- a short intro (`credits.hint`): Lingora uses free models and libraries
  whose authors are thanked here;
- two groups, "Models" and "Libraries", each a list of rows:
  **name** · author, the purpose underneath in gray, and on the right the
  license name as a `LinkButton` that opens its text;
- the `url` of each row as selectable text (`user-select: text`), not a
  link. Opening the browser needs `tauri-plugin-opener`, which is a new
  dependency. **Don't add it**; write it under "Pending".

The license text opens in a modal. There is no generic dialog in
`components/shared/` (`ConfirmDialog` always has a confirm button), so
**create `src/components/shared/Dialog/`**: `title`, `children`,
`closeLabel`, `onClose`; Escape and clicking outside close it, focus goes to
the close button. Take its look (backdrop, card) from `ConfirmDialog` so
they match. Add its row to the catalog in `docs/componentes.md`. Don't
refactor `ConfirmDialog` to use it in this plan.

Inside the dialog: the text in a `<pre>` with `white-space: pre-wrap`, the
monospace font from `styles.css`, scrolling inside the dialog (max height
~70vh), never the page.

Style: shadcn / Sembly, the `--n-*` variables, light and dark. Look at how
the Settings rows (`prefs-row`) and the "Acerca de" card look and follow
them.

### 4. Settings

In `src/pages/Settings/index.jsx`, inside the "Acerca de" card, under the
current paragraphs: a `LinkButton` "Licencias de terceros" that shows or
hides `<Credits />` below it (closed by default). Nothing else in Settings
changes.

### 5. Texts

New namespace `src/i18n/es/credits.json` and `src/i18n/en/credits.json`
(loaded automatically by the `import.meta.glob` in `src/i18n/index.jsx`):

- `title` ("Licencias de terceros" / "Third-party licenses"), `hint`,
  `models`, `libraries`, `close`, `source` (label for the URL);
- `purpose.<id>` for each entry, with the same wording as the table above.

Neutral Spanish. No model names in these texts (the names come from
`credits.js`).

### 6. Tests: `src/utils/credits.test.js`

- the `id`s are unique;
- each `licenseFile` exists in `public/licenses/` and is not empty;
- each `id` has `credits.purpose.<id>` in `es` and in `en`;
- the espeak-ng entry has the same version as `VERSION` in
  `scripts/build-espeak.sh` (read the file in the test).

## Done when

- [ ] Settings → Acerca de → "Licencias de terceros" opens the list, and each
  license opens its text, in Spanish and English, light and dark.
- [ ] Every license in the list was checked against its source (say which
  ones did not match, if any).
- [ ] CLAUDE.md §3 has the exception; `docs/componentes.md` has `Dialog`.
- [ ] `npx vite build`, `pnpm test` and `cargo check` (in `src-tauri`, it
  should not change) with no errors. The `.txt` files are in `dist/licenses/`.
- [ ] Say what was tested by hand and what was not.

## Pending (ask the user, not part of this plan)

- **Every Rust crate and npm package inside the app.** Strictly, MIT and
  Apache ask for the notice of every bundled dependency, including transitive
  ones (hundreds of crates). The standard way is to generate a
  `THIRD_PARTY_NOTICES` file with `cargo-about` (Rust) and a license
  extractor for npm, at build time. They are development tools, not app
  dependencies, but CLAUDE.md asks before adding anything: propose it.
- **Opening the URLs in the browser** needs `tauri-plugin-opener`.
- **Mirror of the espeak-ng source** on Lingora's own release page, in case
  upstream ever removes that tag (GPL v3 §6d asks that the source stays
  available).
