# Lingora: base de conocimiento para marketing

> Documento de contexto para un asistente de IA que ayudará con marketing,
> posicionamiento, contenidos, lanzamiento y crecimiento de Lingora.
> Actualizado: 1 de noviembre de 2026. Versión de la app: 0.1.0 (pre-lanzamiento).
>
> **Cómo usar este documento:** todo lo que está aquí sale del código y de la
> documentación interna del proyecto. Lo que no se sabe o no está decidido
> aparece marcado como **[POR DECIDIR]** o **[POR VERIFICAR]**: no lo inventes ni
> lo des por hecho; pregunta. Las cifras técnicas se midieron en un MacBook Pro
> M1 Pro con 16 GB.

---

## 1. Qué es Lingora (en una frase)

**Lingora es una app de escritorio para Mac que traduce en vivo lo que suena en
tu ordenador (vídeos, clases, podcasts, llamadas) y toma notas de reuniones con
quién dijo qué y un resumen, todo procesado en tu propio Mac, sin enviar tu
audio a la nube.**

Eslogan actual dentro de la app: **"Traductor de voz en tiempo real"**.
Mensaje de privacidad que aparece en la app: **"Todo se procesa en tu equipo"**.

### Versión corta (elevator pitch)

Pones un vídeo en otro idioma, una clase o una reunión, y Lingora te muestra
subtítulos traducidos encima de cualquier ventana (incluso a pantalla
completa) y, si quieres, te lo dice en voz alta en tu idioma. Además puede
transcribir reuniones, distinguir a cada persona y guardarlo todo como notas
con resumen. No hace falta configurar nada de audio, no hay cuotas y, una vez
descargado, funciona sin internet.

---

## 2. El problema que resuelve

- Hay muchísimo contenido valioso (cursos, conferencias, YouTube, podcasts,
  reuniones con clientes o equipos de otros países) en idiomas que la persona
  no domina, o domina a medias.
- Las soluciones habituales tienen pegas:
  - **Subtítulos automáticos de cada plataforma:** solo funcionan dentro de esa
    plataforma (YouTube, Meet, Teams…), no en todo lo que suena en el ordenador,
    y a menudo no traducen o traducen mal.
  - **Traductores y tomadores de notas en la nube:** el audio de tus reuniones
    sale de tu equipo y va a servidores de terceros; suelen tener suscripción,
    minutos limitados y necesitan internet.
  - **Montajes técnicos:** para capturar el audio del sistema en Mac
    tradicionalmente había que instalar drivers de audio virtuales (BlackHole,
    Loopback) y configurar dispositivos multisalida. Lingora no lo necesita.
- Tomar notas de una reunión mientras participas es difícil; recordar quién
  dijo qué, más.

---

## 3. Qué hace (funciones reales, hoy)

La app tiene tres modos y una biblioteca de notas.

### 3.1 Modo "Traducir audio" (funciona)

Traduce lo que oyes: un vídeo, una clase, un podcast, una llamada en la que
solo escuchas.

- **Escucha el audio del Mac directamente**, sin instalar drivers ni
  configurar fuentes de audio. La primera vez, macOS pide permiso de "grabación
  de audio del sistema". También puede escuchar el micrófono.
- **Traduce frase a frase, casi al momento.** Mientras alguien habla ya ves en
  pequeño lo que se está oyendo; la traducción aparece en cuanto termina cada
  frase.
- **Subtítulos en tres variantes:** solo traducción, solo original, o ambos
  (el original en pequeño encima de cada traducción).
- **Subtítulos flotantes:** una ventana de subtítulos que se queda encima de
  cualquier app, incluso de un vídeo a pantalla completa. Se puede cambiar el
  tamaño de letra y la opacidad del fondo.
- **Voz traducida (opcional):** una voz sintética te dice la traducción.
  - Voz femenina o masculina, o elegir una voz concreta y probarla.
  - **"Varias voces":** si en el vídeo hablan varias personas, cada una recibe
    su propia voz traducida, para que distingas quién habla.
  - Opción "Voz de más calidad" (algo más natural, unas décimas más lenta).
  - La voz se acelera un poco solo cuando va atrasada, para no perder el hilo;
    si se atrasa demasiado, se salta frases para alcanzar al original.
  - Opción "Solo subtítulos": sin voz, sin retraso acumulado.
- **Historial** de lo traducido en la sesión y opción de guardar la
  conversación como nota.

### 3.2 Modo "Tomar notas" (funciona; algunas partes en curso)

Transcribe clases y reuniones **en el idioma en que se habla** (sin traducir),
con personas y resumen.

- Tres fuentes:
  - **Audio del equipo:** para vídeos y clases donde tú no hablas.
  - **Micrófono:** reuniones presenciales o notas personales.
  - **Reunión en línea:** las demás personas salen del audio del ordenador y
    tú, del micrófono, como "Yo" (o tu nombre). Funciona con cualquier app de
    videollamada porque escucha el audio del sistema, no se integra con una
    plataforma concreta.
- **Detección automática del idioma**, aunque cambie durante la sesión
  (idiomas europeos). Modo aparte para chino, japonés, coreano y cantonés.
