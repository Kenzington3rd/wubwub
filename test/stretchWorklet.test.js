import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { stretchChannel, GRAIN_SIZE } from "../src/audio/timeStretch.js";

// W3.1 — the KEYLOCK stretch worklet (US73).
//
// `src/worklets/stretch-worklet.js` is a SECOND implementation of the
// WSOLA in `src/audio/timeStretch.js`: the offline core synthesizes a
// whole channel, the worklet streams it in 128-sample render quanta. Only the
// offline core was covered — the worklet's streaming path is what actually
// produces audio in KEYLOCK, and nothing executed it.
//
// It can't be imported directly (it extends AudioWorkletProcessor and calls
// registerProcessor, both of which only exist in an AudioWorkletGlobalScope),
// and unlike the looper worklet its logic isn't a small pure helper that can
// be exported. So we evaluate the real source against a shimmed global scope
// and drive the processor exactly as the audio thread would.

const SRC = readFileSync("src/worklets/stretch-worklet.js", "utf8");
const SAMPLE_RATE = 44100;
const QUANTUM = 128;

function loadProcessor({ currentTime = 0, sampleRate = SAMPLE_RATE } = {}) {
  let Registered = null;
  const posted = [];
  class AudioWorkletProcessorShim {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (m) => posted.push(m),
      };
    }
  }
  // `currentTime` is a live global in an AudioWorkletGlobalScope, so it is a
  // mutable binding here too: `clock.advance()` moves it like the audio
  // thread does (render() advances it one quantum per process() call).
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    "__t0",
    `let currentTime = __t0;\n${SRC}\nreturn { cls: __registered, clock: {
      advance: (dt) => { currentTime += dt; },
      get now() { return currentTime; },
    } };`
      .replace(
        'registerProcessor("stretch-processor", StretchProcessor);',
        'registerProcessor("stretch-processor", StretchProcessor); var __registered = StretchProcessor;'
      )
  );
  const { cls, clock } = factory(
    AudioWorkletProcessorShim,
    (name, c) => { Registered = c; },
    sampleRate,
    currentTime
  );
  Registered = cls;
  return { Processor: Registered, posted, clock, sampleRate };
}

// Drive `frames` samples through process() and return the concatenated output
// (first channel, or every channel with `params.channels`). With
// `params.clock` the worklet's currentTime advances one quantum per call.
function render(proc, frames, params = {}) {
  const rate = params.rate ?? 1;
  const pitchRatio = params.pitchRatio ?? 1;
  const nCh = params.channels ?? 1;
  const outs = Array.from({ length: nCh }, () => new Float32Array(frames));
  const quanta = Math.ceil(frames / QUANTUM);
  let w = 0;
  for (let q = 0; q < quanta; q++) {
    const chans = Array.from({ length: nCh }, () => new Float32Array(QUANTUM));
    proc.process([], [chans], {
      rate: new Float32Array([rate]),
      pitchRatio: new Float32Array([pitchRatio]),
    });
    params.clock?.advance(QUANTUM / (params.ctxRate ?? SAMPLE_RATE));
    for (let i = 0; i < QUANTUM && w < frames; i++, w++) {
      for (let c = 0; c < nCh; c++) outs[c][w] = chans[c][i];
    }
  }
  return nCh === 1 ? outs[0] : outs;
}

