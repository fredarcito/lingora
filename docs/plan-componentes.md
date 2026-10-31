# Plan: reusable interface components

> **Status (2026-10-29): done.** With three changes the user decided on the fly:
> CSS Modules instead of global CSS
> ("CSS Modules"), folders `pages/`, `components/`, `components/shared/` and
> `utils/` instead of `src/` and `src/ui/` ("Final folders") and the order of
> the phases ("How it was done"). What didn't fit is in "Pending". The
> catalog and the rules that remain are in `docs/componentes.md`.
> `scripts/css-check.mjs` and its reference in `docs/refactor/` were removed
> on 2026-10-31: the move was finished and the CSS has changed on purpose
> since. Git history keeps them.

**For whoever implements it:** read `CLAUDE.md` first. This plan is a
refactor: **the app has to look and behave exactly the same** before and
after. If anything here conflicts with `CLAUDE.md`, stop and ask.

## Why

Each screen hand-writes its own buttons, switches, menus, dialogs and
icons. It works, but:

- **The same thing is written several times:**
  - there are three almost identical confirmation dialogs;
  - two menus, each with its own "close when clicking outside";
  - `const svg = {…}` is copied into three files.
- **Each new thing ends up with its own style.** The switch on the lane card
  needed its own CSS because it didn't show on that background.
- **It is hard to know what to use** when adding something, because there is no
  single place to look.

Goal: a `src/ui/` folder with the basic components, the existing code using
them, and a rule in `CLAUDE.md` so that new code uses them (or extends them)
instead of reinventing them.

## Structure (user decision)

Every component, whether a screen or a piece of `src/ui/`, lives in **its own
folder**, never as a loose file (`Captions.jsx`):

```
src/ui/Button/index.jsx      el componente
src/ui/Button/styles.css     su CSS, importado desde index.jsx
src/Notes/index.jsx
src/Notes/styles.css
```

- This also applies to the screens that already exist: App, Notes,
  NoteTaking, Settings, Sidebar, Diagnostics, LanguagePicker, LangOffer,
  SummaryKey and Markdown.
- **Captions, FloatingCaptions and Welcome too**, with the user's yes,
  even though they are on the "don't touch" list: **they are only moved**, their code
  doesn't change by a single line, except the import paths if needed.
- The files that are not components (`notes.js`, `api.js`, `audio.js`,
  `words.js`, `i18n/`) stay where they are.
- If a component has subcomponents that only it uses (for example
  `SpeakerBar` or `Transcript` in Notes), they can stay in its `index.jsx`.
  If another file uses them, they go to their own folder.
- The imports `./Notes` keep working, because Vite resolves
  `Notes/index.jsx`. The ones that carry an extension (`./Notes.jsx`,
  `./Segmented.jsx`) have to be changed.

## Final folders (user decision, 2026-10-29)

It replaces the above as to where each thing goes:

```
src/App/                 the frame and Translate (separating them would touch its logic)
src/pages/               Notes, NoteTaking, Settings, Welcome, FloatingCaptions
src/components/          Captions, Diagnostics, LangOffer, LanguagePicker,
                         Markdown, Sidebar, SummaryKey
src/components/shared/   what the plan calls `src/ui/`
src/utils/               api.js, audio.js, notes.js, words.js (unchanged
                         inside, except the `i18n` path in notes.js)
src/i18n/                same
```

With `pages/Notes` and `utils/notes.js` in different folders, the macOS clash
between `./Notes` and `notes.js` disappears.

## How it was done

With modules, the order of the phases changed: if `.note-action` moves to the
`Button` module while a screen still writes `className="note-action"`, that
screen is left unstyled. So:

1. **Phase 1:** the `ui` pieces were created painting the same global classes as always.
2. **Phase 2:** each screen moved to its folder and its module, using the pieces;
   what `ui` named in its CSS, with `:global()`.
3. **Phase 2b:** each piece moved to its module once all the screens used it, and the
   rules that crossed over were rewritten (see `docs/refactor/renames.json`).

After each step, `npx vite build` and `scripts/css-check.mjs` reported "Bien"
(good). The script was tested and extended before starting and during the refactor
(each extension, tested with copies of the CSS deliberately broken): `@media` and
`@container` in order, classes that go together on one element (according to
`docs/refactor/jsx.original/`), modules (`name__Folder`), simulation of the
cascade for the pairs that change order and global classes that no one writes anymore.

## CSS Modules (user decision, 2026-10-29)

Each component carries its CSS in a **module**, so that one component's classes
don't override another's. This replaces the "same classes" approach below:

- **Files:** `Name/styles.module.css`, imported as
  `import s from "./styles.module.css"`, and `className={s.noteAction}`.
  Inside the CSS the names **do not change** (`.note-action`), so the CSS only
  changes file. To combine classes, a one-line `cx()` in
  `src/ui/cx.js` (without dependencies).