- **Distingue a las personas** ("Persona 1", "Persona 2"…), procesado en el
  propio Mac. Se pueden renombrar y unir dos que en realidad son la misma.
  Al renombrar, sugiere los nombres usados en otras notas (un clic en
  reuniones recurrentes). No reconoce voces entre reuniones: no guarda
  huellas de voz.
- **Mis notas y marcadores:** mientras grabas puedes escribir ideas y marcar
  momentos con ⌘B para encontrarlos luego en la transcripción. Estas notas
  pueden ir al final del resumen. *(Implementado recientemente; en pruebas.)*
- **Subtítulos mientras tomas notas:** puedes abrir los subtítulos flotantes
  en el idioma original o traducidos a otro idioma, mientras la nota se
  guarda en el idioma original. Pensado para **aprender idiomas**: lees la
  traducción y conservas la transcripción original. *(Recién hecho; en
  pruebas.)*
- Se puede **pausar y reanudar** la grabación.
- Antes de empezar, la app recuerda **avisar a los demás de que se está
  transcribiendo** (buena práctica de consentimiento).
- Detecta si llevas auriculares o Bluetooth y elige el micrófono que mejor
  oye.

### 3.3 Modo "Traducir llamada" (en desarrollo, bloqueado en la interfaz)

Traducción en los dos sentidos: lo que oyes y lo que dices (tu voz traducida
llega a la otra persona). Aparece en la app como "**pronto**". Requiere un
micrófono virtual que aún no está resuelto. **No prometerlo como disponible.**

### 3.4 Notas (biblioteca)

- Cada sesión puede guardarse como nota en el propio Mac.
- Búsqueda por texto o fecha, filtros (últimos 7 días, este mes, mes pasado),
  orden.
- Transcripción con quién habló y **cuánto habló cada persona (%)**.
- **Resumen con IA:** puntos clave, decisiones y tareas con responsable, en el
  idioma que elijas (puede ser distinto al de la reunión).
- **Plantillas de resumen:** eliges el tipo de resumen según la reunión:
  General, Reunión de equipo, 1:1, Llamada con cliente, Entrevista, Clase o
  conferencia y Ejecutivo (para directores). Cada una pide sus propias secciones
  (p. ej., en un 1:1: bloqueos, feedback, crecimiento y acuerdos; con un
  cliente: necesidades, objeciones, presupuesto y compromisos de cada parte).
  Se puede volver a resumir la misma nota con otra plantilla. Recién hecho, sin
  probar aún con usuarios. Pendiente: plantillas propias del usuario.
- **Mapa mental del resumen:** los puntos clave, decisiones, tareas y momentos
  marcados como un esquema visual que se pliega por secciones. Las ideas con
  hora llevan a ese momento de la transcripción. Se exporta como imagen (PNG).
  Sale del mismo resumen, que trae una versión corta de cada punto para el
  mapa (no hace otra petición). Recién hecho, sin probar aún con usuarios.
- **Exportar** a Markdown (.md) o texto (.txt).
- **"Copiar para tu chat de IA":** copia la nota con instrucciones para pegarla
  en ChatGPT, Claude, etc. y resumirla allí.

### 3.5 Otras características

- **Interfaz en español e inglés**; cualquier otro idioma de la interfaz se
  genera en el propio Mac con el modelo de traducción (con aviso de que es
  traducción automática).
- **Primera vez:** pantalla de bienvenida que explica cómo funciona mientras
  descarga los componentes (~1,9 GB), con progreso real y tiempo restante. La
  descarga se reanuda si cierras la app.
- **Diagnóstico y descargas:** la app comprueba que todo esté bien y arregla lo
  que puede con un botón ("Arreglarlo ahora").
- **Espacio en disco:** muestra todo lo descargado y deja borrarlo, avisando de
  qué dejará de funcionar.

---

## 4. Diferenciadores (lo que la hace distinta)

1. **Privacidad real: todo se procesa en el Mac.** La escucha, la traducción,
   la voz y la distinción de personas funcionan en el equipo. El audio y el
   texto no salen de él. La única excepción es el **resumen** de una nota, que
   es opcional (ver §6).
2. **Funciona sin internet** una vez descargados los componentes.
3. **Sin cuotas, sin minutos, sin cuenta.** Al no depender de servidores, no
   hay coste por uso. Objetivo del proyecto: poder ser gratis para miles de
   usuarios.
4. **Funciona con todo lo que suena en el Mac**, no solo dentro de una app:
   YouTube, Netflix, Zoom, Meet, Teams, Slack, un curso, un podcast…
5. **Cero configuración técnica:** no requiere instalar drivers de audio ni
   otros programas. Se instala la app y ella descarga lo que necesita.
6. **Subtítulos flotantes sobre cualquier ventana**, incluso a pantalla
   completa.
7. **Voz traducida, incluso con una voz distinta por persona.**
8. **Traducción + notas en una sola app:** traductor en vivo y tomador de notas
   con personas y resumen.
9. **37 idiomas** de traducción (ver §5).

---

## 5. Idiomas

**Traducir a (37 idiomas):** inglés, español, francés, italiano, portugués,
alemán, neerlandés, polaco, checo, ruso, ucraniano, chino (simplificado),
chino tradicional, cantonés, japonés, coreano, turco, árabe, hebreo, persa,
hindi, bengalí, urdu, guyaratí, maratí, tamil, telugu, tailandés, vietnamita,
indonesio, malayo, filipino, jemer, birmano, tibetano, kazajo y mongol.

