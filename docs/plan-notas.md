# Plan: notas y resúmenes

Estado: parte A hecha (2026-10-29), con el diseño revisado por Opus y una página Ajustes nueva. Falta la B (Sonnet) y la C (Opus). La parte de
personas (quién habla) la hace Opus aparte; aquí solo se deja el hueco.

Meta: guardar cada conversación en disco, verla en la app, exportarla y
pedir un resumen. Inspiración: la vista de notas de Sembly, pero **mucho más
simple**: una lista y un detalle, sin editor, sin participantes, sin
reproductor ni chat.

---

## 0. Reglas (leer antes de empezar)

**No tocar lo que ya está afinado.** Costó mucho tiempo dejarlo así. No
cambies, "limpies" ni reorganices nada de esto, aunque te parezca mejorable:

- `src/audio.js` entero: VAD, cortes de frase, `FILLER`, `LONE_NOD`, umbrales y tiempos.
- `src/Captions.jsx` y `src/FloatingCaptions.jsx`: ritmo de palabras, animaciones y recortes.
- En `src/App.jsx`: `speedFor`, `MAX_VOICE_LAG_SECS`, `trimSilence`, el flujo
  de `texted` y `playback`, `start` y `stop`, las claves de `localStorage`
  existentes y los ajustes de cada carril (`LaneCard`).
- En `src-tauri/src`: `audio.rs`, `system_audio.rs`, `listener.rs`,
  `translator.rs`, `tts.rs`, `pipeline.rs`, `phonemizer.rs`,
  `system_voice.rs`, `models.rs`, `doctor.rs` y `config.rs` (salvo lo que
  se indica abajo). Hilos, temperaturas, `silence_scale`, velocidades y
  tiempos se quedan igual.
- `src/Welcome.jsx`, `src/Diagnostics.jsx`, `src-tauri/tauri.conf.json` y la firma.
- No añadas dependencias de npm. En Rust solo la de la parte B (`keyring`).

**Cómo trabajar:**

- Comentarios y textos en español, con el mismo estilo y densidad que el
  código de alrededor (JSDoc en JS, `///` en Rust). Interfaz en español neutro.
- Nunca muestres nombres de modelos en la interfaz ("Parakeet", "Kokoro",
  "HY-MT2", "qwen"…). Usa textos genéricos ("el resumen", "la IA").
- Tocar `src-tauri` reinicia la app de quien está probando. **Avisa antes**
  de editar algo ahí y junta los cambios de Rust en un solo bloque.
- La clave de Groq **nunca** va dentro de la app ni en el repositorio.
- Si algo del plan no encaja con el código, para y pregunta. No improvises
  un cambio grande.
- Al terminar cada parte: `npx vite build` y `cargo check` (en `src-tauri`)
  sin errores, y la lista de pruebas a mano de esa parte.

---

## Formato en disco

Una conversación es un archivo JSON en
`~/Library/Application Support/lingora/notes/<id>.json` (la misma carpeta
base que `models_dir()` en `config.rs`). JSON y no texto plano: guarda la
hora, quién habla y el original separado de la traducción. El texto plano
sale al exportar.

```json
{
  "version": 1,
  "id": "2026-10-29_10-32-05",
  "title": "Conversación del 29 oct, 10:32",
  "created_at": "2026-10-29T10:32:05.120Z",
  "ended_at": "2026-10-29T11:07:40.002Z",
  "mode": "video",
  "speakers": {},
  "sentences": [
    {
      "t": 3.4,
      "direction": "remote_to_local",
      "source_lang": "en",
      "target_lang": "es",
      "speaker": null,
      "source": "Hi everyone, let's get started.",
      "translation": "Hola a todos, empecemos."
    }
  ],
  "summary": null
}
```

- `t`: segundos desde `created_at` hasta que terminó la frase.
- `translation`: `null` en modo original (sin traducir, `noTranslate`).
- `speaker` y `speakers` quedan para la parte de personas: `speaker` será un
  número (1, 2…) y `speakers` el nombre que el usuario le ponga
  (`{"1": "Ana"}`). Ahora siempre `null` y `{}`. La interfaz tiene que
  funcionar en los dos casos: si todas son `null`, no se muestran etiquetas;
  si hay número, se muestra `speakers[n] ?? "Persona n"`.
