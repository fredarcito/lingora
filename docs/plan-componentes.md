# Plan: componentes reutilizables de la interfaz

> **Estado (2026-10-29): hecho.** Con tres cambios que el usuario decidió
> sobre la marcha: CSS Modules en vez de CSS global
> («CSS Modules»), carpetas `pages/`, `components/`, `components/shared/` y
> `utils/` en vez de `src/` y `src/ui/` («Carpetas finales») y el orden de
> las fases («Cómo se hizo»). Lo que no encajó está en «Pendiente». El
> catálogo y las reglas que quedan, en `docs/componentes.md`.

**Para quien lo implemente:** lee antes `CLAUDE.md`. Este plan es un
refactor: **la app tiene que verse y comportarse exactamente igual** antes y
después. Si algo de aquí choca con `CLAUDE.md`, para y pregunta.

## Por qué

Cada pantalla hace a mano sus botones, interruptores, menús, diálogos e
iconos. Funciona, pero:

- **Lo mismo se escribe varias veces:**
  - hay tres diálogos de confirmación casi iguales;
  - dos menús, cada uno con su propio «cerrar al pulsar fuera»;
  - `const svg = {…}` está copiado en tres archivos.
- **Cada cosa nueva acaba con su propio estilo.** El interruptor de la
  tarjeta del carril necesitó CSS propio porque en ese fondo no se veía.
- **Cuesta saber qué usar** al añadir algo, porque no hay un sitio donde
  mirar.

Objetivo: una carpeta `src/ui/` con los componentes básicos, el código
existente usándolos y una regla en `CLAUDE.md` para que lo nuevo los use (o
los amplíe) en vez de reinventarlos.

## Estructura (decisión del usuario)

Todo componente, sea pantalla o pieza de `src/ui/`, vive en **su carpeta**,
nunca como archivo suelto (`Captions.jsx`):

```
src/ui/Button/index.jsx      el componente
src/ui/Button/styles.css     su CSS, importado desde index.jsx
src/Notes/index.jsx
src/Notes/styles.css
```

- Esto vale también para las pantallas que ya existen: App, Notes,
  NoteTaking, Settings, Sidebar, Diagnostics, LanguagePicker, LangOffer,
  SummaryKey y Markdown.
- **Captions, FloatingCaptions y Welcome también**, con el sí del usuario,
  aunque están en la lista de «no tocar»: **solo se mueven**, su código no
  cambia ni una línea, salvo las rutas de import si hiciera falta.
- Los archivos que no son componentes (`notes.js`, `api.js`, `audio.js`,
  `words.js`, `i18n/`) se quedan donde están.
- Si un componente tiene subcomponentes que solo usa él (por ejemplo
  `SpeakerBar` o `Transcript` en Notes), pueden quedarse en su `index.jsx`.
  Si otro archivo los usa, van a su propia carpeta.
- Los imports `./Notes` siguen funcionando, porque Vite resuelve
  `Notes/index.jsx`. Los que llevan extensión (`./Notes.jsx`,
  `./Segmented.jsx`) hay que cambiarlos.

## Carpetas finales (decisión del usuario, 2026-10-29)

Sustituye a lo de arriba en cuanto a dónde va cada cosa:

```
src/App/                 el armazón y Traducir (separarlos tocaría su lógica)
src/pages/               Notes, NoteTaking, Settings, Welcome, FloatingCaptions
src/components/          Captions, Diagnostics, LangOffer, LanguagePicker,
                         Markdown, Sidebar, SummaryKey
src/components/shared/   lo que el plan llama `src/ui/`
src/utils/               api.js, audio.js, notes.js, words.js (sin cambios
                         dentro, salvo la ruta de `i18n` en notes.js)
src/i18n/                igual
```

Con `pages/Notes` y `utils/notes.js` en carpetas distintas desaparece el
choque de macOS entre `./Notes` y `notes.js`.

## Cómo se hizo

Con módulos, el orden de las fases cambió: si `.note-action` pasa al módulo
de `Button` mientras una pantalla aún escribe `className="note-action"`,
esa pantalla se queda sin estilo. Así que:

1. **Fase 1:** las piezas de `ui` se crearon pintando las clases globales de
   siempre.
2. **Fase 2:** cada pantalla pasó a su carpeta y a su módulo, usando las
   piezas; lo de `ui` que nombraba su CSS, con `:global()`.
