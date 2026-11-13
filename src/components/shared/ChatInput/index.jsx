import { useLayoutEffect, useRef } from "react";
import { cx } from "@components/shared/cx";
import { SendIcon, StopIcon } from "@components/shared/icons";
import styles from "./styles.module.css";

/** The field grows with the text up to this height (px), then scrolls. */
const MAX_HEIGHT = 160;

/**
 * Where a chat message is written: a field that grows with the text (Enter
 * sends, Shift+Enter starts a new line) and a button that sends or, while an
 * answer is being written (`busy`), stops it. With `disabled` nothing can be
 * written or sent.
 * @param {{ value: string, onChange: (value: string) => void, onSend: () => void, onStop: () => void,
 *   busy: boolean, disabled?: boolean, placeholder: string, sendLabel: string, stopLabel: string, className?: string }} props
 */
export default function ChatInput({ value, onChange, onSend, onStop, busy, disabled = false, placeholder, sendLabel, stopLabel, className }) {
  const field = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      // Empty: keep the one-row height. Measuring then would count the
      // placeholder, and a wrong width before the first layout inflates it.
      if (!el.value) return;
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    };
    fit();
    // The width can settle after the first paint (layout, fonts, resizes).
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const canSend = !disabled && !busy && value.trim().length > 0;

  return (
    <div className={cx(styles.chatInput, disabled && styles.isDisabled, className)}>
      <textarea
        ref={field}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter while choosing a character with an input method is not "send".
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      {busy ? (
        <button type="button" className={styles.chatInputButton} aria-label={stopLabel} title={stopLabel} onClick={onStop}>
          <StopIcon />
        </button>
      ) : (
        <button type="button" className={cx(styles.chatInputButton, styles.isSend)} aria-label={sendLabel} title={sendLabel} disabled={!canSend} onClick={onSend}>
          <SendIcon />
        </button>
      )}
    </div>
  );
}