// A signal with real spectral content — a constant would hide OLA errors.
function tone(n, freq = 440, sr = SAMPLE_RATE) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return a;
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe("stretch worklet — streaming DSP — US73", () => {
  let Processor, posted, proc;

  beforeEach(() => {
    ({ Processor: Processor, posted } = loadProcessor());
    proc = new Processor();
  });

  it("@us US73: registers rate + pitchRatio AudioParams with sane ranges", () => {
    const d = Processor.parameterDescriptors;
    const rate = d.find((p) => p.name === "rate");
    const pitch = d.find((p) => p.name === "pitchRatio");
    expect(rate.defaultValue).toBe(1);
    expect(pitch.defaultValue).toBe(1);
    // Must cover the deck's 0.5–2.0 speed band.
    expect(rate.minValue).toBeLessThanOrEqual(0.5);
    expect(rate.maxValue).toBeGreaterThanOrEqual(2);
  });

  // ── negative: nothing loaded / not playing must be SILENT, not noise ──
  it("@us US73: emits silence before any track is loaded", () => {
    const out = render(proc, QUANTUM * 4);
    expect(rms(out)).toBe(0);
  });

  it("@us US73: emits silence after load but before play", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE)], sampleRate: SAMPLE_RATE } });
    const out = render(proc, QUANTUM * 4);
    expect(rms(out)).toBe(0);
  });

  it("@us US73: pause silences a playing stream", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE)], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    expect(rms(render(proc, QUANTUM * 8))).toBeGreaterThan(0.01);
    proc.port.onmessage({ data: { type: "pause" } });
    render(proc, QUANTUM * 2); // ~4 ms fade-out tail (see edge-fade suite)
    expect(rms(render(proc, QUANTUM * 8))).toBe(0);
  });

  it("@us US73: playing produces continuous non-silent audio (no dropouts)", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE)], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    // Skip the first grain — OLA fades in from zero by construction.
    render(proc, GRAIN_SIZE);
    const out = render(proc, GRAIN_SIZE * 2);
    expect(rms(out)).toBeGreaterThan(0.1);
    // No silent gap longer than a render quantum anywhere in the steady state.
    let run = 0, worst = 0;
    for (const v of out) {
      run = Math.abs(v) < 1e-6 ? run + 1 : 0;
      worst = Math.max(worst, run);
    }
    expect(worst).toBeLessThan(QUANTUM);
  });

  it("@us US73: rate advances the source read head proportionally", () => {
    const mk = (rate) => {
      const { Processor: P } = loadProcessor();
      const p = new P();
      p.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE * 4)], sampleRate: SAMPLE_RATE } });
      p.port.onmessage({ data: { type: "play", offset: 0 } });
      render(p, GRAIN_SIZE * 4, { rate });
      return p.sourcePos;
    };
    const slow = mk(1);
    const fast = mk(2);
    // Twice the rate consumes roughly twice the source for the same output.
    expect(fast / slow).toBeGreaterThan(1.8);
    expect(fast / slow).toBeLessThan(2.2);
  });

  it("@us US73: seek repositions the read head", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE * 4)], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    render(proc, QUANTUM * 4);
    proc.port.onmessage({ data: { type: "seek", offset: 2 } });
    expect(proc.sourcePos).toBeCloseTo(2 * SAMPLE_RATE, 0);
  });

  it("@us US73: streaming output tracks the offline reference in the steady state", () => {
    // The worklet and timeStretch.js are separate implementations of the same
    // algorithm; at rate 1 / pitch 1 they must agree on gross energy, or one
    // of them has an overlap-add bug.
    const src = tone(GRAIN_SIZE * 8);
    proc.port.onmessage({ data: { type: "load", channels: [src], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    render(proc, GRAIN_SIZE);                       // discard fade-in
    const streamed = render(proc, GRAIN_SIZE * 2);

    const offline = stretchChannel(src, 1, 1);
    const ref = offline.subarray(GRAIN_SIZE, GRAIN_SIZE * 3);

    // Unity OLA: both should sit near the source's own RMS (0.707 for a sine).
    expect(rms(streamed)).toBeGreaterThan(0.5);
    expect(rms(streamed)).toBeLessThan(0.9);
    expect(Math.abs(rms(streamed) - rms(ref))).toBeLessThan(0.15);
  });

  it("@us US73: reports position, then 'ended' once the source is consumed", () => {
    const short = tone(GRAIN_SIZE * 2);
    const { Processor: P, posted: msgs } = loadProcessor({ currentTime: 99 });
    const p = new P();
    p.port.onmessage({ data: { type: "load", channels: [short], sampleRate: SAMPLE_RATE } });
    p.port.onmessage({ data: { type: "play", offset: 0 } });
    render(p, GRAIN_SIZE * 4);
    expect(msgs.some((m) => m.type === "position")).toBe(true);
    expect(msgs.some((m) => m.type === "ended")).toBe(true);
    // After 'ended' the processor must stop emitting, not loop or spew noise.
    expect(rms(render(p, QUANTUM * 4))).toBe(0);
  });

  // ── negative: hostile / degenerate inputs must not throw ──
  it("@us US73: an empty channel list is silent rather than a crash", () => {
    proc.port.onmessage({ data: { type: "load", channels: [], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    expect(() => render(proc, QUANTUM * 2)).not.toThrow();
    expect(rms(render(proc, QUANTUM * 2))).toBe(0);
  });

  it("@us US73: seeking past the end ends cleanly instead of reading garbage", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(GRAIN_SIZE)], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    proc.port.onmessage({ data: { type: "seek", offset: 9999 } });
    const out = render(proc, QUANTUM * 4);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(rms(out)).toBe(0);
  });

  it("@us US73: process() keeps returning true so the node is never GC'd mid-stream", () => {
    proc.port.onmessage({ data: { type: "load", channels: [tone(SAMPLE_RATE)], sampleRate: SAMPLE_RATE } });
    proc.port.onmessage({ data: { type: "play", offset: 0 } });
    const chan = new Float32Array(QUANTUM);
    const params = { rate: new Float32Array([1]), pitchRatio: new Float32Array([1]) };
    for (let i = 0; i < 10; i++) {
      expect(proc.process([], [[chan]], params)).toBe(true);
    }
  });
});

// ── WSOLA streaming, in-worklet looping, audible-position reports ──

const HOP = GRAIN_SIZE / 4;
const send = (p, data) => p.port.onmessage({ data });
const ofType = (msgs, type) => msgs.filter((m) => m.type === type);
function zeroCrossingHz(out, sr = SAMPLE_RATE) {
  let first = -1, last = -1, count = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1] < 0 && out[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  return (count - 1) / ((last - first) / sr);
}
function amDepthDb(out, freq = 440) {
  const span = Math.ceil(SAMPLE_RATE / freq) + 1;
  let mx = 0, mn = Infinity;
  for (let s = 0; s + span < out.length; s += Math.floor(span / 2)) {
    let p = 0;
    for (let i = s; i < s + span; i++) p = Math.max(p, Math.abs(out[i]));
    mx = Math.max(mx, p);
    mn = Math.min(mn, p);
  }
  return 20 * Math.log10(mx / mn);
}

describe("stretch worklet — WSOLA streaming — US73", () => {
  it("@us US73: rate 1 / pitch 1 streams the source bit-exactly after the 3-hop fade-in", () => {
    const { Processor: P } = loadProcessor();
    const p = new P();
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const src = new Float32Array(SAMPLE_RATE).map(() => rnd());
    send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0.25 });
    const out = render(p, SAMPLE_RATE / 2);
    const off = SAMPLE_RATE / 4;
    let worst = 0;
    for (let i = GRAIN_SIZE - HOP; i < out.length; i++) {
      worst = Math.max(worst, Math.abs(out[i] - src[off + i]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("@us US73: the streamed grains are aligned too — flat 440 Hz envelope and held pitch at rate 1.12", () => {
    // Same measurement as timeStretch.test.js; streaming measures 0.00 dB.
    const { Processor: P } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE * 4)], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0 });
    render(p, GRAIN_SIZE * 2, { rate: 1.12 }); // past the fade-in
    const out = render(p, SAMPLE_RATE, { rate: 1.12 });
    expect(amDepthDb(out)).toBeLessThan(0.5);
    expect(Math.abs(zeroCrossingHz(out) / 440 - 1)).toBeLessThan(0.01);
  });
});

describe("stretch worklet — position report is the audible playhead — US73", () => {
  it("@us US73: at rate 1 the report matches the source index of the sample leaving the node", () => {
    // A ramp whose value IS its index: at rate 1 the output is the source,
    // so the last emitted sample tells us exactly where the playhead is.
    const len = SAMPLE_RATE * 2;
    const ramp = new Float32Array(len);
    for (let i = 0; i < len; i++) ramp[i] = i / len;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [ramp], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0.5 });
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const before = posted.length;
      const out = render(p, QUANTUM, { clock });
      const rep = posted.slice(before).find((m) => m.type === "position");
      if (!rep || k < 4) continue; // reports every ~100 ms; skip the fade-in
      const lastEmitted = out[QUANTUM - 1] * len; // source frame just played
      // Within one render quantum of the audible sample — the pre-fix report
      // (write head) ran a full hop ahead.
      expect(Math.abs(rep.seconds * SAMPLE_RATE - lastEmitted)).toBeLessThan(QUANTUM);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it("@us US73: at rates ≠ 1 the report matches a ramp-marker channel within half a sample (overlap-add group delay included) — same-rate and foreign-rate buffers", () => {
    // Replaces "report = offset + emitted × rate": that write-head estimate
    // ignores the overlap-add group delay ≈ (GRAIN/2)·(pitch − rate) and the
    // mean WSOLA nudge — measured +705 / −448 / −705 / −1209 samples off at
    // rates 0.5 / 1.25 / 1.5 / 2.0, which also fired 'ended' ~27 ms early at
    // 2.0. Channel 1 is a tiny ramp whose value is its own index, so the
    // output's channel 1 IS the audible source position, whatever the
    // grains did; channel 0 carries music-like material that drives the
    // (channel-summed) alignment.
    //
    // Foreign-rate buffers (48 kHz track in a 44.1 kHz context and the
    // reverse) run with pitch = sourceRate / contextRate ≠ 1 even with the
    // deck's pitchRatio pinned at 1, so each grain's read offset is d × pitch
    // source frames. Dropping that factor in audibleStream() reports 84–91
    // frames off — less than a render quantum, which is why the bound here is
    // half a sample (measured ≤ 0.02 frames at every rate and source rate).
    const K = 1e-7;
    for (const [srcRate, ctxRate] of [[SAMPLE_RATE, SAMPLE_RATE], [48000, 44100], [44100, 48000]]) {
      const len = srcRate * 10;
      let seed = 1;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
      const music = new Float32Array(len);
      const marker = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        music[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / srcRate) + 0.3 * Math.sin((2 * Math.PI * 331 * i) / srcRate) + 0.05 * rnd();
        marker[i] = K * i;
      }
      for (const rate of [0.5, 1.25, 1.5, 2.0]) {
        const tag = `${srcRate} in ${ctxRate} @ rate ${rate}`;
        const { Processor: P, posted, clock } = loadProcessor({ sampleRate: ctxRate });
        const p = new P();
        send(p, { type: "load", channels: [music, marker], sampleRate: srcRate });
        send(p, { type: "play", offset: 2 });
        let rep = null;
        let checked = 0;
        let worst = 0;
        for (let k = 0; k < 600; k++) {
          const before = posted.length;
          const [, m] = render(p, QUANTUM, { rate, clock, channels: 2, ctxRate });
          // A report describes the sample about to leave: this quantum's first.
          if (rep && k > 8) {
            worst = Math.max(worst, Math.abs(rep.seconds * srcRate - m[0] / K));
            checked++;
          }
          rep = posted.slice(before).find((x) => x.type === "position") || null;
        }
        expect(checked, tag).toBeGreaterThan(10);
        expect(worst, tag).toBeLessThan(0.5);
      }
    }
  });

  // Review pass 3: `at` must be the context time at which the REPORTED sample
  // is heard. `seconds` is measured after the quantum is rendered (the next
  // sample out — this quantum's end), so stamping the quantum START put every
  // anchor one render quantum early: 128 × rate source frames (× the
  // source/context rate ratio for foreign-rate buffers).
  //
  // Each output sample i is heard at t0 + i / ctxRate; channel 1 is a ramp
  // marker whose value is its own source index. So "report − marker heard at
  // `at`" is the anchor error in source frames.
  const T0 = 5;
  const anchorErrors = ({ srcRate, ctxRate, rate, loopRegion = null, quanta = 600 }) => {
    const K = 1e-7;
    const len = srcRate * 10;
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
    const music = new Float32Array(len);
    const marker = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      music[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / srcRate) + 0.3 * Math.sin((2 * Math.PI * 331 * i) / srcRate) + 0.05 * rnd();
      marker[i] = K * i;
    }
    const { Processor: P, posted, clock } = loadProcessor({ sampleRate: ctxRate, currentTime: T0 });
    const p = new P();
    send(p, { type: "load", channels: [music, marker], sampleRate: srcRate });
    if (loopRegion) send(p, { type: "setLoop", enabled: true, ...loopRegion });
    send(p, { type: "play", offset: loopRegion ? loopRegion.start : 2 });
    const heard = new Float64Array(quanta * QUANTUM);
    for (let k = 0; k < quanta; k++) {
      const [, m] = render(p, QUANTUM, { rate, clock, channels: 2, ctxRate });
      for (let i = 0; i < QUANTUM; i++) heard[k * QUANTUM + i] = m[i] / K;
    }
    const markerAt = (at) => heard[Math.round((at - T0) * ctxRate)];
    return { posted, markerAt, heard };
  };

  it("@us US73: `at` is the context time the reported sample is heard — report − marker heard at `at` is 0 ± 0.05 frames at rates 0.5 / 1 / 2, same-rate and foreign-rate", () => {
    for (const [srcRate, ctxRate] of [[SAMPLE_RATE, SAMPLE_RATE], [48000, 44100]]) {
      for (const rate of [0.5, 1, 2]) {
        const tag = `${srcRate} in ${ctxRate} @ rate ${rate}`;
        const { posted, markerAt } = anchorErrors({ srcRate, ctxRate, rate });
        let worst = 0;
        let checked = 0;
        for (const m of ofType(posted, "position")) {
          if ((m.at - T0) * ctxRate < GRAIN_SIZE * 2) continue; // past the fade-in
          const idx = (m.at - T0) * ctxRate;
          expect(Math.abs(idx - Math.round(idx)), tag).toBeLessThan(1e-6); // on a sample boundary
          worst = Math.max(worst, Math.abs(m.seconds * srcRate - markerAt(m.at)));
          checked++;
        }
        expect(checked, tag).toBeGreaterThan(10);
        expect(worst, tag).toBeLessThan(0.05);
      }
    }
  });

  it("@us US73: `looped` posts the exact audible position at `at` (not the region start) — extrapolates onto the marker after the seam", () => {
    // Around the seam the marker channel is a mix of pre- and post-seam reads,
    // so the check runs from the looped anchor forward: seconds + (t − at) ×
    // rate must land on the marker heard at t, once the seam has cleared the
    // overlap-add (≥ 2 grains later, before the next wrap).
    for (const [srcRate, ctxRate] of [[SAMPLE_RATE, SAMPLE_RATE], [48000, 44100]]) {
      const tag = `${srcRate} in ${ctxRate}`;
      const region = { start: 1, end: 1.25 };
      const { posted, markerAt } = anchorErrors({ srcRate, ctxRate, rate: 1, loopRegion: region, quanta: 900 });
      const looped = ofType(posted, "looped");
      expect(looped.length, tag).toBeGreaterThan(2);
      for (const m of looped) {
        expect(m.regionStart, tag).toBeCloseTo(region.start, 9);
        expect(m.seconds, tag).toBeGreaterThanOrEqual(region.start);
        const t = m.at + (GRAIN_SIZE * 2) / ctxRate;
        if ((t - T0) * ctxRate >= 900 * QUANTUM) continue;
        const predicted = (m.seconds + (t - m.at)) * srcRate;
        expect(Math.abs(predicted - markerAt(t)), tag).toBeLessThan(0.05);
      }
    }
  });
});

