import { useEffect, useState } from "react";
import { ROUTE_CHECK_MS, readRoute } from "@utils/route.js";

/**
 * What is connected to hear and speak, kept up to date while `active`: it is checked
 * again every so often (connecting AirPods changes the output and the input).
 * @param {boolean} active
 * @returns {import("@utils/api").AudioRoute | null}
 */
export function useAudioRoute(active) {
  const [route, setRoute] = useState(/** @type {import("@utils/api").AudioRoute | null} */ (null));
  useEffect(() => {
    if (!active) return;
    const load = () => readRoute().then(setRoute);
    load();
    const timer = window.setInterval(load, ROUTE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return route;
}
