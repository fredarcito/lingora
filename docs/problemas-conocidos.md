# Problemas conocidos

Problemas reales encontrados al probar Lingora en un Mac, con el síntoma tal
como lo ve quien usa la app, la causa y lo que hace la app al respecto.

La mayoría son de **configuración del audio de macOS**, no del código. La app
los revisa en el panel de diagnóstico (arriba de todo): las dependencias al
abrirse y el audio cada 5 segundos. Cuando hay un arreglo automático aparece un
botón.

| Síntoma | Causa | ¿Lo detecta la app? | ¿Lo arregla? |
|---|---|---|---|
| Solo traduce la última frase / se corta / suena "como dentro de un pote" | "Lingora" es un dispositivo agregado, no una salida múltiple | Sí | Sí |
| Se corta a ratos | BlackHole y la salida a frecuencias distintas | Sí | Sí |
| No traduce nada, el medidor no se mueve | La salida del sistema no pasa por BlackHole | Sí, y aviso en el carril | Sí |
| Dejó de funcionar al conectar auriculares | macOS cambió la salida (y la entrada) a los auriculares | Sí, en menos de 5 s | Sí |
| El vídeo no se oye | La salida del sistema es BlackHole a secas | Sí | Sí |
| Detecta voz poco o nunca | Volumen de BlackHole bajo / vídeo muy bajo | Sí | Sí (volumen de BlackHole) |
| La voz traducida se repite en bucle | La traducción sonaba por la salida que alimenta la captura | — | Imposible por diseño |
| "No se pudo abrir la salida: the requested device is no longer available" con AirPods | Los AirPods son dos dispositivos con el mismo nombre (entrada y salida) | — | Resuelto en el código |
| Mi voz se oye mal / lejana | Micrófono Bluetooth en modo llamada | Sí (aviso) | No |
| Mi voz llega muy baja | Ganancia automática desactivada en el micrófono | — | Resuelto en el código |
| La voz traducida se corta a mitad en frases largas | Límite de 510 tokens de Kokoro | — | Resuelto en el código |
| Deja de funcionar tras reiniciar el audio del sistema | El WebView pierde el dispositivo | Sí (aviso en el carril) | No: reiniciar la app |
| Falta espeak-ng / un modelo / BlackHole | Instalación incompleta | Sí | No: indica el comando |
| La voz suena cortada: una frase no termina y empieza otra | Frases partidas por el corte de 5 s + la salida se abría y cerraba en cada frase | — | Resuelto en el código |
| La traducción empieza 10–15 s tarde | Trozos largos + voz generada entera + Kokoro lento | — | Resuelto en el código |

---

## Enrutado de audio

Lingora oye la llamada así: la salida del sistema es una **salida múltiple**
llamada "Lingora" que manda el mismo audio a las bocinas (para que tú lo oigas)
y a **BlackHole 2ch** (un cable virtual). La app graba de BlackHole.

```
App de la llamada / vídeo
        │
        ▼
Salida del sistema: "Lingora" (salida múltiple)
        ├──► Bocinas / auriculares  → lo oyes tú
        └──► BlackHole 2ch          → lo captura Lingora
```

### "Lingora" es un dispositivo agregado en lugar de una salida múltiple

- **Síntoma:** la grabación suena entrecortada y metálica, "como dentro de un
  pote". Whisper solo entiende trozos, normalmente el final, así que la app
  traduce solo la última frase.
- **Causa:** en Configuración de Audio MIDI hay dos tipos de dispositivo que se
  parecen. Un *dispositivo agregado* junta entradas y salidas de varios
  aparatos con relojes distintos. Una *salida múltiple* manda el mismo audio a
  varias salidas. Se distinguen porque el agregado tiene canales de entrada.
- **Detección:** la salida del sistema es un agregado con canales de entrada.
- **Arreglo automático:** borra el "Lingora" anterior y crea una salida
  múltiple con la salida real actual (o las bocinas) como dispositivo
  principal, más BlackHole 2ch con corrección de deriva.
- **A mano:** Configuración de Audio MIDI → "+" → *Crear dispositivo de salida
  múltiple*. Marca las bocinas y BlackHole 2ch, elige las bocinas como
  *dispositivo principal* y activa *Corrección de deriva* solo en BlackHole.

### Frecuencias distintas

- **Síntoma:** cortes y saltos en la captura.
- **Causa:** BlackHole iba a 48000 Hz y las bocinas a 44100 Hz. La corrección
  de deriva no compensa una diferencia así.
- **Arreglo automático:** pone BlackHole a la frecuencia de la salida principal.
- **A mano:** Configuración de Audio MIDI → BlackHole 2ch → *Formato*.

### La salida del sistema no pasa por BlackHole