describe("stretch worklet — in-worklet looping — US73", () => {
  it("@us US73: setLoop whole-track wraps seamlessly, posts 'looped' at 0 once per wrap and never 'ended'", () => {
    // 0.5 s of 440 Hz = exactly 220 cycles, so a seamless wrap reproduces a
    // continuous sine; the old ended → play(0) round trip left a gap.
    const len = SAMPLE_RATE / 2;
    const src = tone(len);
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true });
    send(p, { type: "play", offset: 0 });
    const out = render(p, len * 4 + 1000);
    expect(ofType(posted, "ended")).toHaveLength(0);
    const looped = ofType(posted, "looped");
    expect(looped).toHaveLength(4);
    expect(looped.every((m) => m.regionStart === 0)).toBe(true);
    // `seconds` is the audible position at `at`: just past the seam, at most
    // one quantum into the new lap.
    expect(looped.every((m) => m.seconds >= 0 && m.seconds <= QUANTUM / SAMPLE_RATE)).toBe(true);
    expect(p.playing).toBe(true);
    // Across every seam, output is the continuous sine (rate 1 is exact).
    let worst = 0;
    for (let i = GRAIN_SIZE; i < out.length; i++) {
      worst = Math.max(worst, Math.abs(out[i] - src[i % len]));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("@us US73: 'looped' fires when the AUDIBLE position wraps, not when the write head does", () => {
    const len = SAMPLE_RATE / 2;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true });
    send(p, { type: "play", offset: 0 });
    let emitted = 0;
    while (ofType(posted, "looped").length === 0 && emitted < len * 2) {
      render(p, QUANTUM);
      emitted += QUANTUM;
    }
    // The wrap is announced in the quantum that plays source frame `len`.
    expect(emitted).toBeGreaterThan(len);
    expect(emitted - len).toBeLessThanOrEqual(QUANTUM);
  });

  it("@us US73: a region loop wraps inside [start, end) and reports the region start (and the audible position just past it)", () => {
    const len = SAMPLE_RATE * 2;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 1.0 });
    send(p, { type: "play", offset: 0.4 }); // before the region: allowed
    render(p, SAMPLE_RATE * 2, { rate: 1.25, clock });
    const looped = ofType(posted, "looped");
    // 0.4 → 1.0, then 0.5 s laps, over 2.5 s of track time.
    expect(looped.length).toBeGreaterThanOrEqual(3);
    expect(looped.every((m) => m.regionStart === 0.5)).toBe(true);
    expect(looped.every((m) => m.seconds >= 0.5 && m.seconds <= 0.5 + (QUANTUM * 1.25) / SAMPLE_RATE)).toBe(true);
    expect(ofType(posted, "ended")).toHaveLength(0);
    const positions = ofType(posted, "position").map((m) => m.seconds);
    expect(positions.length).toBeGreaterThan(5);
    expect(positions.every((s) => s >= 0.4 && s < 1.0)).toBe(true);
    // Once inside, the write head never leaves the region.
    expect(p.sourcePos).toBeGreaterThanOrEqual(0.5 * SAMPLE_RATE);
    expect(p.sourcePos).toBeLessThan(1.0 * SAMPLE_RATE);
  });

  it("@us US73: seek past an enabled region's end wraps to its start", () => {
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE * 2)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 1.0 });
    send(p, { type: "play", offset: 0 });
    render(p, QUANTUM * 2);
    send(p, { type: "seek", offset: 1.5 });
    render(p, QUANTUM * 2);
    const looped = ofType(posted, "looped");
    expect(looped.map((m) => m.regionStart)).toEqual([0.5]);
    expect(looped[0].seconds).toBeGreaterThanOrEqual(0.5);
    expect(looped[0].seconds).toBeLessThanOrEqual(0.5 + QUANTUM / SAMPLE_RATE);
    expect(p.sourcePos / SAMPLE_RATE).toBeGreaterThanOrEqual(0.5);
    expect(p.sourcePos / SAMPLE_RATE).toBeLessThan(1.0);
  });

  it("@us US73: 'ended' waits for the AUDIBLE end, and only when no loop is enabled", () => {
    const len = SAMPLE_RATE;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    // 300 frames from the end: the first synthesized hop (512) already puts
    // the write head past the end — the old worklet posted 'ended' here and
    // threw that audio away.
    send(p, { type: "play", offset: (len - 300) / SAMPLE_RATE });
    render(p, QUANTUM * 2); // 256 frames: audible material still left
    expect(ofType(posted, "ended")).toHaveLength(0);
    render(p, QUANTUM); // 384 ≥ 300 → audible end reached
    expect(ofType(posted, "ended")).toHaveLength(1);
    expect(p.playing).toBe(false);

    // Loop on → the same approach to the end wraps instead of ending…
    posted.length = 0;
    send(p, { type: "setLoop", enabled: true });
    send(p, { type: "play", offset: (len - 300) / SAMPLE_RATE });
    render(p, QUANTUM * 8);
    expect(ofType(posted, "ended")).toHaveLength(0);
    expect(ofType(posted, "looped")).toHaveLength(1);
    // …and loop off again restores the run-to-end behaviour.
    send(p, { type: "setLoop", enabled: false });
    render(p, len + QUANTUM * 4);
    expect(ofType(posted, "ended")).toHaveLength(1);
    expect(p.playing).toBe(false);
  });

  it("@us US73: load with loop:true loops the whole track; a later load without it clears the loop", () => {
    const len = SAMPLE_RATE / 4;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE, loop: true });
    expect(p.playing).toBe(false);
    expect(p.sourcePos).toBe(0);
    send(p, { type: "play", offset: 0 });
    render(p, len * 3 + 1000);
    expect(ofType(posted, "looped")).toHaveLength(3);
    expect(ofType(posted, "ended")).toHaveLength(0);

    posted.length = 0;
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    expect(p.playing).toBe(false);
    send(p, { type: "play", offset: 0 });
    render(p, len * 2);
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(ofType(posted, "ended")).toHaveLength(1);
  });

  // ── negative: degenerate regions are ignored, previous state stands ──
  it("@us US73: a region shorter than one hop, with end ≤ start, or outside the track is ignored", () => {
    const len = SAMPLE_RATE / 2;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.1, end: 0.1 + (HOP - 1) / SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.3, end: 0.2 });
    send(p, { type: "setLoop", enabled: true, start: 5, end: 9 }); // clamps to nothing
    expect(p.loop).toBe(null);
    send(p, { type: "play", offset: 0 });
    render(p, len + QUANTUM * 4);
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(ofType(posted, "ended")).toHaveLength(1);

    // A valid whole-track loop survives a later degenerate request.
    posted.length = 0;
    send(p, { type: "setLoop", enabled: true });
    send(p, { type: "setLoop", enabled: true, start: 0.2, end: 0.2 });
    send(p, { type: "play", offset: 0 });
    render(p, len + QUANTUM * 8);
    expect(ofType(posted, "looped")).toHaveLength(1);
    expect(ofType(posted, "ended")).toHaveLength(0);
  });

  it("@us US73: a loop wrap keeps every channel continuous (stereo)", () => {
    const len = SAMPLE_RATE / 2;
    const L = tone(len, 440);
    const R = tone(len, 220);
    const { Processor: P } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [L, R], sampleRate: SAMPLE_RATE, loop: true });
    send(p, { type: "play", offset: 0 });
    const [oL, oR] = render(p, len * 2, { channels: 2 });
    let worst = 0;
    for (let i = GRAIN_SIZE; i < oL.length; i++) {
      worst = Math.max(worst, Math.abs(oL[i] - L[i % len]), Math.abs(oR[i] - R[i % len]));
    }
    expect(worst).toBeLessThan(1e-5);
  });
});

describe("stretch worklet — sample-rate guard — US73", () => {
  it("@us US73: a buffer at half the context rate plays at its own pitch and tempo", () => {
    const srcRate = 22050;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(srcRate * 3, 440, srcRate)], sampleRate: srcRate });
    send(p, { type: "play", offset: 0 });
    render(p, GRAIN_SIZE * 2, { clock });
    const out = render(p, SAMPLE_RATE, { clock });
    // Without the guard: one source frame per output frame → 880 Hz at 2×
    // tempo.
    expect(Math.abs(zeroCrossingHz(out) / 440 - 1)).toBeLessThan(0.01);
    const last = ofType(posted, "position").pop();
    const elapsed = (GRAIN_SIZE * 2 + SAMPLE_RATE) / SAMPLE_RATE;
    expect(Math.abs(last.seconds - elapsed)).toBeLessThan(0.11); // ≤ one report period
  });

  it("@us US73: same-rate buffers are untouched by the guard (factor exactly 1)", () => {
    const { Processor: P } = loadProcessor({ sampleRate: 48000 });
    const p = new P();
    const src = tone(48000, 440, 48000);
    send(p, { type: "load", channels: [src], sampleRate: 48000 });
    send(p, { type: "play", offset: 0 });
    const out = render(p, 24000, { ctxRate: 48000 });
    let worst = 0;
    for (let i = GRAIN_SIZE - HOP; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - src[i]));
    expect(worst).toBeLessThan(1e-6);
  });
});

