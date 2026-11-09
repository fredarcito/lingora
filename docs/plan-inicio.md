# Plan: home screen and light mode

Status: phases 1 and 2 built (2026-11-09). Appearance row in Settings added (user OK 2026-11-09). Pending: a manual pass over every screen in both themes.

Goal: the app opens on a **Home** screen that explains the three modes in
one line each and lets you pick one, with the recent notes below. The app
gets a **light mode** next to the current dark one (follows macOS by
default, can be forced in Settings). The side menu stays as today: the ☰
drawer that opens above the content.

Reference design: two screenshots the user shared (light and dark) with a
fixed sidebar, a "What do you want to do?" title, three mode cards
(Translate audio, Translate call, Take notes), a language pair top right,
"Recent activity" and a "Chat with Lingora" card. **Out of scope:** the
fixed sidebar (we keep the ☰ drawer; switching to a fixed one is a later
layout plan) and the chat itself (separate future plan). The chat card is
shown, but only as a "coming soon" placeholder (see 2.2).

---

## 0. Rules (read before starting)

The same as in `docs/plan-notas.md`, section 0. In addition:

- **Frontend only.** Nothing in `src-tauri` changes; the app does not
  restart while someone tests.
- **Protected files** (`CLAUDE.md` §1): `Captions`, `FloatingCaptions` and
  `Welcome` only get their literal colors swapped for variables (phase 1).
  Rhythm, animations, sizes, trims and layout stay exactly the same. If a
  color there cannot become a variable without changing how it looks in
  dark mode, leave it and note it in «Pending».
- **Floating captions stay dark** in both themes (they sit on top of videos).
- **Call mode keeps its build flag.** `CALL_MODE` (`VITE_CALL_MODE`) stays;
  when it is off, the call card shows locked with the existing
  `app.mode.callSoon*` texts, exactly like the mode switch does today.
- **Existing `localStorage` keys are not renamed** (`prefs.test.js`). New
  key: `lingora.theme` only.
- Every new text with `t()` and its key in `src/i18n/es/` and `en/`. No model
  names. Neutral Spanish.
- No new dependencies. Icons are our SVGs from `@components/shared` (add the
  missing ones there), never text glyphs like ⇄ ◉ ✎.
- Imports with aliases, no `../`. New components in their own folder
  (`Name/index.jsx` + `styles.module.css`), shared ones listed in
  `docs/componentes.md`.

---

## Phase 1: colors as variables + light mode

Do this first: Home is then built on the variables and needs no rework.

### 1.1 Tokens (`src/styles.css`)

Today `:root` is dark-only (`color-scheme: dark`, surfaces and borders as
`rgba(255,255,255,…)`). Change to:

- `:root` keeps the **dark** values as today, but move the background to the
  reference's blue-grey: `--bg` ≈ `#14171c`, cards ≈ `#191d24`. Drop the two
  colored `radial-gradient`s on `body` (the reference is flat). Show the
  user before/after; if they prefer the current near-black, keep `#0b0c10`.
- Add the **light** set under
  `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {…} }`
  and again under `:root[data-theme="light"] {…}`, with `color-scheme: light`.
  Suggested values (shadcn zinc-like): `--bg #ffffff`, sidebar/surface
  `#f7f8fa`, `--surface rgba(0,0,0,.03)`, `--surface-2 rgba(0,0,0,.05)`,
  `--surface-3 rgba(0,0,0,.08)`, `--hairline rgba(0,0,0,.08)`,
  `--hairline-strong rgba(0,0,0,.14)`, `--text #16181d`, `--text-2 #5b6170`,
  `--text-3 #8a90a0`, `--ok #059669`, `--warn #b45309`, `--danger #dc2626`,
  and the matching `--n-*` (`--n-border`, `--n-input`, `--n-hover`,
  `--n-muted`, `--n-popover #ffffff`).
