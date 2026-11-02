import { useEffect, useState } from "react";
import { cx } from "@components/shared/cx";
import styles from "./styles.module.css";

/**
 * A line for long waits that changes every few seconds, fading in and out
 * ("Reading the conversation…", "Making the task list…"). It goes round the
 * phrases in order and starts again. Screen readers hear only `label`, once:
 * a new announcement every few seconds would get in the way. Without motion
 * (`prefers-reduced-motion`) the phrases change without fading.
 * @param {{ phrases: string[], label: string, everyMs?: number, className?: string }} props
 *   `phrases` already translated; `everyMs` how long each one stays.
 */
export default function RotatingText({ phrases, label, everyMs = 3500, className }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (phrases.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % phrases.length), everyMs);
    return () => window.clearInterval(timer);
  }, [phrases.length, everyMs]);

  return (
    <span className={cx(styles.rotatingText, className)} role="status" aria-label={label}>
      {/* A new key per phrase restarts its fade. */}
      <span key={index} className={styles.rotatingTextPhrase} style={{ animationDuration: `${everyMs}ms` }} aria-hidden>
        {phrases[index % phrases.length]}
      </span>
    </span>
  );
}
