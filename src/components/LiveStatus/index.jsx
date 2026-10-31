import { cx } from "../shared";
import styles from "./styles.module.css";

/** Characters of what is being heard that fit on one line. */
const LIVE_CHARS = 90;

/**
 * Pulsing dot and what is being heard right now; with nothing heard, a status
 * message. Used at the foot of the subtitles (Translate) and in Take notes.
 * @param {{ live?: string, idle: string }} props
 */
export default function LiveStatus({ live = "", idle }) {
  return (
    <span className={cx(styles.captionsStatus, live && styles.isLive)}>
      <span className="live-dot" />
      <span className={styles.captionsStatusText} dir="auto">
        {live
          ? // The last thing said is what matters: it is trimmed from the start.
            live.length > LIVE_CHARS
            ? `…${live.slice(-LIVE_CHARS)}`
            : live
          : idle}
      </span>
    </span>
  );
}