- **Síntoma:** al pulsar "Traducir en automático" el medidor no se mueve y
  nunca aparece "● voz". Pasados 8 segundos el carril avisa.
- **Causa:** la salida del sistema son las bocinas o unos auriculares, así que
  el audio nunca llega a BlackHole.
- **Arreglo automático:** crea (o recrea) "Lingora" y la pone como salida.

### Se conectaron unos auriculares

- **Síntoma:** funcionaba y de repente deja de traducir.
- **Causa:** al conectar unos auriculares (AirPods, por ejemplo) macOS pasa a
  ellos la salida *y la entrada* del sistema, y el audio deja de pasar por
  "Lingora".
- **Detección:** el diagnóstico se repite cada 5 segundos y lo marca enseguida.
- **Arreglo automático:** crea "Lingora" con los auriculares como salida
  principal, para seguir oyendo por ellos.

### La salida del sistema es BlackHole a secas

- **Síntoma:** Lingora traduce, pero no oyes la llamada ni el vídeo.
- **Causa:** BlackHole es un cable virtual y no suena por ningún altavoz.
- **Arreglo automático:** igual que el anterior.

### Volumen de BlackHole bajo

- **Síntoma:** el medidor apenas se mueve y la voz no se detecta.
- **Causa:** la entrada de BlackHole estaba al 73 %, y el vídeo ya llegaba con
  poco nivel.
- **Arreglo automático:** sube la entrada de BlackHole al 100 %.
- **En el código:** el umbral de detección de voz es bajo (0,002 RMS) y las
  frases se normalizan antes de mandarlas a Whisper.
- **A mano:** sube también el volumen del reproductor o de la app de la llamada.
  Con una salida múltiple las teclas de volumen del Mac no funcionan. Para la
  voz traducida, cada carril tiene su propio control de volumen (0–200 %).

### La traducción se oye en bucle

- **Síntoma:** las mismas frases se repiten una y otra vez, y aparecen
  "transcripciones" en español en el carril de inglés.
- **Causa:** la voz traducida sonaba por "Lingora", volvía a entrar por
  BlackHole y se traducía otra vez. El WebView de macOS (WKWebView) no
  implementa `AudioContext.setSinkId`, así que no puede elegir la salida.
- **En el código:** la voz se reproduce desde Rust (`cpal`) en el dispositivo
  elegido. Las salidas que alimentan la captura (BlackHole 2ch, "Lingora") no se
  pueden elegir, y el backend se niega a reproducir en ellas.
- **Nota técnica:** `cpal` no sabe leer los formatos de las bocinas integradas
  en macOS reciente ("Invalid property value") y no las lista. La app las busca
  entre todos los dispositivos y usa la frecuencia que da Core Audio. Pedir otra
  frecuencia haría que `cpal` la cambiara y descuadraría la salida múltiple.

### Error al reproducir en unos AirPods

- **Síntoma:** con los AirPods como salida del carril, cada frase falla con
  "no se pudo abrir la salida: The requested device is no longer available".
- **Causa:** macOS registra unos auriculares Bluetooth como **dos
  dispositivos con el mismo nombre**: uno solo de entrada (micrófono) y otro
  solo de salida. La app buscaba la salida por nombre y encontraba primero el
  micrófono.
- **En el código:** entre los dispositivos con ese nombre se usa el que tiene
  salida. Igual que con las bocinas, `cpal` no sabe leer sus formatos, así que
  se usa la frecuencia de Core Audio.

### Micrófono Bluetooth

- **Síntoma:** tu voz traducida sale peor. Whisper se equivoca más.
- **Causa:** al usar el micrófono de unos auriculares Bluetooth, macOS los pasa
  a modo llamada: 16 kHz y mucha compresión.
- **Detección:** aviso si la entrada del sistema es Bluetooth.
- **A mano:** usa el micrófono del Mac como entrada y los auriculares solo
  para oír.

### Se reinició el audio del sistema

- **Síntoma:** después de reiniciar el servicio de audio (`sudo killall
  coreaudiod`), de cambiar dispositivos o de que un dispositivo se desconecte,
  la captura deja de funcionar.
- **Causa:** el WebView pierde la conexión con el dispositivo.
- **Detección:** el carril se detiene y avisa.
- **A mano:** volver a pulsar "Traducir en automático"; si no responde,
  reiniciar Lingora.

---

## Voz y transcripción

### Mi voz llega muy baja

- **Causa:** la captura desactiva el procesamiento del sistema porque, con él,
  WKWebView puede entregar silencio en dispositivos virtuales como BlackHole.
  Eso también desactivaba la ganancia automática del micrófono.