3. **Fase 2b:** cada pieza pasó a su módulo cuando todas las pantallas la
   usaban, y las reglas que cruzaban se reescribieron (ver
   `docs/refactor/renames.json`).

Tras cada paso, `npx vite build` y `scripts/css-check.mjs` en «Bien». El
script se probó y se amplió antes de empezar y durante el refactor (cada
ampliación, probada con copias del CSS estropeadas a propósito): `@media` y
`@container` en el orden, clases que van juntas en un elemento (según
`docs/refactor/jsx.original/`), módulos (`nombre__Carpeta`), simulación de
la cascada para los pares que cambian de orden y clases globales que ya no
escribe nadie.

## CSS Modules (decisión del usuario, 2026-10-29)

Cada componente lleva su CSS en un **módulo**, para que las clases de uno no
pisen las de otro. Esto sustituye a lo de «mismas clases» de más abajo:

- **Archivos:** `Nombre/styles.module.css`, importado como
  `import s from "./styles.module.css"`, y `className={s.noteAction}`.
  Dentro del CSS los nombres **no cambian** (`.note-action`), así el CSS solo
  cambia de archivo. Para juntar clases, un `cx()` de una línea en
  `src/ui/cx.js` (sin dependencias).
- **`vite.config.js`:** `css.modules` con `localsConvention: "camelCaseOnly"`
  y `generateScopedName` `[local]_[hash:base64:5]` (en el inspector se sigue
  leyendo `note-action_x7f2a`). Con `LINGORA_CSS_CHECK=1` usa `[local]`, para
  que `css-check` compare los mismos selectores que el original.
- **Lo que sigue global**, en CSS normal:
  - `src/styles.css`: `:root`, reset, elementos, `@keyframes`, estructura y
    las clases de utilidad que usan muchos archivos (`muted`, `error`,
    `small`…);
  - nada más: **Captions, FloatingCaptions y Welcome también van con
    módulo** (el usuario lo aprobó). En ellos solo cambian los `className`;
    ritmo, animaciones, recortes y lógica no se tocan.
- **Reglas que cruzan componentes** (`.dialog .note-action.danger`,
  `.speaker-menu .note-action.primary`, `.notes-switch.lane-save`; unas 20):
  el de fuera pasa una clase suya por `className` y la regla se reescribe con
  ella, **con la misma especificidad**. Cada cambio de selector se apunta en
  `docs/refactor/renames.json` (viejo → nuevo); `css-check` lo acepta solo si
  la especificidad coincide.
- **`css-check` comprueba además** que cada clase de un módulo la use su
  `index.jsx` y que cada `s.algo` exista en el módulo (si no, sale
  `class="undefined"` sin error).
- **App.jsx:** cambian los `className` de todo su JSX, no solo cabecera,
  `LaneCard` y `VoiceControls`. La lógica sigue sin tocarse.
- **CLAUDE.md:** «No cambies las clases que ya existen» pasa a ser: los
  nombres de clase se conservan dentro de los módulos.

## Mover el CSS (decisión del usuario: en este refactor)

> Con CSS Modules, donde abajo dice `styles.css` de un componente léase
> `styles.module.css`; el orden sigue importando igual.

`src/styles.css` se queda solo con lo general: variables de `:root`, reset,
estilos de elementos (`button`, `select`, `input`), `@keyframes` y
estructura de la app. Lo de cada componente va a su `styles.css`.

**El riesgo es el orden.** Cuando dos reglas tienen la misma especificidad,
gana la que va después. Muchas clases tienen reglas repartidas por
`styles.css`: `.note-action` aparece en 5 o 6 sitios, `.note-summary` en 3,
y hay una sección que redefine el alto de todos los controles
(`--control-h`). Si una regla cambia de posición, otra puede ganar y algo
cambia de aspecto sin dar error. Para evitarlo:

1. **Antes de empezar,** copia `src/styles.css` a
   `docs/refactor/styles.original.css`. No hay git: es la única referencia.
2. **En `main.jsx`,** el import de `./styles.css` pasa a ser **el primero**.
   Hoy va el último, y Vite pone el CSS de cada archivo en el orden en que
   se importa. Así lo general va antes que lo de cada componente.
3. **Un componente se lleva todas sus reglas a la vez**, en el mismo orden
   en que estaban, incluidas las de `@media` y las de las secciones
   «generales» que lo nombran. Una regla agrupada como
   `.note-action, .taking-start, .pair { … }` se parte y cada trozo va con su
   componente.