- `summary`: `null` o `{ "text": "<markdown>", "created_at": "..." }`.
- `gaps` (opcional): los ratos en que se apagó «Guardar en notas» a mitad de
  la conversación, `[{ "at": 12, "secs": 95 }]`: el hueco va antes de la
  frase `at` (o al final si `at` es el número de frases) y duró `secs`. La
  vista (`transcriptParts` en `src/notes.js`) y el exportar
  (`transcript_text` en `notes.rs`) lo marcan igual: «Sin guardar · 2 min»,
  partiendo el párrafo en el que cae.
- El `id` sale de la fecha local de inicio y sirve de nombre de archivo.
  Valida en Rust que solo tenga `[0-9A-Za-z_-]`, para que nadie pueda
  escribir fuera de la carpeta.

---

## Parte A: menú, guardado y vista de notas

### A1. Rust: comandos de notas (un solo bloque de cambios; avisar antes)

Archivo nuevo `src-tauri/src/notes.rs`, con `mod notes;` en `lib.rs` y los
comandos añadidos a `generate_handler!`. Errores con el `Error` de
`error.rs`; añade una variante `Notes(String)` si hace falta, con kind `"notes"`.

| Comando | Qué hace |
|---|---|
| `notes_list() -> Vec<NoteSummary>` | Lee la carpeta y devuelve `{ id, title, created_at, ended_at, sentences: usize, has_summary, kind, preview, source_lang, target_lang, summary_line }`, de la más nueva a la más vieja. `preview` son los primeros ~200 caracteres de las traducciones (o del original), para buscar; `source_lang`/`target_lang` son los de la primera frase y `summary_line` la primera frase del resumen (para la lista). Ignora los archivos que no se puedan leer. |
| `note_read(id) -> serde_json::Value` | El JSON tal cual. |
| `note_save(note: serde_json::Value)` | Escribe `<id>.json` de forma atómica (a `.tmp` y luego `rename`). Crea la carpeta si no existe. |
| `note_delete(id)` | Borra el archivo. |
| `note_reveal(id)` | `open -R <ruta>`: lo muestra en Finder. |
| `note_export(id, format: "md" \| "txt") -> String` | Escribe la nota en `~/Downloads/<título saneado>.<ext>` (si existe, añade ` (2)`, ` (3)`…), la muestra en Finder y devuelve la ruta. |

Formato de exportación (en `.md` el título va con `#` y el resumen con su
encabezado; en `.txt`, igual pero sin `#`):

```
# Conversación del 29 oct, 10:32
29 oct 2026 · 10:32–11:07 · 35 min

## Resumen
...

## Transcripción
[00:03] Persona 1: Hola a todos, empecemos.
        (Hi everyone, let's get started.)
```

Sin hablante, la línea es `[00:03] Hola a todos, empecemos.`. El original
entre paréntesis solo aparece si hay traducción.

### A2. JS: `src/notes.js` (nuevo)

- Envoltorios en `src/api.js`, con JSDoc, siguiendo el estilo de los que ya
  hay: `notesList`, `noteRead`, `noteSave`, `noteDelete`, `noteReveal`,
  `noteExport`, y los typedefs `Note`, `NoteSentence` y `NoteSummary`.
- Un grabador, sin React:
  - `createRecorder()` devuelve `{ add(sentence), finish() }`.
  - `add` crea la nota con la primera frase (sin frases no hay archivo) y
    guarda como mucho cada 5 s (debounce) con `api.noteSave`.
  - `finish()` pone `ended_at`, guarda ya, y si la nota sigue vacía no
    escribe nada.
  - Un fallo al guardar no puede romper la traducción: `console.warn` y seguir.
- Interruptor "Guardar conversaciones" en `localStorage`
  (`lingora.saveNotes`), activado por defecto, con `loadSaveNotes()`
  igual que `loadSpeak()` en `App.jsx`.

### A3. Engancharlo en `App.jsx` (cambios mínimos)

