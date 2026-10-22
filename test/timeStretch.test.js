import { describe, it, expect } from "vitest";
import {
  hannWindow,
  semitonesToRatio,
  readGrain,
  stretchChannel,
  findBestLag,
  searchRadius,
  SEARCH,
  GRAIN_SIZE,
  HOP_OUT,
  OLA_GAIN,
} from "../src/audio/timeStretch.js";

// W3.1 — granular time-stretch DSP core (US71). The worklet mirrors this
// algorithm; these tests pin the math the keylock feature will ship on.

describe("timeStretch core — US71", () => {
  it("@us US71: periodic Hann at 75% overlap sums to exactly unity (no OLA gain ripple)", () => {
    const w = hannWindow(GRAIN_SIZE);
    // Periodic form: w[0] = 0, peak exactly at n/2, and w[i] + w[i + n/2] = 1
    // (the old symmetric cos(2πi/(n−1)) form misses this by ~1/n).
    expect(w[0]).toBe(0);
    expect(w[GRAIN_SIZE / 2]).toBe(1);
    expect(HOP_OUT).toBe(GRAIN_SIZE / 4);
    let worst = 0;
    for (let i = 0; i < HOP_OUT; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += w[i + k * HOP_OUT];
      worst = Math.max(worst, Math.abs(sum * OLA_GAIN - 1));
      expect(w[i] + w[i + GRAIN_SIZE / 2]).toBeCloseTo(1, 6);
    }
    expect(worst).toBeLessThan(1e-6);
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

// ── WSOLA quality — numbers pinned against the Audio Engine Architect review ──
//
// Plain OLA (grain g read at outPos × rate, no alignment) comb-filters at the
// grain rate. Measured on the pre-WSOLA core with the metrics below:
//   440 Hz AM depth   rate 1.02 → 10.9 dB, 1.12 → 16.3 dB, 2.0 → 13.6 dB
//   120 BPM clicks    rate 1.06 → second peak at 0.93× the first, 123
//                     samples (2.8 ms) away — every transient doubled
//   rate 1 / pitch 1  max |out − in| = 3.8e-4 (symmetric Hann ripple)
// WSOLA (this core) measures 0.00–0.01 dB, a single click peak (runner-up
// 0.000×), and 6e-8.

const SR = 44100;
function sine(n, freq = 440) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return a;
}
// Peak-to-trough of the per-cycle peak envelope, in dB, away from the edges.
function amDepthDb(out, freq = 440) {
  const lo = 8192;
  const hi = out.length - 8192;
  const span = Math.ceil(SR / freq) + 1;
  let mx = 0;
  let mn = Infinity;
  for (let s = lo; s + span < hi; s += Math.floor(span / 2)) {
    let p = 0;
    for (let i = s; i < s + span; i++) p = Math.max(p, Math.abs(out[i]));
    mx = Math.max(mx, p);
    mn = Math.min(mn, p);
  }
  return 20 * Math.log10(mx / mn);
}
// Frequency from upward zero crossings, away from the edges.
function zeroCrossingHz(out) {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 8192; i < out.length - 8192; i++) {
    if (out[i - 1] < 0 && out[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  return (count - 1) / ((last - first) / SR);
}

// First-difference RMS in dB — a high-frequency proxy (|1 − z⁻¹| rises
// 6 dB/oct), so HF smeared by misaligned grains shows up here first.
function diffRmsDb(a) {
  let e = 0;
  for (let i = 1; i < a.length; i++) e += (a[i] - a[i - 1]) ** 2;
  return 10 * Math.log10(e / (a.length - 1));
}
// Mean power in the 11.5–12.5 kHz band (Hann-windowed 2048-sample frames,
// Goertzel per bin) in dB — catches a 12 kHz partial smeared out of its bin
// as well as one lost outright.
function bandPowerDb(a, lo = 11500, hi = 12500, sr = SR) {
  const N = 2048;
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
  const k0 = Math.ceil((lo * N) / sr);
  const k1 = Math.floor((hi * N) / sr);
  let total = 0;
  let frames = 0;
  for (let s = 0; s + N <= a.length; s += N, frames++) {
    for (let k = k0; k <= k1; k++) {
      const c = 2 * Math.cos((2 * Math.PI * k) / N);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const v = a[s + i] * w[i] + c * s1 - s2;
        s2 = s1;
        s1 = v;
      }
      total += s1 * s1 + s2 * s2 - c * s1 * s2;
    }
  }
  return 10 * Math.log10(total / frames);
}

describe("timeStretch WSOLA quality — US71", () => {
  it("@us US71: 440 Hz sine keeps a flat envelope — AM depth ≤ 0.5 dB at rates 1.02 / 1.12 / 2.0", () => {
    // Measured: 0.01 / 0.00 / 0.00 dB (plain OLA: 10.9 / 16.3 / 13.6 dB).
    const src = sine(SR * 4);
    for (const rate of [1.02, 1.12, 2.0]) {
      const depth = amDepthDb(stretchChannel(src, rate), 440);
      expect(depth, `rate ${rate}`).toBeLessThan(0.5);
    }
  });

  it("@us US71: pitch is held within 1% while tempo changes (keylock)", () => {
    const src = sine(SR * 4);
    for (const rate of [0.8, 1.02, 1.12, 2.0]) {
      const hz = zeroCrossingHz(stretchChannel(src, rate));
      expect(Math.abs(hz / 440 - 1), `rate ${rate} → ${hz.toFixed(1)} Hz`).toBeLessThan(0.01);
    }
  });

  it("@us US71: a 120 BPM click train at rate 1.06 keeps ONE dominant peak per click (no transient doubling)", () => {
    const n = SR * 8;
    const clicks = new Float32Array(n);
    for (let t = 0; t < n; t += SR / 2) clicks[Math.round(t)] = 1;
    for (const rate of [1.06, 0.94]) {
      const out = stretchChannel(clicks, rate);
      const period = SR / 2 / rate;
      for (let k = 1; k < 14; k++) {
        const c = Math.round(k * period);
        const peaks = [];
        for (let i = c - 2000; i < c + 2000; i++) {
          const v = Math.abs(out[i]);
          if (v > 1e-4 && v >= Math.abs(out[i - 1]) && v > Math.abs(out[i + 1])) peaks.push(v);
        }
        peaks.sort((a, b) => b - a);
        expect(peaks.length, `click ${k} @ rate ${rate}`).toBeGreaterThan(0);
        // Measured worst runner-up: 0.000× at 1.06, 0.007× at 0.94
        // (plain OLA: 0.93× / 0.94×).
        expect((peaks[1] || 0) / peaks[0], `click ${k} @ rate ${rate}`).toBeLessThan(0.1);
      }
    }
  });

  it("@us US71: rate 1 / pitch 1 is bit-exact in the steady state (≤ 1e-6)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const src = new Float32Array(SR).map(() => rnd());
    const out = stretchChannel(src, 1, 1);
    expect(out.length).toBe(src.length);
    let worst = 0;
    // After the 3-hop fade-in, before the final grain's fade-out.
    for (let i = GRAIN_SIZE - HOP_OUT; i < src.length - GRAIN_SIZE; i++) {
      worst = Math.max(worst, Math.abs(out[i] - src[i]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("@us US71: high frequencies survive the alignment — white-noise spectral tilt within 0.2 dB of rate 1 and a 12 kHz partial within 0.5 dB at rates 0.92 / 1.04 / 1.1", () => {
    // Candidates searched on the NOMINAL grid sat at a different sub-sample
    // fraction than the grain they overlap whenever hopOut × rate is
    // non-integer, so HF never lined up. A grid error is a spectral TILT, not
    // a level change — WSOLA lowers the broadband level of uncorrelated noise
    // on its own (the old first-difference-vs-source bound was really that
    // floor) — so measure
    //   tilt = (diffRmsDb − rmsDb)(output) − (diffRmsDb − rmsDb)(rate-1 output)
    // Natural grid: |tilt| ≤ 0.017 dB; nominal-grid mutant −1.31 / −1.62 /
    // −1.37 dB at 0.92 / 1.04 / 1.1. The broadband floor is bounded
    // separately (0.75 dB; measured −0.18…−0.46 dB).
    let seed = 5;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
    const noise = new Float32Array(SR * 3).map(() => rnd());
    const partial = new Float32Array(SR * 3);
    for (let i = 0; i < partial.length; i++) {
      partial[i] = 0.3 * Math.sin((2 * Math.PI * 12000 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 150 * i) / SR);
    }
    const mid = (a) => a.subarray(GRAIN_SIZE * 2, a.length - GRAIN_SIZE * 2);
    const rmsDb = (a) => 10 * Math.log10(a.reduce((e, v) => e + v * v, 0) / a.length);
    const noise1 = mid(stretchChannel(noise, 1));
    const shape1 = diffRmsDb(noise1) - rmsDb(noise1);
    for (const rate of [0.92, 1.04, 1.1]) {
      const out = mid(stretchChannel(noise, rate));
      const tilt = diffRmsDb(out) - rmsDb(out) - shape1;
      const floor = rmsDb(out) - rmsDb(noise1);
      expect(Math.abs(tilt), `noise tilt @ ${rate}`).toBeLessThan(0.2);
      expect(Math.abs(floor), `noise broadband floor @ ${rate}`).toBeLessThan(0.75);
      const p = stretchChannel(partial, rate);
      expect(Math.abs(bandPowerDb(mid(p)) - bandPowerDb(mid(partial))), `12 kHz @ ${rate}`).toBeLessThan(0.5);
    }
  });

  it("@us US71: findBestLag keeps lag 0 for silence and finds a known shift", () => {
    const corr = GRAIN_SIZE - HOP_OUT;
    const search = 384;
    // Silence: every score ties → the nominal position wins.
    expect(findBestLag(new Float32Array(corr), new Float32Array(corr + 2 * search), corr, search)).toBe(0);
    // Noise: the continuation sits 37 samples after the nominal start.
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const region = new Float32Array(corr + 2 * search).map(() => rnd());
    const ref = region.slice(search + 37, search + 37 + corr);
    expect(findBestLag(ref, region, corr, search)).toBe(37);
    const refBack = region.slice(search - 201, search - 201 + corr);
    expect(findBestLag(refBack, region, corr, search)).toBe(-201);
  });
});

describe("timeStretch sub-bass keylock — US71", () => {
  // Review pass 7: the search radius is half the period of 40 Hz in TIME,
  // not a fixed 384 samples, so the bass cutoff no longer moves with the
  // sample rate (fixed 384: ~57 / ~62 / ~125 Hz at 44.1 / 48 / 96 kHz).
  // Hann-windowed single-bin amplitude over the steady state.
  const hannAmp = (y, f, sr) => {
    let re = 0;
    let im = 0;
    let ws = 0;
    for (let i = 0; i < y.length; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / y.length));
      const a = (2 * Math.PI * f * i) / sr;
      re += y[i] * w * Math.cos(a);
      im += y[i] * w * Math.sin(a);
      ws += w;
    }
    return (2 * Math.hypot(re, im)) / ws;
  };

  it("@us US71: searchRadius is half the period of 40 Hz in samples (multiple of 4), floored at the old 384", () => {
    expect(SEARCH).toBe(384);
    expect(searchRadius(44100)).toBe(552);
    expect(searchRadius(48000)).toBe(600);
    expect(searchRadius(96000)).toBe(1200);
    expect(searchRadius(22050)).toBe(384);
    expect(searchRadius()).toBe(552); // default 44.1 kHz
  });

  it("@us US71: 41 Hz @ 44.1 kHz, 49 Hz @ 48 kHz, 90 / 49 Hz @ 96 kHz hold f0 within 0.5 dB with < −20 dB at f0 × rate (rates 1.04 / 0.92)", () => {
    for (const [sr, f0] of [
      [44100, 41],
      [48000, 49],
      [96000, 90],
      [96000, 49], // below the 44.1 kHz radius's cutoff: a fixed 552 fails here
    ]) {
      const A = 0.6;
      const src = new Float32Array(sr * 3);
      for (let i = 0; i < src.length; i++) src[i] = A * Math.sin((2 * Math.PI * f0 * i) / sr);
      for (const rate of [1.04, 0.92]) {
        const tag = `${f0} Hz @ ${sr} Hz, rate ${rate}`;
        const out = stretchChannel(src, rate, 1, GRAIN_SIZE, sr);
        const y = out.subarray(Math.round(sr * 0.25), Math.round(sr * 2.25));
        expect(Math.abs(20 * Math.log10(hannAmp(y, f0, sr) / A)), `${tag}: level at f0`).toBeLessThan(0.5);
        expect(20 * Math.log10(hannAmp(y, f0 * rate, sr) / A), `${tag}: level at f0 × rate`).toBeLessThan(-20);
      }
    }
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