- **En el código:** la ganancia automática se activa solo en el carril del
  micrófono, y cada frase se normaliza a −1 dBFS (como mucho ×20) antes de ir a
  Whisper. Lo que está por debajo del umbral de silencio no se amplifica, para
  que Whisper no invente frases sobre el ruido.

### La voz traducida se corta a mitad

- **Causa:** Kokoro admite unos 510 tokens por llamada y descarta el resto sin
  avisar. Una traducción de más de unos 30 s se cortaba.
- **En el código:** espeak-ng devuelve una cláusula por línea; el motor las
  agrupa en trozos de hasta 400 caracteres, los sintetiza por separado y los
  une con una pausa corta.

### Whisper "solo devuelve el último segmento"

Una nota anterior en `groq.rs` atribuía a Whisper que el campo `text` trajera
solo el último segmento. Al probarlo con 22 s de habla, Whisper devolvió todo
tanto con `json` como con `verbose_json`. Lo más probable es que el audio ya
llegara recortado por el problema del dispositivo agregado.

### La traducción empieza 10–15 s tarde

- **Síntoma:** en un vídeo o una llamada, la voz traducida empieza a sonar
  mucho después de que la persona termine de hablar.
- **Causa:** se sumaban tres cosas. Quien habla sin pausas llegaba al máximo
  de 10 s por trozo, así que había que esperar 10 s antes de traducir nada. La
  voz se generaba entera antes de sonar. Y Kokoro en `q8` tardaba la mitad de
  lo que dura el audio en generarlo.
- **En el código:**
  - Trozos de 5 s como máximo; una pausa de 0,4 s cierra la frase.
  - La traducción se parte en frases y la primera se corta en su primera
    coma. Cada frase se sintetiza por separado y suena en cuanto está lista.
  - Kokoro en `fp32`: 2,25 veces más rápido que `q8` en Apple Silicon, ~0,22 s
    por segundo de voz. La primera frase corta está lista en ~0,4 s.
  - Whisper y el traductor reciben el trozo anterior como contexto, para que
    las frases partidas se traduzcan bien.
- **Medido:** Whisper + traducción ~1,4 s, primera frase de voz ~0,4 s. Unos 2 s
  desde que termina el trozo, más los 0,4 s de pausa que lo cierran.

### La voz suena cortada: una frase no termina y empieza otra

- **Causa 1, frases partidas:** quien habla sin pausas se corta cada 5 s. Si
  el corte cae en mitad de una frase, se traducía y se decía media frase
  ("y luego fuimos al…") y la siguiente empezaba igual de coja. Además,
  Whisper suele poner punto al final del trozo aunque la frase siga.
- **En el código:** cada trozo indica si terminó en una pausa o en un corte
  forzado. En un corte forzado solo se traduce hasta el último final de frase
  interno (o la última coma); el resto se guarda y se junta con el trozo
  siguiente. El punto final que pone Whisper no cuenta. Si un texto no tiene
  ningún final de frase, se guarda una vez; a la segunda se traduce tal cual
  para no acumular retraso. En una pausa se traduce todo.
- **Causa 2, la salida se abría en cada frase:** abrir y cerrar el dispositivo
  de audio en cada frase hacía que los auriculares Bluetooth se comieran el
  principio de cada una.
- **En el código:** cada salida se abre una vez y se queda abierta (emite
  silencio cuando no hay nada que decir). Las frases se encolan y suenan
  seguidas. Si el dispositivo se desconecta, se reabre en la siguiente frase.

### Whisper tarda a veces 8 s o falla

- **Síntoma:** algunas frases llegan con mucho más retraso que otras, o
  aparece un error suelto de la API.
- **Causa:** la latencia de Groq es muy variable: la misma petición tarda 1 s
  o 8 s, y de vez en cuando falla sin motivo.
- **En el código:** si Whisper no responde en 2 s, se lanza una segunda
  petición idéntica y se usa la primera que llegue. Un fallo rápido se reintenta
  una vez.

---

## Instalación

| Comprobación | Si falla |
|---|---|
| Clave de Groq | Añadir `GROQ_API_KEY=...` al `.env` de la raíz y reiniciar |
| espeak-ng | Va dentro de la app: reinstalar Lingora. En desarrollo, `scripts/build-espeak.sh` |
| Modelo de voz | «Descargar» en el diagnóstico |
| BlackHole 2ch | `brew install blackhole-2ch` y reiniciar el Mac |

---

## Último recurso

Si BlackHole parece no recibir nada aunque el diagnóstico esté en verde,
reiniciar el servicio de audio puede ayudar (requiere contraseña de
administrador):

```bash
sudo killall coreaudiod
```

Después hay que reiniciar Lingora. No está confirmado que esto fuera necesario
en las pruebas, donde el fallo resultó ser la herramienta de medida, pero es
la recomendación habitual con drivers virtuales bloqueados.