**Escuchar (idiomas de origen, 16):** inglés, español, francés, italiano,
portugués, alemán, neerlandés, polaco, checo, ruso, ucraniano, chino, chino
tradicional, cantonés, japonés y coreano. Los demás, de momento, solo como
idioma de destino (en la app aparecen como "pronto").

**Voz traducida:** voz propia de Lingora en 18 idiomas (inglés, español,
francés, italiano, portugués, japonés, coreano, alemán, neerlandés, polaco,
checo, ruso, ucraniano, turco, árabe, hindi, vietnamita e indonesio). Para el
resto usa las voces del sistema de macOS si están instaladas (gratis en
Ajustes del Sistema); si no hay voz, solo subtítulos.

**Calidad por idioma (dato interno, para ser honestos en los mensajes):**
la traducción es mejor en idiomas europeos, chino, japonés y coreano. Es
**claramente más floja** en hindi, bengalí, urdu, guyaratí, maratí, tamil,
telugu, jemer, birmano y algo en vietnamita y persa. El equipo decidió que
esos mercados no son prioridad por ahora. **No enfocar campañas en esos
idiomas** sin hablarlo antes.

**Mercado prioritario implícito:** español ↔ inglés (el creador es
hispanohablante y la app se afinó sobre todo en esa pareja), luego idiomas
europeos y asiáticos orientales. **[POR DECIDIR: mercado/país de lanzamiento]**

---

## 6. Privacidad (mensaje central; ser exactos)

- **Lo que se procesa en el Mac:** escuchar, transcribir, traducir, la voz y
  distinguir personas. Las notas se guardan en el equipo.
- **Lo único que puede salir:** el **resumen con IA** de una nota. Hoy usa
  **Groq** (un servicio de IA en la nube) **con la clave propia del usuario**,
  que se guarda en el llavero del Mac. La app **pide permiso** antes de enviar
  la transcripción ("La transcripción se enviará a Groq. ¿Continuar?").
  Alternativa sin nube: "Copiar para tu chat de IA".
- **Plan:** sustituirlo por un **resumen local** (un modelo que corre en el
  Mac), para que nada salga del equipo. En curso; **[POR VERIFICAR fecha]**.
- Lingora no tiene cuenta de usuario ni servidores propios. **[POR VERIFICAR:
  si habrá analítica o telemetría en la versión pública; hoy no hay.]**

**Frases seguras para usar:**
- "Tu audio no sale de tu Mac."
- "La traducción se hace en tu ordenador, no en la nube."
- "Funciona sin internet una vez instalada."
- "El resumen con IA es opcional y te pide permiso antes."

**Frases que NO se deben usar (hoy son falsas):**
- "Nada sale nunca de tu equipo" sin matizar el resumen opcional.
- "Traduce tus llamadas en los dos sentidos" (aún no disponible).
- "Disponible para Windows" (solo una prueba interna, ver §8).
- "Traducción perfecta" / "sin errores" / "simultánea al instante": hay un
  pequeño retraso (frase a frase) y puede haber errores.

---

## 7. Para quién es (públicos objetivo)

Hipótesis basadas en lo que hace la app. **[POR VALIDAR con usuarios reales]**

| Público | Uso principal | Qué les importa |
|---|---|---|
| **Estudiantes y aprendices online** | Cursos, clases y conferencias en inglés u otros idiomas | Entender el contenido, subtítulos sobre el vídeo, notas de clase |
| **Profesionales en equipos internacionales / remotos** | Reuniones en inglés con compañeros o clientes extranjeros | Entender bien, notas con quién dijo qué, tareas, privacidad |
| **Freelancers, consultores, agencias** | Llamadas con clientes; documentar acuerdos | Resumen con decisiones y tareas, exportar |
| **Perfiles sensibles a la privacidad** (abogados, salud, RR. HH., periodistas, empresas con datos confidenciales) | Transcribir sin mandar audio a la nube | Procesamiento local, sin servidores |
| **Consumidores de contenido extranjero** | YouTube, series, streams, podcasts, anime/dramas | Subtítulos flotantes, voz traducida, varias voces |
| **Migrantes y expatriados** | Entender trámites, clases, contenido local | Facilidad, idioma propio |
| **Personas con dificultades auditivas** | Subtítulos en vivo de cualquier audio (modo original, sin traducir) | Subtítulos legibles sobre cualquier ventana |

---

## 8. Plataforma, requisitos y estado

- **Plataforma:** macOS. Requiere **macOS 14 o superior**; para escuchar el
  audio del ordenador sin drivers, **macOS 14.2 o superior**.
- **Hardware:** probado en Apple Silicon (M1 Pro, 16 GB). Usa ~2–2,5 GB de RAM
  con todo cargado. **[POR VERIFICAR: rendimiento en Mac Intel y en Macs de
  8 GB.]**
- **Descarga:** instalador pequeño + ~1,9 GB de componentes la primera vez
  (~2,1 GB con el extra para chino/japonés/coreano).
- **Windows:** existe una versión de prueba sin firmar que se ha enviado a
  amigos y familia. **No anunciar.** Plan completo, pendiente.
