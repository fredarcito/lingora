# Plan: una app que no depende de nada

Estado: Fases 1, 2 y 6 hechas (2026-10-29); el resto, pendiente. Amplía los puntos 1, 2 y 4 de
`plan-distribucion.md`.

Meta: quien la recibe descarga un `.dmg`, la arrastra a Aplicaciones y todo
funciona: escuchar, traducir, voz, notas y resumen. Sin Homebrew, sin
Terminal, sin avisos de seguridad. Lo único que se baja después son los
modelos, desde la propia app.

---

## 0. Qué depende hoy de algo de fuera

Revisado en el código y en el binario de `release` (`otool -L`):

| Pieza | Hoy | ¿Problema? |
|---|---|---|
| Escucha, voz Kokoro, personas (sherpa-onnx) | Va **dentro** del binario (enlace estático) | No |
| Traducción (llama.cpp) | Lanza `/opt/homebrew/bin/llama-server` como proceso aparte (`translator.rs`, `config.rs`) | **Sí**: sin Homebrew no traduce |
| Fonemas de la voz (espeak-ng) | Lanza `/opt/homebrew/bin/espeak-ng` en cada frase (`phonemizer.rs`) | **Sí**: sin Homebrew no hay voz Kokoro |
| Resumen de notas | Groq, con la clave del usuario (`notes.rs`) | Es nube y pide una cuenta |
| Modelos | Se bajan de GitHub (sherpa-onnx) y Hugging Face (HY-MT2) | Dependen de terceros: si cambian una URL, la app se rompe |
| Firma | Ad hoc (`signingIdentity: "-"`) | **Sí**: en otro Mac, macOS la bloquea |
| `tar`, `open`, `say`, `ps`, `kill` | Vienen con macOS | No |
| Diagnóstico | Comprueba espeak-ng y llama-server de Homebrew (`doctor.rs`) | Hay que cambiarlo con lo de arriba |

Todo lo marcado con **Sí** está en la lista de «no tocar» de CLAUDE.md
(`translator.rs`, `phonemizer.rs`, `config.rs`, `models.rs`, `doctor.rs`,
`tauri.conf.json`, la firma y los crates nuevos). **Cada fase necesita el sí
del usuario antes de empezar**, y cada una se prueba en una copia del
proyecto antes de tocar `src-tauri` (ver §2 de CLAUDE.md).

---

## Fase 1: la traducción, con llama.cpp dentro de la app

**Hoy:** `translator.rs` arranca `llama-server` (el servidor de llama.cpp) en
un puerto local, espera a `/health` y le pide la traducción en streaming por
HTTP.

**Cambio:** usar llama.cpp como **librería**, dentro del proceso, con el
crate `llama-cpp-2` (MIT, con Metal). Es lo que ya se decidió: nada de
programas aparte.

- Solo cambia el **interior** de `translator.rs`; su forma pública se queda
  igual (`new`, `is_installed`, `warm_up`, `shutdown`, `translate` con
  `on_delta`). `pipeline.rs` y el frontend no se enteran.
- Pasa al patrón de `listener.rs`: carga perezosa del modelo al primer uso,
  en su hilo, y se libera tras 3 minutos parado como los demás.
- **Mismos parámetros que hoy**, para no perder calidad: temperatura 0,3,
  `max_tokens = min(caracteres/2 + 32, 512)`, contexto 4096, todas las capas
  en la GPU (`-ngl 99`), el mismo prompt de HY-MT2 y la plantilla de chat del
  modelo. Antes de cambiar, sacar 30 frases de prueba con `llama-server` y
  comparar que salgan iguales (o casi) con la librería.
- `on_delta` se llama con cada trozo que sale del bucle de tokens, igual que
  ahora con el streaming HTTP.
- Sobran: `kill_previous`, el archivo del PID, el puerto y el log en `/tmp`.
  También `llama_server_bin` en `config.rs`.
- **Compilar** necesita `cmake` en el Mac de desarrollo (ya está); quien usa
  la app no necesita nada. El binario crece unos 5–10 MB.
- **Riesgo:** que ggml y onnxruntime choquen al enlazarse juntos. Se
  comprueba primero en una copia con un `main` de prueba que cargue los dos.

**Plan B** (solo si `llama-cpp-2` da problemas): meter `llama-server`
**dentro** del `.app` como ejecutable propio (`externalBin` de Tauri) y
seguir lanzándolo como hoy. Cambia una ruta y poco más, pero sigue siendo un
proceso aparte.