- **`vite.config.js`:** `css.modules` with `localsConvention: "camelCaseOnly"`
  and `generateScopedName` `[local]_[hash:base64:5]` (in the inspector you still
  read `note-action_x7f2a`). With `LINGORA_CSS_CHECK=1` it uses `[local]`, so
  that `css-check` compares the same selectors as the original.
- **What stays global**, in plain CSS:
  - `src/styles.css`: `:root`, reset, elements, `@keyframes`, structure and
    the utility classes that many files use (`muted`, `error`,
    `small`…);
  - nothing else: **Captions, FloatingCaptions and Welcome also go with a module**
    (the user approved it). In them only the `className`s change; rhythm, animations,
    cuts and logic are not touched.
- **Rules that cross components** (`.dialog .note-action.danger`,
  `.speaker-menu .note-action.primary`, `.notes-switch.lane-save`; about 20):
  the outer one passes one of its own classes through `className` and the rule is
  rewritten with it, **with the same specificity**. Each selector change is noted in
  `docs/refactor/renames.json` (old → new); `css-check` accepts it only if
  the specificity matches.
- **`css-check` also checks** that each class of a module is used by its
  `index.jsx` and that each `s.something` exists in the module (otherwise
  `class="undefined"` comes out without an error).
- **App.jsx:** the `className`s of all its JSX change, not only the header,
  `LaneCard` and `VoiceControls`. The logic is still not touched.
- **CLAUDE.md:** "Don't change the existing class names" becomes: the class
  names are kept inside the modules.

## Moving the CSS (user decision: in this refactor)

> With CSS Modules, wherever below it says a component's `styles.css`, read
> `styles.module.css`; the order still matters just the same.

`src/styles.css` stays only with the general things: `:root` variables, reset,
element styles (`button`, `select`, `input`), `@keyframes` and app
structure. Each component's own styles go to its `styles.css`.

**The risk is the order.** When two rules have the same specificity, the one that
comes later wins. Many classes have rules spread across `styles.css`:
`.note-action` appears in 5 or 6 places, `.note-summary` in 3,
and there is a section that redefines the height of all the controls
(`--control-h`). If a rule changes position, another may win and something
changes its look without any error. To avoid it:

1. **Before starting,** copy `src/styles.css` to
   `docs/refactor/styles.original.css`. There is no git: it is the only reference.
2. **In `main.jsx`,** the import of `./styles.css` becomes **the first one**.
   Today it is last, and Vite puts each file's CSS in the order it is
   imported. That way the general styles come before each component's.
3. **A component takes all its rules at once**, in the same order they were in,
   including those in `@media` and those in the "general" sections that name it. A
   grouped rule such as `.note-action, .taking-start, .pair { … }` is split and each
   piece goes with its component.
4. **A rule that mixes two components** (`.dialog .note-action.danger`,
   `.speaker-menu .note-action.primary`) goes with the outer one: the dialog or the
   note page.
5. **Check with `scripts/css-check.mjs`** after each component:

   ```
   npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
   node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
   ```

   It warns if a rule was lost or duplicated, or if two rules that can override
   each other changed order. **That script is untested.** Before moving anything,
   run it against the current CSS: it has to say "Bien" (good). If it fails or gives
   false warnings, fix it first. If it warns about an order, don't turn it off:
   move the rule or leave both in the same file.

## Rules for this refactor

- **Same output HTML, same classes.** The components generate the classes that
  already exist (`note-action`, `notes-switch`, `note-menu`,
  `dialog`…). `CLAUDE.md` forbids changing existing classes, so nothing changes
  visually. The CSS only changes file, not content.
- **Do not touch the code of:**
  - `src/Welcome.jsx`, `src/Captions.jsx` and `src/FloatingCaptions.jsx` (they are only
    moved to their folder);
  - `src/audio.js`;
  - in `src/App.jsx`, only the JSX of `LaneCard`, `VoiceControls` and the
    header. Nothing about `enqueue`, `texted`, `playback`, `start`, `stop`, the effects or the
    `lingora.*` keys;
  - `createSpeakerTracker` and its constants in `src/notes.js`.
- **No new dependencies** (no Radix, no shadcn as a package, no
  icon libraries).
- **No Rust.** This plan does not touch `src-tauri`.
- **JS with JSDoc**, comments and texts in Spanish, with the density of the
  surrounding code. Every visible text through `t()`; the components don't
  carry fixed text, they receive it through props.
- **One migrated file = one step.** After each one, `npx vite build`
  without errors.

## Phase 0: prepare

