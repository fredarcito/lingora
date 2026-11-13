import { ArrowIcon, cx } from "@components/shared";
import { TIME_AT_END } from "@utils/mindMap.js";
import { splitCitations, splitTimes, trailingCitations, trailingTimes } from "@utils/chat.js";
import styles from "./styles.module.css";

/**
 * Minimal rendering of the summary's Markdown: `##`, lists with `-`, checkboxes
 * `- [ ]` (visual only), `**bold**` and paragraphs. A list item that starts
 * with a time (`[07:26] …`, Highlighted moments) shows it apart; with a quote
 * after it (`[01:52] «note» — context`, My notes) the user's words stand out
 * and the context goes below, quieter. A time at the end (`point [12:40]`,
 * where it was said) is for the mind map: here it is left out. Everything comes out as React
 * elements, so the text is never interpreted as HTML. `className`, so that
 * the caller can place it. With `onTime` (the chat's answers) every `[mm:ss]`
 * is a button that calls `onTime(seconds)`: in its place, or at the end of
 * the line when it closes a list item; numbered lists (`1.`) are drawn too,
 * and an item that starts with `**Title**:` shows the title over the rest.
 * `writing`: the text is still arriving; its end fades in (a short trail
 * that fades to `--md-fade-bg`, the background under the text).
 * With `cite` (the chat with all the notes), the citations `[Nota 2, 12:40]`
 * and `[Nota 2]` are buttons labelled `cite.label(n, clock)` that call
 * `cite.open(n, seconds | null)`; a citation whose `label` is null (one that
 * was not checked) stays as text. It draws the answer like `onTime` does.
 * @param {{ text: string, className?: string, onTime?: (secs: number) => void, writing?: boolean, cite?: Cite }} props
 */
export default function Markdown({ text, className, onTime, writing = false, cite }) {
  /** @type {Links | undefined} */
  const links = onTime || cite ? { onTime, cite } : undefined;
  /** @type {import("react").ReactNode[]} */
  const blocks = [];
  /** @type {import("react").ReactNode[] | null} */
  let list = null;
  let numbered = false;
  const flush = () => {
    if (list) blocks.push(numbered ? <ol key={blocks.length}>{list}</ol> : <ul key={blocks.length}>{list}</ul>);
    list = null;
  };

  const lines = text.split("\n");
  const lastLine = lines.findLastIndex((l) => l.trim());
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    const tail = writing && index === lastLine ? <span key="tail" className={styles.mdTail} aria-hidden /> : null;
    const heading = line.match(/^#{1,4}\s+(.*)/);
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/);
    const item = line.match(/^\s*[-*]\s+(.*)/);
    const ordered = links ? line.match(/^\s*(\d{1,3})[.)]\s+(.*)/) : null;
    if ((task || item || ordered) && list && numbered !== !!ordered) flush();
    if (heading) {
      flush();
      blocks.push(<h3 key={blocks.length}>
          {inline(heading[1], links)}
          {tail}
        </h3>);
    } else if (task || item || ordered) {
      list ??= [];
      numbered = !!ordered;
      if (ordered && links) {
        list.push(
          <li key={list.length} className={styles.mdPoint}>
            <span className={styles.mdNumber} aria-hidden>
              {ordered[1]}
            </span>
            {chatItem(ordered[2], links, tail)}
          </li>,
        );
      } else if (task) {
        const done = task[1] !== " ";
        list.push(
          <li key={list.length} className={styles.mdTask} data-task>
            <span className={cx(styles.mdCheck, done && styles.isDone)} aria-hidden />
            <span>
              {links ? inline(task[2], links) : endTime(task[2])}
              {tail}
            </span>
          </li>,
        );
      } else {
        // In one span: bold and text stay together even if the item is laid out as a grid.
        list.push(
          links ? (
            <li key={list.length} className={styles.mdPoint}>
              {chatItem(/** @type {RegExpMatchArray} */ (item)[1], links, tail)}
            </li>
          ) : (
            <li key={list.length}>
              <span>
                {timed(/** @type {RegExpMatchArray} */ (item)[1])}
                {tail}
              </span>
            </li>
          ),
        );
      }
    } else if (line.trim()) {
      flush();
      // The model sometimes puts a time on a paragraph too.
      blocks.push(<p key={blocks.length}>
          {links ? inline(line, links) : endTime(line)}
          {tail}
        </p>);
    } else {
      flush();
    }
  }
  flush();
  return <div className={cx(styles.md, className)}>{blocks}</div>;
}

