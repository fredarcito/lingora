import { useEffect, useState } from "react";
import { api } from "@utils/api";

/** Asked once per run: it doesn't change while the app is open. */
let answer = /** @type {Promise<boolean> | null} */ (null);

/**
 * True on a low-end computer (`perf::light_device` in Rust), where the light
 * voice goes first (docs/plan-voz-ligera.md). False until Rust answers.
 */
export function useLightDevice() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    answer ??= api.lightDevice().catch(() => false);
    answer.then(setLight);
  }, []);
  return light;
}