- `:root[data-theme="dark"]` repeats nothing: dark is the default.
- **Lane accents.** Each lane redefines `--accent`, `--accent-2`,
  `--accent-ink`. Light colors like `#5eead4` do not read on white: give each
  lane a darker light-mode value (e.g. teal `#0f9488`) under the light
  selectors. Find where lanes set them (`LaneCard` CSS / `App` classes).
- Add new tokens for what Home needs, so nothing literal goes in components:
  `--mode-audio`, `--mode-call`, `--mode-notes` (icon/button tint: teal,
  violet, amber) with a light and dark value each, and
  `--mode-*-soft` for the tinted backgrounds (use
  `color-mix(in srgb, var(--mode-audio) 14%, transparent)`).

### 1.2 Literal colors → variables

About 167 literal colors (`#…`, `rgb(a)(…)`) in 26 CSS files. Find them:

```sh
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src --include='*.css'
```

Replace each with the closest token (or `color-mix` of a token). Typical
cases: `rgba(255,255,255,x)` → `--surface*` / `--hairline*` /
`color-mix(in srgb, var(--text) x%, transparent)`; `rgba(0,0,0,x)` shadows →
a new `--shadow` token (lighter in light mode); text whites → `--text`.
Keep **dark mode pixel-identical** except for the agreed new background.

`FloatingCaptions`: wrap its root in `data-theme="dark"` (or set the dark
values on its root class) so it ignores the light theme.

### 1.3 Theme preference

- `src/utils/prefs.js`: `loadTheme()` / `storeTheme(theme)` with key
  `lingora.theme`, values `"system" | "light" | "dark"`, default `"system"`.
  Add the key to the list in `prefs.test.js`.
- `src/hooks/useTheme.js`: reads the pref and sets
  `document.documentElement.dataset.theme` (`"light"`/`"dark"`, or removes it
  for `"system"`). Call it once in `App`. Also apply it before React mounts
  (in `main.jsx`, from `loadTheme()`) to avoid a dark flash on light Macs.
- The floating captions window is a separate page: it must not pick up the
  pref (see 1.2).
- Settings: a new "Appearance" row with `Segmented` (System / Light / Dark).
  `CLAUDE.md` §3 limits Settings to devices, notes and diagnostics: **ask
  the user before adding it** (proposed 2026-11-03, not yet confirmed). If
  they agree, update that line of `CLAUDE.md`.
- Tauri window background (`tauri.conf.json`, protected): do not touch. If a
  dark flash shows on light Macs at launch, note it in «Pending».

### 1.4 Check phase 1

Walk every screen in both themes: Welcome, Translate (video and call, idle
and running, focused lane), Take notes, My notes (list and a note with
summary, mind map, people), Settings (all sections, Credits, Storage,
dialogs, menus, selects), the ☰ drawer, the floating captions. Look for
invisible borders, white-on-white text, unreadable accents, harsh shadows.

---

## Phase 2: Home

### 2.1 Navigation

- `View` (in `components/Sidebar`) gains `"home"`: `"home" | "translate" |
  "notes" | "settings"`.
- `App/index.jsx`: `view` starts at `"home"` (not `"translate"`). Choosing a
  mode card does `changeMode(mode)` + `goTo("translate")`. Keep `App` thin:
  Home gets props and callbacks, no logic lives in `App` beyond wiring.
- If a lane is running (`anyRunning`), Home still opens, but the cards of
  the other modes are disabled (same rule as the mode switch today:
  `app.mode.stopToChange`), and the running mode's card says it is running
  and goes back to it.
- Sidebar `SECTIONS`: add `home` first (new `HomeIcon`), keep the rest.
  Texts `sidebar.home` / `sidebar.home.hint`.
- The top bar's mode switch **stays** for now (switching without going
  through Home). Revisit with the user after they try it.

### 2.2 `src/pages/Home/`

`index.jsx` + `styles.module.css`. Layout from the reference:

1. **Header row:** ☰ (`MenuButton`), title "¿Qué quieres hacer?" and subtitle
   "Elige un modo para empezar." (`PageHeader` if it fits). Right side: the
   existing `PairBar` (same props as in `TopBar`), labelled "Origen"; it
   changes the pair used by Translate. Locked while running.
