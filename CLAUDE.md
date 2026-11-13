# Lingora: guía para agentes

Lee esto antes de cambiar nada. Resume lo que costó mucho afinar y las
decisiones que el usuario ya tomó. Si una tarea choca con algo de aquí,
**para y pregunta**; no lo "mejores" por tu cuenta.

Lingora es una app de escritorio (Tauri 2 + React, sin TypeScript) para Mac
que traduce en vivo vídeos y llamadas, y guarda notas con resumen. Todo se
procesa en el Mac: la escucha, la traducción, la voz y la distinción de
personas.

---

## 1. No tocar lo afinado

Costó muchas horas de pruebas con audio real. No cambies, "limpies",
reorganices ni renombres nada de esto, aunque parezca mejorable:

- **`src/utils/audio.js` entero:** VAD, cortes de frase, `FILLER`, `LONE_NOD`,
  umbrales y tiempos.
- **`src/components/Captions` y `src/pages/FloatingCaptions`:** ritmo de
  palabras, animaciones y recortes. Captions es un módulo CSS: la ventana
  flotante es su variante `floating`, App cambia el tamaño con
  `--captions-size` y LaneCard la coloca con `className`. El pie de lo que
  se oye es `components/LiveStatus` (también en Tomar notas).
- **El flujo de la traducción en vivo** (antes en `src/App/index.jsx`; se
  movió tal cual, sin cambiar la lógica):
  - `speedFor`, `MAX_VOICE_LAG_SECS` y `trimSilence`, en `src/utils/voice.js`
    (este último lo comparte con la prueba de voz);
  - el corte en frases para la voz (`phraseSplitter`, `splitAtSentenceEnd`,
    sus largos y separadores), en `src/utils/phrases.js`;
  - el flujo `enqueue` / `texted` / `playback`, `start` y `stop`, en
    `src/hooks/useTranslationPipeline.js`;
  - las claves de `localStorage` que ya existen (`lingora.*`, casi todas en
    `src/utils/prefs.js` y `src/utils/notePrefs.js`): no las renombres, se
    perderían los ajustes de quien ya usa la app (`prefs.test.js` lo vigila).
- **«No tocar» protege el comportamiento, no el sitio.** Lo que no se cambia
  son los valores, los tiempos y la lógica afinados. Mover ese código a otro
  archivo para ordenar está permitido si queda idéntico (compruébalo con un
  diff) y se avisa de que hay que probarlo con audio real.
- **En `src/utils/speakers.js`:** `createSpeakerTracker` y sus constantes
  (`SAME_SPEAKER = 0.5`, `SHORT_SECS`, `NEW_SPEAKER_SECS`, `MIN_SHARE`,
  `MERGE`, el repaso `refine()`). Se afinaron con una entrevista real de
  55 min (2 personas: 94 % bien) y voces sintéticas (100 %).
- **El agrupado en párrafos:** `paragraphs` en `src/utils/notes.js` y en
  `src-tauri/src/notes.rs` aplican las mismas reglas (cambio de persona,
  pausa de más de 12 s, más de 700 caracteres). Si cambias una, cambia la
  otra. Las dos se prueban con los mismos casos
  (`tests/fixtures/paragraphs.json`): `pnpm test` y `cargo test`.
- **En `src-tauri/src`:** `audio.rs`, `system_audio.rs`, `listener.rs`,
  `translator.rs`, `tts.rs`, `pipeline.rs`, `phonemizer.rs`,
  `system_voice.rs`, `speakers.rs`, `models.rs`, `doctor.rs` y `config.rs`.
  Hilos, temperaturas, `silence_scale`, velocidades, tiempos y modelos se
  quedan igual.
- **`src/pages/Welcome`, `src-tauri/tauri.conf.json` y la firma.**
- **Dependencias:** no añadas paquetes de npm ni crates sin preguntar.

Si una tarea necesita tocar algo de esta lista, explica por qué y espera el
sí.

**Ninguna regla de esta guía es inamovible.** El proyecto usa siempre la
solución estándar y recomendada, sin rodeos para esquivar una regla. Si lo
correcto implica tocar algo protegido o añadir una dependencia, propónlo. En
lo importante, di qué archivo cambia, qué podría afectar y qué se gana (pros y
contras), y el usuario decide. Antes de recomendar algo, compruébalo (su
documentación o su código).

---

## 2. Cómo trabajar

- **Rust reinicia la app.** `pnpm tauri dev` vigila `src-tauri`: cualquier
  cambio ahí recompila y reinicia la app de quien está probando, y parece
  que algo se rompió. **Avisa antes** de editar en `src-tauri`, espera la
  señal y junta todos los cambios de Rust en un solo bloque. Para probar
  cosas del backend, usa una copia en otra carpeta, no el proyecto.
