import { useEffect, useState } from "react";
import { ROUTE_CHECK_MS, readRoute } from "../utils/route.js";

/**
 * Lo que hay conectado para oír y hablar, al día mientras `active`: se vuelve
 * a mirar cada poco (conectar unos AirPods cambia la salida y la entrada).
 * @param {boolean} active
 * @returns {import("../utils/api").AudioRoute | null}
 */
export function useAudioRoute(active) {
  const [route, setRoute] = useState(/** @type {import("../utils/api").AudioRoute | null} */ (null));
  useEffect(() => {
    if (!active) return;
    const load = () => readRoute().then(setRoute);
    load();
    const timer = window.setInterval(load, ROUTE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return route;
}
