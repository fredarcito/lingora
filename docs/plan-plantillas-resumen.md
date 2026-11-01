# Plan: summary templates

Status: phase 1 implemented (2026-11-01); pending the manual checks of
section 5 with real notes. Phase 2 (custom templates)
comes afterwards, with its own confirmation.

Goal: today every note gets the same summary (Summary, Key points, Decisions,
Tasks). A 1:1, a client call or a class need different sections. The user
picks a template per note in the Summary tab; the rest of the summary
(times, mind map, highlighted moments, my notes, language) works as now.

---

## 0. Rules (read before starting)

The same as in `docs/plan-notas.md`, section 0. In addition:

- **General is the current summary.** Its sections and wording stay as they
  are; notes without a template behave exactly like today.
- **Only the sections change.** `SUMMARY_NOTES`, `SUMMARY_BOOKMARKS`,
  `SUMMARY_LANGUAGE`, `split_map`, `with_user_notes` and the chunking in
  `summarize_text` are shared by every template.
- **No model names in the interface**, and every new text with `t()` and its
  key in `src/i18n/es/` and `en/`.
- Before touching `src-tauri`, warn and wait for the signal: it restarts the
  app of whoever is testing. Bundle all the Rust changes into one block.
- No new dependencies.

---

## 1. The templates

Ids are stable (they are saved in the notes); names go through i18n.
The sections are what the prompt asks for, in Spanish like the current
`SUMMARY_SYSTEM` (`SUMMARY_LANGUAGE` already makes the model write the
headings in the chosen language).

| id | Name (es / en) | Sections |
|---|---|---|
| `general` | General / General | the current ones, unchanged |
| `team` | Reunión de equipo / Team meeting | Objetivo · Temas tratados · Avances · Decisiones · Tareas · Bloqueos · Para la próxima |
| `one_on_one` | 1:1 / 1:1 | Resumen · Cómo está · Avance del trabajo · Bloqueos · Feedback · Crecimiento y carrera · Acuerdos · Tareas · Para la próxima |
| `client` | Llamada con cliente / Client call | Resumen · Contexto del cliente · Quién decide · Necesidades y problemas · Dudas y objeciones · Alternativas · Presupuesto y plazos · Riesgos · Compromisos · Próximos pasos |
| `interview` | Entrevista / Interview | Perfil o tema · Preguntas y respuestas · Citas destacadas · Por verificar · Próximos pasos |
| `class` | Clase o conferencia / Class or lecture | Resumen · Estructura · Conceptos principales · Definiciones · Ejemplos · Lo que se remarcó · Recursos mencionados · Tareas y fechas · Dudas abiertas · Para repasar |
| `executive` | Ejecutivo / Executive | Resumen · Decisiones · Riesgos · Cifras clave · Qué se necesita · Próximos pasos |

Section text for the prompt (each one replaces the section list of
`SUMMARY_SYSTEM`; the opening line and the closing "No inventes nada…"
sentence stay shared):

```text
team:
## Objetivo (1-2 frases)
## Temas tratados (lista: cada tema con lo esencial de lo que se dijo)
## Avances (lista: lo que contó cada persona de su trabajo)
## Decisiones (lista)
## Tareas (lista; "- [ ] tarea — responsable — fecha", solo con lo que se mencione)
## Bloqueos (lista)
## Para la próxima (lista: temas que quedaron pendientes)

one_on_one:
## Resumen (2-4 frases)
## Cómo está (lista: solo lo que la persona contó de sí misma; no interpretes su ánimo)
## Avance del trabajo (lista: proyectos u objetivos que se repasaron y cómo van)
## Bloqueos (lista)
## Feedback (lista; di si se dio o se recibió y quién lo dio)
## Crecimiento y carrera (lista)
## Acuerdos (lista)
## Tareas (lista; "- [ ] tarea — responsable" si se menciona)
## Para la próxima (lista)

client:
## Resumen (3-5 frases)
## Contexto del cliente (lista: su situación y lo que usa ahora)
## Quién decide (lista: personas y roles del lado del cliente)
## Necesidades y problemas (lista)
## Dudas y objeciones (lista)
## Alternativas (lista: otras opciones o competidores que mencionó)
## Presupuesto y plazos (lista; solo lo que se dijo)
## Riesgos (lista: señales de alerta)
## Compromisos (lista; "- Nosotros: …" o "- Cliente: …". "Yo" es quien usa la app y está del lado "Nosotros")
## Próximos pasos (lista; "- [ ] paso — responsable — fecha", solo con lo que se mencione)

interview:
## Perfil o tema (2-4 frases)
## Preguntas y respuestas (lista: solo las preguntas principales, "- Pregunta: lo esencial de la respuesta")
## Citas destacadas (lista: "- "cita" — Persona N"; escribe cada cita traducida al idioma del resumen, fiel a lo que se dijo, sin resumirla)
## Por verificar (lista: datos, cifras o afirmaciones que conviene comprobar)
## Próximos pasos (lista)

class:
## Resumen (3-5 frases)
## Estructura (lista: los temas en el orden en que se explicaron)
## Conceptos principales (lista: cada concepto con una explicación de 1-2 frases)
## Definiciones (lista; "- término: definición")
## Ejemplos (lista)
## Lo que se remarcó (lista: lo que se dijo que es importante, que entra en el examen o que se repitió)
## Recursos mencionados (lista: libros, autores, enlaces, herramientas)
## Tareas y fechas (lista: lo que se pidió hacer y para cuándo)
## Dudas abiertas (lista)
## Para repasar (lista: 3-5 preguntas para comprobar si se entendió, "- pregunta — respuesta breve"; la respuesta tiene que estar en la transcripción)

executive:
## Resumen (un párrafo de 6-10 frases: contexto, qué se decidió y por qué importa)
## Decisiones (lista)
## Riesgos (lista)
## Cifras clave (lista: importes, fechas y números que se mencionaron)
## Qué se necesita (lista: decisiones, recursos o aprobaciones que se piden a quien lo lee)
## Próximos pasos (lista: qué pasa ahora, quién y cuándo)
```

