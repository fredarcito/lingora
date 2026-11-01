import { useCallback, useEffect, useState } from "react";
import { api } from "@utils/api";
import { SYSTEM_AUDIO, listWebviewDevices, pairDevices } from "@utils/audio";
import { VIRTUAL_MIC, feedsCapture } from "@utils/lanes";

/**
 * The audio inputs and outputs, and whether the Mac audio can be heard without
 * BlackHole (macOS 14.2+). When they load, each lane without a device gets a
 * safe default (see `loadDevices`). They are read again when something is
 * connected, except while translating.
 * @param {{
 *   setLanes: React.Dispatch<React.SetStateAction<import("@app/types").Lane[]>>,
 *   anyRunningRef: React.MutableRefObject<boolean>,
 * }} options
 */
export function useDevices({ setLanes, anyRunningRef }) {
  const [devices, setDevices] = useState({ inputs: [], outputs: [] });
  const [systemAudio, setSystemAudio] = useState(false);

  // Core Audio gives the reliable names; the WebView gives the IDs that
  // getUserMedia accepts. They are paired by name. `askMic` opens the microphone
  // for a moment to get the names; when something is connected it is not needed
  // (the permission is already there) and opening it would cause another `devicechange`.
  const loadDevices = useCallback((askMic = true) => {
    const web = askMic ? listWebviewDevices() : navigator.mediaDevices.enumerateDevices();
    Promise.all([api.listAudioDevices(), web, api.systemAudioSupported().catch(() => false)])
      .then(([core, web, canTap]) => {
        const paired = pairDevices(core, web);
        setDevices(paired);
        setSystemAudio(canTap);
        // By default, the first safe output (usually the speakers). Speak goes
        // to the virtual microphone when it is installed.
        const safe = paired.outputs.find((d) => !feedsCapture(d.name) && d.name !== VIRTUAL_MIC);
        const mic = paired.outputs.find((d) => d.name === VIRTUAL_MIC);
        // Listen hears the call or the video from the Mac audio (without
        // Lingora's voice) or, on older Macs, through BlackHole. With the default
        // microphone it would hear its own voice through the speakers and repeat it in a loop.
        const blackhole = paired.inputs.find((d) => d.webId && /blackhole 2ch/i.test(d.name));
        const listenFrom = canTap ? SYSTEM_AUDIO : (blackhole?.webId ?? "");
        setLanes((prev) =>
          prev.map((l) => {
            const inputDeviceId = l.inputDeviceId || (l.direction === "remote_to_local" ? listenFrom : "");
            // With the Mac audio, Lingora's voice does not get into the capture: the
            // default output is safe and follows the headphones if they are connected.
            const followsSystem = l.direction === "remote_to_local" && inputDeviceId === SYSTEM_AUDIO;
            const fallback = l.direction === "local_to_remote" && mic ? mic.name : followsSystem ? "" : safe?.name || "";
            return { ...l, outputDevice: l.outputDevice || fallback, inputDeviceId };
          }),
        );
      })
      .catch(() => setDevices({ inputs: [], outputs: [] }));
  }, []);

  useEffect(() => {
    loadDevices();
    // A microphone or headphones that get connected show up in Settings right
    // away. Not while recording: the Mac audio creates its own device when it
    // starts (and in a meeting `useMeetingNotes` already follows the microphone).
    // Notices in a row count as one and do not open the microphone.
    const media = navigator.mediaDevices;
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      if (anyRunningRef.current) return;
      timer = window.setTimeout(() => loadDevices(false), 500);
    };
    media?.addEventListener("devicechange", onChange);
    return () => {
      window.clearTimeout(timer);
      media?.removeEventListener("devicechange", onChange);
    };
  }, [loadDevices]);

  return { devices, systemAudio, loadDevices };
}
