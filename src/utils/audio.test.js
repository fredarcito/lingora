import { describe, expect, it } from "vitest";
import { encodeWavPcm16, FILLER, joinWords, pairDevices } from "./audio";

describe("FILLER", () => {
  it.each(["Mm.", "Mmm", "Mm-hmm.", "Uh,", "Ah.", "Ajá", "Eh, mm.", "Hmm..."])("skips %j", (text) => {
    expect(FILLER.test(text)).toBe(true);
  });

  it.each(["Sí.", "Yes.", "Um, creo que sí.", "Hola", "Ah, vale."])("keeps %j", (text) => {
    expect(FILLER.test(text)).toBe(false);
  });
});

describe("joinWords", () => {
  it("joins with spaces", () => {
    expect(joinWords(["Hola", "qué", "tal"])).toBe("Hola qué tal");
  });

  it("glues Chinese and Japanese characters", () => {
    expect(joinWords(["你", "好", "世", "界"])).toBe("你好世界");
    expect(joinWords(["こんにちは", "OK"])).toBe("こんにちはOK");
  });
});

describe("encodeWavPcm16", () => {
  it("writes a 16-bit mono header and clamped samples", () => {
    const wav = encodeWavPcm16(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(wav.length).toBe(44 + 8);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });
});

describe("pairDevices", () => {
  it("matches Core Audio devices with WebView ones by name", () => {
    const core = [
      { name: "MacBook Pro Microphone", uid: "mic", input_channels: 1, output_channels: 0 },
      { name: "AirPods", uid: "pods", input_channels: 1, output_channels: 2 },
    ];
    const web = [
      { kind: "audioinput", label: "AirPods", deviceId: "w-pods-in" },
      { kind: "audiooutput", label: "AirPods", deviceId: "w-pods-out" },
    ];
    expect(pairDevices(/** @type {any} */ (core), /** @type {any} */ (web))).toEqual({
      inputs: [
        { name: "MacBook Pro Microphone", uid: "mic", webId: "" },
        { name: "AirPods", uid: "pods", webId: "w-pods-in" },
      ],
      outputs: [{ name: "AirPods", uid: "pods", webId: "w-pods-out" }],
    });
  });
});
