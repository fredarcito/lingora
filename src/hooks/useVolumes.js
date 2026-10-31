import { useRef, useState } from "react";
import { loadVolumes, storeVolumes } from "@utils/prefs.js";

/**
 * The volume of each lane, saved. The playback queue reads `volumesRef` on
 * every sentence: that way the control works while translating, without
 * restarting the lane.
 */
export function useVolumes() {
  const [volumes, setVolumes] = useState(loadVolumes);
  const volumesRef = useRef(volumes);

  /** @param {import("@app/types").Direction} direction @param {number} value */
  const changeVolume = (direction, value) => {
    const next = { ...volumesRef.current, [direction]: value };
    volumesRef.current = next;
    setVolumes(next);
    storeVolumes(next);
  };

  return { volumes, volumesRef, changeVolume };
}