4. **Una regla que mezcla dos componentes** (`.dialog .note-action.danger`,
   `.speaker-menu .note-action.primary`) va con el de fuera: el diálogo o la
   página de la nota.
5. **Comprueba con `scripts/css-check.mjs`** después de cada componente:

   ```
   npx vite build --minify false --outDir /tmp/lingora-css --emptyOutDir
   node scripts/css-check.mjs docs/refactor/styles.original.css /tmp/lingora-css/assets/*.css
   ```

   Avisa si una regla se perdió o se duplicó, o si dos reglas que pueden
   pisarse cambiaron de orden. **Ese script está sin probar.** Antes de
   mover nada, ejecútalo contra el CSS actual: tiene que decir «Bien». Si
   falla o da falsos avisos, arréglalo primero. Si avisa de un orden, no lo
   apagues: mueve la regla o deja las dos en el mismo archivo.

## Reglas de este refactor

- **Mismo HTML de salida, mismas clases.** Los componentes generan las
  clases que ya existen (`note-action`, `notes-switch`, `note-menu`,
  `dialog`…). `CLAUDE.md` prohíbe cambiar las clases existentes, y así no
  cambia nada visual. El CSS solo cambia de archivo, no de contenido.
- **No se toca el código de:**
  - `src/Welcome.jsx`, `src/Captions.jsx` y `src/FloatingCaptions.jsx` (solo
    se mueven a su carpeta);
  - `src/audio.js`;
  - en `src/App.jsx`, solo el JSX de `LaneCard`, `VoiceControls` y la
    cabecera. Nada de `enqueue`, `texted`, `playback`, `start`, `stop`, los
    efectos ni las claves `lingora.*`;
  - `createSpeakerTracker` y sus constantes en `src/notes.js`.
- **Sin dependencias nuevas** (ni Radix, ni shadcn como paquete, ni
  librerías de iconos).
- **Sin Rust.** Este plan no toca `src-tauri`.
- **JS con JSDoc**, comentarios y textos en español, con la densidad del
  código de alrededor. Todo texto visible con `t()`; los componentes no
  llevan texto fijo, lo reciben por props.
- **Un archivo migrado = un paso.** Después de cada uno, `npx vite build`
  sin errores.

## Fase 0: preparar

1. Copia `src/styles.css` a `docs/refactor/styles.original.css`.
2. Prueba `scripts/css-check.mjs` contra el CSS actual, como dice «Mover el
   CSS».
3. Pon el import de `./styles.css` el primero en `main.jsx` y comprueba con
   el script que sigue saliendo «Bien».

## Fase 1: crear `src/ui/`

Una carpeta por componente (`index.jsx` + `styles.css`, como dice
«Estructura») y un `src/ui/index.js` que los exporte todos. Cada
componente se lleva su CSS de `styles.css` según «Mover el CSS».