1. Copy `src/styles.css` to `docs/refactor/styles.original.css`.
2. Run `scripts/css-check.mjs` against the current CSS, as "Moving the CSS" says.
3. Put the import of `./styles.css` first in `main.jsx` and check with
   the script that it still says "Bien".

## Phase 1: create `src/ui/`

One folder per component (`index.jsx` + `styles.css`, as in "Structure") and a
`src/ui/index.js` that exports them all. Each component takes its CSS from
`styles.css` as described in "Moving the CSS".

| Component | Replaces | Notes |
|---|---|---|
| `Button` | `<button className="note-action …">` (about 20 times) | Props: `variant`: `"default"` \| `"primary"` \| `"danger"`. Also `icon` (icon only, square: today `note-more` and `note-summary-copy`), `busy` (puts the `spinner small` in front) and the rest goes to the `<button>`. Classes: `note-action`, `primary`, `danger` and any extra ones passed in `className`. |
| `IconButton` | `icon-button` (☰, floating panel, lane settings) | `active` adds `is-active`. `label` goes to `aria-label` and `title`. |
| `LinkButton` | `<button className="link …">` | Only wraps the class. |
| `Switch` | `label.notes-switch` + `input[role=switch]` (Settings ×2, "Show original", "Save to notes") | Props: `checked`, `onChange(bool)`, `label`, `disabled`, `className`, `title`. What is in Settings (row with title and help) still uses `prefs-row`, with `Switch` inside. |
| `Select` | `<select className="prefs-select">` and those of `note-summary-lang` | Props: `value`, `onChange(value)`, `options: {value, label}[]`, `label` (to `aria-label`), `disabled`. The header selects (`.pair`) and those of `VoiceControls` stay as they are, because their CSS depends on the container. |
| `Menu` + `useDismiss` | the note's ⋯ menu and `speaker-menu` | `useDismiss(open, onClose)` closes on clicking outside and with Escape; today it is written twice in `Notes.jsx`. `Menu` renders `note-menu`, with `align="end"` (adds `note-menu-end`); `MenuItem` takes `danger` (adds `note-menu-danger`); `MenuSeparator` is `<hr className="note-menu-sep">`. |
| `ConfirmDialog` | `ConfirmDelete`, `ConfirmSend` (Notes.jsx), `ConfirmRecord` (NoteTaking.jsx) | Props: `title`, `body`, `confirmLabel`, `cancelLabel`, `danger`, `onConfirm` and `onCancel`. Keeps the initial focus on Cancel, Escape to cancel, clicking outside to cancel and `role="alertdialog"`. The title's `id` via `useId()`. |
| `Badge` | `<span className="badge">` | |
| `Spinner` | `<span className="spinner …" aria-hidden />` | `small` adds `small`. |
| `SearchBox` | `label.notes-searchbox` of the notes list | Props: `value`, `onChange`, `placeholder`, `shortcut` (the `⌘K`), `inputRef` and `className`. |
| `Segmented` | `src/Segmented.jsx` | Moved to `src/ui/` as is. Update the imports. |
| Icons | the 20 `XxxIcon` functions and the three `const svg` | `src/ui/icons.jsx`: a shared `svgProps` and each icon exported by name. If two icons are the same drawing, only one stays. **Copy the exact `path`s**, without redrawing anything. |

Each component gets a short JSDoc: what it is for and what props it has, in the
style of `Segmented.jsx`.

## Phase 2: migrate file by file

In this order, from least to most risk. Each screen moves to its folder with
its CSS, and after each one run `npx vite build` and `scripts/css-check.mjs`. At the
end come `Captions`, `FloatingCaptions` and `Welcome`: just move them and
take their CSS along.

1. `LangOffer.jsx`, `SummaryKey.jsx` and `LanguagePicker.jsx`: buttons and
   selects.
2. `Settings.jsx`: switches, select and buttons.
3. `Sidebar.jsx`: `IconButton` and icons.
4. `Diagnostics.jsx`: icons, `LinkButton` and `Spinner`.
5. `NoteTaking.jsx`: buttons, `ConfirmDialog` (instead of `ConfirmRecord`)
   and `Segmented`.
6. `Notes.jsx`: buttons, ⋯ menu with `Menu`/`useDismiss`, `speaker-menu`,
   `ConfirmDialog` ×2, the "Show original" `Switch`, `Select`, `Badge`,
   `SearchBox` and icons.
7. `App.jsx`, **only the JSX** of the header, `LaneCard` and `VoiceControls`:
   `IconButton`, the "Save to notes" `Switch`, `Segmented` and icons.

If something doesn't fit a component without changing how it looks, **leave it
as it is** and note it at the end of this document, under "Pending". Don't force
the component or change the CSS to make it fit.

## Phase 3: the rule and the catalog