- Un `useRef` con el grabador actual.
- **Un solo punto de grabación:** en `playback`, justo después del último
  `patchEntry(lane.direction, id, { translation: result.translation, ... })`
  (cerca de la línea 806), llama a
  `recorder.add({ direction, source_lang, target_lang, source: result.transcript, translation })`.
  - En modo original (`noTranslate`), `translation: null`.
  - No añadas grabación en ningún otro sitio ni cambies ese flujo.
- `t` lo calcula el grabador (`performance.now()` desde la primera frase,
  corregido por `created_at`). No hace falta tocar `info`.
- Sesión: empieza con la primera frase después de que algún carril arranca.
  Termina (`finish()`) cuando `anyRunning` pasa a `false`. Ya hay un efecto
  sobre `anyRunning` (cerca de la línea 950); añade uno nuevo al lado, sin
  tocar el existente.
- Si `lingora.saveNotes` está apagado, no se crea grabador.

### A4. Menú de hamburguesa (☰)

- Botón ☰ arriba a la izquierda, antes del logo de la barra superior. Es
  lo único que cambia en la barra: la marca, los modos y los idiomas se
  quedan igual.
- Al pulsarlo, se abre un panel lateral (`src/Sidebar.jsx`) **por encima**
  del contenido, desde la izquierda, de ~240 px, con un fondo oscuro
  semitransparente detrás. No empuja ni encoge la vista.
- Se cierra:
  - al elegir una entrada;
  - al pulsar fuera, en el fondo;
  - con Esc;
  - con una ✕.
- Al abrirse, el foco va a la primera entrada. Al cerrarse, vuelve al ☰.
- Dos entradas, con icono y texto: **Traducir** (la vista actual) y
  **Notas**. La que está activa va resaltada. Nada más por ahora; Ajustes y
  Diagnóstico se quedan donde están.
- Iconos SVG en línea, simples, como `WaveIcon`.
- **Muy importante:** al ir a Notas, la vista Traducir **no se desmonta**:
  se oculta con `hidden` o CSS. Si se desmontara, se cortaría la
  traducción en curso. Si hay un carril en marcha, la entrada Traducir
  muestra un punto rojo y el ☰ también, para que se vea con el menú cerrado.
- La vista Notas lleva su propia barra superior: ☰, el título "Notas" y nada
  más.

### A5. Vista Notas: `src/Notes.jsx`

Dos páginas, una tras otra, no en columnas:

1. **Lista de notas:** todas las conversaciones guardadas.
2. **Página de una nota:** se abre al pulsar una nota, ocupa toda la vista y
   tiene un botón "← Notas" arriba para volver a la lista. La lista
   recuerda el buscador y la posición del scroll al volver.

**Arriba de la lista:**
- un buscador ("Buscar en notas") que filtra por título y `preview`, en local;
- el interruptor "Guardar conversaciones".

**Lista:**
- cada elemento muestra el título, la fecha (`29 oct · 10:32`), la duración
  y un punto si ya tiene resumen;
- la nota en curso aparece arriba, con la etiqueta "Grabando";
- vacía: "Aún no hay notas. Cuando traduzcas algo, se guardará aquí."

**Página de una nota:**
- **Cabecera:**
  - título editable al hacer clic, que guarda con `noteSave` al salir del
    campo o con Enter;
  - debajo: fecha, hora de inicio y fin, duración e idiomas (`Inglés → Español`).
- **Acciones**, botones pequeños a la derecha:
  - Resumir (parte B; en la parte A no se muestra);
  - Copiar para resumir;
  - Exportar, con un menú pequeño: Markdown (.md) / Texto (.txt);
  - Mostrar en Finder;
  - Borrar, que pide confirmación con un diálogo propio, no `window.confirm`.
- **Pestañas:** "Resumen" y "Transcripción".
  - Sin resumen se abre en Transcripción.
  - En la parte A, Resumen solo muestra el texto vacío explicando el botón
    Copiar para resumir.
- **Transcripción:**
  - una fila por frase: `mm:ss` en gris, la etiqueta de persona si hay, y la
    traducción;
  - un interruptor "Ver original" muestra el original en pequeño debajo.
