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
  palabras, animaciones y recortes. Captions usa CSS global
  (`Captions/styles.css`), no módulo: App, FloatingCaptions y Tomar notas
  también le dan estilo.
- **En `src/App/index.jsx`:**
  - `speedFor`, `MAX_VOICE_LAG_SECS` y `trimSilence` (este, en
    `src/utils/voice.js`: lo comparte con la prueba de voz);
  - el flujo `enqueue` / `texted` / `playback`, `start` y `stop`;
  - las claves de `localStorage` que ya existen (`lingora.*`): no las
    renombres, se perderían los ajustes de quien ya usa la app.
- **En `src/utils/notes.js`:** `createSpeakerTracker` y sus constantes
  (`SAME_SPEAKER = 0.5`, `SHORT_SECS`, `NEW_SPEAKER_SECS`, `MIN_SHARE`,
  `MERGE`, el repaso `refine()`). Se afinaron con una entrevista real de
  55 min (2 personas: 94 % bien) y voces sintéticas (100 %).
- **El agrupado en párrafos:** `paragraphs` en `src/utils/notes.js` y en
  `src-tauri/src/notes.rs` aplican las mismas reglas (cambio de persona,
  pausa de más de 12 s, más de 700 caracteres). Si cambias una, cambia la
  otra.
- **En `src-tauri/src`:** `audio.rs`, `system_audio.rs`, `listener.rs`,
  `translator.rs`, `tts.rs`, `pipeline.rs`, `phonemizer.rs`,
  `system_voice.rs`, `speakers.rs`, `models.rs`, `doctor.rs` y `config.rs`.
  Hilos, temperaturas, `silence_scale`, velocidades, tiempos y modelos se
  quedan igual.
- **`src/pages/Welcome`, `src-tauri/tauri.conf.json` y la firma.**
- **Dependencias:** no añadas paquetes de npm ni crates sin preguntar.

Si una tarea necesita tocar algo de esta lista, explica por qué y espera el
sí.

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
- **Al terminar:** `npx vite build` y `cargo check` (en `src-tauri`) sin
  errores. Si tocaste CSS, también `scripts/css-check.mjs` (cómo, en
  `docs/componentes.md`). Di qué probaste y qué no.
- **No es un repositorio git.** No hay historial para deshacer: mira bien
  antes de borrar o sobrescribir.
- **No borres** modelos descargados, notas guardadas ni archivos de prueba
  sin que te lo pidan.

---

## 3. Decisiones del usuario

- **Todo local.** No añadas llamadas a servicios en la nube. La única
  excepción es el **resumen de notas**: es opcional, usa la clave de Groq
  del propio usuario y pide su permiso la primera vez.
  - La clave **nunca** va dentro de la app ni en el código. Vive solo en el
    llavero del Mac (`keyring`). `GROQ_API_KEY` es solo un respaldo para
    desarrollo.
- **Sin instalar programas.** Quien usa la app no debe instalar nada aparte
  de ella (ni Node, ni Homebrew, ni programas externos). Lo que falte se
  integra en la app o se descarga desde ella.
- **Nada de nombres de modelos en la interfaz** ("Parakeet", "Kokoro",
  "HY-MT2", "qwen", "ERes2Net"…). Usa textos genéricos: "la escucha", "la
  voz", "el resumen", "un modelo pequeño".
- **Interfaz en español neutro.** Los textos de la interfaz van en
  `src/i18n/es` y `en` (con `t()`).
- **Comentarios y documentación en inglés.** Comentarios del código,
  README y `docs/` en inglés, con el estilo y la densidad del código de
  alrededor (JSDoc en JS, `///` en Rust). Los nombres de funciones, claves y
  variables ya están en inglés y no se tocan.
- **La voz y la velocidad se quedan en la tarjeta del carril**, a mano. En
  Ajustes solo van los dispositivos, las notas y el diagnóstico.
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
- **Carpetas:** `src/pages/` (pantallas), `src/components/` (piezas de una
  pantalla o de varias) y `src/components/shared/` (las básicas),
  `src/utils/` (lo que no es interfaz: `api`, `audio`, `notes`, `words`,
  `lanes`, `voice`, `echo`, `route`), `src/hooks/` (hooks propios de React,
  `useAlgo.js`) y `src/App/` (el armazón y Traducir; la cabecera y la
  tarjeta de cada carril están en `components/TopBar` y
  `components/LaneCard`, y los tipos en `App/types.js`).
- **Código modular.** Lo nuevo no se amontona en un archivo (sobre todo en
  `App/index.jsx`): las funciones puras van exportadas en `src/utils/`, la
  lógica con estado en un hook de `src/hooks/` y la interfaz en su
  componente. Arquitectura limpia, piezas reutilizables.

---

## 4. Dónde está cada cosa

- `docs/problemas-conocidos.md`: fallos reales del audio de macOS, con su
  causa y arreglo. Míralo antes de depurar audio.
- `docs/plan-notas.md`: notas, resumen y personas (hecho).
- `docs/plan-tomar-notas.md`: el modo "Tomar notas" (en curso).
- `docs/plan-componentes.md`: componentes reutilizables y CSS Modules (hecho;
  lo que quedó, en su «Pendiente»).
- `docs/componentes.md`: catálogo de `src/components/shared/`, las reglas
  del CSS y cómo comprobarlo con `scripts/css-check.mjs`.
- `docs/plan-distribucion.md` y `docs/plan-idiomas.md`: lo que falta para
  distribuir y los idiomas.
- `docs/plan-autonomia.md`: quitar lo que aún depende de Homebrew o de la
  nube (llama.cpp y espeak-ng dentro de la app, resumen local, firma).
- `docs/plan-windows.md`: lo que falta para Windows (solo plan).
- `docs/i18n.md`: la interfaz multilingüe (es/en incluidos, el resto se genera
  con el modelo local). **Todo texto nuevo de la interfaz va con `t()` y su
  clave en `src/i18n/es/` y `en/`**; no escribas texto fijo en los componentes.
- `README.md`: cómo arrancar y las variables de entorno.

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