**Crate nuevo:** `llama-cpp-2` (hay que preguntar).

## Fase 2: los fonemas, con espeak-ng dentro de la app

**Hoy:** `phonemizer.rs` ejecuta `espeak-ng -v <idioma> -q --ipa <texto>`
desde Homebrew en cada frase.

**Ojo con la licencia:** espeak-ng es **GPL v3**. Si se enlaza como librería
dentro de Lingora, toda la app pasa a ser GPL (código abierto obligatorio).
Si va como **programa aparte dentro del `.app`**, es solo distribuirlo junto
a la app: basta con incluir su licencia y ofrecer su código fuente.

**Cambio recomendado:** espeak-ng como programa propio de la app.

- Compilarlo desde su código fuente para Apple Silicon, sin dependencias
  (`--without-pcaudiolib --without-sonic`), con un script en
  `scripts/build-espeak.sh` que deje el binario y `espeak-ng-data` (~10 MB,
  solo los idiomas que usa Kokoro).
- Meterlo en el `.app` con `externalBin` (el binario, en `Contents/MacOS`)
  y `resources` (los datos, en `Contents/Resources`) de `tauri.conf.json`.
- `phonemizer.rs` solo cambia la ruta: el binario de dentro de la app, con
  `--path=<Resources>/espeak-ng-data`. La llamada, los fonemas y las
  interjecciones se quedan igual.
- En desarrollo sigue sirviendo `LINGORA_ESPEAK_BIN` para apuntar a otro.
- Añadir `LICENSES/espeak-ng.txt` y una línea en «Acerca de» con el enlace
  a su código fuente.

**Alternativa sin GPL** (más trabajo, para más adelante): un conversor de
texto a fonemas propio o con licencia permisiva. No hay uno bueno en Rust
para todos los idiomas de Kokoro, así que no compensa ahora.

## Fase 3: el resumen, en local

**Hoy:** Groq con la clave del usuario. Es la única excepción a «todo
local», y en la memoria del proyecto consta que era solo para probar.

**Cambio:** el resumen con un modelo local, sobre el **mismo llama.cpp** de
la fase 1 (sin motor nuevo).

- Un modelo de instrucciones pequeño en GGUF (unos 2–3 GB en Q4), que se
  descarga aparte desde Ajustes o la primera vez que se pide un resumen. En
  la interfaz se llama «el resumen», sin nombre de modelo.
- Elegirlo probando con 3 notas reales (una de 5 min, otra de 30 y otra de
  55) en español e inglés: calidad, tiempo y memoria. El contexto tiene que
  dar para una reunión de una hora; si no da, resumir por trozos y luego
  juntar.
- La memoria: el traductor (~1,4 GB) y el modelo del resumen no deberían
  estar cargados a la vez. El resumen se pide con la toma de notas parada,
  así que se libera uno antes de cargar el otro.
- Groq, la clave y el llavero salen de la interfaz. Si se quiere conservar
  como opción avanzada, va detrás de un interruptor y apagada por defecto.

**Decisión del usuario:** ¿quitar Groq del todo o dejarlo como opción?

## Fase 4: los modelos, desde un sitio propio

**Hoy:** las URLs apuntan a GitHub (sherpa-onnx) y Hugging Face. Si renombran
un archivo, la bienvenida falla para todo el mundo.

**Cambio:**

- Subir una copia de cada modelo a un almacenamiento propio (Cloudflare R2
  o los Releases de un repositorio propio), con su versión en el nombre.
- Un manifiesto (`models.json`) con URL, tamaño y SHA-256 de cada uno.
  `models.rs` comprueba el SHA-256 al terminar cada descarga: un archivo
  corrupto no se instala.
- Si la copia propia falla, se intenta la URL original.
- Revisar la licencia de cada modelo para poder redistribuirlo (HY-MT2,
  Parakeet, SenseVoice, Kokoro, el de las personas y el del resumen).

## Fase 5: firma, notarización e instalador

- Cuenta de **Apple Developer** (99 USD al año) y certificado «Developer ID
  Application».
- `tauri.conf.json`: `signingIdentity` con ese certificado y hardened
  runtime. Los permisos (`entitlements.plist`) siguen con
  `audio-input`; los textos de permisos ya están en `Info.plist`.
- Tauri firma también los programas de `externalBin` (espeak-ng). Comprobar
  que llama.cpp con Metal funciona con hardened runtime, sin permisos extra.
