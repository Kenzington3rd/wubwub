import { describe, it, expect } from "vitest";
import { detectKey } from "../src/audio/keyDetect.js";
import { MockAudioBuffer } from "./mocks/webAudioMock.js";

// Build a buffer that loudly contains the C-major triad (C, E, G) across
// multiple octaves. Krumhansl-Schmuckler should pick C major as best fit.
function buildChordBuffer(freqs, seconds = 12, sampleRate = 11025) {
  const length = Math.floor(sampleRate * seconds);
  const buf = new MockAudioBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t);
    data[i] = s / freqs.length;
  }
  return buf;
}

describe("detectKey — US41", () => {
  it("@us US41: rejects null buffer", async () => {
    await expect(detectKey(null)).rejects.toThrow();
  });

  it("@us US41: returns { key, camelot, confidence }", async () => {
    const buf = buildChordBuffer([261.63, 329.63, 392.0]); // C major triad
    const result = await detectKey(buf);
    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("camelot");
    expect(result).toHaveProperty("confidence");
  });

  it("@us US41: detects C major from a C-E-G triad → Camelot 8B", async () => {
    const buf = buildChordBuffer([261.63, 329.63, 392.0]);
    const result = await detectKey(buf);
    expect(result.camelot).toBe("8B");
  });

  it("@us US41: detects A minor from an A-C-E triad → Camelot 8A", async () => {
    const buf = buildChordBuffer([220.0, 261.63, 329.63]);
    const result = await detectKey(buf);
    expect(result.camelot).toBe("8A");
  });

  it("@us US41: confidence in [0, 1]", async () => {
    const buf = buildChordBuffer([261.63, 329.63, 392.0]);
    const { confidence } = await detectKey(buf);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("@us US41: camelot follows the 1A..12B canonical form", async () => {
    const buf = buildChordBuffer([261.63, 329.63, 392.0]);
    const { camelot } = await detectKey(buf);
    expect(camelot).toMatch(/^([1-9]|1[0-2])[AB]$/);
  });
});