- **Copiar para resumir:** copia al portapapeles
  (`navigator.clipboard.writeText`) unas instrucciones cortas y la
  transcripción en el formato de exportación, para pegarla en cualquier
  chat de IA.
  - Instrucciones: "Resume esta conversación en español: puntos clave,
    decisiones y tareas con responsable si se menciona".
  - Debe mostrar el aviso "Copiado".
- La nota en curso se refresca sola mientras se graba: un evento de
  ventana desde el grabador o un `setInterval` de 3 s; elige uno.

**Estilo:**
- Usa las variables y clases que ya hay en `src/styles.css` (tema oscuro,
  acento turquesa, `icon-button`, `link`). Añade lo nuevo al final del
  archivo, en una sección `/* Notas */`.
- Foco visible y estados hover.
- Sin scroll horizontal. La lista y la página de la nota ocupan toda la
  vista, hasta ~860 px de ancho, centradas.

### Pruebas a mano (parte A)

1. Traducir un vídeo 1–2 minutos. En Notas aparece "Grabando", con frases
   que se van añadiendo. Al parar, queda con su duración.
2. Mientras se traduce, ir a Notas y volver: la traducción no se cortó, ni
   los subtítulos ni la voz.
3. Con "Guardar conversaciones" apagado no se crea nada.
4. Renombrar, exportar .md y .txt (los archivos aparecen en Descargas),
   mostrar en Finder y borrar.
5. Pararla sin que haya dicho nada: no queda una nota vacía.
6. Modo original: se guarda sin traducción, y "Ver original" no duplica el texto.
7. El menú ☰ se abre por encima y se cierra con Esc, al pulsar fuera y al
   elegir una entrada. Notas → una nota → "← Notas" vuelve a la lista con
   el buscador intacto.

---

## Parte B: resumen con IA

### B1. La clave

- Dependencia: `keyring = { version = "3", features = ["apple-native"] }`.
- Comandos en `notes.rs` (servicio `com.lingora.app`, cuenta `groq`):
  - `summary_key_status() -> bool`;
  - `summary_key_set(key)`, que antes de guardar comprueba la clave con un
    `GET https://api.groq.com/openai/v1/models` y si no vale devuelve
    "La clave no es válida";
  - `summary_key_clear()`.
- Solo en desarrollo, si no hay clave en el llavero se usa `GROQ_API_KEY`
  del entorno. Nunca se guarda en un archivo ni va en el bundle.

### B2. Resumir

- `note_summarize(id) -> String`: lee la nota, arma la transcripción en el
  formato de exportación y llama al chat de Groq. Reutiliza el cliente de
  `groq.rs` añadiendo un método `complete(system, user, model)` sin
  streaming. No cambies `transcribe` ni `translate`.
- Modelo: `LINGORA_SUMMARY_MODEL` en `config.rs`, por defecto
  `qwen/qwen3.8-27b`, que ya funciona en la cuenta. Es el único cambio en
  `config.rs`. Temperatura 0.3.
- Prompt de sistema (en español; idioma de salida = el de la traducción):
  ```
  Eres un asistente que resume conversaciones transcritas. Responde en {idioma}
  con Markdown y solo estas secciones, omitiendo las que no tengan contenido:
  ## Resumen (3-6 frases)
  ## Puntos clave (lista)
  ## Decisiones (lista)
  ## Tareas (lista; "- [ ] tarea — responsable" si se menciona)
  No inventes nada que no esté en la transcripción. Si aparecen etiquetas
  "Persona N", úsalas tal cual.
  ```
- Textos largos: si la transcripción pasa de ~60 000 caracteres, se resume
  por trozos de ~50 000 y luego se resume el conjunto de esos resúmenes.
- Guarda el resultado en `summary` de la nota y lo devuelve.
- El cliente de `groq.rs` tiene un timeout de 30 s. Para resumir, crea el
  cliente con 120 s; no cambies el de la traducción.

### B3. Interfaz

- Botón **Resumir** en el detalle (o "Volver a resumir" si ya hay resumen),
  con un estado "Resumiendo…" y los errores en línea.
- Sin clave: un panel pequeño en la propia pestaña Resumen.
  - Texto: "Para resumir, Lingora envía la transcripción a Groq con tu
    propia clave. Es lo único que sale de tu equipo. La clave se guarda en
    el llavero del Mac."
  - Un campo de contraseña y el botón Guardar.
  - Un enlace a `https://console.groq.com/keys`.
  - Debajo, la alternativa: "O usa Copiar para resumir y pégalo en tu chat
    de IA".
