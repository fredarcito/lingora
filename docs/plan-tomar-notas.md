# Plan: modo "Tomar notas" (transcribir sin traducir)

Estado: fase 1 lista para implementar (2026-10-29). Las fases 2 y 3 van
después, cada una con su propia confirmación.

Meta: usar Lingora para tomar notas de clases y reuniones en el idioma en
que se habla, con personas, resumen y exportación. Por dentro casi todo
existe ya:

- el modo Original transcribe sin traducir;
- el grabador de notas, las personas y el resumen ya funcionan.

Falta el modo en sí y su interfaz.

---

## 0. Reglas (leer antes de empezar)

Las mismas que en `docs/plan-notas.md`, sección 0. Además:

- **"Traducir audio" y "Traducir llamada" tienen que funcionar exactamente
  igual que ahora.** El modo nuevo se añade al lado; no reorganices el flujo
  de los otros.
- **No toques lo afinado:**
  - `src/utils/audio.js`;
  - el flujo `enqueue` / `texted` / `playback` de `App.jsx`, salvo lo que
    se indica abajo;
  - `src/components/Captions/` y `src/pages/FloatingCaptions/`;
  - el agrupado de personas en `src/utils/notes.js` (`createSpeakerTracker`);
  - los modelos y sus parámetros en Rust.
- **Reutiliza el diseño** de Notas y Ajustes: los componentes de
  `src/components/shared/` (`Button`, `Switch`…; ver `docs/componentes.md`)
  y las variables `--n-*` de `src/styles.css`. Lo nuevo va en
  `src/pages/NoteTaking/styles.module.css`.
- Antes de tocar `src-tauri`, avisa y espera la señal: reinicia la app de
  quien prueba. Junta todos los cambios de Rust en un solo bloque.
- En la interfaz no se nombran modelos.

---

## Cómo se maneja el idioma

- La escucha europea (25 idiomas) detecta el idioma frase a frase: no hace
  falta elegirlo y aguanta reuniones mezcladas (inglés y español, por
  ejemplo). La de chino, japonés, coreano y cantonés también detecta sola
  entre esos idiomas y el inglés.
- Por eso el usuario no elige un idioma concreto, sino solo la familia:
  - **"Automático"**, por defecto: por dentro se escucha con el código
    `"EN"`, que elige la escucha europea.
  - **"Chino, japonés, coreano o cantonés"**: por dentro, `"ZH"`.
- La transcripción queda en el idioma en que se dijo cada frase.
- **Idioma de las notas:** es el del resumen, por defecto `es`. Así una
  reunión en inglés queda transcrita en inglés y resumida en español.
- Límite: las frases muy cortas o con ruido ("OK", "Yeah") a veces salen en
  otro idioma o se pierden.

---

## Fase 1: el modo básico

### 1.1 El modo

- `Mode` pasa a ser `"video" | "call" | "notes"`. Se guarda en
  `lingora.mode` como los otros.
- En la barra superior, un tercer botón en el selector de modo:
  - texto: **"Tomar notas"**;
  - pista: "Transcribe clases y reuniones sin traducir, con personas y
    resumen".
  - No depende de `VITE_CALL_MODE`.
- En modo `notes`, la barra no muestra el selector de idiomas (`PairBar`):
  sus opciones van en la tarjeta del modo (1.3).

### 1.2 Por dentro: el carril de Escuchar sin traducir ni hablar

En modo `notes` se usa el carril `remote_to_local` tal cual, con estos
cambios, aplicados **solo** en el cálculo de `lanes` (cerca de `const lanes =
laneSettings.map`):

- `sourceLang` y `targetLang` = `"EN"` o `"ZH"`, según "Idioma de la
  reunión". Con el mismo idioma, el flujo ya se salta la traducción (ver
  `t.source_lang === t.target_lang` en `enqueue`).
- `speak: false`: sin voz.
- `inputDeviceId`: el de "Qué escuchar" (1.3), no el del carril. No cambies
  el dispositivo guardado de Escuchar.

Además:

