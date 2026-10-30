# Componentes y CSS

Antes de escribir un botón, un interruptor o un menú dentro de una pantalla,
mira aquí. Si no está lo que necesitas, créalo en `src/components/shared/`
con su JSDoc y añade su fila a esta tabla.

## Carpetas

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

Cada componente vive en su carpeta: `Nombre/index.jsx` y su CSS en
`Nombre/styles.module.css`. Nunca `Nombre.jsx` suelto.

## Catálogo

Todo se importa de `src/components/shared` (`import { Button } from "../components/shared"`).
Los textos llegan por props, ya traducidos con `t()`.

| Componente | Para qué | Props | Ejemplo |
|---|---|---|---|
| `Button` | Botón de notas y ajustes (estilo shadcn) | `variant`: `"default"` \| `"primary"` \| `"danger"` \| `"stop"` (con `<StopIcon />` delante); `busy` (spinner delante); `className`; el resto, incluido `ref`, al `<button>` | `<Button variant="primary" busy={saving} onClick={save}>{t("x.save")}</Button>` |
| `IconButton` | Botón cuadrado con solo un icono | `active`, `small`, `label` (a `aria-label` y `title`; un `title` propio lo sustituye), `className`, el resto al `<button>` | `<IconButton active={open} title={t("x.settings")} onClick={toggle}><SlidersIcon /></IconButton>` |
| `LinkButton` | Botón con aspecto de enlace | `className`, el resto al `<button>` | `<LinkButton onClick={onBack}>{t("notes.back")}</LinkButton>` |
| `Switch` | Interruptor | `checked`, `onChange(bool)`, `label`, `disabled`, `className`, `title`. Sin `label` se pinta como `<span>`, para ir dentro de otra etiqueta (filas de Ajustes) | `<Switch checked={on} onChange={setOn} label={t("x.showSource")} />` |
| `Select` | Desplegable de ajustes y notas | `value`, `onChange(value)`, `options: {value, label}[]`, `label` (a `aria-label`), `disabled`, `className` | `<Select value={lang} onChange={setLang} options={langs} />` |
| `TextField` | Campo de texto de una línea (ajustes) | `value`, `onChange(value)`, `onCommit()` (Enter o al salir), `label` (a `aria-label`), `placeholder`, `maxLength`, `disabled`, `className` | `<TextField value={name} onChange={setName} onCommit={save} placeholder={t("x.name")} />` |
| `Menu`, `MenuItem`, `MenuSeparator` | Menú desplegable bajo un botón | `Menu`: `align` (`"start"` \| `"end"`), `className`, el resto al `<div>` (`role="menu"`). `MenuItem`: `danger`, el resto al `<button>` | `<Menu align="end" role="menu"><MenuItem onClick={x}>{t("x")}</MenuItem></Menu>` |
| `useDismiss` | Cierra algo abierto al pulsar fuera o con Escape | `useDismiss(open, onClose)`. Quien lo abre para su propio clic con `e.stopPropagation()` | `useDismiss(menuOpen, () => setMenuOpen(false));` |
| `ConfirmDialog` | Confirmación propia (no `window.confirm`) | `title`, `body`, `confirmLabel`, `cancelLabel`, `danger`, `onConfirm`, `onCancel`. Foco en Cancelar, Escape y pulsar fuera cancelan | `<ConfirmDialog danger title={…} body={…} confirmLabel={…} cancelLabel={…} onConfirm={del} onCancel={close} />` |
| `Badge` | Etiqueta pequeña junto a un título | `children` | `<Badge>{t("notes.badge.summary")}</Badge>` |
| `Spinner` | Rueda de espera | `small` | `<Spinner small />` |
| `SearchBox` | Buscador con lupa | `value`, `onChange(value)`, `placeholder` (también `aria-label`), `shortcut`, `inputRef`, `className`. Escape lo vacía | `<SearchBox value={q} onChange={setQ} placeholder={t("notes.search")} shortcut="⌘K" />` |
| `Segmented` | Botones de opción única | `value`, `onChange(value)`, `options: {value, label, hint?, disabled?}[]`, `small` | `<Segmented value={mode} onChange={setMode} options={modes} />` |
| `cx` | Junta clases y quita las vacías | `cx(...nombres)` | `className={cx(styles.item, open && styles.isOpen)}` |
| Iconos (`icons.jsx`) | Los iconos de la interfaz, cada uno con su tamaño | sin props | `<CopyIcon />` |