1. Create `docs/componentes.md`: a table with each component, what it is for,
   its props and a one-line example.
2. In `CLAUDE.md`, section 3, **Design** item, add:

   > **Componentes:** usa los de `src/ui/` (catálogo en
   > `docs/componentes.md`). Si no existe lo que necesitas, créalo ahí, con
   > su JSDoc y su fila en el catálogo, en vez de escribirlo dentro de la
   > pantalla. Cada componente va en su carpeta: `Nombre/index.jsx` y su
   > CSS en `Nombre/styles.css`, nunca como `Nombre.jsx` suelto.
   > `src/styles.css` es solo para lo general.

   And change the **Design** sentence that says "New code goes in its own section at the end of the CSS":
   now new code goes in the `styles.css` of its component.

3. In `CLAUDE.md`, section 4 ("Where everything is"), add a line for
   `src/ui/` and `docs/componentes.md`.

## How to check it

- `npx vite build` without errors and `scripts/css-check.mjs` reporting "Bien" after
  each file. `cargo check` isn't needed, because Rust isn't touched.
- At the end, no loose `.jsx` remains in `src/` except `main.jsx`.
- `grep -c 'className="note-action' src/*.jsx` should end up at 0 outside
  `src/ui/`, except what is noted under "Pending". The same with
  `role="switch"`, `className="dialog"` and `const svg =`.
- The user reviews it in the app with `pnpm tauri dev`. Tell them which screens to
  look at:
  - **Translate audio:** card, lane settings and the "Save to notes" switch.
  - **Take notes:** start, recording and the confirm dialog.
  - **Notes list:** search box with ⌘K, filters and cards.
  - **A note's page:** ⋯ menu, deleting with its dialog, the first
    summary with its notice, copy, the tabs, "Show original" and the menu of
    a person.
  - **Settings and Diagnostics.**
  - **☰ menu.**

  Dialogs have to keep the focus on Cancel and close with
  Escape.
- At the end, say what was migrated, what was left under "Pending" and what could not be
  tested.

## Outside this plan

- Merging or cleaning duplicated CSS: for example, the three `.note-summary`
  rules into one. Here it is only moved, not rewritten. Cleaning changes the
  result and goes in another plan.
- Changing the design of anything.
- Changing the code of Welcome (`welcome-primary`/`welcome-secondary`) or of
  the captions so they use the new components.

## Pending

What didn't fit without changing the look, or what is left for another plan:

- ~~**Captions uses global CSS**~~ (done 2026-10-31). It is a module now:
  the floating window styles are its `floating` variant, App sets the size
  with `--captions-size`, LaneCard places it with `className`, and the
  "heard now" line is `components/LiveStatus`, shared with Take notes.
- **`.taking-end` stays global** (`src/styles.css`). In the original, a later
  `.note-action` rule overrides its `background`, so the "Jump to end" button
  looks like the normal buttons' background. In a module it would come later and would
  start showing `--n-popover`. Its `background` is in fact dead: deciding which one is wanted
  is a design decision.
- **`LinkButton` and `Spinner` render the global classes `link` and
  `spinner`.** Captions and Welcome write those classes directly, and in them
  only the `className`s could be changed, not components used.
- **`Button` has no `icon` prop.** The square size is in `.note-more`
  and `.note-summary-copy` (Notes), mixed with other properties. A generic
  variant would need new CSS.
- **The "Summary in" select (`note-summary-lang`) doesn't use `Select`.** It
  doesn't carry `prefs-select`, and `Select` always adds it. Neither do the header
  ones (`.pair`) or those of `VoiceControls` and `LaneSettings`, as the plan said.
- **Diagnostics keeps its status icons** (`StatusIcon` and its chevron,
  with a 2.4 stroke): they are different from those in `icons.jsx`.
- **Dead CSS still in `src/styles.css`**, untouched: `.pill`,
  `.pill-bad`, `.dot*`, `.setting-group`, `.setting-pair`,
  `.settings-advanced*`, `.note-toast`, `.notes-tools` and `.note-actions`.
  No JSX uses them. Cleaning it up goes in another plan.
- **HTML changes with no visible effect:**
  - The dialogs use `useId()` for the title, instead of `dialog-title`,
    `send-title` and `record-title`.
  - `Spinner` adds `aria-hidden` where it wasn't before (App and
    Diagnostics).
  - Classes without CSS are no longer rendered: `note-original` in "Show original",
    `lane-remote_to_local` on the card and `is-ok` in diagnostics.
    `welcome-how`, `is-active` (Welcome) and `error` (Diagnostics) remain
    as text.
  - `IconButton` has a `small` prop for the rule
    `.icon-button.small`, which already existed and no one uses today.
  - App's `Chevron`, which was not used, was removed along with its `const svg`.
