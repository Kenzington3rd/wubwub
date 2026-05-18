import { describe, it, expect } from "vitest";
import { detectBpm } from "../src/audio/bpmDetect.js";
import { MockAudioBuffer } from "./mocks/webAudioMock.js";

// Build a buffer with kicks at a known BPM. The mock OfflineAudioContext
// passes the source buffer through unchanged, so detectBpm sees this signal.
function buildKickBuffer(bpm, seconds = 12, sampleRate = 44100) {
  const length = Math.floor(sampleRate * seconds);
  const buf = new MockAudioBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  const samplesPerBeat = Math.floor(60 / bpm * sampleRate);
  // Each kick is a short, low-frequency burst (200 Hz sine, 50 ms).
  const burstLen = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < length; i += samplesPerBeat) {
    for (let j = 0; j < burstLen && i + j < length; j++) {
      const t = j / sampleRate;
      // Decaying low sine, mimics a kick fundamental
      data[i + j] = Math.sin(2 * Math.PI * 80 * t) * Math.exp(-12 * t);
    }
  }
  return buf;
}

describe("detectBpm — US40", () => {
  it("@us US40: rejects null buffer", async () => {
    await expect(detectBpm(null)).rejects.toThrow();
  });

  it("@us US40: returns { bpm, confidence }", async () => {
    const buf = buildKickBuffer(128, 8);
    const result = await detectBpm(buf);
    expect(result).toHaveProperty("bpm");
    expect(result).toHaveProperty("confidence");
    expect(typeof result.bpm).toBe("number");
    expect(typeof result.confidence).toBe("number");
  });

  it("@us US40: detects 128 BPM on a synthetic 128 BPM kick pattern (±2 BPM)", async () => {
    const buf = buildKickBuffer(128, 15);
    const { bpm } = await detectBpm(buf);
    expect(Math.abs(bpm - 128)).toBeLessThanOrEqual(2);
  });

  it("@us US40: detects 140 BPM on a synthetic 140 BPM kick pattern (±2 BPM)", async () => {
    const buf = buildKickBuffer(140, 15);
    const { bpm } = await detectBpm(buf);
    expect(Math.abs(bpm - 140)).toBeLessThanOrEqual(2);
  });

  it("@us US40: respects minBpm/maxBpm bounds", async () => {
    const buf = buildKickBuffer(128, 15);
    const { bpm } = await detectBpm(buf, { minBpm: 100, maxBpm: 160 });
    expect(bpm).toBeGreaterThanOrEqual(100);
    expect(bpm).toBeLessThanOrEqual(160);
  });

  it("@us US40: returns a confidence in [0, 1]", async () => {
    const buf = buildKickBuffer(128, 10);
    const { confidence } = await detectBpm(buf);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("@us US40: a silent / all-zero buffer returns confidence 0 and a finite bpm", async () => {
    // Untouched MockAudioBuffer channels are zero-filled — pure silence.
    const silent = new MockAudioBuffer(1, 44100 * 8, 44100);
    const { bpm, confidence } = await detectBpm(silent);
    expect(confidence).toBe(0);
    expect(Number.isFinite(bpm)).toBe(true);
  });

  it("@us US40: a buffer too short for the autocorrelation lag returns a finite default, confidence 0", async () => {
    // A tiny buffer cannot hold even one minLag-spaced pair in the ~200 Hz
    // envelope — detectBpm must return an explicit finite default, never
    // -Infinity-derived garbage.
    const tiny = new MockAudioBuffer(1, 64, 44100);
    const { bpm, confidence } = await detectBpm(tiny);
    expect(confidence).toBe(0);
    expect(Number.isFinite(bpm)).toBe(true);
  });
});