Iconos: `WaveIcon`, `NoteIcon`, `MenuIcon`, `CloseIcon`, `SettingsIcon`,
`LockIcon`, `SearchIcon`, `MoreIcon`, `CopyIcon`, `ChevronIcon`, `SwapIcon`,
`ArrowIcon`, `FloatIcon`, `SlidersIcon`, `PlayIcon`, `StopIcon`,
`VolumeIcon`. Los de estado del diagnóstico (✓, ✕, !) son propios de
`Diagnostics`.

## CSS

**Módulos.** Cada componente importa su CSS como módulo y usa sus clases
desde ahí:

```jsx
import styles from "./styles.module.css";
<div className={cx(styles.noteItem, open && styles.isOpen)} />
```

En el CSS los nombres siguen con guiones (`.note-item`). En JS van en
camelCase (`styles.noteItem`), como el `camelCase` de lodash:
`lane-local_to_remote` → `styles.laneLocalToRemote`. Llama al import
`styles`, no `s`: varias pantallas usan `s` como variable.

**Lo global** está en `src/styles.css`: variables (`--n-*`, `--control-h`…),
reset, elementos, `@keyframes`, la estructura de las pantallas (`app`,
`topbar`, `brand`, `notes-scroll`, `prefs-section`, `prefs-row`, `field`…) y
las clases que comparten varios componentes (`muted`, `notes-error`, `link`,
`spinner`, `live-dot`, la transcripción `note-line`…). En el JSX van como
texto: `className="muted"`. Captions también es global, en
`Captions/styles.css`.

**Dentro de un módulo:**

- Una clase global se escribe `:global(.muted)`.
- Las animaciones usan `@keyframes` globales: `animation: global(fade-in) 0.15s`.
  Sin `global()`, Vite le pone el sufijo del módulo y la animación no existe.
- Para colocar un componente desde fuera, pásale una clase tuya por
  `className` y escribe la regla con ella. Las clases de otro módulo no
  se pueden nombrar.
- Si esa regla tiene que ganar igual que antes, mantén la especificidad
  (por ejemplo `.lane-save.lane-save`, con la clase dos veces) y dilo en un
  comentario.

## Comprobar el CSS

`scripts/css-check.mjs` compara el CSS empaquetado con el de antes del
refactor (`docs/refactor/styles.original.css`):

```
LINGORA_CSS_CHECK=1 npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
```

Con `LINGORA_CSS_CHECK=1` cada clase de módulo sale como `nombre__Carpeta`,
para comparar sin el sufijo y saber de qué módulo es. El script avisa si:

1. una regla se perdió o se duplicó;
2. dos reglas que pueden caer en el mismo elemento cambiaron de orden y el
   valor final de alguna propiedad cambia (simula la cascada del elemento);
3. un módulo y su `index.jsx` no casan (`styles.algo` que no existe, o una
   clase que nadie usa);
4. una clase global ya no está escrita en ningún `.jsx`.

Usa además `docs/refactor/renames.json` (los selectores que se
reescribieron al pasar a módulos, solo válidos con la misma especificidad)
y `docs/refactor/jsx.original/` (qué clases iban juntas en cada elemento).

Sirve para **mover** CSS sin cambiar el resultado. Si cambias CSS a
propósito, avisará de esa regla: es lo esperado. Para otro refactor solo
de mover, hay que hacer antes una referencia nueva.