- **Sin precargas innecesarias.** Revisa `start`: en modo `notes` no se
  precarga la traducción (`translateWarmUp`) ni la voz (`warmUp`), y no se
  abre la ventana de subtítulos flotantes. Si `start` ya lo evita con el
  mismo idioma y sin voz, no lo toques.
- **El grabador** (efecto de `anyRunning`):
  - en modo `notes` se crea **siempre**, aunque "Guardar conversaciones"
    esté apagado: grabar es el propósito del modo;
  - en los otros modos sigue como está.
- **Las personas** se distinguen igual que ahora: interruptor
  "Distinguir personas" y modelo descargado.

### 1.3 Pantalla del modo: `src/pages/NoteTaking/` (nuevo)

En modo `notes` se muestra este componente en lugar de las tarjetas de los
carriles (`lanes`). El diagnóstico se queda igual.

**Antes de empezar** (no está grabando), una tarjeta (`prefs-card`) con:

- **Qué escuchar**, un segmentado como los de la tarjeta (`Segmented`):
  - "Audio del Mac": vídeos, clases o reuniones en línea. Usa
    `SYSTEM_AUDIO`; si no está disponible, la opción se desactiva con su
    pista.
  - "Micrófono": reuniones en persona. Usa el micrófono por defecto.
  - Se guarda en `lingora.notesInput`.
- **Idioma de la reunión:** "Automático" / "Chino, japonés, coreano o
  cantonés". Se guarda en `lingora.notesListen`.
- **Idioma de las notas:** un `select` con los idiomas de
  `api.languages()`, por defecto español. Pista: "El resumen se escribe en
  este idioma". Se guarda en `lingora.notesLang`.
- **El botón principal:** "Empezar a tomar notas".
- Una línea en gris debajo: "Se transcribe en tu Mac. Solo sale el texto
  si pides un resumen."

**La primera vez** que se pulsa Empezar, un diálogo (mismo estilo que
`ConfirmDelete` en `Notes.jsx`):

> "Antes de grabar: avisa a las personas de que estás transcribiendo la
> conversación."

Botones "Cancelar" y "Entendido, empezar". Se recuerda en
`lingora.notesConsent`.

**Mientras graba**, una vista tipo documento:

- **Barra arriba:**
  - punto rojo que late (reutiliza `note-live`);
  - tiempo transcurrido `mm:ss` (o `h:mm:ss` a partir de una hora);
  - las personas detectadas, con su color y sin editar;
  - a la derecha, el botón **Detener** (`note-action`).
- **Centro:** la transcripción en vivo, en párrafos, con hora, persona y
  color, igual que la pestaña Transcripción de una nota.
  - Para no duplicar código, extrae de `Notes.jsx` un componente
    `Transcript` (la lista `note-lines`) y `speakerColor`, y úsalos en los
    dos sitios sin cambiar cómo se ven.
  - Baja sola mientras el usuario esté abajo. Si sube para leer algo, no
    lo arrastra: aparece un botón "↓ Ir al final".
- **Al pie, en gris:** lo que se está oyendo ahora (`heard` + `partial` del
  carril). Así no parece que va con retraso.
- **Sin frases todavía:** "Escuchando… las notas aparecerán aquí."

**De dónde sale la nota en vivo.** `notes.js` expone:

- `getActiveNote()`: una copia de la nota en memoria;
- un evento de ventana `lingora-note-changed` que se emite al añadir una
  frase y al asignarle persona.

`NoteTaking` lo escucha. **No** leas el disco cada pocos segundos para esto.

### 1.4 La nota de este modo

`createRecorder({ mode })` con `mode: "notes"` crea la nota con:

- `kind: "notes"`. Las demás notas no tienen `kind`, o tienen
  `"translation"`.
- Título: `"Notas del 29 oct, 10:32"`.
- `summary_lang`: el idioma de las notas elegido.
- En cada frase, `source_lang` y `target_lang` = `"auto"` (o `"zh"` con la
  otra familia), y `translation: null`.

En la página de la nota (`Notes.jsx`):

