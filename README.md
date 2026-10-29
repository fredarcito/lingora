# Lingora

Traductor de voz en tiempo real para macOS, **todo en local**: nada sale del
equipo ni depende de una API. Lingora escucha el audio del Mac (un vídeo, una
llamada), lo transcribe, lo traduce y lo muestra como subtítulos o lo dice con
una voz sintética; en modo llamada hace lo mismo con tu micrófono en la
dirección contraria. 37 idiomas de destino; se pueden escuchar los 11 europeos
de Parakeet más chino, cantonés, japonés y coreano (ver docs/plan-idiomas.md).

## Estado

Fase 0 (validación) completada y scaffold de la app generado. Lo que está
comprobado con ejecuciones reales está marcado abajo; lo que no, también.

| Pieza | Estado |
|---|---|
| Captura de audio del sistema (BlackHole 2ch) | Verificado |
| Captura de micrófono | Verificado |
| Envío de voz a BlackHole (micrófono virtual para la llamada) | Verificado |
| Sin realimentación (voz traducida → bocinas, no → BlackHole) | Verificado |
| Transcripción local (Parakeet v3; SenseVoice para zh/yue/ja/ko) | Verificado |
| Traducción local (HY-MT2 1.8B con llama.cpp dentro de la app) | Verificado |
| Groq (Whisper / qwen) | Fuera de la UI desde 2026-10-28; el código sigue en `groq.rs` |
| Fonemas español/inglés (`espeak-ng`, dentro de la app) | Verificado |
| Voz (Kokoro en sherpa-onnx, voces `em_alex` / `am_michael`) | Verificado |
| Backend Rust compila | Verificado |
| Frontend compila (`vite build`, JS/JSX) | Verificado |
| App arranca (`tauri dev`) | Verificado |
| Grabación desde la UI en WKWebView | **Sin verificar** (pendiente de prueba manual) |
| Dirección B con una llamada real | **Sin verificar** |

## Arquitectura

```
Audio del sistema ──► Salida múltiple "Lingora" (Bocinas + BlackHole 2ch)
                              └──► BlackHole 2ch ──► WebView (captura)
                                                          │ cada 0,5 s
                                                          ▼
                                              Rust: Parakeet (local) → subtítulos en
                                                    vivo y dónde termina cada frase
                                                          │ WAV 16 kHz de la frase
                                                          ▼
                                              Rust: Whisper (Groq) → qwen (Groq)
                                                          │ texto
                                                          ▼
                                              espeak-ng → fonemas IPA
                                                          │
                                                          ▼
                                              Kokoro (sherpa-onnx) → PCM 24 kHz
                                                          │
                                                          ▼
                                              WebView: reproduce en el dispositivo
                                              de salida elegido (nunca la salida múltiple)
```

La dirección contraria usa el micrófono como entrada y BlackHole 2ch como salida
(la llamada lo selecciona como micrófono).

### Por qué cada decisión

- **Core Audio taps para Escuchar, BlackHole para Hablar**: en macOS 14.2+
  Escuchar oye el audio del Mac con una tap global que excluye a Lingora
  (`system_audio.rs`): sin driver, sin salida múltiple y sin que la voz
  traducida vuelva a entrar. La primera vez macOS pide "Grabación de audio del
  sistema". Hablar sigue necesitando BlackHole como micrófono virtual, porque
  macOS no permite crear uno sin driver. En Macs más antiguos Escuchar puede
  seguir usando BlackHole.
- **Todo local, sin Groq** (desde 2026-10-28): gratis para cualquier número de
  usuarios, sin cuotas ni errores 429, sin internet y sin que el audio salga
  del equipo. A cambio, algo menos de calidad que Whisper + qwen en la nube,
  y unos 2–2,5 GB de RAM con los modelos cargados (se sueltan tras 3 minutos
  parado). Antes se usaba Groq: `qwen3.8-27b` fue el más rápido y estable
  (344 ms de media).
- **SenseVoice para chino, cantonés, japonés y coreano**: Parakeet no los
  entiende. SenseVoice Small int8 (2024-07-17, ~240 MB) tarda ~0,3 s en 7 s de
  audio y pone puntuación; la versión de 2025-09-09 no la pone y falla en
  japonés. Los idiomas que ninguno de los dos escucha (árabe, hindi…) solo
  sirven como destino hasta tener un Whisper local.
- **Parakeet en local para cortar frases** (historia: antes el texto salía de Whisper): medido en
  un M1 Pro. Parakeet v3 int8 (sherpa-onnx) tarda ~0,25 s en escuchar la frase
  en curso, así que se puede repetir cada medio segundo y cortar el audio entre
  dos palabras en cuanto termina una frase, en vez de esperar una pausa o
  cortar a los 5 s a mitad de palabra. Pero en inglés comete más errores que
  Whisper (7 frente a 3 en las pruebas), así que el texto que se traduce sigue
  saliendo de Whisper. Whisper en local (whisper.cpp con Metal) da la misma
  calidad que Groq pero tarda ~0,9 s por trozo: no aporta velocidad.