- **Confirma antes de lo grande.** Para cambios grandes, primero el plan y
  luego el código.
- **Calidad frente a velocidad.** Los cambios que bajan la latencia sin
  perder calidad, adelante. Los que pierden calidad van detrás de un
  interruptor, con lo preciso por defecto.
- **Al terminar:** `npx vite build`, `pnpm test` y `cargo check` (en
  `src-tauri`) sin errores. Di qué probaste y qué no.
- **Es un repositorio git.** Antes de un cambio grande, comprueba que el
  árbol está limpio (o pide un commit) para poder deshacerlo. Aun así, mira
  bien antes de borrar o sobrescribir.
- **No borres** modelos descargados, notas guardadas ni archivos de prueba
  sin que te lo pidan.

---

## 3. Decisiones del usuario

- **Todo local.** No añadas llamadas a servicios en la nube. El resumen de
  notas es local por defecto (`summarizer.rs`, Qwen3.5-4B). La única
  excepción: resumir con la **clave de IA del propio usuario**
  (`summary_cloud.rs`), que él activa, recomendada en equipos con menos de
  8 GB, y que pide permiso la primera vez con cada servicio.
  - La clave **nunca** va dentro de la app ni en el código. Vive solo en el
    llavero (`keyring`), una por servicio. `LINGORA_SUMMARY_KEY` es solo un
    respaldo para desarrollo.
  - Los servicios se nombran en la interfaz (OpenAI, Claude…); los modelos,
    no (salvo el campo opcional «modelo»).
- **Sin instalar programas.** Quien usa la app no debe instalar nada aparte
  de ella (ni Node, ni Homebrew, ni programas externos). Lo que falte se
  integra en la app o se descarga desde ella.
- **Nada de nombres de modelos en la interfaz** ("Parakeet", "Kokoro",
  "HY-MT2", "Index-Translate", "qwen", "ERes2Net"…). Usa textos genéricos: "la escucha", "la
  voz", "el resumen", "un modelo pequeño", salvo en Ajustes → Acerca de →
  Licencias de terceros, donde las licencias obligan a citarlos.
- **Interfaz en español neutro.** Los textos de la interfaz van en
  `src/i18n/es` y `en` (con `t()`).
- **Comentarios y documentación en inglés.** Comentarios del código,
  README y `docs/` en inglés, con el estilo y la densidad del código de
  alrededor (JSDoc en JS, `///` en Rust). Los nombres de funciones, claves y
  variables ya están en inglés y no se tocan.
- **La voz y la velocidad se quedan en la tarjeta del carril**, a mano. En
  Ajustes solo van los dispositivos, la apariencia (tema claro u oscuro), las
  notas, el diagnóstico y la grabación
  de «Tu voz» (Ajustes → Hablar); elegir «Tu voz» se hace en la tarjeta.
- **Diseño:** estilo shadcn / Sembly, sobrio. Reutiliza las variables
  `--n-*` de `src/styles.css`. Lo nuevo va en el `styles.module.css` de su
  componente (CSS Modules: las clases de uno no pisan las de otro). Dentro
  de los módulos se conservan los nombres de clase que ya existen.
- **Componentes:** usa los de `src/components/shared/` (catálogo en
  `docs/componentes.md`). Si no existe lo que necesitas, créalo ahí, con su
  JSDoc y su fila en el catálogo, en vez de escribirlo dentro de la
  pantalla. Cada componente va en su carpeta: `Nombre/index.jsx` y su CSS en
  `Nombre/styles.module.css`, nunca como `Nombre.jsx` suelto.
  `src/styles.css` es solo para lo general.
- **Carpetas:** `src/pages/` (pantallas; `Home` es la que abre la app), `src/components/` (piezas de una
  pantalla o de varias) y `src/components/shared/` (las básicas),
  `src/utils/` (lo que no es interfaz: `api`, `audio`, `notes` (la nota como datos), `notePrefs`, `noteRecorder`, `speakers`, `words`,
  `lanes`, `voice`, `phrases`, `echo`, `route`, `prefs`, `noteList`, `multiVoice`, `speechQueue`, `summarySource`), `src/hooks/` (hooks propios de React,
  `useAlgo.js`) y `src/App/` (el armazón y Traducir, solo une las piezas: la
  traducción en vivo está en `hooks/useTranslationPipeline`, la nota en curso en
  `hooks/useNoteRecorder` y los carriles en `resolveLanes` de `utils/lanes`; la cabecera y la
  tarjeta de cada carril están en `components/TopBar` y
  `components/LaneCard`, y los tipos en `App/types.js`).
- **Imports:** nada de `../`. Entre carpetas se usan los alias `@app`,
  `@pages`, `@components` (lo básico es `@components/shared`), `@utils`,
  `@hooks` e `@i18n` (en `vite.config.js` y `jsconfig.json`; si añades uno,
  en los dos). Dentro del mismo componente, `./` (p. ej.
  `./styles.module.css`).
