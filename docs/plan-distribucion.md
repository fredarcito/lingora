# Plan: traducción local y una app sin dependencias externas

Estado: pendiente. Se hará después de la fase de pruebas. El plan detallado
para no depender de nada está en `plan-autonomia.md`.

Meta: que el usuario descargue un solo instalador, lo abra y la app baje sus
modelos la primera vez. Sin Homebrew, Node, espeak-ng ni configurar BlackHole.

## 1. Traducción local con HY-MT2 1.8B (dentro de la app)

Probado en el scratchpad (M1 Pro, 16 GB):

- HY-MT2 1.8B Q4_K_M (`tencent/Hy-MT2-1.8B-GGUF`, Apache 2.0): 1.1 GB, ~1.4 GB
  de RAM, ~0.3 s por frase. Más rápido que qwen en Groq (0.4-0.9 s).
- Q8 empató con Q4 en calidad, así que se usa Q4.
- TranslateGemma 4B quedó descartado: el doble de lento, el doble de grande y
  alarga las traducciones.
- Inglés → español: bien. Español coloquial y trozos cortados: flojo.
  - "Dale" queda sin traducir.
  - "buscarle otra vuelta" sale como "looked up again".
  - A veces quita el "and" final de un trozo.
- Pasarle contexto empeora las cosas:
  - Con el formato "Background Information" a veces traduce también el
    contexto, y la voz lo repite.
  - Con indicaciones extra a veces devuelve las propias instrucciones.
- Los parámetros oficiales (temperatura 0.7) inventan más; usar temperatura baja.

**Hecho (2026-10-29):** llama.cpp va dentro de la app (`llama-cpp-2`, con
Metal), en un hilo propio de `translator.rs`. Sin `llama-server` ni Homebrew.
Traduce igual que antes (30 de 30 frases idénticas sin azar). Lo que se
planeó entonces:

- llama.cpp dentro de la app con el crate `llama-cpp-2` (Metal), sin
  `llama-server` externo. Solo cambia el interior de `translator.rs`, que
  pasa al patrón de `listener.rs` (carga perezosa en el proceso); el resto de
  la lista ya está hecho.
- Prompt por defecto de HY-MT2:
  `Translate the following text into {lang}. Note that you should only output
  the translated result without any additional explanation:\n\n{text}`.
  - Sin contexto.
  - Temperatura 0.3.
  - `max_tokens` proporcional al texto.
- Glosario por dirección con el formato de terminología:
  `Reference the following translations:\n{a} translates to {b}\n\n...`.
  Solo incluye las entradas que aparecen en la frase.
- Sustitución previa para los casos que el glosario no arregla
  ("Dale," → "OK,").
- Solo en modo local con transcripción Precisa (con Rápida sumaba ~4 s de
  retraso): traducir hasta el último `.?!` y guardar el resto en
  `rt.carry`. Si ya se guardó un trozo, cortar en la última coma o mandarlo
  todo, la misma regla que `splitAtSentenceEnd`.
- Selector por carril: "Traducción: Nube (qwen) / Local (HY-MT2)", que se
  puede cambiar sin detener el carril. La traducción condensada no aplica en
  modo local.
- Diagnóstico: "Traducción local" con un botón "Descargar".
- A futuro: afinar el 1.8B con LoRA (el repositorio trae scripts) con pares de
  frases de llamadas generados con qwen.

## 2. Voz con sherpa-onnx en lugar de Node + Kokoro-js

- **Hecho (2026-10-28):** Kokoro corre dentro de la app con sherpa-onnx, la
  misma librería que Parakeet. Ya no hace falta Node. El modelo (`fp32`,
  ~350 MB de descarga) se baja desde el diagnóstico y se libera con los demás
  tras 3 minutos parado.
- **Hecho (2026-10-29): espeak-ng** va dentro de la app como programa propio
  (`externalBin`, por su licencia GPL), con 2 MB de datos. Lo compila
  `scripts/build-espeak.sh`.

## 3. Capturar el audio de la llamada sin BlackHole

- **Hecho (2026-10-28):** Escuchar usa una tap global de Core Audio que
  excluye a Lingora (`src-tauri/src/system_audio.rs`), elegida por defecto
  como "Audio del Mac". Falta probar el permiso en la app firmada (en
  desarrollo se lo pide a VS Code o a la terminal).
- Core Audio process taps (macOS 14.2+) capturan el audio de otras apps
  directamente.
- Quita BlackHole y la salida múltiple del carril remoto → local.
- El carril local → remoto sigue necesitando un micrófono virtual: macOS no
  permite crear uno sin un driver.

## 4. Primer arranque e instalador

- **Hecho (2026-10-28):** bienvenida la primera vez (`src/pages/Welcome/`). Explica
  cómo funciona mientras descarga escuchar, traducir y voz (~1,9 GB) con
  progreso real y tiempo restante. Las descargas siguen donde se cortaron
  (`src-tauri/src/models.rs`). Plan B: se puede saltar, y si la bienvenida
  falla se entra a la app; lo que falte se baja desde el diagnóstico.
- Instalador firmado en local (`signingIdentity: "-"`). Para otros Macs falta
  la firma de Apple (Developer ID) y la notarización.
- El instalador incluye el micrófono virtual, que se instala con un clic. Si
  es BlackHole, hace falta licencia comercial, porque es GPL. Otra opción es un
  driver propio.
- La nube (qwen o Whisper), si se ofrece, va por un servidor nuestro. La clave
  nunca va dentro de la app.

## Limpieza (hecha el 2026-10-28)

- Borrados el Whisper local (`ggml-large-v3-turbo-q8_0.bin`, 834 MB) y
  `translategemma:4b` de Ollama (3.3 GB).
- `llama.cpp` y `ggml` de Homebrew ya no hacen falta para la app (solo
  sirven para comparar con `llama-server` en las pruebas)
  para la traducción local.
- `cmake` se queda: es pequeño y puede hacer falta para compilar sherpa-onnx.

## Tamaño estimado

| Pieza | Tamaño |
|---|---|
| Instalador (.dmg): app, sherpa-onnx, llama.cpp y driver | ~30-60 MB |
| Parakeet v3 int8 (primer arranque) | ~640 MB |
| HY-MT2 1.8B Q4 (primer arranque) | ~1.1 GB |
| Kokoro (primer arranque, según precisión) | ~100-350 MB |
| Total en disco | ~2-2.2 GB |