- **Traducción local opcional con HY-MT2 1.8B**: qwen en Groq se queda sin
  cuota en el plan gratuito (1.000 peticiones al día, 8.000 tokens por minuto)
  y pierde trozos. HY-MT2 Q4_K_M (1,1 GB) tarda ~0,3 s por frase en un M1 Pro.
  Va bien de inglés a español; con español coloquial y frases cortadas es más
  flojo, así que en modo local va con un glosario de coloquialismos y sin
  contexto (con contexto a veces lo traduce también). Con transcripción Precisa
  además espera a que termine cada frase; con Rápida corta en las comas, porque
  esperar al punto sumaba ~4 s de retraso.
  TranslateGemma 4B se descartó: el doble de lento y alarga las traducciones.
- **Kokoro para la voz**: Groq TTS solo tiene inglés y requiere aceptar términos.
- **espeak-ng para fonemas**: con texto español directo Kokoro suena con
  acento inglés. Con fonemas de espeak-ng la transcripción de la salida es
  exacta. Se le pasan a Kokoro ya calculados (`phoneme_codepoints`).
- **Kokoro dentro de la app, con sherpa-onnx** (antes Node + `kokoro-js` en un
  proceso aparte): sin Node, menos memoria y la misma velocidad con 4 hilos
  (~0,22× la duración del audio). Modelo `fp32`: el `int8` tarda 2,5 veces más
  en Apple Silicon.

## Problemas conocidos

La app revisa su propia configuración (panel de diagnóstico) y arregla lo que
puede. Síntomas, causas y soluciones en
[docs/problemas-conocidos.md](docs/problemas-conocidos.md).

## Requisitos

```bash
pnpm install                 # frontend y Tauri CLI
scripts/build-espeak.sh      # compila espeak-ng para meterlo en la app (una vez)
```

Para compilar hacen falta `cmake` y las herramientas de Xcode (llama.cpp y
espeak-ng se compilan dentro de la app). Quien usa la app no instala nada:
`scripts/check-standalone.sh` comprueba que el `.app` no dependa de nada de
fuera.

El modelo de subtítulos en vivo (Parakeet, ~470 MB) se descarga desde el panel
de diagnóstico («Descargar») en `~/Library/Application Support/lingora/models/`.
Sin él la app funciona igual, cortando las frases solo por pausas.

La traducción local usa llama.cpp dentro de la app y el modelo HY-MT2
(~1,1 GB), que también se descarga desde el diagnóstico.

El proyecto usa **pnpm** y **JavaScript/JSX** sin
TypeScript. Los tipos del puente con Rust están documentados con JSDoc.

Rust (stable) es necesario para compilar la app.

## Configuración

Crea un `.env` en la raíz (está en `.gitignore`):

```
GROQ_API_KEY=tu_clave
```

Variables opcionales:

| Variable | Por defecto |
|---|---|
| `LINGORA_STT_MODEL` | `whisper-large-v3-turbo` |
| `LINGORA_TRANSLATION_MODEL` | `qwen/qwen3.8-27b` |
| `LINGORA_ESPEAK_BIN` | El `espeak-ng` que va dentro de la app |
| `LINGORA_TTS_MODEL_DIR` | `models/kokoro-multi-lang-v1_0` |
| `VITE_CALL_MODE` | `false`: «Traducir llamada» sale bloqueada mientras se termina. Se lee al compilar la interfaz (`.env` o entorno). |
| `LINGORA_TRANSLATOR_MODEL` | `models/Hy-MT2-1.8B-Q4_K_M.gguf` |
| `LINGORA_SPEAKER_MODEL` | `models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (distinguir personas en las notas) |

## Uso

1. Crea la salida múltiple **Lingora** (Bocinas + BlackHole 2ch) en *Audio MIDI
   Setup* y selecciónala como salida del sistema.
2. Arranca la app: `pnpm tauri dev`.
3. En la app, elige la entrada de cada dirección (BlackHole para el audio
   remoto, micrófono para el tuyo) y la salida donde quieres oír la traducción.
4. En la app de la llamada, selecciona **BlackHole 2ch** como micrófono.

## Estructura

```
src/                  Frontend React en JS/JSX (UI, captura y reproducción)
src-tauri/src/
  lib.rs              Comandos Tauri
  pipeline.rs         Pipeline por dirección, con tiempos por etapa
  groq.rs             Whisper y traducción
  listener.rs         Escucha local (Parakeet)
  translator.rs       Traducción local (HY-MT2 con llama.cpp, en su hilo)
  phonemizer.rs       espeak-ng (el de la app, ver scripts/build-espeak.sh)
  tts.rs              Voz (Kokoro en sherpa-onnx)
  audio.rs            Enumeración de dispositivos (Core Audio)
  config.rs           Ajustes por entorno
```

## Gestor de paquetes

Se usa **pnpm**. pnpm 12 bloquea los scripts de instalación por defecto; el
único paquete que los necesita (`esbuild`) está aprobado en
`pnpm-workspace.yaml` (`allowBuilds`).

## Limitaciones conocidas

- En inglés, Parakeet comete algo más de errores que Whisper en la nube.
- Kokoro tarda ~0,22× la duración del audio. Para conversación fluida conviene
  frases cortas.
- Solo macOS.
