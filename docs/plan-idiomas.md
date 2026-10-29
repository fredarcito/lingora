# Plan: más idiomas y paquetes de idioma descargables

Estado (2026-10-28):

- **Hecho: 37 idiomas**, todos los que traduce HY-MT2 en local y transcribe
  Whisper (todos menos el uigur, que Whisper no tiene). La lista vive en un
  solo sitio, `LANGS` en `src-tauri/src/config.rs`, y la UI la pide con el
  comando `languages`, que dice también qué voces hay en el equipo.
- **Todo local (desde 2026-10-28), sin Groq.**
- **Por idioma:**
  - Escuchar: Parakeet para los europeos (en, es, fr, it, pt, de, nl, pl,
    cs, ru, uk) y SenseVoice para zh, zh-hant, yue, ja y ko. Los demás (22)
    solo pueden ser idioma de destino: en el lado que se escucha salen como
    "(pronto)". Para escucharlos haría falta un Whisper local (whisper.cpp,
    ~550–830 MB, más lento) u Omnilingual de Meta (sherpa-onnx, CTC).
  - Voz: Kokoro en en, es, fr, it y pt; para los demás, la mejor voz del
    sistema instalada (`system_voice.rs`: Premium > Mejorada > normal, y
    del género pedido o, si no hay, del otro). Sin voz instalada, el idioma
    sale como "(sin voz)" y solo hay subtítulos.
  - En este Mac (macOS 26) hay voz para 27 de los 37. Sin voz: persa,
    urdu, guyaratí, maratí, filipino, jemer, birmano, tibetano, kazajo y
    mongol.
- **Subtítulos:** las escrituras sin espacios (china, japonesa, tailandesa,
  lao, tibetana, birmana, jemer) se separan en palabras con
  `Intl.Segmenter`; el árabe, el hebreo y el urdu se muestran de derecha a
  izquierda (`dir="auto"`); los cortes de frase entienden 。！？ । ۔ ؟ ။ ། ។.
- **Windows:** `system_voice.rs` ya separa la lista de voces y la síntesis
  por sistema. Falta implementarlas con `Windows.Media.SpeechSynthesis`
  (voces OneCore, con idioma y género); hasta entonces en Windows solo
  tendrían voz los cinco idiomas de Kokoro.
- **Pendiente:** escuchar en local los 22 idiomas restantes y los paquetes
  descargables.

Los paquetes no se hicieron porque el modelo de Kokoro ya trae sus 54 voces
(`voices.bin`, 27 MB): no hay nada más que descargar. Tienen sentido
cuando un idioma necesite piezas pesadas (ver abajo).

## Antes de la fase 1

La app solo tenía inglés y español: el tipo `Lang` (`config.rs`) solo tenía
`En` y `Es`, y los carriles iban fijos EN↔ES.

Cuántos idiomas cubre cada pieza:

| Pieza | Idiomas |
|---|---|
| Whisper en Groq (Precisa) | ~99 |
| Parakeet v3 (Rápida) | 25, solo europeos |
| qwen en Groq (Nube) | 100+ |
| HY-MT2 (Local) | 33 (incluye chino, japonés, coreano, árabe, hindi, alemán…) |
| Kokoro (voz) | 8: inglés, español, francés, italiano, portugués, hindi, japonés, chino |

El límite lo pone la voz:

- **Todo local** (Rápida + Local): 5 idiomas (en, es, fr, it, pt).
- **Con Whisper en Groq**: hasta 8, pero hindi, japonés y chino están sin
  probar. Hoy los fonemas salen de espeak-ng, y Kokoro se entrenó con otro
  sistema para japonés y chino.
- Kokoro no tiene alemán, ruso, árabe ni coreano. Piper (en sherpa-onnx) tiene
  voces para unos 40 idiomas, aunque menos naturales.

Abrir los 5 idiomas europeos es poco trabajo:

- Un selector de idioma por carril.
- Ampliar `Lang`, las voces y los glosarios.
- Revisar los filtros que solo conocen inglés y español (muletillas y
  alucinaciones de Whisper).

## Japonés y chino

1. **Escuchar:**
   - Whisper en Groq ya funciona con los dos.
   - En local, Parakeet no los reconoce. Las opciones:
     - SenseVoice Small (Alibaba; zh, ja, ko, yue, en; ~230 MB). Corre en
       sherpa-onnx, la misma librería que Parakeet. Falta comprobar que da
       tiempos por palabra.
     - Whisper local (large-v3-turbo, 834 MB; se borró al limpiar y habría que volver a bajarlo).
2. **Traducir:** no cambia. HY-MT2 es fuerte en chino↔inglés e incluye
   japonés; qwen también.
3. **Hablar, que es lo difícil:**
   - Kokoro tiene voces japonesas (5) y chinas (8), pero necesita la
     pronunciación de su entrenamiento, y espeak-ng no la da.
   - **Chino:** el Kokoro multilingüe de sherpa-onnx trae diccionario propio.
     Es viable y encaja con pasar Kokoro a sherpa-onnx
     (ver [plan-distribucion.md](plan-distribucion.md)).
   - **Japonés:** hace falta un analizador de kanji (OpenJTalk/MeCab). No hay
     una opción lista conocida para Rust; es lo más costoso.
   - **Alternativas:** MeloTTS (zh+en en sherpa-onnx) y Style-BERT-VITS2 para
     japonés. Esta última va en Python, así que no sirve para la app.
4. **Ajustes de la app para chino y japonés:**
   - Puntuación `。！？、，` en los cortes de frase (`audio.js`, `App.jsx`).
   - Sin espacios entre palabras: afecta a la unión de tokens en
     `listener.rs` y al corte entre palabras.
   - Los largos de frase en caracteres (`MIN_PHRASE_CHARS`,
     `MAX_PHRASE_CHARS`) deben ir por idioma.
   - Alucinaciones de Whisper propias de cada idioma, como
     "字幕由Amara.org社区提供".

Primero hay que comprobar dos cosas:

- Qué idiomas lee de verdad el Kokoro multilingüe de sherpa-onnx. Si incluye
  japonés, se simplifica mucho.
- Si SenseVoice da tiempos por palabra.

**Resumen:** el chino es viable a medio plazo. El japonés depende de resolver
la voz.

## Paquetes de idioma descargables

La voz en sí casi no pesa. Lo pesado es lo que necesita cada idioma.

| Pieza | Tamaño aprox. | ¿Por idioma? |
|---|---|---|
| Modelo de Kokoro | ~100–330 MB | No, uno para todos sus idiomas |
| Una voz de Kokoro | ~0,5 MB | Sí |
| Diccionario de pronunciación | Chino: pocos MB. Japonés: ~100 MB | Sí |
| Voz Piper (idiomas sin Kokoro) | ~60 MB | Sí |
| Modelo para escuchar en local (SenseVoice) | ~230 MB, compartido zh/ja/ko | A veces |

Por eso, en lugar de "descargar una voz", un **paquete de idioma** con voces,
diccionario y, si hace falta, el modelo para escuchar en local:

- En el carril se elige el idioma. Si no está instalado, sale "Descargar
  japonés (~350 MB)" con barra de progreso.
- El instalador trae solo inglés y español. El resto se baja cuando se pide,
  como los modelos del primer arranque.
- Una sección "Idiomas" muestra los paquetes instalados y permite borrarlos.

Ventajas:

- El instalador sigue pequeño.
- Un idioma se puede añadir o mejorar publicando su paquete, sin sacar una
  versión nueva de la app.

Lo que no resuelve: el paquete solo es la forma de repartir. Para el japonés
primero hace falta un motor que lo lea bien dentro de la app.