| Componente | Sustituye a | Notas |
|---|---|---|
| `Button` | `<button className="note-action …">` (unas 20 veces) | Props: `variant`: `"default"` \| `"primary"` \| `"danger"`. Además `icon` (solo icono, cuadrado: hoy `note-more` y `note-summary-copy`), `busy` (pone el `spinner small` delante) y el resto pasa al `<button>`. Clases: `note-action`, `primary`, `danger` y las extra que se le pasen en `className`. |
| `IconButton` | `icon-button` (☰, panel flotante, ajustes del carril) | `active` añade `is-active`. `label` va a `aria-label` y `title`. |
| `LinkButton` | `<button className="link …">` | Solo envuelve la clase. |
| `Switch` | `label.notes-switch` + `input[role=switch]` (Ajustes ×2, «Ver original», «Guardar en notas») | Props: `checked`, `onChange(bool)`, `label`, `disabled`, `className`, `title`. Lo que hay en Ajustes (fila con título y ayuda) sigue usando `prefs-row`, con `Switch` dentro. |
| `Select` | `<select className="prefs-select">` y los de `note-summary-lang` | Props: `value`, `onChange(value)`, `options: {value, label}[]`, `label` (a `aria-label`), `disabled`. Los selects de la cabecera (`.pair`) y de `VoiceControls` se quedan como están, porque su CSS depende del contenedor. |
| `Menu` + `useDismiss` | menú ⋯ de la nota y `speaker-menu` | `useDismiss(open, onClose)` cierra al pulsar fuera y con Escape; hoy está escrito dos veces en `Notes.jsx`. `Menu` pinta `note-menu`, con `align="end"` (añade `note-menu-end`); `MenuItem` lleva `danger` (añade `note-menu-danger`); `MenuSeparator` es `<hr className="note-menu-sep">`. |
| `ConfirmDialog` | `ConfirmDelete`, `ConfirmSend` (Notes.jsx), `ConfirmRecord` (NoteTaking.jsx) | Props: `title`, `body`, `confirmLabel`, `cancelLabel`, `danger`, `onConfirm` y `onCancel`. Conserva el foco inicial en Cancelar, Escape para cancelar, pulsar fuera para cancelar y `role="alertdialog"`. El `id` del título con `useId()`. |
| `Badge` | `<span className="badge">` | |
| `Spinner` | `<span className="spinner …" aria-hidden />` | `small` añade `small`. |
| `SearchBox` | `label.notes-searchbox` de la lista de notas | Props: `value`, `onChange`, `placeholder`, `shortcut` (el `⌘K`), `inputRef` y `className`. |
| `Segmented` | `src/Segmented.jsx` | Se mueve a `src/ui/` tal cual. Actualiza los imports. |
| Iconos | las 20 funciones `XxxIcon` y los tres `const svg` | `src/ui/icons.jsx`: un `svgProps` común y cada icono exportado con nombre. Si dos iconos son el mismo dibujo, queda uno. **Copia los `path` exactos**, sin redibujar nada. |

Cada componente con un JSDoc corto: para qué sirve y qué props tiene, al
estilo de `Segmented.jsx`.

## Fase 2: migrar archivo por archivo

En este orden, de menos a más riesgo. Cada pantalla pasa a su carpeta con
su CSS, y tras cada una toca `npx vite build` y `scripts/css-check.mjs`. Al
final van `Captions`, `FloatingCaptions` y `Welcome`: solo moverlos y
llevarse su CSS.

1. `LangOffer.jsx`, `SummaryKey.jsx` y `LanguagePicker.jsx`: botones y
   selects.
2. `Settings.jsx`: interruptores, select y botones.
3. `Sidebar.jsx`: `IconButton` e iconos.
4. `Diagnostics.jsx`: iconos, `LinkButton` y `Spinner`.
5. `NoteTaking.jsx`: botones, `ConfirmDialog` (en lugar de `ConfirmRecord`)
   y `Segmented`.
6. `Notes.jsx`: botones, menú ⋯ con `Menu`/`useDismiss`, `speaker-menu`,
   `ConfirmDialog` ×2, `Switch` de «Ver original», `Select`, `Badge`,
   `SearchBox` e iconos.
7. `App.jsx`, **solo el JSX** de la cabecera, `LaneCard` y `VoiceControls`:
   `IconButton`, `Switch` de «Guardar en notas», `Segmented` e iconos.

Si algo no encaja en un componente sin cambiar cómo se ve, **déjalo como
está** y apúntalo al final de este documento, en «Pendiente». No fuerces el
componente ni cambies el CSS para que encaje.

## Fase 3: la regla y el catálogo

1. Crea `docs/componentes.md`: una tabla con cada componente, para qué es,
   sus props y un ejemplo de una línea.
2. En `CLAUDE.md`, sección 3, apartado **Diseño**, añade:

   > **Componentes:** usa los de `src/ui/` (catálogo en
   > `docs/componentes.md`). Si no existe lo que necesitas, créalo ahí, con
   > su JSDoc y su fila en el catálogo, en vez de escribirlo dentro de la
   > pantalla. Cada componente va en su carpeta: `Nombre/index.jsx` y su
   > CSS en `Nombre/styles.css`, nunca como `Nombre.jsx` suelto.
   > `src/styles.css` es solo para lo general.

   Y cambia la frase de **Diseño** que dice «Lo nuevo va en su propia
   sección al final del CSS»: ahora lo nuevo va en el `styles.css` de su
   componente.

3. En `CLAUDE.md`, sección 4 («Dónde está cada cosa»), añade una línea para
   `src/ui/` y `docs/componentes.md`.

## Cómo comprobarlo

- `npx vite build` sin errores y `scripts/css-check.mjs` en «Bien» después
  de cada archivo. `cargo check` no hace falta, porque no se toca Rust.