- **Estado:** pre-lanzamiento, versión 0.1.0, en fase de pruebas. Desarrollado
  por una persona (con ayuda de IA) desde octubre de 2026.
- **Lo que falta para lanzar al público** (detalle completo en §16):
  - Firma y notarización de Apple (sin ella, macOS bloquea la app en otros
    Macs con un aviso de seguridad).
  - Resumen local (para el mensaje "100 % local").
  - Modo "Traducir llamada" (requiere micrófono virtual propio).
  - Escuchar los 21 idiomas que hoy solo son de destino.

---

## 9. Rendimiento (cifras para contenidos técnicos)

Medido en MacBook Pro M1 Pro, 16 GB:

- La escucha se actualiza cada medio segundo (~0,25 s por pasada).
- Traducción: ~0,24 s por frase.
- Voz: ~0,14 s para generar 1 s de habla (o ~0,21 s en "más calidad").
- Distinguir personas: **94 % de acierto** en una entrevista real de 55 min con
  2 personas; 100 % con voces sintéticas.
- En la práctica: la traducción aparece poco después de terminar cada frase.

**Limitaciones conocidas (para no prometer de más):**
- En inglés, la escucha comete algo más de errores que los mejores servicios
  en la nube.
- La voz traducida va algo detrás del original; funciona mejor con frases
  cortas. En contenido muy rápido, conviene "solo subtítulos".
- Coloquialismos y frases cortadas a veces se traducen peor.

---

## 10. Modelo de negocio y precio

**[POR DECIDIR]** No hay precio ni modelo definido. Lo que sí se sabe:

- Al ser todo local, **el coste por usuario es casi cero** (no hay servidores
  de IA que pagar). Esto permite un plan gratuito generoso o ilimitado.
- Objetivo declarado del creador: que pueda ser **gratis para miles de
  usuarios**.
- Costes reales a tener en cuenta: cuenta de desarrollador de Apple (firma),
  alojamiento de descargas, y posiblemente un micrófono virtual propio o
  licencia comercial para el modo llamada.
- Ideas posibles a evaluar (no decididas): gratis + donaciones; freemium (p.
  ej. modo llamada, varias voces o resumen local como "Pro"); pago único;
  licencia para empresas que valoran la privacidad.

---

## 11. Competencia y alternativas

**[POR VERIFICAR: precios y funciones actuales de cada uno antes de usarlos en
comparativas.]** Categorías y ejemplos conocidos:

- **Tomadores de notas con IA en la nube:** Otter.ai, Fireflies, Fathom,
  tl;dv, Granola, Notta, Krisp. Fuerte en resúmenes e integraciones; el audio
  va a sus servidores, suelen tener límites de minutos y suscripción.
- **Traducción integrada en plataformas de videollamada:** subtítulos
  traducidos de Google Meet, Microsoft Teams, Zoom. Solo funcionan dentro de
  esa plataforma y a menudo requieren planes de pago.
- **Traducción de voz en vivo:** DeepL Voice, Google Translate (modo
  conversación), Wordly, KUDO, Interprefy (más orientados a eventos/empresas).
- **Funciones del sistema:** Live Captions / traducción en vivo de Apple y
  subtítulos en directo de Chrome/Windows. Gratis e integrados, pero con
  menos idiomas, sin notas ni personas, o solo en ciertos dispositivos.
- **Transcripción local en Mac:** apps basadas en Whisper (MacWhisper, Aiko,
  Superwhisper). Locales y privadas, pero centradas en transcribir archivos o
  dictar, no en traducir en vivo con subtítulos flotantes y voz.

**Hueco de Lingora:** traducción **en vivo** de **cualquier audio del Mac**,
con subtítulos flotantes y voz, + notas con personas y resumen, **todo local,
sin cuotas ni configuración**.

---

## 12. Marca, tono y estilo

- **Nombre:** Lingora. **[POR VERIFICAR: dominio, marca registrada,
  redes sociales disponibles.]**