// ── edge fades: no click on pause / seek / play-over-fade ──
describe("stretch worklet — edge fades — US73", () => {
  const FADE = Math.round(SAMPLE_RATE * 0.004); // 176
  const F0 = 440;
  // A 440 Hz unit sine moves at most 2π·f/sr per sample; the fade/crossfade
  // adds at most (|a|+|b|)/FADE on top. Anything above this is a click.
  const NATURAL = (2 * Math.PI * F0) / SAMPLE_RATE; // ≈ 0.0627
  const LIMIT = NATURAL + 2 / FADE + 0.01; // ≈ 0.085
  const maxStep = (a, from = 1, to = a.length) => {
    let m = 0;
    for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
    return m;
  };
  const cat = (...parts) => {
    const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let w = 0;
    for (const p of parts) { o.set(p, w); w += p.length; }
    return o;
  };
  const src = tone(SAMPLE_RATE * 3, F0);
  // Exact value of the source sine at a fractional frame (offsets land
  // between samples; comparing to src[round()] would be a half-sample error).
  const sine = (frame) => Math.sin((2 * Math.PI * F0 * frame) / SAMPLE_RATE);
  let proc;
  beforeEach(() => {
    const { Processor } = loadProcessor();
    proc = new Processor();
    send(proc, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
  });

  // Quantum boundary q (in [24, 80)) where the un-paused stream is near a
  // peak, so a hard cut there would jump by ~1.
  function peakQuantum() {
    const { Processor } = loadProcessor();
    const p = new Processor();
    send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0 });
    const ref = render(p, QUANTUM * 80);
    for (let q = 24; q < 80; q++) if (Math.abs(ref[q * QUANTUM]) > 0.9) return { q, ref };
    throw new Error("no peak found");
  }

  it("@us US73: pause mid-cycle fades to zero within 5 ms with no click", () => {
    const { q, ref } = peakQuantum();
    const hardCut = Math.abs(ref[q * QUANTUM]); // what the old zero-fill did
    expect(hardCut).toBeGreaterThan(LIMIT * 8);
    send(proc, { type: "play", offset: 0 });
    const pre = render(proc, q * QUANTUM);
    send(proc, { type: "pause" });
    const post = render(proc, QUANTUM * 8);
    expect(maxStep(cat(pre, post), q * QUANTUM - 1)).toBeLessThan(LIMIT);
    // Still sounding right after pause (a tail, not an instant stop)…
    expect(rms(post.subarray(0, 64))).toBeGreaterThan(0.1);
    // …envelope strictly decays and is exactly zero within 5 ms.
    expect(post.subarray(Math.ceil(0.005 * SAMPLE_RATE)).every((v) => v === 0)).toBe(true);
    expect(rms(post.subarray(FADE - 32, FADE))).toBeLessThan(0.15);
    expect(rms(post.subarray(FADE - 8, FADE))).toBeLessThan(0.03);
    // Tail is the live stream scaled by the ramp (continues from the grain).
    for (let k = 0; k < FADE; k += 11) {
      expect(Math.abs(post[k] - ref[q * QUANTUM + k] * ((FADE - k) / FADE))).toBeLessThan(1e-4);
    }
  });

  it("@us US73: pause reads playing=false at once while audio tails", () => {
    send(proc, { type: "play", offset: 0 });
    render(proc, QUANTUM * 10);
    send(proc, { type: "pause" });
    expect(proc.playing).toBe(false);
    expect(rms(render(proc, QUANTUM))).toBeGreaterThan(0.01);
    render(proc, QUANTUM * 2);
    expect(rms(render(proc, QUANTUM * 4))).toBe(0);
  });

  it("@us US73: pause before any audio left the node stays silent", () => {
    send(proc, { type: "play", offset: 0 });
    send(proc, { type: "pause" });
    expect(rms(render(proc, QUANTUM * 4))).toBe(0);
  });

  it("@us US73: seek while playing crossfades — no click, new position within 5 ms", () => {
    send(proc, { type: "play", offset: 0 });
    const pre = render(proc, QUANTUM * 40);
    // Half a period off → worst-case phase discontinuity at the seam.
    const seekTo = 1 + 0.5 / F0;
    send(proc, { type: "seek", offset: seekTo });
    const post = render(proc, QUANTUM * 20);
    expect(maxStep(cat(pre, post), pre.length - 1)).toBeLessThan(LIMIT);
    // Old position gone and new position exact once the 4 ms crossfade ends.
    const base = seekTo * SAMPLE_RATE;
    for (let k = FADE; k < 1500; k += 7) expect(Math.abs(post[k] - sine(base + k))).toBeLessThan(1e-3);
    // Audible (≥ half scale) inside 5 ms, not after a multi-hop fade-in.
    expect(rms(post.subarray(FADE, Math.ceil(0.005 * SAMPLE_RATE)))).toBeGreaterThan(0.5);
  });

  it("@us US73: seek while paused or silent is inert until play, then starts exactly", () => {
    send(proc, { type: "seek", offset: 1 });
    expect(rms(render(proc, QUANTUM * 4))).toBe(0);
    send(proc, { type: "play", offset: 1 });
    const out = render(proc, QUANTUM * 20);
    const base = SAMPLE_RATE;
    for (let k = FADE; k < 1500; k += 7) expect(Math.abs(out[k] - src[base + k])).toBeLessThan(1e-3);
  });

  it("@us US73: play during the pause fade-out crossfades — no click", () => {
    send(proc, { type: "play", offset: 0 });
    const pre = render(proc, QUANTUM * 41);
    send(proc, { type: "pause" });
    const mid = render(proc, QUANTUM); // 128 of the 176 fade samples
    const off = 2 + 0.5 / F0;
    send(proc, { type: "play", offset: off });
    const post = render(proc, QUANTUM * 20);
    expect(maxStep(cat(pre, mid, post), pre.length - 1)).toBeLessThan(LIMIT);
    const base = off * SAMPLE_RATE;
    for (let k = FADE; k < 1500; k += 7) expect(Math.abs(post[k] - sine(base + k))).toBeLessThan(1e-3);
  });

  it("@us US73: a play after pause begins at the requested offset", () => {
    send(proc, { type: "play", offset: 0 });
    render(proc, QUANTUM * 30);
    send(proc, { type: "pause" });
    render(proc, QUANTUM * 10);
    send(proc, { type: "play", offset: 1.25 });
    const out = render(proc, QUANTUM * 20);
    const base = 1.25 * SAMPLE_RATE;
    for (let k = FADE; k < 1500; k += 7) expect(Math.abs(out[k] - sine(base + k))).toBeLessThan(1e-3);
  });

  it("@us US73: re-pressing play over a sounding stream crossfades too", () => {
    send(proc, { type: "play", offset: 0 });
    const pre = render(proc, QUANTUM * 40);
    send(proc, { type: "play", offset: 1 + 0.5 / F0 });
    const post = render(proc, QUANTUM * 10);
    expect(maxStep(cat(pre, post), pre.length - 1)).toBeLessThan(LIMIT);
  });

  it("@us US73: back-to-back seeks stay click-free", () => {
    send(proc, { type: "play", offset: 0 });
    let all = render(proc, QUANTUM * 30);
    for (const o of [0.5 / F0 + 1, 2.3, 0.7]) {
      send(proc, { type: "seek", offset: o });
      all = cat(all, render(proc, QUANTUM)); // lands mid-crossfade
    }
    expect(maxStep(all, QUANTUM * 30 - 1)).toBeLessThan(LIMIT * 1.6);
  });

  it("@us US73: a loop region that moves the read position crossfades; looped still fires", () => {
    const { Processor, posted } = loadProcessor();
    const p = new Processor();
    send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 2 });
    const pre = render(p, QUANTUM * 40);
    // Region entirely behind the playhead.
    send(p, { type: "setLoop", enabled: true, start: 0.5 + 0.5 / F0, end: 0.7 });
    const post = render(p, QUANTUM * 20);
    expect(maxStep(cat(pre, post), pre.length - 1)).toBeLessThan(LIMIT);
    expect(ofType(posted, "looped").length).toBeGreaterThan(0);
    // …and the jumped-to material is sounding at full level once it ends.
    expect(rms(post.subarray(FADE, FADE + 1024))).toBeGreaterThan(0.6);
  });

  it("@us US73: a loop region that does not move the read position is left alone", () => {
    send(proc, { type: "play", offset: 0.5 });
    const pre = render(proc, QUANTUM * 20);
    send(proc, { type: "setLoop", enabled: true, start: 0.2, end: 2.5 });
    expect(proc.tail).toBeNull();
    const post = render(proc, QUANTUM * 10);
    expect(maxStep(cat(pre, post), pre.length - 1)).toBeLessThan(LIMIT);
  });
});

