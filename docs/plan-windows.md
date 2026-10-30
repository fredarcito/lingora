# Plan: Lingora en Windows

Estado (2026-10-30): el `.exe` se compila en GitHub Actions
(`.github/workflows/windows-check.yml`, rama `windows-build`). Hecho: Fase 1
(por probar con audio real), Fase 3
(espeak-ng y procesos sin ventana) y en la 6 la carpeta de modelos y el
`keyring`. La traducción va por CPU; `vulkan` se prueba aparte en
Actions (ver Fase 2). Sin Rust para listar dispositivos, la interfaz usa los del WebView
(`listAudioDevices` en `api.js`). Sigue a
`plan-autonomia.md`: como la traducción y la voz ya van dentro de la app,
casi todo lo que falta es lo que toca el sistema (audio, voces, ventanas).

Meta: un instalador (`.exe` de Tauri con NSIS) que se abre en Windows 10/11 y
hace lo mismo que en el Mac: Traducir audio, Tomar notas (también «Reunión en
línea»), la voz traducida y los subtítulos flotantes. Sin instalar nada aparte.

---

## 0. Dónde estamos

Revisado en el código (`#[cfg(target_os = "macos")]` y llamadas al sistema):

| Pieza | En Windows hoy | Trabajo |
|---|---|---|
| Interfaz (React), filtro de eco, notas, nombre «(Yo)» | Igual: JS puro | Nada (salvo los textos que dicen «Mac», ver Fase 7) |
| Micrófono | `getUserMedia` en WebView2 | Probar |
| Escucha, voz Kokoro, personas (sherpa-onnx) | El crate tiene versión para Windows | Compilar y probar |
| Traducción (`llama-cpp-2`) | Compila en Windows; `metal` es solo Mac | Fase 2: elegir GPU |
| Fonemas (espeak-ng) | Falta el `.exe` | Fase 3 |
| **Audio del sistema** (`system_audio.rs`) | Devuelve «solo macOS por ahora» | **Fase 1: lo más grande** |
| Qué hay conectado (`route.rs`) | Responde «no sé» → se trata como altavoces | Fase 4 |
| Voces del sistema (`system_voice.rs`) | Lista vacía | Fase 5 |
| Lista de dispositivos (`audio.rs`) | Error «solo macOS» | Fase 4 |
| Subtítulos flotantes (`captions_window.rs`) | La parte de AppKit (`objc`) no compila allí, el resto sí | Fase 6 |
| Carpeta de modelos (`config.rs`) | `$HOME/Library/Application Support/…`: en Windows no existe `HOME` | Fase 6 |
| Clave de Groq (`keyring`) | Solo con `apple-native` | Fase 6 |
| `open` (mostrar archivo, abrir enlace) | No existe en Windows | Fase 6 |
| `tar` para descomprimir modelos | Windows 10+ trae `tar.exe` (bsdtar, admite `.bz2`) | Probar |
| Diagnóstico (`doctor.rs`) | Las comprobaciones de audio son solo Mac | Fase 6 |
| Scripts `build-espeak.sh` y `check-standalone.sh` | Solo Mac | Fases 3 y 8 |

Lo bueno: el código ya separa Mac del resto con `cfg`, así que cada pieza se
puede hacer por separado y la app de Mac no cambia.

Todo esto está en la lista de «no tocar» de CLAUDE.md (`audio.rs`,
`system_audio.rs`, `system_voice.rs`, `config.rs`, `doctor.rs`,
`tauri.conf.json`, crates nuevos). **Cada fase necesita el sí del usuario**, y
lo de Windows va siempre dentro de `#[cfg(windows)]`: el código de Mac no se
toca.

---

## Antes de empezar: decisiones del usuario

1. **Una máquina con Windows para probar.** Sin ella no se puede: compilar
   para Windows desde el Mac no es práctico (sherpa-onnx, llama.cpp y MSVC), y
   el audio solo se afina con audio real. Opciones: un PC propio o de un
   amigo, o una máquina virtual (Parallels con Windows 11 ARM sirve para
   compilar y probar la interfaz, **no** para afinar audio ni GPU).
2. **Versión mínima.** La captura que excluye a la propia app (Fase 1) es de
   Windows 10 2004 (mayo de 2020) en adelante. Propuesta: Windows 10 2004+ y
   Windows 11.