- **La línea de idiomas,** si `kind === "notes"`: "Transcripción · idioma
  automático".
- **Idioma del resumen:** junto al botón Resumir, un `select` pequeño
  ("Resumen en: Español"). Cambiarlo guarda `summary_lang` en la nota.
  Solo en notas con `kind: "notes"`.
- **En la lista,** una etiqueta discreta "Notas" (`badge`) para distinguirlas
  de las traducciones.

### 1.5 Al detener

- Se para el carril como ahora. El grabador termina y hace el repaso de
  personas.
- Después se abre **la página de esa nota** en la vista Notas, con la
  pestaña Transcripción y el botón Resumir a mano.
  - `Notes` acepta una prop para abrir una nota concreta, por ejemplo
    `openRequest: { id, nonce }`.
  - `App` cambia `view` a `"notes"` cuando `finish()` termina.
  - Si la nota quedó vacía (no se dijo nada), no se abre nada y se queda en
    la pantalla del modo.

### 1.6 Rust (un solo bloque, avisar antes)

Solo en `src-tauri/src/notes.rs`:

- **`note_summarize`:** el idioma del resumen sale de `summary_lang` si
  existe (con `Lang::from_code`). Si no, se usa lo de ahora: el
  `target_lang` de la primera frase, y si no, español.
- **`span_line` y la exportación:** comprueba que funcionan con
  `source_lang: "auto"` (no deberían depender de él).
- Una prueba unitaria: una nota con `summary_lang: "en"` elige inglés.

### Pruebas a mano (fase 1)

1. "Traducir audio" y "Traducir llamada" funcionan igual que antes: voz,
   subtítulos, flotante, original.
2. Tomar notas con el audio del Mac sobre un vídeo con 2 personas:
   - aparece la transcripción en vivo, con personas;
   - al detener se abre la nota, con las personas ya repasadas.
3. Una reunión en inglés con "Idioma de las notas: Español": la
   transcripción queda en inglés y el resumen sale en español.
4. Cambiar "Resumen en" en la nota y volver a resumir: sale en el otro
   idioma.
5. Con "Guardar conversaciones" apagado, Tomar notas graba igual y
   "Traducir audio" no graba.
6. Con el micrófono: hablar y ver la transcripción. La voz de Lingora no
   suena en ningún momento.
7. El aviso de privacidad sale solo la primera vez.
8. Detener sin haber dicho nada: no se crea nota y no se cambia de vista.
9. Durante la grabación, subir para leer: no te arrastra abajo, y "↓ Ir al
   final" vuelve.
10. Una nota de "Tomar notas" y otra de traducción en la lista: la etiqueta
    "Notas" solo sale en la primera.

---

## Fase 2: reunión en línea, con "Yo" (la hace Opus)

Meta: en una reunión en línea quedan en la nota **las demás personas y tú**,
uses lo que uses para oír y hablar. Se usan siempre la **salida y la entrada
por defecto del Mac**; quien usa la app no elige ni configura nada.

### 2.1 Qué ve la persona

- "Qué escuchar" pasa a tener tres opciones:
  - **"Reunión en línea"** (nueva, la primera y la de por defecto si hay
    audio del Mac): el audio del Mac y tu micrófono a la vez.
  - "Solo audio del Mac": vídeos y clases, donde tú no hablas.
  - "Micrófono": reuniones en persona.
- Debajo, una pista que cambia sola según lo que esté conectado (ver 2.3):
  - Auriculares: "Con auriculares: tu voz y la de los demás quedan separadas."
  - Altavoces: "Con altavoces, Lingora quita de tu micrófono lo que ya se
    oyó por el Mac. Con auriculares queda más limpio."
  - AirPods como micrófono: "Tu micrófono son los AirPods: se oye con menos
    calidad." (la pista que ya hay en el diagnóstico).
- En la nota: el micrófono es siempre **"Yo"** (`speaker: 0`); el audio del
  Mac son Persona 1, 2… como ahora.
- Nada se manda a la llamada: sin voz ni micrófono virtual.

### 2.2 Cómo se graba