// ── review pass 1: HF alignment grid, end-of-track fade, eject fade, loop
//    bookkeeping, audio-thread allocation ──
describe("stretch worklet — review pass 1 fixes — US73", () => {
  const FADE = Math.round(SAMPLE_RATE * 0.004);
  const F0 = 440;
  const NATURAL = (2 * Math.PI * F0) / SAMPLE_RATE;
  const LIMIT = NATURAL + 2 / FADE + 0.01; // same click threshold as the edge-fade suite
  const maxStep = (a, from = 1, to = a.length) => {
    let m = 0;
    for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
    return m;
  };
  const diffRmsDb = (a) => {
    let e = 0;
    for (let i = 1; i < a.length; i++) e += (a[i] - a[i - 1]) ** 2;
    return 10 * Math.log10(e / (a.length - 1));
  };
  // Mean 11.5–12.5 kHz band power (Hann frames + per-bin Goertzel), dB.
  const bandPowerDb = (a, lo = 11500, hi = 12500, sr = SAMPLE_RATE) => {
    const N = 2048;
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
          const v = a[s + i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / N)) + c * s1 - s2;
          s2 = s1;
          s1 = v;
        }
        total += s1 * s1 + s2 * s2 - c * s1 * s2;
      }
    }
    return 10 * Math.log10(total / frames);
  };

  it("@us US73: alignment searches the natural continuation's sub-sample grid — white-noise spectral tilt within 0.2 dB of rate 1 and a 12 kHz partial within 0.5 dB at rates 0.92 / 1.04 / 1.1", () => {
    // Metric (review pass 3): the old bound compared the noise's first-
    // difference level against the source's — but WSOLA lowers the BROADBAND
    // level of uncorrelated noise by itself (partially-correlated grains
    // overlap-add below unity power), so that "HF" bound was really the
    // broadband floor and had ~0.17 dB of margin at rate 1.1. A grid error
    // is a spectral TILT (HF lost relative to LF), so measure
    //   tilt = (diffRmsDb − rmsDb)(output) − (diffRmsDb − rmsDb)(rate-1 output)
    // which cancels the broadband level. Natural grid: |tilt| ≤ 0.011 dB.
    // Nominal-grid mutant (candidates on the nominal sub-sample grid):
    // −1.29 / −1.62 / −1.43 dB at 0.92 / 1.04 / 1.1. The broadband floor is
    // bounded separately (0.75 dB; measured −0.26…−0.31 dB). Real white
    // noise: a full-period LCG — the old `seed * 1103515245` fixture overflowed 2^53 and
    // repeated every 419 samples, which WSOLA aligns perfectly.
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
    const noise = new Float32Array(SAMPLE_RATE * 4).map(() => 0.5 * rnd());
    const partial = tone(SAMPLE_RATE * 4, 12000).map((v, i) => 0.3 * v + 0.3 * Math.sin((2 * Math.PI * 150 * i) / SAMPLE_RATE));
    const run = (src, rate) => {
      const { Processor: P } = loadProcessor();
      const p = new P();
      send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
      send(p, { type: "play", offset: 0.5 });
      render(p, GRAIN_SIZE * 2, { rate }); // past the fade-in
      return render(p, SAMPLE_RATE * 1.5, { rate });
    };
    const ref = (src) => src.subarray(SAMPLE_RATE, SAMPLE_RATE * 2.5);
    const rmsDb = (a) => 10 * Math.log10(a.reduce((e, v) => e + v * v, 0) / a.length);
    const noise1 = run(noise, 1);
    const shape1 = diffRmsDb(noise1) - rmsDb(noise1);
    for (const rate of [0.92, 1.04, 1.1]) {
      const out = run(noise, rate);
      const tilt = diffRmsDb(out) - rmsDb(out) - shape1;
      const floor = rmsDb(out) - rmsDb(noise1);
      expect(Math.abs(tilt), `noise tilt @ ${rate}`).toBeLessThan(0.2);
      expect(Math.abs(floor), `noise broadband floor @ ${rate}`).toBeLessThan(0.75);
      expect(Math.abs(bandPowerDb(run(partial, rate)) - bandPowerDb(ref(partial))), `12 kHz @ ${rate}`).toBeLessThan(0.5);
    }
    // Extreme rates sit on the WSOLA floor: real noise is 1–3 dB down
    // (−1.9 at 0.5, −1.0 at 0.75, −1.7 at 1.5, −2.8 at 2.0). Rate 2 varies
    // with the noise seed — review pass 4 measured ≈ −2.9…−3.5 dB across
    // seeds (a 48-seed sweep reaches −3.51) — so the bound is 4 dB (~0.5 dB margin). Guard
    // against regressions past that floor; do not read this as "clean".
    for (const rate of [0.5, 0.75, 1.5, 2.0]) {
      expect(Math.abs(diffRmsDb(run(noise, rate)) - diffRmsDb(ref(noise))), `noise HF @ ${rate}`).toBeLessThan(4);
    }
  });

  it("@us US73: foreign-rate buffers (pitch ≠ 1) align on the natural grid too — noise HF within 0.5 dB, a 12 kHz partial within 0.1 dB", () => {
    // pitch = pitchRatio × sourceRate / contextRate, so a 48 kHz track in a
    // 44.1 kHz context (and the reverse) takes the non-unit-pitch branch of
    // the candidate grid in production. Reference: the same buffer at rate 1,
    // where rate == pitch, the search is skipped and the output is the plain
    // linear-interp resample — so the resampler's own HF roll-off cancels.
    // Measured: noise −0.2…−0.4 dB, 12 kHz 0.00 dB. Mutants: integer grid
    // (the pitch === 1 branch for every pitch) −0.8…−1.1 dB noise / −0.2…−0.4
    // dB at 12 kHz; nominal grid up to −2.6 dB noise / −1.3 dB at 12 kHz.
    for (const [srcRate, ctxRate] of [[48000, 44100], [44100, 48000]]) {
      let seed = 9;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
      const noise = new Float32Array(srcRate * 4).map(() => 0.5 * rnd());
      const partial = tone(srcRate * 4, 12000, srcRate).map((v, i) => 0.3 * v + 0.3 * Math.sin((2 * Math.PI * 150 * i) / srcRate));
      const run = (src, rate) => {
        const { Processor: P } = loadProcessor({ sampleRate: ctxRate });
        const p = new P();
        send(p, { type: "load", channels: [src], sampleRate: srcRate });
        send(p, { type: "play", offset: 0.5 });
        render(p, GRAIN_SIZE * 2, { rate, ctxRate });
        return render(p, Math.round(ctxRate * 1.5), { rate, ctxRate });
      };
      const noiseRef = diffRmsDb(run(noise, 1));
      const partialRef = bandPowerDb(run(partial, 1), 11500, 12500, ctxRate);
      for (const rate of [0.92, 1.04, 1.1]) {
        const tag = `${srcRate} in ${ctxRate} @ ${rate}`;
        expect(Math.abs(diffRmsDb(run(noise, rate)) - noiseRef), `noise HF ${tag}`).toBeLessThan(0.5);
        expect(Math.abs(bandPowerDb(run(partial, rate), 11500, 12500, ctxRate) - partialRef), `12 kHz ${tag}`).toBeLessThan(0.1);
      }
    }
  });

  it("@us US73: the end of the track fades out — no click at rates 1.5 and 2.0", () => {
    // 'ended' fires while the grains still hold signal (|out| ≈ 0.35–0.5 on a
    // unit sine); it used to stop dead — step 0.82 at 1.5 / 0.69 at 2.0 on a
    // 440 Hz sine before the group-delay fix, still 0.085 / 0.195 on 100 Hz
    // with the corrected 'ended' timing alone. 100 Hz keeps the natural step
    // small (0.014), so any residual cut stands out.
    const f = 100;
    const limit = (2 * Math.PI * f) / SAMPLE_RATE + 2 / FADE + 0.01; // ≈ 0.036
    for (const rate of [1.5, 2.0]) {
      const { Processor: P, posted } = loadProcessor();
      const p = new P();
      send(p, { type: "load", channels: [tone(SAMPLE_RATE * 3, f)], sampleRate: SAMPLE_RATE });
      send(p, { type: "play", offset: 2.5 });
      const out = render(p, QUANTUM * 300, { rate });
      expect(ofType(posted, "ended"), `rate ${rate}`).toHaveLength(1);
      expect(maxStep(out, FADE), `rate ${rate}`).toBeLessThan(limit);
      expect(rms(out.subarray(out.length - QUANTUM * 20)), `rate ${rate}`).toBe(0);
    }
  });

  it("@us US73: load (eject: channels null) over a sounding stream fades the old track out within 5 ms", () => {
    // Find a quantum boundary near a peak, where a hard cut jumps by ~1.
    const src = tone(SAMPLE_RATE * 2, F0);
    const { Processor: R } = loadProcessor();
    const r = new R();
    send(r, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(r, { type: "play", offset: 0 });
    const ref = render(r, QUANTUM * 80);
    let q = 24;
    while (Math.abs(ref[q * QUANTUM]) < 0.9) q++;

    const { Processor: P } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0 });
    const pre = render(p, q * QUANTUM);
    send(p, { type: "pause" }); // the host pauses first — the eject must not cut it short
    send(p, { type: "load", channels: null, sampleRate: SAMPLE_RATE });
    const post = render(p, QUANTUM * 8);
    const all = new Float32Array(pre.length + post.length);
    all.set(pre);
    all.set(post, pre.length);
    expect(maxStep(all, pre.length - 1)).toBeLessThan(LIMIT);
    expect(rms(post.subarray(0, 64))).toBeGreaterThan(0.1); // a tail, not a cut
    expect(post.subarray(Math.ceil(0.005 * SAMPLE_RATE)).every((v) => v === 0)).toBe(true);
    expect(p.channels).toBe(null);
    expect(p.playing).toBe(false);
  });

  it("@us US73: a seek just before a loop wrap posts no stray 'looped' — exactly one, at the next real wrap", () => {
    // The tail rendered for the seek crossfade runs the OLD stream across its
    // seam; that must not announce a wrap the listener never reaches.
    const len = SAMPLE_RATE / 2;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE, loop: true });
    send(p, { type: "play", offset: (len - 300) / SAMPLE_RATE });
    render(p, QUANTUM); // 172 frames before the seam
    send(p, { type: "seek", offset: 0.1 });
    render(p, FADE * 2);
    expect(ofType(posted, "looped")).toHaveLength(0);
    render(p, len - 0.1 * SAMPLE_RATE); // through the next real wrap
    expect(ofType(posted, "looped")).toHaveLength(1);
  });

  it("@us US73: a loop region that moves the read position announces exactly one 'looped'", () => {
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE * 3)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true });
    send(p, { type: "play", offset: 2 });
    render(p, QUANTUM * 40);
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 0.7 });
    render(p, QUANTUM * 20); // < one lap of the 0.2 s region
    expect(ofType(posted, "looped")).toHaveLength(1);
  });

  it("@us US73: setLoop off after the write head wrapped but before the wrap is audible plays on to the end", () => {
    // Ramp source: value = position / len, so a restart shows as a drop to ~0.
    const len = SAMPLE_RATE / 2;
    const ramp = new Float32Array(len);
    for (let i = 0; i < len; i++) ramp[i] = i / len;
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [ramp], sampleRate: SAMPLE_RATE, loop: true });
    send(p, { type: "play", offset: (len - 4000) / SAMPLE_RATE });
    let guard = 0;
    while (p.sourcePos > len / 2 && guard++ < 100) render(p, QUANTUM);
    // Write head has wrapped; the listener has not reached the seam.
    expect(p.sourcePos).toBeLessThan(len / 2);
    expect(ofType(posted, "looped")).toHaveLength(0);
    send(p, { type: "setLoop", enabled: false });
    let lowest = Infinity;
    for (let k = 0; k < 40 && ofType(posted, "ended").length === 0; k++) {
      // Exact zeros are the track having ended (reads past the last frame).
      for (const v of render(p, QUANTUM)) if (v !== 0) lowest = Math.min(lowest, v);
    }
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(ofType(posted, "ended")).toHaveLength(1);
    // Never went back to the start (a restart reads ~0). The 4 ms re-anchor
    // crossfade dips to ~0.7 × like every seek crossfade (start-of-stream
    // normalisation floor), hence 0.5 rather than ~1.
    expect(lowest).toBeGreaterThan(0.5);
  });

  it("@us US73: play / seek / loop jumps reuse the preallocated accumulator and tail buffers", () => {
    const { Processor: P } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE * 2), tone(SAMPLE_RATE * 2)], sampleRate: SAMPLE_RATE, loop: true });
    send(p, { type: "play", offset: 0 });
    render(p, QUANTUM * 4, { channels: 2 });
    const pending = p.pending;
    const pending0 = p.pending[0];
    send(p, { type: "seek", offset: 1 });
    const seen = new Set([p.tail.buf[0]]);
    render(p, QUANTUM * 4, { channels: 2 });
    for (const msg of [{ type: "play", offset: 0.5 }, { type: "seek", offset: 1.2 }, { type: "setLoop", enabled: true, start: 0.1, end: 0.3 }, { type: "seek", offset: 1.5 }]) {
      send(p, msg);
      if (p.tail) seen.add(p.tail.buf[0]);
      render(p, QUANTUM * 4, { channels: 2 });
    }
    expect(p.pending).toBe(pending);
    expect(p.pending[0]).toBe(pending0);
    expect(seen.size).toBeLessThanOrEqual(2); // two alternating tail slots, never fresh arrays
  });
});