---

## 2. Backend (`src-tauri/src/notes.rs`)

1. Split `SUMMARY_SYSTEM` in three: the opening line (with `{idioma}`), the
   sections, and the closing rule ("No inventes nada… Persona N…"). The
   General sections are the current text, byte for byte.
2. `SUMMARY_TEMPLATES: &[(&str, &str)]`: `(id, sections)` for the seven
   templates of section 1.
3. `fn summary_template(note: &Value) -> &'static str`: reads
   `/summary_template`; missing or unknown → `"general"`.
4. `summary_system` builds opening + template sections + closing, then adds
   the same extras as today, in the same order.
5. `SUMMARY_MAP`: it names "Puntos clave, Decisiones y Tareas"; change it to
   "En cada sección que sea una lista" and "esas mismas secciones de lista"
   for the short version. `mapTree` in `src/utils/mindMap.js` already
   matches branches by title, so the mind map needs no change.
6. `note_summarize` saves the template used in the summary:
   `{ text, map?, template, created_at }`.
7. Tests (`cargo test`):
   - no `summary_template` → the system prompt contains the current
     General sections;
   - each id → its first heading is in the prompt;
   - an unknown id → General;
   - the extras (notes, bookmarks, map, language) still go in with any
     template.

`first_summary_line` (the line under each note in the list) takes the first
non-heading line, so it works with every template: no change.

---

## 3. Interface

**Summary tab of `src/components/NotePage/index.jsx`:** a second
`InlineSelect` (`@components/shared`) before the language one, so the bar
reads "Resumen **General ⌄** en **Español ⌄**". Same `disabled` as the
language select (`live || summarizing`).

- Choosing a template saves `summary_template` in the note with
  `api.noteSave`, like `summary_lang`.
- The chosen value: `note.summary_template`, else `"general"` (every note
  starts on General; the choice is only remembered in that note).
- **Stale summary:** if `note.summary.template` (missing = `"general"`)
  differs from the chosen one, "Summarize again" becomes the primary button
  and a line like the language one says which template the summary was made
  with (`notes.summaryStaleTemplate`). If both language and template
  changed, one line with both is enough.

**Pure functions in `src/utils/notes.js`** (with tests in `notes.test.js`):

- `SUMMARY_TEMPLATES`: the ids, in the order of section 1.
- `summaryTemplateOf(note)`: the note's id, else `"general"`.

**No "last template used":** the selector always starts on General, so no
new `localStorage` key.

**i18n** (`src/i18n/es/notes.json` and `en/notes.json`):

- `notes.summaryTemplate`: the select's `aria-label` ("Plantilla del
  resumen" / "Summary template");
- `notes.template.<id>`: the seven names;
- `notes.summaryStaleTemplate`: "Este resumen se hizo con la plantilla
  {template}." / "This summary was made with the {template} template.".

Then generate the other languages as `docs/i18n.md` says.

**"Copy for another chat"** (`summaryPrompt`) stays generic in phase 1.

---

## 4. Docs

- `marketing/lingora-base-conocimiento.md`: the templates (feature list).
- `CLAUDE.md`, section 4: a line for this plan.
- `docs/plan-notas.md`: a pointer to this plan where it describes the
  summary.

---

## 5. Checks

- `npx vite build`, `pnpm test`, `cargo check` and `cargo test`.
- By hand, with real notes and the user's Groq key:
  - an old note without template → same summary as before;
  - each template on a fitting note (a 1:1, a client call, a class…): the
    sections appear, empty ones are left out, times on the list items;
  - the mind map shows the template's lists (and nothing breaks with
    Executive, which is mostly prose);
  - summary in English with a non-General template: headings in English;
  - changing the template after summarizing → stale line and primary
    button; summarizing again clears it.

---

## Phase 2 (later): custom templates

The user writes their own sections (name + list of headings, each
marked as prose or list). Not part of phase 1; it needs its own plan
(where they are stored, an editor, limits so the prompt stays safe).