- Notarizar al compilar (`APPLE_ID`, `APPLE_PASSWORD` de aplicación,
  `APPLE_TEAM_ID` en el entorno, nunca en el código).
- Actualizaciones con el plugin `updater` de Tauri: la app avisa de la
  versión nueva y se actualiza sola. Sus claves de firma, fuera del
  repositorio.
- Solo Apple Silicon y macOS 14.2 o posterior: decirlo en la página de
  descarga y en la bienvenida si el Mac no cumple.

**Crate o plugin nuevo:** `tauri-plugin-updater` (hay que preguntar).

## Fase 6: comprobarlo en un Mac limpio

- **Script** `scripts/check-standalone.sh`, que falla si:
  - `otool -L` de cualquier binario del `.app` apunta fuera de `/usr/lib` y
    `/System`;
  - el binario contiene `/opt/homebrew` o `/usr/local` (`strings`);
  - `codesign --verify --deep --strict` o `spctl -a -vv` fallan.
- **Prueba de verdad:** una máquina virtual de macOS (UTM, en el mismo Mac) o
  el Mac de un amigo, sin Homebrew. Instalar el `.dmg` y recorrer:
  bienvenida y descargas, Traducir audio con voz, Tomar notas («Reunión en
  línea» y micrófono) y un resumen.
- Mientras tanto, en el Mac de desarrollo: renombrar `/opt/homebrew/bin/
  llama-server` y `espeak-ng` y comprobar que todo sigue funcionando.

## Extra: registros para quien prueba

Hoy los registros salen por la terminal, y en la app instalada no se ven.
Guardarlos también en `~/Library/Logs/Lingora/` (rotando, los últimos días)
y añadir en Ajustes → Diagnóstico un botón «Copiar registro» para mandarlo.

---

## Orden y tamaño

| Fase | Qué arregla | Tamaño | Puede ir sola |
|---|---|---|---|
| 2. espeak-ng | La voz sin Homebrew | Pequeña | Sí |
| 1. llama.cpp | La traducción sin Homebrew | Mediana | Sí |
| 6. Script de comprobación | Saber que no queda nada fuera | Pequeña | Sí, en paralelo |
| 4. Modelos propios | Que las descargas no se rompan | Pequeña-mediana | Sí |
| 3. Resumen local | Quitar la nube y la clave | Mediana | Después de la 1 |
| 5. Firma y actualizaciones | Que se abra sin avisos | Pequeña (más la cuenta de Apple) | Al final |

Se empieza por la 2 porque es la más corta y ya deja la voz funcionando.

## Decisiones del usuario (2026-10-29)

1. Sí a `llama-cpp-2` y a tocar los archivos de las fases 1, 2 y 6.
2. Sí a espeak-ng como programa dentro de la app.
3. Groq se queda para el resumen mientras sea una demo; la Fase 3 espera.
4. Los modelos siguen bajándose de GitHub y Hugging Face; la copia propia
   espera. Sí se comprueba que cada descarga llegue entera.
5. La firma de Apple, después. Ahora la meta es que funcione sin la
   configuración del Mac de desarrollo (sin Homebrew).

## Hecho (2026-10-29)

- **Fase 2, espeak-ng:** `scripts/build-espeak.sh` lo compila (versión y
  SHA-256 fijos, en un disco que distingue mayúsculas y montado en una ruta
  corta: con rutas largas espeak-ng corta los nombres de archivo). Sale en
  `src-tauri/binaries/` y `src-tauri/resources/espeak-ng-data/` (solo en, es,
  fr, it y pt: 2,1 MB). Da los mismos fonemas que el de Homebrew en los 5
  idiomas. `phonemizer.rs` le pasa `--path` con los datos de la app.
- **Fase 1, llama.cpp:** `translator.rs` con `llama-cpp-2` (Metal, sin
  `openmp`, que pediría libomp de Homebrew). Un hilo tiene el modelo y su
  contexto; las traducciones van en cola. Mismo prompt (plantilla de HY-MT2
  escrita tal cual la arma `llama-server`) y mismo muestreo. Con
  `same_as_llama_server` (sin azar): 30 de 30 frases idénticas, 150–350 ms
  en compilación de pruebas. `shutdown` espera a que el hilo suelte la GPU:
  si no, Metal aborta al salir.
- **Fase 6:** `scripts/check-standalone.sh`.
- Fuera: `llama_server_bin`, `LINGORA_LLAMA_SERVER_BIN`, el aviso «Falta
  llama.cpp» del diagnóstico y los `brew install` de los mensajes.