2. **Three mode cards** in a row (stack them under ~760 px):
   - Translate audio (`video`): "Escucha y sigue la traducción mientras
     suena el audio." Button "Elegir audio →".
   - Translate call (`call`): "Traducción en directo de una llamada o del
     audio del equipo." Button "Configurar llamada →". Locked when
     `CALL_MODE` is off (reuse `app.mode.callSoon` / `.hint`).
   - Take notes (`notes`): "Transcribe una reunión, el audio del equipo o el
     micrófono." Button "Configurar notas →".
   - Icon tile + tinted button use `--mode-*` / `--mode-*-soft`.
   - The **last used mode** (`loadMode()`) is highlighted: border in its
     color and a filled button (as in the dark reference). Same in both
     themes.
3. **Recent activity** (left, about two thirds of the width): the 5
   latest notes from `useNotesList` (`@hooks/useNotesList.js`): icon by kind
   (conversation vs take-notes), title, short description and relative day
   (reuse `daysAgo` / `groupLabel` / `dateFormats` from `@utils/noteList.js`).
   "Abrir" opens the note through the existing `openRequest` path
   (`setOpenRequest({ id, nonce })` + `goTo("notes")`). A "Ver todas" link
   goes to My notes. Empty state: one muted line ("Aquí aparecerán tus
   notas.").
4. **Chat card, placeholder only** (right, about one third; stacks under
   Recent activity on narrow windows): title "Chat con Lingora",
   description "Pregunta sobre una transcripción, traducción o tus notas.",
   a `Badge` "Próximamente", a disabled input with the placeholder
   "«Resume los puntos clave…»" and a disabled "Abrir chat" button. No
   logic, no state, no handlers. Same locked look as the call card when
   `CALL_MODE` is off. Do not show the "Contexto: sesión abierta" line.

### 2.3 Shared components

Create in `src/components/shared/` (with JSDoc and a row in
`docs/componentes.md`) only what is generic:

- `ModeCard`: icon, title, description, action button, `tone`
  (`"audio" | "call" | "notes"`), `highlighted`, `disabled`, `onClick`.
  (If it ends up Home-only, put it in `src/components/ModeCard/` instead.)
- `ActivityRow`: icon, title, subtitle, trailing action. Reusable later by
  the chat or search.
- Icons: `HomeIcon`, `SwapIcon` (audio), `CallIcon`, reuse `NoteIcon`.

### 2.4 Texts

New `src/i18n/es/home.json` and `en/home.json` (loaded automatically by the
glob in `src/i18n/index.jsx`): `title`, `subtitle`, `origin`,
`audio.title/desc/action`, `call.title/desc/action`,
`notes.title/desc/action`, `running`, `recent`, `recent.empty`, `seeAll`,
`open`, `chat.title`, `chat.desc`, `chat.placeholder`, `chat.action`,
`chat.soon`. Plus `sidebar.home` and `sidebar.home.hint`. Spanish as in the
reference, except the activity footer (dropped).

### 2.5 Check phase 2

Home in both themes, narrow and wide window; each card opens its mode;
locked call card with the flag off and working with it on; chat card
visible, locked and not focusable as an action; running lane →
other cards disabled; "Abrir" opens the right note; empty list; the ☰
drawer from every screen; keyboard focus order and visible focus rings.

---

## Finish

- `npx vite build`, `pnpm test` (Rust not touched, `cargo check` optional).
- Say what was tested by hand and what was not.
- Update `CLAUDE.md` §3/§4 (Home, theme in Settings, this plan) and
  `marketing/lingora-base-conocimiento.md` (light mode, home screen).

## Pending

- Chat with the notes (local summary model + search over notes): own plan.
  Home already has its placeholder card; that plan turns it on.
- Fixed sidebar like the reference (instead of the ☰ drawer): own layout
  plan. It changes the shell of every screen (less width for Translate,
  Notes, Settings), not just Home.
- Decide whether the top bar's mode switch goes away once Home exists.
