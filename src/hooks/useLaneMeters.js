import { useEffect, useRef, useState } from "react";

/** RMS level below which no sound is considered to arrive. */
const SILENCE_RMS = 0.0005;

/**
 * The level of each lane's capture, read 10 times per second for the meter,
 * and how long it has been silent (to warn when no audio arrives).
 * `lastSignal` is the last moment with signal per lane; setting it to 0 restarts the count.
 * @param {React.MutableRefObject<Record<string, { capture?: import("../utils/audio").AutoCapture }>>} runtime
 */
export function useLaneMeters(runtime) {
  const [meters, setMeters] = useState({ remote_to_local: null, local_to_remote: null });
  const lastSignal = useRef({ remote_to_local: 0, local_to_remote: 0 });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const read = (d) => {
        const c = runtime.current[d].capture;
        if (!c) return null;
        const level = c.level();
        const now = performance.now();
        if (level > SILENCE_RMS || !lastSignal.current[d]) lastSignal.current[d] = now;
        return { level, speaking: c.speaking(), silentSecs: (now - lastSignal.current[d]) / 1000 };
      };
      setMeters({ remote_to_local: read("remote_to_local"), local_to_remote: read("local_to_remote") });
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  return { meters, lastSignal };
}