// ── review pass 2: loop-off arms, stream reset, tail slots, roll ghost,
//    timestamped reports, closure-free render path ──
describe("stretch worklet — review pass 2 fixes — US73", () => {
  const FADE = Math.round(SAMPLE_RATE * 0.004);
  const maxStep = (a, from = 1, to = a.length) => {
    let m = 0;
    for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
    return m;
  };
  const cat = (...parts) => {
    const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let w = 0;
    for (const p of parts) { o.set(p, w); w += p.length; }
    return o;
  };
  // Value = position / len, so a restart at the loop start reads ~0.
  const rampOf = (len) => {
    const r = new Float32Array(len);
    for (let i = 0; i < len; i++) r[i] = i / len;
    return r;
  };
  const lowestNonZero = (a) => {
    let lo = Infinity;
    for (const v of a) if (v !== 0) lo = Math.min(lo, v);
    return lo;
  };

  // ── disableLoop: the two re-anchor triggers and the plain-drop arm ──
  it("@us US73: loop off with a seam queued re-anchors at the audible position even when the in-flight lead estimate says it is far from the seam", () => {
    // Rate 4 / pitch 0.25 builds a write-head lead of ~4.1k frames; one
    // quantum at rate 0.25 then drops lastRate, so the `p + ahead ≥ end`
    // estimate (2 × GRAIN × max(1, rate, pitch) = 4096) no longer reaches the
    // seam. Only the queued seam says the write head has wrapped — without
    // that check the loop is simply dropped, the stream carries on from the
    // wrapped write head (back at the track start) and the seam still fires.
    const len = SAMPLE_RATE * 2;
    const ramp = rampOf(len);
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [ramp], sampleRate: SAMPLE_RATE, loop: true });
    send(p, { type: "play", offset: (len - 30000) / SAMPLE_RATE });
    let guard = 0;
    while (p.seamCount === 0 && guard++ < 400) render(p, QUANTUM, { rate: 4, pitchRatio: 0.25 });
    render(p, QUANTUM, { rate: 0.25, pitchRatio: 0.25 });
    const audible = p.audibleFrame();
    // Preconditions: the seam is queued, unheard, and out of the estimate's reach.
    expect(p.seamCount).toBeGreaterThan(0);
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(audible + 2 * GRAIN_SIZE).toBeLessThan(len);
    send(p, { type: "setLoop", enabled: false });
    expect(p.loop).toBe(null);
    expect(p.tail).not.toBe(null); // crossfaded re-anchor…
    expect(Math.abs(p.sourcePos - audible)).toBeLessThan(1); // …at the audible position
    let lowest = Infinity;
    for (let k = 0; k < 200 && ofType(posted, "ended").length === 0; k++) {
      lowest = Math.min(lowest, lowestNonZero(render(p, QUANTUM)));
    }
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(ofType(posted, "ended")).toHaveLength(1);
    expect(lowest).toBeGreaterThan(0.5); // never restarted from the top
  });

  it("@us US73: loop off with no seam queued but grains already reading past it re-anchors too — no wrapped material is heard", () => {
    // The track's head (first 0.2 s) is a loud 1 kHz tone. Near the end of a
    // whole-track loop the newest grain reads across the seam into that tone
    // before the write head itself wraps. Dropping the loop without
    // re-anchoring would play those grains out (and the end fade would
    // replay them).
    //
    // What precedes the seam matters: WSOLA aligns each grain on the
    // material there, and that alignment sets how far the audible playhead
    // trails the newest grain. The rate-2 and 96 kHz cases put real noise at
    // the seam to make the fixture representative of real material (the test
    // passes and kills the same mutants with silence). It is quiet (±0.01) because the alignment is a NORMALIZED cross-correlation
    // — level-invariant — while the 1 kHz tone stays measurable above it.
    //
    // The look-ahead `ahead = 2 × (GRAIN × max(1, rate, pitch) + SEARCH ×
    // pitch)` is pinned by the configurations: at the first quantum whose
    // newest grain reads past the seam, the audible playhead is 1712 / 1909
    // source frames short of it at rates 1 / 1.5 (silence), 2207 at rate 2
    // with noise (so a flat `ahead = GRAIN` = 2048 fails), and 5505 for a
    // 96 kHz track with noise at deck speed 2 in a 44.1 kHz context (rate
    // 4.35, pitch 2.18 — so dropping the `max`, i.e. a flat 2 × GRAIN = 4096,
    // fails there). The noise seeds are ones whose crossing grain carries
    // enough tone to hear when the re-anchor is skipped; across seeds and
    // 44.1 / 48 / 96 kHz contexts the gap reaches up to 0.998 × GRAIN ×
    // max(1, rate, pitch) (0.84× of the bound with the SEARCH term); the 2×
    // factor and the SEARCH term are safety margin this test does not pin.
    for (const [srcRate, ctxRate, rate, noiseSeed] of [
      [SAMPLE_RATE, SAMPLE_RATE, 1, null],
      [SAMPLE_RATE, SAMPLE_RATE, 1.5, null],
      [SAMPLE_RATE, SAMPLE_RATE, 2, 9],
      [96000, SAMPLE_RATE, 2, 5],
    ]) {
      const tag = `${srcRate} in ${ctxRate} @ rate ${rate}`;
      const len = srcRate * 2;
      const src = new Float32Array(len);
      for (let i = 0; i < srcRate * 0.2; i++) src[i] = Math.sin((2 * Math.PI * 1000 * i) / srcRate);
      if (noiseSeed !== null) {
        let seed = noiseSeed;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
        for (let i = len - 40000; i < len; i++) src[i] = 0.02 * rnd();
      }
      const { Processor: P, posted } = loadProcessor({ sampleRate: ctxRate });
      const p = new P();
      send(p, { type: "load", channels: [src], sampleRate: srcRate, loop: true });
      send(p, { type: "play", offset: (len - 30000) / srcRate });
      const newestEnd = () => p.gPos[p.grainCount & 3] + GRAIN_SIZE * p.gPitch[p.grainCount & 3];
      let guard = 0;
      while (newestEnd() <= len && guard++ < 400) render(p, QUANTUM, { rate, ctxRate });
      expect(p.seamCount, tag).toBe(0);
      expect(newestEnd(), tag).toBeGreaterThan(len);
      if (noiseSeed !== null) {
        // Precondition: a flat GRAIN (rate 2) / 2 × GRAIN (96 kHz) misses it.
        expect(len - p.audibleFrame(), tag).toBeGreaterThan((srcRate !== ctxRate ? 2 : 1) * GRAIN_SIZE);
      }
      send(p, { type: "setLoop", enabled: false });
      expect(p.tail, tag).not.toBe(null);
      const out = render(p, QUANTUM * 40, { rate, ctxRate });
      expect(ofType(posted, "looped"), tag).toHaveLength(0);
      expect(ofType(posted, "ended"), tag).toHaveLength(1);
      // Only the crossfade tail may carry the first window-weighted sliver.
      const after = out.subarray(FADE);
      if (noiseSeed === null) {
        expect(rms(after), tag).toBeLessThan(1e-3);
        expect(rms(out), tag).toBeLessThan(0.01);
      } else {
        // 1 kHz amplitude past the tail: measured <= 2e-4 (the noise's own
        // share); a wrapped tone sliver measures 0.01–0.03.
        let re = 0;
        let im = 0;
        for (let i = 0; i < after.length; i++) {
          const w = (2 * Math.PI * 1000 * i) / ctxRate;
          re += after[i] * Math.cos(w);
          im += after[i] * Math.sin(w);
        }
        expect((2 * Math.hypot(re, im)) / after.length, tag).toBeLessThan(2e-3);
      }
    }
  });

  it("@us US73: loop off far from the seam simply drops the loop — no crossfade, output bit-identical to never having looped", () => {
    const src = tone(SAMPLE_RATE * 2);
    const mk = (loop) => {
      const { Processor: P } = loadProcessor();
      const p = new P();
      send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE, loop });
      send(p, { type: "play", offset: 0.2 });
      return p;
    };
    const looped = mk(true);
    const plain = mk(false);
    const a0 = render(looped, QUANTUM * 20, { rate: 1.12 });
    const b0 = render(plain, QUANTUM * 20, { rate: 1.12 });
    send(looped, { type: "setLoop", enabled: false });
    expect(looped.loop).toBe(null);
    expect(looped.tail).toBe(null);
    const a = cat(a0, render(looped, QUANTUM * 40, { rate: 1.12 }));
    const b = cat(b0, render(plain, QUANTUM * 40, { rate: 1.12 }));
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBe(0);
  });

  // ── resetStream clears every piece of per-stream loop bookkeeping ──
  it("@us US73: a seam queued during a pause fade is dropped by the next play — no stray 'looped', reports stay on the track", () => {
    const len = SAMPLE_RATE * 2;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 1.0 });
    send(p, { type: "play", offset: 0.98 });
    let guard = 0;
    while (p.seamCount === 0 && guard++ < 100) render(p, QUANTUM, { clock });
    expect(p.seamCount).toBeGreaterThan(0);
    expect(ofType(posted, "looped")).toHaveLength(0);
    send(p, { type: "pause" });
    render(p, QUANTUM * 4, { clock }); // fade-out: process() posts nothing while paused
    send(p, { type: "setLoop", enabled: false });
    send(p, { type: "play", offset: 0.9 });
    render(p, SAMPLE_RATE * 0.3, { clock }); // through 1.0 — the old region end
    expect(ofType(posted, "looped")).toHaveLength(0);
    const last = ofType(posted, "position").pop();
    expect(last.seconds).toBeGreaterThan(1.1);
  });

  it("@us US73: seek past a region end then seek back inside, in one quantum, posts no stray 'looped'", () => {
    // The first seek's fresh stream would wrap at once (startWrapped); the
    // second seek replaces that stream before it is heard. resetStream()
    // clears startWrapped; since the roll-ghost fix the second capture no
    // longer renders the unheard stream at all, so the flag is never set
    // here in the first place (both guards hold this case).
    const { Processor: P, posted } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE * 2)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 1.0 });
    send(p, { type: "play", offset: 0.2 });
    render(p, QUANTUM * 20);
    send(p, { type: "seek", offset: 1.5 });
    send(p, { type: "seek", offset: 0.6 });
    render(p, SAMPLE_RATE * 0.2);
    expect(ofType(posted, "looped")).toHaveLength(0);
    expect(p.startWrapped).toBe(false);
  });

  it("@us US73: a seek after a loop wrap reports the new position exactly (lap count reset)", () => {
    const len = SAMPLE_RATE * 2;
    const K = 1e-7;
    const marker = new Float32Array(len);
    for (let i = 0; i < len; i++) marker[i] = K * i;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [tone(len), marker], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.5, end: 1.0 });
    send(p, { type: "play", offset: 0.5 });
    render(p, SAMPLE_RATE * 0.7, { clock, channels: 2, rate: 1.25 });
    expect(ofType(posted, "looped").length).toBeGreaterThan(0);
    send(p, { type: "seek", offset: 0.6 });
    let rep = null;
    let checked = 0;
    let worst = 0;
    for (let k = 0; k < 80; k++) {
      const before = posted.length;
      const [, m] = render(p, QUANTUM, { clock, channels: 2, rate: 1.25 });
      if (rep && k > 4) {
        worst = Math.max(worst, Math.abs(rep.seconds * SAMPLE_RATE - m[0] / K));
        checked++;
      }
      rep = posted.slice(before).find((x) => x.type === "position") || null;
    }
    expect(checked).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.5);
  });

  // ── tail slots / roll ghost: two crossfading messages in one quantum ──
  it("@us US73: two crossfading messages in one quantum stay click-free (100 Hz full-scale sine)", () => {
    // 100 Hz keeps the natural step at 0.014, so a click stands out; the
    // crossfade adds ≤ 2/FADE. Seek + seek and loop-off (re-anchor) + seek.
    // Before the roll-ghost fix the second capture rendered over the first
    // one's slot, so a single tail slot clicked at 0.6–0.8 here; now the
    // second capture finds no heard stream and keeps the first tail, so the
    // alternating slots are belt-and-braces: a capture over a live stream
    // always finds the old tail already advanced by ≥ 1 sample.
    const f = 100;
    const len = SAMPLE_RATE * 3;
    const src = tone(len, f);
    const LIMIT = 0.03;
    for (const [label, loop, offset, msgs] of [
      ["seek+seek", false, 0, [{ type: "seek", offset: 1 + 0.5 / f }, { type: "seek", offset: 2.3 + 0.25 / f }]],
      ["setLoop off+seek", true, (len - 3000) / SAMPLE_RATE, [{ type: "setLoop", enabled: false }, { type: "seek", offset: 1 + 0.5 / f }]],
    ]) {
      const { Processor: P } = loadProcessor();
      const p = new P();
      send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE, loop });
      send(p, { type: "play", offset });
      const pre = render(p, QUANTUM * 12);
      for (const m of msgs) send(p, m);
      const post = render(p, QUANTUM * 10);
      expect(maxStep(cat(pre, post), pre.length - 1), label).toBeLessThan(LIMIT);
    }
  });

  it("@us US73: a roll's back-to-back setLoop + seek leaves only the first crossfade tail — no ghost of the old position", () => {
    // The second message's capture used to re-render the not-yet-heard
    // stream the first one had just re-anchored (at the old / wrapped
    // position): fade-in × fade-out ≈ −12 dB of ghost material for 4 ms, and
    // the real tail ramped twice. Now only the first tail plays — identical,
    // sample for sample, to a single seek from the same state.
    const len = SAMPLE_RATE * 3;
    // Silent first second (the seek target), a 1 kHz tone after it.
    const src = new Float32Array(len);
    for (let i = SAMPLE_RATE; i < len; i++) src[i] = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
    const cases = [
      // Loop off near the seam: re-anchors at the old (tone) position.
      ["setLoop off + seek", (len - 3000) / SAMPLE_RATE, true, { type: "setLoop", enabled: false }],
      // Region behind the playhead (the roll press): re-anchors and wraps.
      ["setLoop region + seek", 2.0, false, { type: "setLoop", enabled: true, start: 1.5, end: 1.7 }],
    ];
    for (const [label, offset, loop, first] of cases) {
      const run = (msgs) => {
        const { Processor: P } = loadProcessor();
        const p = new P();
        send(p, { type: "load", channels: [src], sampleRate: SAMPLE_RATE, loop });
        send(p, { type: "play", offset });
        render(p, QUANTUM * 12);
        for (const m of msgs) send(p, m);
        return render(p, QUANTUM * 10);
      };
      const seek = { type: "seek", offset: 0.3 };
      const both = run([first, seek]);
      const only = run([seek]);
      let worst = 0;
      for (let i = 0; i < both.length; i++) worst = Math.max(worst, Math.abs(both[i] - only[i]));
      expect(worst, label).toBeLessThan(1e-6);
      expect(rms(both.subarray(0, FADE)), label).toBeGreaterThan(0.1); // the real tail
      expect(both.subarray(FADE).every((v) => v === 0), label).toBe(true); // nothing after it
    }
  });

  // ── timestamped reports ──
  it("@us US73: position and looped reports carry `at` = the END of the quantum they were measured after (currentTime + frames / sampleRate)", () => {
    const { Processor: P, posted, clock } = loadProcessor({ currentTime: 3 });
    const p = new P();
    send(p, { type: "load", channels: [tone(SAMPLE_RATE)], sampleRate: SAMPLE_RATE });
    send(p, { type: "setLoop", enabled: true, start: 0.1, end: 0.3 });
    send(p, { type: "play", offset: 0.1 });
    const seen = { position: 0, looped: 0 };
    for (let k = 0; k < 400; k++) {
      const t = clock.now;
      const before = posted.length;
      render(p, QUANTUM, { clock });
      for (const m of posted.slice(before)) {
        if (m.type !== "position" && m.type !== "looped") continue;
        // The reported sample is the next one out, heard one quantum after t.
        expect(m.at, m.type).toBe(t + QUANTUM / SAMPLE_RATE);
        seen[m.type]++;
      }
    }
    expect(seen.position).toBeGreaterThan(5);
    expect(seen.looped).toBeGreaterThan(3);
  });

  // ── zero allocation on the audio thread ──
  it("@us US73: the render path creates no closures, iterators or object literals per grain / quantum", () => {
    // Pass 1 claimed zero per-event allocation, but bestLag() built a
    // fullScore closure per grain, loopBounds() a clamp closure per call, and
    // process() / captureTail() / synthesizeBlock() iterated with for…of.
    // Pass 3: loopBounds() still returned a fresh { start, end, len } per
    // call (every quantum, every grain, each wrap) — it now fills one
    // preallocated object. Only the channel-layout reallocation branches
    // (Array.from with a Float32Array factory) may allocate, plus the
    // postMessage payloads (structured-cloned by the port regardless, ≤ ~10
    // per second).
    const body = (name) => {
      const m = new RegExp(`\\n  ${name}\\([^)]*\\) \\{`).exec(SRC);
      expect(m, name).not.toBe(null);
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const start = i;
      for (; i < SRC.length; i++) {
        if (SRC[i] === "{") depth++;
        else if (SRC[i] === "}" && --depth === 0) break;
      }
      return SRC.slice(start, i + 1);
    };
    const hot = [
      "process", "produce", "synthesizeBlock", "bestLag", "fullScore", "read", "readMono", "sampleAt",
      "audibleStream", "audibleFrame", "loopBounds", "wrap", "queueSeam", "captureTail",
    ];
    // Drop every `this.port.postMessage(…)` call (balanced parentheses).
    const withoutPosts = (code) => {
      let out = "";
      let i = 0;
      for (;;) {
        const k = code.indexOf("this.port.postMessage(", i);
        if (k < 0) return out + code.slice(i);
        out += code.slice(i, k);
        let depth = 0;
        let j = k + "this.port.postMessage".length;
        for (; j < code.length; j++) {
          if (code[j] === "(") depth++;
          else if (code[j] === ")" && --depth === 0) break;
        }
        i = j + 1;
      }
    };
    for (const name of hot) {
      const code = withoutPosts(body(name))
        .split("\n")
        .filter((l) => !/Array\.from\(\{ length: n \}, \(\) => new Float32Array\(/.test(l))
        .join("\n");
      expect(code, `${name}: closure`).not.toMatch(/=>/);
      // `{` after `=`, `(`, `,`, `:`, `?`, `[` or `return` opens an object literal.
      expect(code, `${name}: object literal`).not.toMatch(/(?:[=(,:?[]|\breturn)\s*\{/);
      expect(code, `${name}: array literal`).not.toMatch(/(?:[=(,:?]|\breturn)\s*\[/);
      expect(code, `${name}: for…of`).not.toMatch(/for \((const|let|var) [^;)]+ of /);
      expect(code, `${name}: array callback`).not.toMatch(/\.(map|forEach|filter|reduce)\(/);
    }
  });
});

// ── Review pass 4: transport epoch ──
// `at` alone cannot separate a stale report from a fresh one (in real
// Chromium their `at` ranges overlap around a host re-anchor), so the host
// tags every transport move with an epoch and the worklet echoes the last
// one it received in every report.
describe("stretch worklet — transport epoch — US73", () => {
  it("@us US73: position and looped echo the epoch of the last load / play / seek that carried one (null before any)", () => {
    const len = SAMPLE_RATE * 2;
    const { Processor: P, posted, clock } = loadProcessor();
    const p = new P();
    const reports = (from) => posted.slice(from).filter((m) => m.type === "position" || m.type === "looped");
    const epochsSince = (from) => [...new Set(reports(from).map((m) => m.epoch))];

    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(reports(0).length).toBeGreaterThan(0);
    expect(epochsSince(0)).toEqual([null]);

    // load stores it; a later play WITHOUT one keeps it.
    let n = posted.length;
    send(p, { type: "load", channels: [tone(len)], sampleRate: SAMPLE_RATE, epoch: 1 });
    send(p, { type: "play", offset: 0 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(reports(n).length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([1]);

    n = posted.length;
    send(p, { type: "play", offset: 0.5, epoch: 2 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(reports(n).length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([2]);

    n = posted.length;
    send(p, { type: "seek", offset: 0.2, epoch: 3 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(reports(n).length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([3]);

    // setLoop{epoch 4} does NOT store its epoch: the roll-release pair is
    // setLoop → seek, and a quantum rendered between the two still describes
    // the old position, so it must report the previous epoch (3). Region
    // ahead of the playhead (~0.45 s), so the wraps report too.
    n = posted.length;
    send(p, { type: "setLoop", enabled: true, start: 0.6, end: 0.7, epoch: 4 });
    render(p, SAMPLE_RATE * 0.5, { clock });
    expect(ofType(posted.slice(n), "looped").length).toBeGreaterThan(1);
    expect(ofType(posted.slice(n), "position").length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([3]);

    // The pair's seek lands the epoch; everything after carries it.
    n = posted.length;
    send(p, { type: "seek", offset: 0.5, epoch: 4 });
    render(p, SAMPLE_RATE * 0.5, { clock });
    expect(reports(n).length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([4]);

    // A degenerate setLoop (ignored region) is no different: still not stored.
    n = posted.length;
    send(p, { type: "setLoop", enabled: true, start: 0.65, end: 0.65, epoch: 5 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(p.loop).toEqual({ start: 0.6, end: 0.7 }); // region unchanged
    expect(reports(n).length).toBeGreaterThan(0);
    expect(epochsSince(n)).toEqual([4]);
    send(p, { type: "seek", offset: 0.5, epoch: 5 });
    n = posted.length;
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(epochsSince(n)).toEqual([5]);

    // pause carries no transport epoch; the next play's does.
    send(p, { type: "pause", epoch: 99 });
    n = posted.length;
    send(p, { type: "play", offset: 0.1 });
    render(p, SAMPLE_RATE * 0.25, { clock });
    expect(epochsSince(n)).toEqual([5]);
  });
});

// ── Review pass 7: sub-bass keylock at any context rate; cold-start fade ──
// The alignment search radius was a fixed 384 samples, so the lowest pitch
// it could hold (half a period inside ±SEARCH) moved with the context rate:
// ~57 Hz at 44.1 kHz, ~62 Hz at 48 kHz, ~125 Hz at 96 kHz. Below it the lag
// pinned to the search edge every grain and the bass came out at f0 × rate.
// The radius is now half the period of 40 Hz in TIME (552 / 600 / 1200
// samples). Measured (rates 0.92–1.5): every tone ≥ 41 Hz holds within
// 0.1 dB at f0 at 44.1 / 48 / 96 kHz; with SEARCH = 384 the same probe read
// −41 / −34 dB at f0 for 41 / 49 Hz at 44.1 kHz, −41 / −34 / −27 dB for
// 41 / 49 / 55 Hz at 48 kHz and −38…−58 dB for 41–110 Hz at 96 kHz.
// Hann-windowed single-bin amplitude (2 s: f0 and f0 × rate sit ≥ 3 bins
// apart, where Hann leakage is far below −20 dB).
function hannAmp(y, f, sr) {
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
}
const dB = (x) => 20 * Math.log10(x);

describe("stretch worklet — review pass 7 — US73", () => {
  it("@us US73: sub-bass stays keylocked at every context rate — 41 Hz @ 44.1 kHz, 49 Hz @ 48 kHz, 90 / 49 Hz @ 96 kHz hold f0 within 0.5 dB with < −20 dB at f0 × rate (rates 1.04 / 0.92)", () => {
    for (const [sr, f0] of [
      [44100, 41],
      [48000, 49],
      [96000, 90],
      [96000, 49], // below the 44.1 kHz radius's cutoff: a fixed 552 fails here
    ]) {
      const A = 0.6;
      const src = new Float32Array(sr * 4);
      for (let i = 0; i < src.length; i++) src[i] = A * Math.sin((2 * Math.PI * f0 * i) / sr);
      for (const rate of [1.04, 0.92]) {
        const tag = `${f0} Hz @ ${sr} Hz, rate ${rate}`;
        const { Processor: P } = loadProcessor({ sampleRate: sr });
        const p = new P();
        send(p, { type: "load", channels: [src], sampleRate: sr });
        send(p, { type: "play", offset: 0.2 });
        render(p, sr * 0.5, { rate, ctxRate: sr });
        const y = render(p, sr * 2, { rate, ctxRate: sr });
        expect(Math.abs(dB(hannAmp(y, f0, sr) / A)), `${tag}: level at f0`).toBeLessThan(0.5);
        expect(dB(hannAmp(y, f0 * rate, sr) / A), `${tag}: level at f0 × rate`).toBeLessThan(-20);
      }
    }
  });

  it("@us US73: a cold play rises no faster than the explicit 4 ms linear fade-in (|out[k]| ≤ k / FADE on a full-scale DC track)", () => {
    // Kept deliberately (review pass 7): the start-of-stream normalisation
    // floor (NORM_FLOOR) already ramps a fresh stream, but only as a side
    // effect of the window shape; the explicit fade is what guarantees the
    // 4 ms edge regardless of that tuning. This bound fails without it.
    const FADE = Math.round(SAMPLE_RATE * 0.004);
    const { Processor: P } = loadProcessor();
    const p = new P();
    send(p, { type: "load", channels: [new Float32Array(SAMPLE_RATE).fill(1)], sampleRate: SAMPLE_RATE });
    send(p, { type: "play", offset: 0.3 });
    const out = render(p, QUANTUM * 4);
    for (let k = 0; k < FADE; k++) {
      expect(Math.abs(out[k]), `sample ${k}`).toBeLessThanOrEqual(k / FADE + 1e-6);
    }
    // ...and it does arrive: full level once fade and floor are both done.
    for (let k = FADE + 64; k < out.length; k++) expect(out[k], `sample ${k}`).toBeCloseTo(1, 4);
  });
});