- Al terminar, en `src/` no queda ningún `.jsx` suelto salvo `main.jsx`.
- `grep -c 'className="note-action' src/*.jsx` debería quedar en 0 fuera de
  `src/ui/`, salvo lo apuntado en «Pendiente». Lo mismo con
  `role="switch"`, `className="dialog"` y `const svg =`.
- El usuario lo revisa en la app con `pnpm tauri dev`. Dile qué pantallas
  mirar:
  - **Traducir audio:** tarjeta, ajustes del carril e interruptor «Guardar
    en notas».
  - **Tomar notas:** inicio, grabando y el diálogo de confirmar.
  - **Lista de notas:** buscador con ⌘K, filtros y tarjetas.
  - **Página de una nota:** menú ⋯, borrar con su diálogo, el primer
    resumen con su aviso, copiar, las pestañas, «Ver original» y el menú de
    una persona.
  - **Ajustes y Diagnóstico.**
  - **Menú ☰.**

  Los diálogos tienen que seguir con el foco en Cancelar y cerrarse con
  Escape.
- Al terminar, di qué migraste, qué quedó en «Pendiente» y qué no pudiste
  probar.

## Fuera de este plan

- Juntar o limpiar CSS duplicado: por ejemplo, las tres reglas de
  `.note-summary` en una sola. Aquí solo se mueve, sin reescribir. Limpiar
  cambia el resultado y va en otro plan.
- Cambiar el diseño de nada.
- Cambiar el código de Welcome (`welcome-primary`/`welcome-secondary`) o de
  los subtítulos para que usen los componentes nuevos.

## Pendiente

Lo que no encajó sin cambiar el aspecto, o que queda para otro plan:

- **Captions usa CSS global** (`src/components/Captions/styles.css`, no
  módulo). App (`.lane > .captions`), FloatingCaptions (`.floating
  .captions-text`) y Tomar notas (`captions-status`, `live-dot`, `word`)
  le dan estilo desde fuera. Para hacerlo módulo, Captions tendría que
  aceptar clases por props, y eso es cambiar su código más allá de los
  `className`.
- **`.taking-end` sigue global** (`src/styles.css`). En el original, una
  regla posterior de `.note-action` pisa su `background`, así que el botón
  «Ir al final» se ve con el fondo de los botones normales. En un módulo
  iría después y pasaría a verse con `--n-popover`. Su `background` está de
  hecho muerto: decidir cuál se quiere es una decisión de diseño.
- **`LinkButton` y `Spinner` pintan las clases globales `link` y
  `spinner`.** Captions y Bienvenida escriben esas clases directamente, y en
  ellos solo se podían cambiar los `className`, no usar componentes.
- **`Button` no tiene prop `icon`.** El tamaño cuadrado está en `.note-more`
  y `.note-summary-copy` (Notes), mezclado con otras propiedades. Una
  variante genérica necesitaría CSS nuevo.
- **El select de «Resumir en» (`note-summary-lang`) no usa `Select`.** No
  lleva `prefs-select`, y `Select` siempre la pone. Tampoco los de la
  cabecera (`.pair`) ni los de `VoiceControls` y `LaneSettings`, como decía
  el plan.
- **Diagnóstico conserva sus iconos de estado** (`StatusIcon` y su chevron,
  con trazo 2.4): son distintos a los de `icons.jsx`.
- **CSS muerto que sigue en `src/styles.css`**, sin tocar: `.pill`,
  `.pill-bad`, `.dot*`, `.setting-group`, `.setting-pair`,
  `.settings-advanced*`, `.note-toast`, `.notes-tools` y `.note-actions`.
  Ningún JSX las usa. Limpiarlo va en otro plan.
- **Cambios en el HTML sin efecto visible:**
  - Los diálogos usan `useId()` para el título, en vez de `dialog-title`,
    `send-title` y `record-title`.
  - `Spinner` añade `aria-hidden` donde antes no estaba (App y
    Diagnóstico).
  - Ya no se pintan clases sin CSS: `note-original` en «Ver original»,
    `lane-remote_to_local` en la tarjeta y `is-ok` en el diagnóstico.
    `welcome-how`, `is-active` (Bienvenida) y `error` (Diagnóstico) siguen
    como texto.
  - `IconButton` tiene una prop `small` para la regla
    `.icon-button.small`, que ya existía y hoy no usa nadie.
  - El `Chevron` de App, que no se usaba, se quitó con su `const svg`.
