import { cx } from "@components/shared";
import styles from "./styles.module.css";

/**
 * Minimal rendering of the summary's Markdown: `##`, lists with `-`, checkboxes
 * `- [ ]` (visual only), `**bold**` and paragraphs. A list item that starts
 * with a time (`[07:26] …`, Highlighted moments) shows it apart; with a quote
 * after it (`[01:52] «note» — context`, My notes) the user's words stand out
 * and the context goes below, quieter. A time at the end (`point [12:40]`,
 * where it was said) goes in gray after the text. Everything comes out as React
 * elements, so the text is never interpreted as HTML. `className`, so that
 * the caller can place it.
 * @param {{ text: string, className?: string }} props
 */
export default function Markdown({ text, className }) {
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
          <li key={list.length} className={styles.mdTask} data-task>
            <span className={cx(styles.mdCheck, done && styles.isDone)} aria-hidden />
            <span>{endTime(task[2])}</span>
          </li>,
        );
      } else {
        // In one span: bold and text stay together even if the item is laid out as a grid.
        list.push(
          <li key={list.length}>
            <span>{timed(/** @type {RegExpMatchArray} */ (item)[1])}</span>
          </li>,
        );
      }
    } else if (line.trim()) {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    } else {
      flush();
    }
  }
  flush();
  return <div className={cx(styles.md, className)}>{blocks}</div>;
}

/**
 * `[mm:ss] rest`: the time apart, in gray. If the rest is `«quote» — context`,
 * the quote (what the user wrote) and the context on its own line.
 * @param {string} text
 */
function timed(text) {
  const at = text.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/);
  if (!at) return endTime(text);
  const quote = at[2].match(/^«([^»]*)»\s*(?:—\s*(.*))?$/);
  return (
    <>
      <span className={styles.mdTime}>{at[1]}</span>
      {quote ? (
        <>
          <span className={styles.mdQuote}>«{quote[1]}»</span>
          {quote[2] && <span className={styles.mdContext}>{inline(quote[2])}</span>}
        </>
      ) : (
        inline(at[2])
      )}
    </>
  );
}

/** `text [12:40]`: the time after the text, in gray. @param {string} text */
function endTime(text) {
  const at = text.match(/^(.*?)\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/);
  if (!at) return inline(text);
  return (
    <>
      {inline(at[1])}
      <span className={styles.mdTimeEnd}>{at[2]}</span>
    </>
  );
}

/** Turns `**bold**` into <strong>; the rest stays as text. @param {string} text */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}
