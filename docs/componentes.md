# Components and CSS

Before writing a button, a switch or a menu inside a screen, look here. If
what you need isn't here, create it in `src/components/shared/` with its JSDoc
and add its row to this table.

## Folders

```
src/
  main.jsx  styles.css      entrada y CSS general
  App/                      el armazón (vistas, menú) y la pantalla Traducir;
                            types.js, sus tipos JSDoc (Lane, LaneState, Mode…)
  pages/                    Notes, NoteTaking, Settings, Welcome, FloatingCaptions
  components/               Captions, Diagnostics, LaneCard (con VoiceControls),
                            LaneSettings, LangOffer, LanguagePicker, Markdown,
                            PairBar, Sidebar, SummaryKey, TopBar
  components/shared/        las piezas básicas (esta tabla) e icons.jsx
  utils/                    api, audio, notes, words, lanes, voice: lo que no
                            es interfaz
  i18n/                     textos de la interfaz
```

Each component lives in its own folder: `Name/index.jsx` and its CSS in
`Name/styles.module.css`. Never a loose `Name.jsx`.

## Catalog

Everything is imported from `src/components/shared` (`import { Button } from "../components/shared"`).
Texts arrive as props, already translated with `t()`.

| Component | What for | Props | Example |
|---|---|---|---|
| `Button` | Notes and settings button (shadcn style) | `variant`: `"default"` \| `"primary"` \| `"danger"` \| `"stop"` (with `<StopIcon />` in front); `busy` (spinner in front); does not shrink when the text changes (keeps its larger width); `className`; the rest, including `ref`, goes to the `<button>` | `<Button variant="primary" busy={saving} onClick={save}>{t("x.save")}</Button>` |
| `IconButton` | Square button with only an icon | `active`, `small`, `label` (goes to `aria-label` and `title`; an explicit `title` replaces it), `className`, the rest goes to the `<button>` | `<IconButton active={open} title={t("x.settings")} onClick={toggle}><SlidersIcon /></IconButton>` |
| `LinkButton` | Button that looks like a link | `className`, the rest goes to the `<button>` | `<LinkButton onClick={onBack}>{t("notes.back")}</LinkButton>` |
| `Switch` | Toggle switch | `checked`, `onChange(bool)`, `label`, `disabled`, `className`, `title`. Without `label` it is rendered as a `<span>`, to go inside another label (Settings rows) | `<Switch checked={on} onChange={setOn} label={t("x.showSource")} />` |
| `Select` | Dropdown for settings and notes | `value`, `onChange(value)`, `options: {value, label}[]`, `label` (goes to `aria-label`), `disabled`, `className` | `<Select value={lang} onChange={setLang} options={langs} />` |
| `TextField` | Single-line text field (settings) | `value`, `onChange(value)`, `onCommit()` (on Enter or on leaving the field), `label` (goes to `aria-label`), `placeholder`, `maxLength`, `disabled`, `className` | `<TextField value={name} onChange={setName} onCommit={save} placeholder={t("x.name")} />` |
| `Menu`, `MenuItem`, `MenuSeparator` | Dropdown menu under a button | `Menu`: `align` (`"start"` \| `"end"`), `className`, the rest goes to the `<div>` (`role="menu"`). `MenuItem`: `danger`, the rest goes to the `<button>` | `<Menu align="end" role="menu"><MenuItem onClick={x}>{t("x")}</MenuItem></Menu>` |
| `PageHeader` | Large page title, inside its column and aligned with the content (Notes, Settings) | `title`, `subtitle` (gray, below), `children` (on the right: filters, actions) | `<PageHeader title={t("notes.title")} subtitle={count}><Select … /></PageHeader>` |
| `useDismiss` | Closes something open when clicking outside or pressing Escape | `useDismiss(open, onClose)`. Whoever opens it for its own click uses `e.stopPropagation()` | `useDismiss(menuOpen, () => setMenuOpen(false));` |
| `ConfirmDialog` | Own confirmation (not `window.confirm`) | `title`, `body`, `confirmLabel`, `cancelLabel`, `danger`, `onConfirm`, `onCancel`. Focus goes to Cancel; Escape and clicking outside cancel | `<ConfirmDialog danger title={…} body={…} confirmLabel={…} cancelLabel={…} onConfirm={del} onCancel={close} />` |
| `ErrorBoundary` | Catches a render error and shows a notice with a reload button instead of a blank window; the error goes to the log | `title`, `body`, `reloadLabel`, `children` | `<ErrorBoundary title={t("errorBoundary.title")} body={t("errorBoundary.body")} reloadLabel={t("errorBoundary.reload")}>…</ErrorBoundary>` |
| `Badge` | Small label next to a title | `children` | `<Badge>{t("notes.badge.summary")}</Badge>` |
| `Spinner` | Wait indicator | `small` | `<Spinner small />` |
| `SearchBox` | Search field with a magnifying glass | `value`, `onChange(value)`, `placeholder` (also `aria-label`), `shortcut`, `inputRef`, `className`. Escape clears it | `<SearchBox value={q} onChange={setQ} placeholder={t("notes.search")} shortcut="⌘K" />` |
| `Segmented` | Single-choice buttons | `value`, `onChange(value)`, `options: {value, label, hint?, disabled?}[]`, `small` | `<Segmented value={mode} onChange={setMode} options={modes} />` |
| `cx` | Joins classes and removes the empty ones | `cx(...names)` | `className={cx(styles.item, open && styles.isOpen)}` |
| Icons (`icons.jsx`) | The UI icons, each with its own size | no props | `<CopyIcon />` |

