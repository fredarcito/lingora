import { useCallback, useEffect, useRef, useState } from "react";

const BLOCK_SIZE = 4096;

/**
 * Records the microphone as it is (no echo cancellation, noise suppression or
 * automatic gain: Rust brings the level up), for "Your voice" in Settings →
 * Speak. With noise suppression on, the first 2 s came in ~8× quieter
 * (probably while it settled) and the clone took that level; Rust also drops
 * such a quiet start (`own_voice::lead_in`).
 * - `recording`: a recording is going on.
 * - `secs`: seconds recorded so far.
 * - `level`: 0–1, how loud the last block was, for the meter.
 * - `start(deviceId)`: "" = the system's microphone. Rejects if it can't be opened.
 * - `stop()`: resolves with what was recorded (`null` if nothing was going on).
 * - `cancel()`: stops and throws it away.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  /** @type {React.MutableRefObject<{ stream: MediaStream, ctx: AudioContext, blocks: Float32Array[] } | null>} */
  const session = useRef(null);

  const close = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (!s) return null;
    s.stream.getTracks().forEach((track) => track.stop());
    s.ctx.close().catch(() => {});
    setRecording(false);
    setLevel(0);
    return s;
  }, []);

  /** @param {string} deviceId */
  const start = useCallback(async (deviceId) => {
    close();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const ctx = new AudioContext();
    // Like `startAutoCapture`: a suspended context delivers no audio.
    await ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
    /** @type {Float32Array[]} */
    const blocks = [];
    processor.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      blocks.push(block);
      const rms = Math.sqrt(block.reduce((sum, v) => sum + v * v, 0) / block.length);
      setLevel(Math.min(1, Math.sqrt(rms) * 2));
      setSecs((blocks.length * BLOCK_SIZE) / ctx.sampleRate);
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    session.current = { stream, ctx, blocks };
    setSecs(0);
    setRecording(true);
  }, [close]);

  const stop = useCallback(async () => {
    const s = close();
    if (!s) return null;
    const samples = new Float32Array(s.blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of s.blocks) {
      samples.set(b, at);
      at += b.length;
    }
    return { samples, sampleRate: s.ctx.sampleRate };
  }, [close]);

  const cancel = useCallback(() => {
    close();
    setSecs(0);
  }, [close]);

  // Leaving the screen while recording releases the microphone.
  useEffect(() => () => void close(), [close]);

  return { recording, secs, level, start, stop, cancel };
}