/**
 * What the times and citations of a chat answer link to.
 * @typedef {{ label: (n: number, clock: string | null) => string | null, open: (n: number, secs: number | null) => void }} Cite
 * @typedef {{ onTime?: (secs: number) => void, cite?: Cite }} Links
 */

/**
 * A list item of a chat answer: `**Title**: rest` as a title over the rest,
 * and the times that close it as buttons on the right. `tail` goes at the end of the text.
 * @param {string} text @param {Links} links @param {import("react").ReactNode} [tail]
 */
function chatItem(text, links, tail = null) {
  const { onTime, cite } = links;
  // All notes: the checked citations that close the line go to the right, as the times do.
  const closing = cite ? trailingCitations(text) : { text, cites: [] };
  const linked = closing.cites.filter((c) => c.n !== null && cite?.label(c.n, c.clock) !== null);
  const unlinked = closing.cites.filter((c) => !linked.includes(c)).map((c) => c.raw);
  const rest = cite ? [closing.text, ...unlinked].join(" ") : text;
  const { text: body, times } = onTime && !cite ? trailingTimes(rest) : { text: rest, times: [] };
  const titled = body.match(/^\*\*([^*]+)\*\*\s*(?:[:.—–-]\s*)?(.+)$/);
  return (
    <>
      <span className={styles.mdPointBody}>
        {titled ? (
          <>
            <strong className={styles.mdPointTitle}>{withTimes(titled[1], links)}</strong>
            <span className={styles.mdPointText}>
              {inline(titled[2], links)}
              {tail}
            </span>
          </>
        ) : (
          <>
            {inline(body, links)}
            {tail}
          </>
        )}
      </span>
      {onTime && times.length > 0 && (
        <span className={styles.mdPointTimes}>
          {times.map((at, i) => (
            <button key={i} type="button" className={cx(styles.mdJump, styles.isPill)} onClick={() => onTime(at.secs)}>
              {at.clock}
              <ArrowIcon />
            </button>
          ))}
        </span>
      )}
      {cite && linked.length > 0 && (
        <span className={styles.mdPointTimes}>
          {linked.map((c, i) => (
            <button key={i} type="button" className={cx(styles.mdJump, styles.isPill)} onClick={() => cite.open(/** @type {number} */ (c.n), c.secs)}>
              {cite.label(/** @type {number} */ (c.n), c.clock)}
              <ArrowIcon />
            </button>
          ))}
        </span>
      )}
    </>
  );
}

/**
 * `[mm:ss] rest`: the time apart, in gray. If the rest is `«quote» — context`,
 * the quote (what the user wrote) and the context on its own line. A repeated
 * time at the end is left out.
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
          {quote[2] && <span className={styles.mdContext}>{endTime(quote[2])}</span>}
        </>
      ) : (
        endTime(at[2])
      )}
    </>
  );
}

/** `text [12:40]`: the text without the time, which only the mind map uses. @param {string} text */
function endTime(text) {
  return inline(text.replace(TIME_AT_END, "$2"));
}

/**
 * Turns `**bold**` into <strong>; the rest stays as text. With `links`, the
 * times and citations in it are buttons. @param {string} text @param {Links} [links]
 */
function inline(text, links) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{withTimes(part.slice(2, -2), links)}</strong>
      ) : (
        withTimes(part, links, i)
      ),
    );
}

/** The times (and citations) in `text` as buttons, if asked for. @param {string} text @param {Links | undefined} links @param {number} [key] */
function withTimes(text, links, key) {
  if (!links) return text;
  const { onTime, cite } = links;
  if (cite) {
    return (
      <span key={key}>
        {splitCitations(text).map((piece, i) => {
          if (typeof piece === "string") return piece;
          if (piece.n === null) {
            return onTime && piece.secs !== null ? (
              <button key={i} type="button" className={styles.mdJump} onClick={() => onTime(/** @type {number} */ (piece.secs))}>
                {piece.clock}
              </button>
            ) : (
              piece.raw
            );
          }
          const n = piece.n;
          const label = cite.label(n, piece.clock);
          return label === null ? (
            piece.raw
          ) : (
            <button key={i} type="button" className={styles.mdJump} onClick={() => cite.open(n, piece.secs)}>
              {label}
            </button>
          );
        })}
      </span>
    );
  }
  if (!onTime) return text;
  return (
    <span key={key}>
      {splitTimes(text).map((piece, i) =>
        typeof piece === "string" ? (
          piece
        ) : (
          <button key={i} type="button" className={styles.mdJump} onClick={() => onTime(piece.secs)}>
            {piece.clock}
          </button>
        ),
      )}
    </span>
  );
}
