/**
 * Render mínimo del Markdown del resumen: `##`, listas con `-`, casillas
 * `- [ ]` (solo visuales), `**negrita**` y párrafos. Todo sale como elementos
 * de React, así que el texto nunca se interpreta como HTML.
 * @param {{ text: string }} props
 */
export default function Markdown({ text }) {
  /** @type {import("react").ReactNode[]} */
  const blocks = [];
  /** @type {import("react").ReactNode[] | null} */
  let list = null;
  const flush = () => {
    if (list) blocks.push(<ul key={blocks.length}>{list}</ul>);
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,4}\s+(.*)/);
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/);
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (heading) {
      flush();
      blocks.push(<h3 key={blocks.length}>{inline(heading[1])}</h3>);
    } else if (task || item) {
      list ??= [];
      if (task) {
        const done = task[1] !== " ";
        list.push(
          <li key={list.length} className="md-task">
            <span className={done ? "md-check is-done" : "md-check"} aria-hidden />
            <span>{inline(task[2])}</span>
          </li>,
        );
      } else {
        list.push(<li key={list.length}>{inline(/** @type {RegExpMatchArray} */ (item)[1])}</li>);
      }
    } else if (line.trim()) {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    } else {
      flush();
    }
  }
  flush();
  return <div className="md">{blocks}</div>;
}

/** Pasa `**negrita**` a <strong>; el resto queda como texto. @param {string} text */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}