- **Código modular.** Lo nuevo no se amontona en un archivo (sobre todo en
  `App/index.jsx`): las funciones puras van exportadas en `src/utils/`, la
  lógica con estado en un hook de `src/hooks/` y la interfaz en su
  componente. Arquitectura limpia, piezas reutilizables.

---

## 4. Dónde está cada cosa

- `docs/problemas-conocidos.md`: fallos reales del audio de macOS, con su
  causa y arreglo. Míralo antes de depurar audio.
- `docs/aislamiento-audio.md`: cómo se aísla la voz (captura sin Lingora,
  micrófono, detección de voz, filtros, eco, personas) y la cancelación de
  eco del micrófono (`echo_cancel.rs`).
- `docs/plan-notas.md`: notas, resumen y personas (hecho).
- `docs/plan-tomar-notas.md`: el modo "Tomar notas" (en curso).
- `docs/plan-componentes.md`: componentes reutilizables y CSS Modules (hecho;
  lo que quedó, en su «Pendiente»).
- `docs/componentes.md`: catálogo de `src/components/shared/` y las reglas
  del CSS.
- `docs/plan-distribucion.md` y `docs/plan-idiomas.md`: lo que falta para
  distribuir y los idiomas.
- `docs/plan-autonomia.md`: quitar lo que aún depende de Homebrew o de la
  nube (llama.cpp y espeak-ng dentro de la app, resumen local hecho, firma).
- `docs/plan-windows.md`: lo que falta para Windows (solo plan).
- `docs/plan-tu-voz.md`: «Tu voz», Hablar con la voz propia clonada (hecho;
  solo inglés, falta probarlo en una llamada real).
- `docs/plan-voz-ligera.md`: la voz ligera (Piper) para equipos modestos y
  los idiomas sin voz natural (motor e interfaz hechos; faltan más idiomas).
- `docs/plan-plantillas-resumen.md`: plantillas de resumen (fase 1 hecha;
  las plantillas propias, en su fase 2).
- `docs/plan-resumen-nube.md`: resumir con la clave de IA del propio usuario
  (opcional; recomendado en equipos con poca RAM). Hecho; falta probar cada servicio.
- `docs/plan-chat.md`: chat con una nota y con todas (fases 1 y 2). El motor
  está hecho en `src-tauri/src/chat/` (modelo cargado, respuesta en directo,
  reutiliza lo leído, nube con streaming): úsalo tal cual. Fase 1 (chat con
  una nota: pestaña «Chat» de la nota, `chat/prompt.rs`, `chat/search.rs`,
  `chat/commands.rs`, banco de preguntas en `chat/bench.rs`) hecha; falta
  probarla a mano y ampliar el banco. Fase 2 (página «Chat» con todas las
  notas: `chat/all.rs`, `chat/query.rs`, el índice en `chat/search.rs`, chats
  guardados en `chat/store.rs`; `pages/Chat`, `hooks/useNotesChat`) hecha;
  falta probarla a mano. Premisa: el usuario nombra persona, tema o fecha; si
  la pregunta es ambigua, el chat pregunta en vez de adivinar.
- `docs/plan-creditos.md`: la pantalla de licencias de terceros (hecho; lo que quedó, en su «Pending»).
- `docs/plan-inicio.md`: pantalla de inicio y modo claro (hechos, con la fila «Apariencia» en Ajustes). Los colores son variables (`:root` oscuro, claro bajo `data-theme`): no escribas colores literales en los CSS.
- `docs/i18n.md`: la interfaz multilingüe (es/en incluidos, el resto se genera
  con el modelo local). **Todo texto nuevo de la interfaz va con `t()` y su
  clave en `src/i18n/es/` y `en/`**; no escribas texto fijo en los componentes.
- `README.md`: cómo arrancar y las variables de entorno.
- `marketing/lingora-base-conocimiento.md`: base de conocimiento para
  marketing (en español; se sube a un proyecto de Claude). Si cambia algo que
  vea el usuario (funciones, idiomas, modelos, privacidad, requisitos o lo
  pendiente de los planes), actualízalo también.

**Datos que conviene saber:**

- El audio del Mac se captura con un "process tap" de Core Audio
  (`system_audio.rs`), sin BlackHole. Se excluye el propio proceso para que
  la voz traducida no vuelva a entrar.
- La escucha europea detecta el idioma frase a frase. El código de idioma
  que se le pasa solo elige el motor.
- Los modelos se descargan en `~/Library/Application Support/lingora/models/`
  y se liberan tras 3 minutos sin uso.
- En las notas, `speaker: 0` es "Yo" (el micrófono) y las demás personas
  empiezan en 1.
