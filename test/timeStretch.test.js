import { describe, it, expect } from "vitest";
import {
  hannWindow,
  semitonesToRatio,
  readGrain,
  stretchChannel,
  GRAIN_SIZE,
  HOP_OUT,
} from "../src/audio/timeStretch.js";

// W3.1 — granular time-stretch DSP core (US71). The worklet mirrors this
// algorithm; these tests pin the math the keylock feature will ship on.

describe("timeStretch core — US71", () => {
  it("@us US71: 50% Hann overlap sums to unity (no OLA gain ripple)", () => {
    const w = hannWindow(GRAIN_SIZE);
    // At 50% overlap, w[i] + w[i + HOP] must be ~1 across the second half.
    for (let i = 0; i < HOP_OUT; i += 97) {
      expect(w[i] + w[i + HOP_OUT]).toBeCloseTo(1, 2);
    }
  });

  it("@us US71: semitonesToRatio — 0 → 1, +12 → 2, −12 → 0.5", () => {
    expect(semitonesToRatio(0)).toBe(1);
    expect(semitonesToRatio(12)).toBeCloseTo(2, 10);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 10);
  });

  it("@us US71: readGrain resamples with linear interpolation and zero-pads out of range", () => {
    const input = new Float32Array([0, 1, 2, 3]);
    const out = readGrain(input, 0.5, 3, 1);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(1.5, 5);
    // pitchRatio 2 skips every other sample.
    const fast = readGrain(input, 0, 2, 2);
    expect(fast[0]).toBe(0);
    expect(fast[1]).toBe(2);
    // Reads past the end are silent, not garbage.
    const past = readGrain(input, 10, 2, 1);
    expect(past[0]).toBe(0);
  });

  it("@us US71: output length scales inversely with rate (tempo without pitch)", () => {
    const input = new Float32Array(GRAIN_SIZE * 8).fill(0.5);
    expect(stretchChannel(input, 2).length).toBe(input.length / 2);
    expect(stretchChannel(input, 0.5).length).toBe(input.length * 2);
    expect(stretchChannel(input, 1).length).toBe(input.length);
  });

  it("@us US71: a constant signal passes through at unity in the steady state", () => {
    const input = new Float32Array(GRAIN_SIZE * 8).fill(1);
    for (const rate of [0.8, 1, 1.25]) {
      const out = stretchChannel(input, rate);
      // Skip the fade-in/fade-out edges; the interior must hold ~1.0.
      for (let i = GRAIN_SIZE; i < out.length - GRAIN_SIZE; i += 1009) {
        expect(out[i]).toBeCloseTo(1, 1);
      }
    }
  });

  it("@us US71: pitchRatio changes content speed inside grains without changing output length", () => {
    // A ramp input read at pitchRatio 2 climbs twice as fast within a grain.
    const input = new Float32Array(GRAIN_SIZE * 8);
    for (let i = 0; i < input.length; i++) input[i] = i;
    const normal = stretchChannel(input, 1, 1);
    const up = stretchChannel(input, 1, 2);
    expect(up.length).toBe(normal.length);
    // Early in the first grain (before overlap), up's slope ≈ 2× normal's.
    const slopeNormal = normal[600] - normal[500];
    const slopeUp = up[600] - up[500];
    expect(slopeUp / slopeNormal).toBeCloseTo(2, 0);
  });
});

describe("stretch worklet source — US71", () => {
  it("@us US71: the worklet source registers 'stretch-processor' with rate + pitchRatio params", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/worklets/stretch-worklet.js", "utf8");
    expect(src).toMatch(/registerProcessor\("stretch-processor"/);
    expect(src).toMatch(/name: "rate"/);
    expect(src).toMatch(/name: "pitchRatio"/);
    // Danger-zone rule: no static worklet paths anywhere — this file is
    // designed for ?raw + Blob-URL registration like the looper worklet.
    expect(src).not.toMatch(/import /);
  });
});