- Dos carriles a la vez, como el modo llamada, los dos con `notes: true` y
  sin voz:
  - `remote_to_local` con `SYSTEM_AUDIO` (las demás personas);
  - `local_to_remote` con la entrada por defecto (tú). El recorder ya pone
    `speaker: 0` a esta dirección.
- **El orden:** antes `createRecorder.add` apilaba en el orden de llegada y
  `t` era la hora de llegada. Con dos fuentes, una frase corta puede
  adelantarse a otra. Ahora `t` es cuándo **terminó de oírse** la frase
  (`info.endedAt`, como dice el tipo `NoteSentence`; las pausas de
  `paragraphs` cuentan con eso) y la frase se inserta en su sitio por `t`.
- **Los subtítulos** de la pantalla de notas muestran las dos fuentes en una
  sola lista, por hora, con "Yo" marcado.

### 2.3 Qué hay conectado (detección automática)

Se mira al empezar y **cada vez que cambia** la salida o la entrada por
defecto (conectar o quitar unos AirPods a media reunión):

| Salida por defecto | Cómo se reconoce | ¿Puede haber eco? |
|---|---|---|
| AirPods / auriculares Bluetooth | transporte Bluetooth | No |
| Auriculares con cable en el Mac | integrada con fuente `hdpn` | No |
| Auriculares USB (con micrófono) | USB con entrada y salida | No |
| Altavoces del Mac | integrada con fuente `ispk` | **Sí** |
| Monitor, HDMI, altavoz USB/Bluetooth sin micrófono, AirPlay | el resto | **Sí** (por si acaso) |

Si no se sabe, se trata como altavoces: quitar el eco cuando no lo hay
apenas cuesta; no quitarlo cuando lo hay llena la nota de frases repetidas.

**El micrófono de unos AirPods.** Si la entrada por defecto es el micrófono
de los AirPods pero la app de la reunión usa el del Mac, abrirlo pasaría los
AirPods a modo llamada y **la reunión se oiría peor**. Regla:

- si el micrófono de los AirPods ya lo usa otra app (Core Audio:
  `DeviceIsRunningSomewhere`), se usa ese (ya están en modo llamada, no se
  pierde nada);
- si no, se usa el micrófono del Mac, que con auriculares solo te oye a ti.

**Cambios a media reunión.** Si cambia la entrada por defecto, el carril del
micrófono se cierra y se vuelve a abrir con la nueva, sin parar la nota ni
mostrar un error. La captura del Mac sigue sola: la tap es global, no depende
de la salida.

### 2.4 El eco con altavoces

Con altavoces el micrófono oye también a los demás: sin hacer nada, cada
frase suya saldría dos veces, una como "Persona 1" y otra como "Yo". Tenemos
la ventaja de que **sabemos exactamente lo que sonó** (el audio del Mac), así
que se compara con eso. Se hace en tres capas, en `src/utils/echo.js` (nuevo;
no toca `audio.js` ni el tracker de personas):

1. **Espera corta.** Cada frase del micrófono espera hasta que el carril del
   Mac entregó todo lo que se oyó a la misma hora (como mucho unos 4 s).
2. **Texto.** Si en ese rato (±1,5 s) hubo una frase del Mac y casi todas
   las palabras de la del micrófono están en ella (≥ 60 %, sin acentos ni
   muletillas), es eco y se descarta. Si solo una parte coincide (hablasteis
   a la vez), se quitan esas palabras y se queda lo tuyo, si queda algo con
   sentido (3 palabras o más).
3. **Voz.** Si la huella de voz de la frase del micrófono se parece más a una
   persona del Mac que a "Yo", se descarta. La huella de "Yo" se aprende sola
   con las frases del micrófono que el Mac no explica. Solo se aplica cuando
   la salida puede tener eco.

Con auriculares no se aplica ninguna capa: lo del micrófono va directo como
"Yo", sin esperas.