3. **Crate nuevo: `windows`** (de Microsoft, MIT). Hace falta para el audio,
   las voces y saber qué hay conectado. Es el equivalente de `coreaudio-sys`.
   Solo se añade para Windows (`[target.'cfg(windows)'.dependencies]`).
4. **La GPU de la traducción** (Fase 2).
5. **¿Icono en la barra de tareas?** En el Mac la app no sale en el Dock. En
   Windows lo normal es que sí salga; ocultarlo puede confundir.

---

## Fase 1: el audio del sistema (lo más grande)

**Primera prueba real (2026-10-30, Dell con Windows 10 19041):** con el audio
del equipo la app se cerraba sola (`0xc0000374`, memoria corrompida, en
`ntdll.dll`); con el micrófono no. Se ajustó `system_audio.rs` (solo Windows)
al ejemplo de Microsoft: búfer de 20 ms (con 0 no hay periodo con que
calcularlo), sin `SRC_DEFAULT_QUALITY`, el aviso de activación «agile», la
operación viva hasta la respuesta y el aviso de eventos cerrado después del
cliente. Por probar.

**Hoy en Mac:** una «process tap» de Core Audio copia lo que suena, menos la
propia Lingora, para que su voz traducida no vuelva a entrar.

**En Windows:** la API equivalente existe y hace justo eso: captura de
*process loopback* de WASAPI (`ActivateAudioInterfaceAsync` con
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` y
`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`, pasando el PID de
Lingora). Es la misma idea que en el Mac, sin BlackHole ni drivers.

- Nuevo `mod imp` para Windows dentro de `system_audio.rs`, con la **misma
  forma pública**: `supported()`, `start(on_block)` → `Capture`, bloques mono
  de `BLOCK_FRAMES` muestras. `lib.rs`, `pipeline.rs` y la interfaz no se
  enteran.
- La captura entrega el formato de la mezcla del sistema (suele ser 48 kHz
  estéreo, `f32`): se pasa a mono como hoy.
- Ojo: WASAPI no entrega nada cuando no suena nada (en Mac llegaba silencio).
  Hay que rellenar con ceros para que el VAD de `audio.js` mida bien las
  pausas. Si no, los cortes de frase cambian.
- No pide permiso (en Mac sí, «Grabación de audio del sistema»).

**Riesgo:** medio. La API es poco usada y hay pocos ejemplos en Rust. En el
Mac, la mayoría de lo que costó (ver `problemas-conocidos.md`) salió al
probar con audio real, no al escribir el código. Hay que contar con lo mismo
aquí.

**Prueba:** un vídeo de YouTube en inglés → Traducir audio → la traducción no
debe volver a entrar (sin bucle) y los cortes de frase deben parecerse a los
del Mac.

## Fase 2: la traducción con la GPU de Windows

En el Mac todos los equipos tienen la misma GPU (Apple Silicon, memoria
compartida). En Windows varía mucho, y es **el mayor riesgo de rendimiento**:

| Opción | Funciona en | Pega |
|---|---|---|
| `vulkan` | NVIDIA, AMD, Intel (con drivers al día) | Hace falta el SDK de Vulkan solo en la máquina que compila |
| `cuda` | Solo NVIDIA | Pesado (cientos de MB), hay que llevar las librerías de CUDA |
| Solo CPU | Todos | Lento en portátiles: la traducción puede ir muy por detrás de la voz |

**Propuesta:** `vulkan` y, si falla al cargar, CPU (con aviso en el
diagnóstico). Hay que medir en un portátil normal sin GPU dedicada: si con
CPU tarda demasiado, la traducción en vivo no es viable allí y conviene
decirlo en la app.

**Pendiente (riesgo, 2026-10-30):** con `vulkan` el `.exe` enlaza
`vulkan-1.dll` al arrancar. La trae el driver de la GPU (casi todos los PC con
drivers al día), pero en un equipo sin driver o en una máquina virtual **la
app no abre**. Arreglo: la opción `dynamic-backends` de `llama-cpp-2` (carga
la GPU como DLL aparte solo si se puede; si no, CPU), o cargar `vulkan-1.dll`
con retraso (`/DELAYLOAD`) y comprobar antes si existe. Añadir también el
aviso en el diagnóstico.

**Intento con `vulkan` (2026-10-30), en curso:** la demo va con CPU y
`vulkan` es una opción de `Cargo.toml` (`--features vulkan`) que compila un
trabajo aparte del flujo. Lo que se vio en GitHub Actions (`windows-latest`, VS 2026, CMake 4):

- El SDK se instala con `jakoch/install-vulkan-sdk-action` (1.4.309.0), pero
  `ggml-vulkan` pide `find_package(SPIRV-Headers)` y el SDK no trae su
  configuración de CMake: se arregla compilando e instalando SPIRV-Headers de
  la etiqueta `vulkan-sdk-1.4.309.0` y poniendo `CMAKE_PREFIX_PATH`.
- Luego `vulkan-shaders-gen` (un proyecto CMake aparte que lanza llama.cpp)
  falla al probar el compilador con `C1041 … use /FS`. El mensaje engaña: la
  causa es la **longitud de la ruta** del `.pdb` (~268 caracteres dentro de
  `src-tauri/target/…`; `cl.exe` no pasa de 260). Ni `CL`/`CFLAGS=-FS` ni Ninja
  (que sí pone `/FS`) lo arreglan; Ninja además cambia `/MT` por `/MD`, que no
  casa con sherpa-onnx. Se prueba con `CARGO_TARGET_DIR=C:\t` (MSBuild).
- Ojo: Git Bash convierte `/FS` en una ruta (`C:/Program Files/Git/FS`) y su
  `/usr/bin/link` tapa el `link.exe` de Visual Studio: `cargo` va en `cmd`.
- Peso: el instalador en CPU pesa ~10 MB; con Vulkan, unos 10-20 MB más
  (shaders), sin medir.

- En `Cargo.toml`: `features = ["metal"]` pasa a ser solo para Mac, y
  `["vulkan"]` para Windows (sección por sistema).
- `translator.rs` no cambia, salvo `n_gpu_layers` si se cae a CPU.
- `build.rs`: `link_clang_runtime` ya es solo Mac.

## Fase 3: espeak-ng para Windows

- Compilar `espeak-ng.exe` con CMake y MSVC, con las mismas opciones que
  `build-espeak.sh`, y dejarlo en
  `src-tauri/binaries/espeak-ng-x86_64-pc-windows-msvc.exe`. Tauri elige el
  binario de cada sistema por el nombre, así que `tauri.conf.json` no cambia.
- **Los datos (`espeak-ng-data/`) son los mismos que los del Mac.** Conviene
  reutilizarlos: el disco de Windows tampoco distingue mayúsculas, así que
  compilar allí los fonemas tendría el mismo problema que en el Mac
  (`e_short_1` / `E_short_1`).
- `config.rs` (`bundled_espeak`): buscar `espeak-ng.exe` en Windows.
- `phonemizer.rs` (`data_dir`): en Windows los recursos van junto al `.exe`,
  no en `../Resources`. La búsqueda en la carpeta del binario ya lo cubre.
  Probar.
- Nuevo `scripts/build-espeak.ps1` (PowerShell), con el mismo SHA-256.

## Fase 4: qué hay conectado y la lista de dispositivos

- `route.rs`: con `IMMDeviceEnumerator`, la salida y la entrada por defecto y
  su `PKEY_AudioEndpoint_FormFactor` (Headphones/Headset → «headphones»,
  Speakers → «speakers»). Bluetooth: el identificador del dispositivo empieza
  por `BTHENUM` / `BTHHFENUM`.
- Bluetooth en Windows tiene el mismo problema que en el Mac: al abrir el
  micrófono de unos auriculares, pasan a «modo manos libres» y el sonido
  empeora. Windows lo muestra como dos dispositivos («Auriculares» y
  «Manos libres»). `meetingMic` en `route.js` ya evita abrir ese micrófono si
  hay otro; hay que comprobar que reconoce los nombres de Windows.
- `input_busy` (otra app usa el micrófono): en Windows no hay una forma
  sencilla. Se puede dejar en `false`.
- `audio.rs` (`list_devices`): con el mismo enumerador. Solo da nombres
  reales a los dispositivos: si falla, la interfaz usa los de WebView2.

## Fase 5: voces del sistema

`system_voice.rs` ya separa `voices()` y `synthesize()` por sistema. En
Windows, con `Windows.Media.SpeechSynthesis` (voces OneCore: idioma y género)
→ WAV → `tts::parse_wav`, como hoy hace `say` en Mac. Ya está anotado en
`plan-idiomas.md`. Sin esto la app funciona igual con la voz propia (Kokoro)
en los idiomas que cubre.

## Fase 6: lo pequeño

- **Carpeta de modelos** (`config.rs`): en Windows,
  `%LOCALAPPDATA%\lingora\models`. Mejor con la ruta de datos de la app que da
  Tauri que con `HOME`.
- **`keyring`:** añadir la opción `windows-native` (Administrador de
  credenciales de Windows) solo para Windows.
- **`open`** (`notes.rs`): usar `explorer /select,` para mostrar el archivo y
  `cmd /c start` (o el plugin `opener` de Tauri, que sería un crate nuevo)
  para el enlace de Groq.
- **Subtítulos flotantes:** la ventana transparente y por encima de todo la
  da Tauri. La parte de AppKit (`objc`) es solo Mac. Probar encima de un vídeo
  a pantalla completa en Chrome/Edge.
- **`set_activation_policy`:** ya es solo Mac. En Windows, lo que se decida en
  el punto 5.
- **Diagnóstico:** sin las comprobaciones de BlackHole, que en Windows no
  aplican. Añadir la de la GPU (Fase 2).
- **Procesos sin ventana:** espeak-ng y `tar` abrirían una consola negra un
  instante. Hay que lanzarlos con `CREATE_NO_WINDOW`.

## Fase 7: textos de la interfaz

Hay 25 textos en `src/i18n/es/` que dicen «Mac» («audio del Mac», «Solo
audio del Mac»…). Opciones: palabras neutras («del equipo», «del sistema») o
una clave por sistema. Lo decide el usuario.

## Fase 8: instalador y prueba en limpio

- `tauri.conf.json`: añadir el objetivo `nsis` (instalador `.exe`), con
  WebView2 incluido o descargado al instalar (Windows 11 ya lo trae).
- `scripts/check-standalone.ps1`: el equivalente de `check-standalone.sh`.
  Comprueba que todo lo que carga el `.exe` es de Windows (`dumpbin
  /dependents`), que espeak-ng pronuncia y que no aparecen rutas de la
  máquina que compila.
- **Prueba en limpio:** un Windows sin herramientas de desarrollo.

### Cómo se reparte

Una web o la nube no sirven: el navegador no capta el audio del sistema ni
mueve bien los modelos, y todo debe ser local. Siempre hay un programa que
instalar; lo que cambia es la fricción.

**Ahora (demo para amigos y familia, decidido 2026-10-29):** instalador `.exe`
(NSIS) sin firmar, enviado a mano (enlace de la nube o USB). Sin firma,
SmartScreen avisa; va con una nota de una línea: «si sale el aviso azul,
pulsa *Más información* → *Ejecutar de todas formas*». Es lo mismo que la
firma ad hoc en el Mac.

**Cómo se genera sin tener el proyecto en Windows:** se trabaja solo en el
Mac y en Windows solo se instala y se prueba el `.exe`.
1. Compilación cruzada en el Mac (`cargo-xwin` + LLVM + NSIS,
   `pnpm tauri build --target x86_64-pc-windows-msvc`). Experimental en
   Tauri; el riesgo son llama.cpp y sherpa-onnx (C++). Probar primero en una
   copia.
2. Si falla: GitHub Actions compila en un Windows suyo (repositorio privado;
   Lingora aún no es un repositorio git).

**Más adelante (para más gente):** Microsoft Store (sin avisos, con
actualizaciones; cuenta de desarrollador y revisión) o un certificado de
firma de código. Es el equivalente de la firma y notarización de Apple,
también pendiente. Alternativas descartadas por ahora: `.zip` portable (no se
desinstala normal) y `winget` (para gente técnica).

---

## Orden y tamaño

| Fase | Tamaño | Bloquea |
|---|---|---|
| 0. Compilar sin errores en Windows (Fases 3 y 6, a lo mínimo) | Pequeño | Todo |
| 1. Audio del sistema | **Grande** | Traducir audio, Tomar notas |
| 2. GPU de la traducción | Medio (sobre todo, medir) | Que la traducción vaya a tiempo |
| 4. Qué hay conectado | Medio | Solo afina el eco en «Reunión en línea» |
| 3, 6, 7, 8 | Pequeños | Instalador |
| 5. Voces del sistema | Medio | Solo los idiomas que Kokoro no cubre |

Primer hito útil: Fases 0 + 1 + 2 → Traducir audio funciona en Windows. Lo
demás se puede hacer después, sin prisa.
