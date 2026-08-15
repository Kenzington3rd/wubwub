import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { stretchChannel, GRAIN_SIZE } from "../src/audio/timeStretch.js";

// W3.1 — the KEYLOCK stretch worklet (US73).
//
// `src/worklets/stretch-worklet.js` is a SECOND implementation of the
// granular OLA in `src/audio/timeStretch.js`: the offline core synthesizes a
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

function loadProcessor({ currentTime = 0 } = {}) {
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
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    "currentTime",
    `${SRC}\nreturn __registered;`
      .replace(
        'registerProcessor("stretch-processor", StretchProcessor);',
        'registerProcessor("stretch-processor", StretchProcessor); var __registered = StretchProcessor;'
      )
  );
  Registered = factory(
    AudioWorkletProcessorShim,
    (name, cls) => { Registered = cls; },
    SAMPLE_RATE,
    currentTime
  );
  return { Processor: Registered, posted };
}

// Drive `frames` samples through process() and return the concatenated output.
function render(proc, frames, params = {}) {
  const rate = params.rate ?? 1;
  const pitchRatio = params.pitchRatio ?? 1;
  const out = new Float32Array(frames);
  const quanta = Math.ceil(frames / QUANTUM);
  let w = 0;
  for (let q = 0; q < quanta; q++) {
    const chan = new Float32Array(QUANTUM);
    proc.process([], [[chan]], {
      rate: new Float32Array([rate]),
      pitchRatio: new Float32Array([pitchRatio]),
    });
    for (let i = 0; i < QUANTUM && w < frames; i++) out[w++] = chan[i];
  }
  return out;
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