Plan B (solo si con audio real las capas no bastan): cancelación de eco de
verdad con el audio del Mac como referencia. Necesita un crate nuevo
(cancelación de eco tipo WebRTC) y hay que preguntar antes. La cancelación
de eco de WKWebView no sirve: solo quita lo que suena desde la propia
página, no lo que suena por la app de la reunión.

### 2.5 Otros casos

- **Te silencias en la reunión:** Lingora no lo sabe y sigue anotando lo que
  dices. Se acepta; queda en la pista de la opción.
- **Sala híbrida** (varias personas junto a tu micrófono): todo lo del
  micrófono sale como "Yo". Para eso está la opción "Micrófono", que distingue
  personas.
- **Sin audio del Mac** (macOS anterior a 14.2): la opción nueva se desactiva
  con su pista, como "Solo audio del Mac".
- **Sin permiso de micrófono:** se avisa y se sigue solo con el audio del Mac
  (no se pierde la reunión).
- **Se pierde el micrófono** (lo desconectas): se reintenta con la nueva
  entrada por defecto; el carril del Mac no se para.

### 2.6 Qué toca (hecho)

- `src/utils/route.js`: `readRoute`, `echoPossible`, `prefersMacMic`,
  `meetingMic` (qué micrófono abrir).
- `src/utils/echo.js`: `compareEcho` (texto) y `withEchoFilter` (envuelve
  al grabador con su misma forma).
- `src/hooks/useMeetingNotes.js`: empezar y parar los dos carriles, volver a
  abrir el micrófono si cambia o se pierde, cerrar si se pierde el Mac.
- `src/hooks/useAudioRoute.js`: lo que hay conectado, para la pista.
- `utils/notes.js`: `add(sentence, voice, info)` con `t` del audio e
  inserción ordenada; `lingora.notesInput` gana `"meeting"` (por defecto si
  no había nada guardado). `createSpeakerTracker` sin tocar.
- `App/index.jsx`: los carriles de notas y los hooks. En `enqueue` solo se
  pasa `info` al grabador; `start` y `stop` sin tocar.
- `NoteTaking`: tercera opción, pista según lo conectado, aviso si falla el
  micrófono y "Yo" marcado en vivo.
- Rust: `src-tauri/src/route.rs` (nuevo, comando `audio_route`) y su
  registro en `lib.rs`. `audio.rs` sin tocar. En vez de un evento, el
  frontend vuelve a mirar cada 2 s mientras graba.

### 2.7 Pruebas con audio real

1. AirPods (micrófono y salida) en Meet o Zoom.
2. AirPods para oír y micrófono del Mac en la reunión: los AirPods no deben
   pasar a modo llamada.
3. Auriculares con cable.
4. Altavoces del Mac: ninguna frase de los demás debe salir como "Yo"; hablar
   a la vez que otra persona y comprobar que lo tuyo queda.
5. Monitor externo con altavoces.
6. Conectar y quitar los AirPods a media reunión: la nota sigue sin cortes.
7. Comprobar el orden de las frases en una conversación rápida.

## Fase 3: mis notas y marcas (después)

- **Mis notas:** un panel lateral "Mis notas" mientras se graba (abajo en
  ventanas estrechas). Cada línea guarda el minuto en que se escribió y va en
  `my_notes: [{ t, text }]`.
- **Marcas:** "Marcar momento" (⌘B) guarda `bookmarks: [{ t }]`. En la
  transcripción se ve una marca junto a ese párrafo.
- **En el resumen y la exportación:** el resumen recibe las notas y las
  marcas como "lo que el usuario consideró importante", y la exportación las
  incluye.

## Fase 4: traducción opcional (más adelante)

La traducción pequeña debajo de cada párrafo, para quien quiera las dos
cosas.

---

## Campos nuevos de la nota

Sin romper las notas que ya existen; todos son opcionales al leer.

| Campo | Fase | Qué es |
|---|---|---|
| `kind` | 1 | `"notes"` o `"translation"` (sin él, traducción) |
| `summary_lang` | 1 | Idioma del resumen |
| `my_notes` | 3 | `[{ t, text }]` |
| `bookmarks` | 3 | `[{ t }]` |
