import { describe, it, expect } from "vitest";
import { captureStartIndex } from "../public/worklets/looper-worklet.js";

// The ring-buffer wrap math from the looper AudioWorklet. The worklet itself
// can't be imported directly (it extends AudioWorkletProcessor, which only
// exists in an AudioWorkletGlobalScope), so the pure wrap helper is exported
// separately and exercised here.
describe("looper worklet — ring-buffer wrap math — US28", () => {
  it("@us US28: capture window fits before the write head — no wrap", () => {
    // writePos 800, capture 200 samples, buffer 1000 → starts at 600.
    expect(captureStartIndex(800, 200, 1000)).toBe(600);
  });

  it("@us US28: capture window wraps past index 0", () => {
    // writePos 100, capture 300 samples, buffer 1000 → 100-300 = -200,
    // wrapped → 800.
    expect(captureStartIndex(100, 300, 1000)).toBe(800);
  });

  it("@us US28: write head exactly at 0 wraps to the tail", () => {
    expect(captureStartIndex(0, 250, 1000)).toBe(750);
  });

  it("@us US28: capturing the whole buffer starts at the write head", () => {
    // samples === bufferSize → (w - n + n) % n === w % n.
    expect(captureStartIndex(640, 1000, 1000)).toBe(640);
    expect(captureStartIndex(0, 1000, 1000)).toBe(0);
  });

  it("@us US28: a zero-length capture starts at the write head", () => {
    expect(captureStartIndex(512, 0, 1000)).toBe(512);
  });

  it("@us US28: result is always a valid in-range buffer index", () => {
    const bufferSize = 4096;
    for (let w = 0; w < bufferSize; w += 137) {
      for (const samples of [1, 441, 2048, bufferSize]) {
        const start = captureStartIndex(w, samples, bufferSize);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start).toBeLessThan(bufferSize);
      }
    }
  });
});