- **Tono de la interfaz:** sobrio, claro, cercano; español neutro; frases
  cortas que explican qué pasa y qué hacer ("Arreglarlo ahora", "Todo listo
  para traducir").
- **Diseño visual:** estilo sobrio y limpio, tipo shadcn/ui o Sembly. **[POR
  VERIFICAR: logo, colores y tipografía oficiales.]**
- **Regla de comunicación importante:** en la interfaz **no se nombran los
  modelos de IA** que usa la app; se habla de "la escucha", "la traducción",
  "la voz", "el resumen". En marketing conviene seguir igual (beneficios, no
  tecnicismos). Los nombres técnicos están en la §17, solo para contenidos
  técnicos (blog para desarrolladores, Product Hunt, Hacker News).
- **Idiomas de la comunicación:** español e inglés como base.

---

## 13. Preguntas frecuentes (respuestas verificadas)

- **¿Necesito internet?** Solo para la descarga inicial. Luego funciona sin
  conexión (salvo el resumen con Groq, que es opcional).
- **¿Mi audio se sube a algún sitio?** No. Se procesa en tu Mac.
- **¿Tengo que instalar algo más?** No. Ni drivers de audio, ni otros
  programas. La app descarga sus componentes la primera vez.
- **¿Funciona con Zoom / Meet / Teams / YouTube?** Sí, con todo lo que suena en
  el Mac, porque escucha el audio del sistema.
- **¿La otra persona se entera?** Lingora no se conecta a la llamada; escucha
  tu ordenador. Aun así, la app recomienda avisar cuando transcribes.
- **¿Puedo traducir lo que yo digo para la otra persona?** Todavía no; está en
  desarrollo ("Traducir llamada").
- **¿Cuánto ocupa?** Unos 2 GB de componentes descargados; se pueden borrar
  desde la app.
- **¿Es gratis?** [POR DECIDIR]
- **¿Windows?** De momento solo Mac.

---

## 14. Ideas de ángulos de contenido (para inspirar, no decididos)

- Demo en vídeo: YouTube en japonés con subtítulos flotantes en español a
  pantalla completa.
- Demo "varias voces": una entrevista con dos personas dobladas en vivo con
  dos voces distintas.
- "Toma notas de tus reuniones sin mandar tu audio a la nube."
- "Estudia cursos en inglés como si fueran en español."
- Comparativa de privacidad: dónde va tu audio con cada herramienta.
- Historia del creador: una app construida en semanas por una persona con IA.
- Contenido técnico: cómo correr transcripción, traducción y voz en un
  portátil, en tiempo real.

---

## 15. Glosario de la app (nombres tal como aparecen en la interfaz)

| En la app | Qué es |
|---|---|
| Traducir audio | Modo de traducción en vivo de lo que oyes |
| Tomar notas | Modo de transcripción con personas y resumen |
| Reunión en línea | Fuente de Tomar notas: audio del equipo + tu micrófono |
| Traducir llamada | Modo bidireccional (próximamente) |
| Notas | Biblioteca de sesiones guardadas |
| Subtítulos flotantes | Ventana de subtítulos encima de cualquier app |
| Carril | Cada dirección de traducción (Escuchar / Hablar) con sus ajustes |
| Varias (voces) | Una voz traducida distinta para cada persona |
| Diagnóstico y descargas | Pantalla que comprueba y arregla la configuración |
| Copiar para tu chat de IA | Copia la nota para resumirla en otra IA |
| Marcar momento (⌘B) | Marcador dentro de la transcripción |

---

## 16. Hoja de ruta: lo que está planeado y pendiente

Sale de los planes internos del proyecto. **No hay fechas comprometidas**: no
anuncies fechas ni prometas nada de esta lista como disponible. Sirve para
planificar mensajes de "próximamente", la secuencia de lanzamientos y
contenidos del tipo "lo que viene".

### 16.1 Para poder lanzar al público (bloqueantes)

| Qué | Por qué importa para marketing | Estado |
|---|---|---|
| **Firma y notarización de Apple** (cuenta de desarrollador, 99 USD/año) | Sin ella, macOS bloquea la app con un aviso de seguridad en cualquier otro Mac. Es imprescindible para una descarga pública. | Pendiente; el usuario lo dejó para más adelante |
| **Actualizaciones automáticas** | La app avisa cuando hay una versión nueva y se actualiza sola. Permite lanzar rápido e iterar. | Planeado, junto a la firma |
| **Modelos alojados por Lingora** | Hoy se descargan de sitios de terceros (GitHub, Hugging Face); si cambian un enlace, la primera instalación falla. Con copia propia y comprobación de integridad, la descarga es fiable. | Planeado; de momento se sigue con terceros |
| **Prueba en un Mac limpio** | Confirmar que funciona en un Mac sin herramientas de desarrollo. | Hay una comprobación automática; falta la prueba real |
| **Registro para soporte** | Botón "Copiar registro" para que quien tenga un problema lo envíe. | Planeado |
| **Página de descarga** | Debe indicar los requisitos: Apple Silicon y macOS 14.2 o superior. | Por hacer |

### 16.2 Funciones nuevas

| Qué | Valor para el usuario | Estado |
|---|---|---|
| **Resumen local** | Cierra el mensaje "100 % en tu Mac": el resumen dejaría de usar la nube y no haría falta ninguna clave. Usaría un modelo de ~2–3 GB que se descarga aparte. | Planeado. Falta elegir el modelo y decidir si Groq desaparece o queda como opción avanzada |
| **Traducir llamada (en los dos sentidos)** | Tu voz, traducida, le llega a la otra persona en Zoom, Meet, etc. Es la función "estrella" pendiente. | En desarrollo y bloqueada: necesita un micrófono virtual propio (macOS no permite crearlo sin un driver) o una licencia comercial de uno existente |
| **Escuchar 21 idiomas más** | Hoy esos idiomas solo pueden ser de destino (árabe, hindi, turco, tailandés, vietnamita…). Con esto también podrían ser el idioma que se oye. | Pendiente; requiere un modelo de escucha adicional, más lento y pesado |
| **Paquetes de idioma descargables** | El usuario descarga solo los idiomas que usa ("Descargar japonés, ~350 MB"), así la instalación es más ligera. | Idea planeada; aún no es necesaria |
| **Traducción bajo cada párrafo de la nota** | Ver el original y la traducción juntos en la nota guardada. | Planeado |
| **Mejorar "Varias voces"** | Hoy, en vídeos reales, a veces separa a una persona en varias (por risas, música o cambios de tono). Ya tiene ajustes manuales: número de personas y unir dos. | Recién hecho; en pruebas con audio real |
| **Afinar la traducción coloquial** | Entrenar el modelo con frases reales de conversación para mejorar expresiones coloquiales. | Idea a futuro |

### 16.3 Nuevas plataformas

| Qué | Estado |
|---|---|
| **Windows** | Hay un instalador `.exe` sin firmar que funciona como prueba entre amigos y familia (avisa SmartScreen). Faltan, sobre todo, captura de audio del sistema fiable, aceleración con la tarjeta gráfica, voces del sistema y firma. Más adelante: Microsoft Store o certificado de firma. |
| **Extensión de Chrome** | Solo una idea, sin aprobar. |
| **Voz personal** (que la traducción suene con tu voz) | Solo una idea, sin aprobar. Clonar la voz de cada persona del vídeo queda descartado por ahora (requiere una herramienta de pago). |

### 16.4 Pendientes legales y de licencias (relevantes para lanzar)

- Pantalla de licencias de terceros: hecha. Falta generar el aviso completo de
  todas las librerías incluidas.
- Revisar que cada modelo se pueda redistribuir si se alojan copias propias.
- Si el micrófono virtual se basa en BlackHole (GPL), hace falta una licencia
  comercial, o bien crear un driver propio.

### 16.5 Orden lógico de lanzamiento (sugerido por el estado actual)

1. **Beta privada en Mac:** firma de Apple + actualizaciones + página de
   descarga. El mensaje se centra en Traducir audio y Tomar notas.
2. **Resumen local:** permite decir "100 % en tu Mac, sin nube y sin cuentas".
3. **Traducir llamada:** lanzamiento propio, como gran novedad.
4. **Windows.**

**[POR DECIDIR con el creador: orden real y fechas.]**

---

## 17. Tecnología: IA que corre en tu Mac, y por qué es una ventaja

> Esta sección es para contenidos técnicos (blog, Product Hunt, Hacker News,
> prensa tecnológica, comparativas, respuestas a usuarios avanzados) y para que
> entiendas de dónde salen las ventajas. **En la publicidad general y en la
> interfaz no se nombran los modelos** (ver §12): se habla de beneficios. Los
> nombres de los modelos sí pueden aparecer en contenidos técnicos y en la
> pantalla de licencias. Todas las cifras se midieron en un MacBook Pro M1 Pro
> con 16 GB salvo que se indique otra cosa.

### 17.1 La idea central: "IA local"

Casi todos los traductores en vivo y los tomadores de notas con IA funcionan
así: graban tu audio, lo **suben a sus servidores**, allí lo transcriben y
traducen con modelos grandes y te devuelven el texto. Lingora hace **todo el
proceso dentro del Mac**:

1. **Escuchar** (convertir voz en texto),
2. **Traducir**,
3. **Hablar** (convertir el texto traducido en voz),
4. **Distinguir quién habla**.

Usa modelos de IA abiertos y compactos, optimizados para ejecutarse en un
portátil en tiempo real. Aprovechan el chip de Apple (GPU con Metal) y están
**cuantizados**: comprimidos a 4 u 8 bits para ocupar y gastar menos memoria
con una pérdida de calidad mínima.

Desde el 28 de octubre de 2026 **toda la escucha y la traducción son
locales**. Antes la app usaba servicios en la nube y el creador decidió
eliminarlos. La única excepción que queda es el resumen opcional (§6), que
también está planeado hacer en local (§16).

### 17.2 Cómo fluye el audio (de principio a fin)

```
Audio del Mac (cualquier app)          Micrófono
   │  capturado sin drivers                │
   └──────────────┬────────────────────────┘
                  ▼
   ESCUCHA en vivo, cada 0,5 s → subtítulo provisional
   y detección del final de cada frase
                  │ frase completa
                  ▼
   TRANSCRIPCIÓN final ──► huella de voz (¿quién habla?)
                  │ texto
                  ▼
   TRADUCCIÓN, que va saliendo palabra a palabra
                  │
                  ▼
   VOZ sintética (si está activada)
                  │
                  ▼
   Se reproduce; se acelera un poco solo si va atrasada
```

Detalles que marcan diferencia:

- **Captura del audio del sistema sin drivers.** Usa una función nativa de
  macOS 14.2+ ("process taps" de Core Audio) que escucha todo lo que suena
  en el Mac **excepto la propia Lingora**. Así la voz traducida no vuelve a
  entrar como si fuera audio nuevo (no hay eco ni bucles). La alternativa
  clásica en Mac era instalar un driver de audio virtual (BlackHole,
  Loopback) y montar un dispositivo multisalida: algo que la mayoría de la
  gente no sabe hacer.
- **Corta las frases en el momento justo.** La escucha se repite cada medio
  segundo (~0,25 s por pasada), así que detecta el final de una frase entre
  dos palabras, sin esperar a que haya silencio. Esto reduce el retraso.
- **Traducción en streaming.** La traducción empieza a salir mientras se
  genera, no al final.
- **Glosario de expresiones coloquiales.** Antes de traducir, la app aplica un
  glosario por idioma para expresiones que los modelos suelen traducir mal
  (por ejemplo, "Dale" en español rioplatense).
- **La voz no se queda atrás.** Si la voz traducida acumula retraso, se
  acelera un poco; si el retraso es demasiado, se salta frases para alcanzar
  al original. Los subtítulos nunca se saltan.
- **Memoria bajo control.** Los modelos se cargan cuando se necesitan y **se
  liberan de la memoria tras 3 minutos sin uso**. Con todo cargado, Lingora
  usa ~2–2,5 GB de RAM.
- **Reuniones en línea sin eco.** En el modo "Reunión en línea" combina el
  audio del Mac (los demás) y tu micrófono ("Yo"). Detecta si usas
  auriculares, Bluetooth o el micrófono integrado, y filtra el eco cuando la
  llamada suena por los altavoces.
- **Interfaz traducida en local.** El mismo modelo de traducción genera la
  interfaz de la app en cualquier idioma, sin servicios externos.
- **Sin dependencias externas.** La app incluye todo lo necesario (motores de
  IA y librerías). El usuario no instala Python, Homebrew ni drivers. Un
  script comprueba en cada versión que la app no dependa de nada de fuera.

### 17.3 Los modelos que usa (todos abiertos)

| Función | Modelo | Autor | Tamaño (descarga) | Licencia | Dato clave |
|---|---|---|---|---|---|
| Escuchar (idiomas europeos) | **Parakeet TDT 0.6B v3**, int8 | NVIDIA | ~490 MB (imprescindible) | CC-BY-4.0 | ~0,25 s por pasada; 11 idiomas europeos con detección automática frase a frase |
| Escuchar (chino, cantonés, japonés, coreano) | **SenseVoice Small**, int8 | Alibaba (FunAudioLLM) | ~165 MB (opcional) | FunASR Model License | Añade puntuación; se eligió la versión de 2024 porque la de 2025 fallaba en japonés |
| Traducir | **Index-Translate-2B** (2 000 millones de parámetros), Q4_K_M | Bilibili (IndexTeam) | ~1,3 GB (imprescindible) | Apache-2.0 | ~0,24 s por frase; ~1,45 GB de RAM; sin aleatoriedad (siempre traduce igual la misma frase) |
| Voz | **Supertonic 3**, int8 | Supertone Inc. | ~145 MB | OpenRAIL-M | 18 idiomas, 10 voces (5 femeninas y 5 masculinas); ~0,14 s para generar 1 s de habla |
| Voz (resto de idiomas) | Voces del sistema de macOS | Apple | Ya vienen con el Mac | — | Elige la mejor instalada: Premium > Mejorada > normal |
| Distinguir personas | **ERes2Net** (3D-Speaker) | Alibaba | ~40 MB | Apache-2.0 | 94 % de acierto en una entrevista real de 55 min |
| Resumen (temporal, opcional) | Modelo en Groq (nube) | — | — | — | Con la clave del usuario; se sustituirá por uno local |

**Motores (librerías) que ejecutan los modelos dentro de la app:**

- **sherpa-onnx** (k2-fsa / Next-gen Kaldi, Apache-2.0) con **ONNX Runtime**
  (Microsoft, MIT): ejecuta la escucha, la voz y las huellas de voz.
- **llama.cpp** (MIT), integrado como librería con aceleración **Metal**
  (la GPU del chip de Apple): ejecuta la traducción.
- **Tauri 2** (Rust) + **React**: el armazón de la app. Es mucho más ligera que
  una app de Electron: el instalador ocupa decenas de MB y los modelos se
  descargan aparte.

### 17.4 Cómo se eligió cada modelo (rigor detrás del producto)

Cada pieza se eligió tras probar alternativas con audio real. Esto sirve
para contar la historia de "afinado con cuidado" y para responder a usuarios
técnicos.

**Traducción.** Se midieron con 40 frases reales de llamadas:

| Modelo probado | Resultado |
|---|---|
| **Index-Translate-2B** (elegido el 1 nov 2026) | ~0,24 s/frase, ~1,45 GB RAM. Más natural y fiel; respeta el glosario al pie de la letra |
| HY-MT2 1.8B (Tencent; el anterior) | Misma velocidad y memoria, menos natural. Mejor en idiomas indios, jemer y birmano |
| TranslateGemma 4B (Google) | Descartado: el doble de lento y añade cosas que no se dijeron |
| Gemma 4 E2B / E4B (Google) | Descartados: más lentos (0,34–0,53 s) y pesados (3,3–5,3 GB) |
| Qwen3-1.7B | Descartado: responde o explica en vez de traducir |

Dato para comunicar: la traducción local (~0,24 s por frase) es **más rápida
que la que se usaba antes en la nube** (0,4–0,9 s por frase con un modelo en
Groq), porque no hay que esperar a la red.

**Voz.** Supertonic 3 sustituyó a Kokoro el 1 de noviembre de 2026:

| | Kokoro (anterior) | Supertonic 3 (actual) | Supertonic 3, "más calidad" |
|---|---|---|---|
| Tiempo para generar 1 s de habla | 0,22 s | **0,14 s** | 0,21 s |
| Memoria máxima | ~790 MB | **~357 MB** | ~357 MB |
| En disco | 338 MB | **145 MB** | 145 MB |
| Idiomas con voz neuronal propia | 5 | **18** | 18 |

Además suena mejor en español. Se descartaron voces basadas en Python
(Qwen3-TTS, Chatterbox y otras): son demasiado lentas para hablar en vivo y
obligarían a instalar Python.

**Escucha.** Parakeet sustituyó a Whisper: es mucho más rápido en local, lo
que permite la escucha cada medio segundo. A cambio, en inglés comete algo más
de errores que los mejores servicios en la nube (limitación aceptada).

**Personas.** El sistema que distingue voces se afinó con una entrevista real
de 55 minutos (94 % de acierto) y con voces sintéticas (100 %). Agrupa las
voces en vivo y al terminar repasa toda la conversación para corregir.

### 17.5 Ventajas frente a los competidores (por qué lo local gana)

| Aspecto | Lingora (local) | Servicios en la nube (tomadores de notas, traductores) |
|---|---|---|
| **Privacidad** | El audio y el texto no salen del Mac. No hay servidor que pueda filtrar o reutilizar datos | El audio se sube a servidores de terceros; depende de su política de datos y de entrenamiento |
| **Cumplimiento normativo** (RGPD, secreto profesional, datos de salud, NDA) | Más sencillo: no hay transferencia de datos a terceros (salvo el resumen opcional) | Requiere evaluar al proveedor, contratos de tratamiento de datos, ubicación de servidores |
| **Coste por uso** | Prácticamente cero: el cálculo lo hace el Mac del usuario | Cada minuto de transcripción o traducción cuesta dinero al proveedor; por eso hay planes de pago y límites de minutos |
| **Límites** | Sin minutos, sin cuotas, sin cuenta | Suelen limitar los minutos al mes en los planes gratuitos |
| **Sin conexión** | Funciona sin internet (avión, tren, redes de empresa restrictivas, mala conexión) | No funciona sin internet |
| **Latencia** | No hay ida y vuelta por la red: ~0,24 s por frase para traducir | Depende de la red y de la carga del servidor |
| **Dónde funciona** | Con todo lo que suena en el Mac: cualquier app de videollamada, navegador, reproductor, juego | Muchos funcionan solo dentro de una plataforma o mediante un "bot" que entra en la reunión |
| **Presencia en la reunión** | No entra ningún bot ni participante extra en la llamada | Muchos tomadores de notas añaden un bot visible a la reunión **[POR VERIFICAR por competidor]** |
| **Escalabilidad del negocio** | Más usuarios no suben los costes de servidor | Más usuarios = más gasto en servidores de IA |
| **Instalación** | Una app; los componentes se descargan desde ella | Normalmente nada que descargar (pero sí cuenta y suscripción) |

**Frente a las funciones gratuitas del sistema** (Live Captions y traducción
en vivo de Apple, subtítulos en directo de Chrome/Windows, subtítulos de
Meet/Teams/Zoom): Lingora junta en una app subtítulos flotantes traducidos
sobre cualquier ventana, voz traducida (incluso una voz por persona), notas
con personas, marcadores y resumen, en 37 idiomas de destino. **[POR
VERIFICAR: idiomas y funciones actuales de cada función del sistema antes de
publicar una comparativa.]**

**Frente a otras apps locales de transcripción en Mac** (basadas en Whisper):
esas se centran en transcribir archivos o en dictar. Lingora traduce **en
vivo**, con subtítulos flotantes y voz, y además toma notas de reuniones con
personas.

### 17.6 Las contrapartidas de lo local (para ser honestos)

- **Descarga inicial de ~1,9 GB**, que se hace una sola vez y se reanuda si se
  corta.
- **Necesita un Mac reciente:** Apple Silicon y macOS 14.2 o superior para el
  audio del sistema; ~2–2,5 GB de RAM libres con todo cargado.
- **Los modelos compactos rinden algo menos que los más grandes de la nube**
  en algunos casos: inglés con acentos difíciles, coloquialismos, idiomas
  indios y del sudeste asiático.
- **Escucha 16 idiomas** (no los ~100 de algunos servicios en la nube); los
  otros 21 solo como destino, por ahora.
- **El resumen todavía usa la nube** (opcional, con permiso) hasta que llegue
  el resumen local.

Cómo plantearlo: "Elegimos la privacidad y la libertad (sin cuotas, sin
internet) y lo compensamos con modelos elegidos y afinados uno a uno con
audio real."

### 17.7 Frases técnicas listas para usar

- "Transcripción, traducción y voz con IA que funciona en tu Mac, en tiempo
  real."
- "Traduce cada frase en un cuarto de segundo, sin enviar nada a internet."
- "Escucha todo lo que suena en tu Mac sin drivers ni configuraciones de
  audio."
- "Ningún bot entra en tu reunión: Lingora escucha tu ordenador, no la
  llamada."
- "Sin minutos, sin cuotas: el procesamiento lo hace tu propio Mac."
- "Construida con modelos abiertos de NVIDIA, Alibaba, Bilibili y Supertone,
  probados uno a uno con audio real." *(Solo en contenidos técnicos.)*

### 17.8 Otros datos técnicos

- El código está en GitHub. **[POR DECIDIR: si será código abierto.]**
- Las licencias de todos los modelos y librerías se muestran en Ajustes →
  Acerca de → Licencias de terceros.
- Los componentes descargados se guardan en
  `~/Library/Application Support/lingora/models/` y se pueden borrar desde la
  app.
- La clave del resumen (temporal) se guarda en el llavero de macOS, nunca
  dentro de la app.