Icons: `WaveIcon`, `NoteIcon`, `MenuIcon`, `CloseIcon`, `SettingsIcon`,
`LockIcon`, `SearchIcon`, `MoreIcon`, `CopyIcon`, `ChevronIcon`, `SwapIcon`,
`ArrowIcon`, `FloatIcon`, `SlidersIcon`, `PlayIcon`, `StopIcon`,
`VolumeIcon`. The diagnostics status marks (✓, ✕, !) are specific to
`Diagnostics`.

## CSS

**Modules.** Each component imports its CSS as a module and uses its classes
from there:

```jsx
import styles from "./styles.module.css";
<div className={cx(styles.noteItem, open && styles.isOpen)} />
```

In CSS, names keep hyphens (`.note-item`). In JS they go in camelCase
(`styles.noteItem`), as lodash's `camelCase` does:
`lane-local_to_remote` → `styles.laneLocalToRemote`. Call the import
`styles`, not `s`: several screens use `s` as a variable.

**Global styles** are in `src/styles.css`: variables (`--n-*`, `--control-h`…),
reset, elements, `@keyframes`, the structure of the screens (`app`,
`topbar`, `brand`, `notes-scroll`, `prefs-section`, `prefs-row`, `field`…) and
the classes shared by several components (`muted`, `notes-error`, `link`,
`spinner`, `live-dot`, the transcript `note-line`…). In JSX they are written as
plain text: `className="muted"`. Captions is also global, in
`Captions/styles.css`.

**Inside a module:**

- A global class is written `:global(.muted)`.
- Animations use global `@keyframes`: `animation: global(fade-in) 0.15s`.
  Without `global()`, Vite adds the module suffix and the animation doesn't exist.
- To place a component from outside, pass it one of your own classes through
  `className` and write the rule with it. Classes from another module cannot
  be named.
- If that rule has to win just as before, keep the specificity
  (for example `.lane-save.lane-save`, with the class twice) and say so in a
  comment.

## Checking the CSS

`scripts/css-check.mjs` compares the bundled CSS with the CSS from before the
refactor (`docs/refactor/styles.original.css`):

```
LINGORA_CSS_CHECK=1 npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
```

With `LINGORA_CSS_CHECK=1` each module class comes out as `name__Folder`, so
you can compare without the suffix and know which module it belongs to. The
script warns if:

1. a rule was lost or duplicated;
2. two rules that can match the same element changed order and the final value
   of some property changes (it simulates the element's cascade);
3. a module and its `index.jsx` don't match (`styles.something` that doesn't
   exist, or a class nobody uses);
4. a global class is no longer written in any `.jsx`.

It also uses `docs/refactor/renames.json` (the selectors that were rewritten
when moving to modules, only valid with the same specificity) and
`docs/refactor/jsx.original/` (which classes went together on each element).

It is meant for **moving** CSS without changing the result. If you change CSS
on purpose, it will warn about that rule: that is expected. For another
move-only refactor, a new reference has to be made first.