- La primera vez que se resume, un aviso de confirmación: "La
  transcripción se enviará a Groq. ¿Continuar?" Se recuerda en
  `lingora.summaryConsent`.
- Resumen en Markdown: un render mínimo propio para `##`, listas `-`,
  casillas `- [ ]` (solo visuales) y `**negrita**`. Sin dependencias y sin
  `dangerouslySetInnerHTML` con el texto sin escapar.
- La clave se gestiona también en **Ajustes → Notas** (`src/Settings.jsx`):
  estado ("Clave guardada" / "Sin clave"), un campo para ponerla o
  cambiarla y "Quitar clave". Es una fila nueva en la tarjeta de Notas que
  ya existe, con el mismo estilo (`prefs-row`).
- Textos de privacidad: con clave guardada, el pie del menú
  (`src/Sidebar.jsx`, `drawer-foot`) y "Acerca de" en Ajustes pasan de
  "Todo se procesa en tu Mac" a "Todo se procesa en tu Mac, salvo los
  resúmenes que pidas". Sin clave, se quedan como están.
- Estilo: usa las clases y variables de la sección `/* Notas */` de
  `styles.css` (`note-action`, `note-action primary`, `notes-switch`,
  `prefs-*`, `--n-*`), que ya siguen el estilo de shadcn. No cambies las
  que existen; añade lo nuevo al final de esa sección.

### Pruebas a mano (parte B)

1. Sin clave: el panel explica qué se envía. Una clave mala se rechaza.
2. Con clave: Resumir una nota de 5–10 minutos devuelve las secciones
   esperadas y queda guardado (cierra y abre la app).
3. "Volver a resumir" reemplaza el resumen.
4. Sin conexión: el error se muestra en línea y la app sigue funcionando.
5. Exportar con resumen: sale la sección Resumen.

---

## Parte C: personas (hecha por Opus, 2026-10-29)

- Rust (`src-tauri/src/speakers.rs`) solo calcula la huella de voz de cada
  frase (`voice_print`). Modelo: ERes2Net de 3D-Speaker (~40 MB, un solo
  archivo), descargable desde el diagnóstico (`speakers`, opcional).
- Se probaron 4 modelos con 4 voces sintéticas en inglés y en español. Solo
  ERes2Net acertó todas las frases con un mismo umbral (0,5), con ~80 ms por
  frase. CAM++ y TitaNet confundían voces y WeSpeaker juntaba a todas.
- El agrupado va en JS (`createSpeakerTracker` en `src/notes.js`):
  - cada frase va a la persona más parecida si el coseno pasa de 0,5;
  - si no, es una persona nueva;
  - las frases de menos de 1,2 s van siempre a la más parecida.
- Lo del micrófono (llamada) es siempre `speaker: 0`, "Yo".
- En la nota: los colores por persona, renombrar y unir dos personas
  (`SpeakerBar` en `src/Notes.jsx`).
- Interruptor "Distinguir personas" en Ajustes → Notas (`lingora.speakers`).
- Con audio real (una entrevista de 55 min, 2 personas) el agrupado en vivo
  daba 6 "personas": las de más eran frases sueltas con risas, ruido o dos
  voces a la vez. Por eso hay dos ajustes:
  - en vivo, una frase de menos de 2 s no crea persona nueva;
  - al terminar, un repaso (`refine`) con toda la conversación:
    1. quien habla menos del 3 % del tiempo se une a la más parecida;
    2. dos personas con medias más parecidas que 0,6 se juntan;
    3. cada frase se reasigna a la persona más cercana;
    4. se renumera por orden de aparición.
  Resultado: 2 personas y el 94 % de las frases bien, contra la diarización
  completa de sherpa-onnx como referencia. Las pruebas con 4 voces siguen al
  100 %.
- Mientras se graba pueden verse personas de más; se corrigen al detener.
- Las notas grabadas antes del repaso no se pueden rehacer: no se guardan
  las huellas. Se corrigen a mano con "Es la misma persona que…".
