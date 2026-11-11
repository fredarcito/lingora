import { useState } from "react";
import { loadLaneSettings, storeLaneSettings } from "@utils/prefs.js";

/**
 * What the user chose on each lane (devices, voice, speed…), saved.
 * `setLanes` is for what changes them from outside (the devices that appear
 * and disappear, see `useDevices`); `updateLane` is a change made by hand.
 */
export function useLaneSettings() {
  const [laneSettings, setLanes] = useState(loadLaneSettings);

  /** @param {import("@app/types").Direction} direction @param {Partial<import("@app/types").Lane>} patch */
  const updateLane = (direction, patch) => {
    setLanes((prev) => {
      const next = prev.map((l) => (l.direction === direction ? { ...l, ...patch } : l));
      storeLaneSettings(next, patch);
      return next;
    });
  };

  return { laneSettings, setLanes, updateLane };
}
