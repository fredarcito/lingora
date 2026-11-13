import { useEffect, useLayoutEffect, useRef } from "react";
import { cx } from "@components/shared/cx";
import { ArrowIcon, SparkleIcon } from "@components/shared/icons";
import { useSmoothText } from "@hooks/useSmoothText";
import { useStickToBottom } from "@hooks/useStickToBottom";
import styles from "./styles.module.css";

/**
 * The messages of a chat: yours on the right, the answers on the left with
 * the assistant's mark and name (`assistantLabel`), drawn by `renderAnswer`
 * so this stays independent of how they are formatted. Each message shows
 * its time of day (`timeOf(message)`, nothing if empty); `renderActions`
 * adds a row under a finished answer (copy…).
 * It fills the height it is given and scrolls inside itself, with `footer`
 * (the input) under the messages; it follows the answer being written
 * unless the user scrolled up to reread; then a button above the footer
 * offers to go back to the end.
 * `streaming` is the answer in progress: its text so far, shown at a steady
 * pace (`renderAnswer(text, true)`, which can fade its end in),
 * or an empty string while the model is still reading (three dots that
 * pulse; `readingLabel` is what a screen reader says).
 * `null` when no answer is in progress. `children` is the empty state (shown
 * with no messages). An answer stopped before it wrote anything shows `stoppedLabel`.
 * @template {{ role: "user" | "assistant", text: string }} M
 * @param {{ messages: M[], streaming: string | null,
 *   renderAnswer: (text: string, writing?: boolean) => import("react").ReactNode, renderActions?: (message: M) => import("react").ReactNode,
 *   timeOf?: (message: M) => string, assistantLabel: string, readingLabel: string, stoppedLabel: string,
 *   latestLabel: string, footer?: import("react").ReactNode, className?: string, children?: import("react").ReactNode }} props
 */
export default function ChatThread({
  messages,
  streaming,
  renderAnswer,
  renderActions,
  timeOf = () => "",
  assistantLabel,
  readingLabel,
  stoppedLabel,
  latestLabel,
  footer,
  className,
  children,
}) {
  // The answer being written appears at a steady pace, not in jumps.
  const smooth = useSmoothText(streaming);
  // A smooth scroll for each new message or answer; while one is being written, the
  // view follows it every frame without animating (an animation per letter would stutter).
  const { ref, away, onScroll, toBottom } = useStickToBottom([messages.length, streaming === null]);
  // Off as soon as the user scrolls up (the view only goes up by hand: following
  // and new text only push it down), on again back at the bottom.
  const following = useRef(true);
  const lastTop = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && smooth && following.current) el.scrollTop = el.scrollHeight;
  }, [smooth, ref]);
  const scrolled = () => {
    onScroll();
    const el = ref.current;
    if (!el) return;
    if (el.scrollTop < lastTop.current - 1) following.current = false;
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 4) following.current = true;
    lastTop.current = el.scrollTop;
  };
  /** @param {ScrollBehavior} [behavior] */
  const toEnd = (behavior) => {
    following.current = true;
    toBottom(behavior);
  };
  const empty = messages.length === 0 && streaming === null;
  // A cleared chat starts over at the bottom: no «go to the end» left from before,
  // and the next answer is followed again.
  useEffect(() => {
    if (!empty) return;
    following.current = true;
    lastTop.current = 0;
    toBottom("auto");
  }, [empty, toBottom]);

  /** An answer: the mark, the name and time, and the body. @param {import("react").Key} key @param {string} time @param {import("react").ReactNode} body @param {boolean} [writing] @param {boolean} [reading] */
  const answer = (key, time, body, writing = false, reading = false) => (
    <div key={key} className={styles.chatAnswer}>
      <span className={styles.chatAvatar} aria-hidden>
        <SparkleIcon />
      </span>
      <div className={styles.chatAnswerMain}>
        <p className={styles.chatMeta}>
          <span className={styles.chatName}>{assistantLabel}</span>
          {time && <time>{time}</time>}
        </p>
        <div className={cx(styles.chatMessage, styles.isAnswer, writing && styles.isWriting, reading && styles.isReading)}>{body}</div>
      </div>
    </div>
  );

  return (
    <div className={cx(styles.chatThreadWrap, className)}>
      <div ref={ref} className={cx(styles.chatThread, empty && styles.isEmpty)} onScroll={scrolled} role="log" aria-live="polite">
        {empty ? (
          children
        ) : (
          <>
            {messages.map((m, i) => {
              const time = timeOf(m);
              if (m.role === "user") {
                return (
                  <div key={i} className={styles.chatQuestion}>
                    <p className={cx(styles.chatMessage, styles.isUser)}>{m.text}</p>
                    {time && <time className={styles.chatQuestionTime}>{time}</time>}
                  </div>
                );
              }
              const written = m.text.trim().length > 0;
              const actions = written && renderActions?.(m);
              return answer(
                i,
                time,
                <>
                  {written ? renderAnswer(m.text) : <span className="muted">{stoppedLabel}</span>}
                  {actions && <div className={styles.chatActions}>{actions}</div>}
                </>,
              );
            })}
            {streaming !== null &&
              answer(
                "streaming",
                "",
                smooth ? (
                  renderAnswer(smooth, true)
                ) : (
                  <span className={styles.chatTyping} role="status" aria-label={readingLabel}>
                    <i />
                    <i />
                    <i />
                  </span>
                ),
                !!smooth,
                !smooth,
              )}
          </>
        )}
      </div>
      <div className={styles.chatFooter}>
        {away && (
          <button type="button" className={styles.chatLatest} onClick={() => toEnd()}>
            <span className={styles.chatLatestArrow}>
              <ArrowIcon />
            </span>
            {latestLabel}
          </button>
        )}
        {footer}
      </div>
    </div>
  );
}
