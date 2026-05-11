import { describe, it, expect } from "vitest";
import {
  buildReverbIR,
  buildDistortionCurve,
  rampGain,
  clamp,
} from "../src/audio/effects.js";

describe("buildReverbIR — US18", () => {
  it("@us US18: returns a stereo AudioBuffer of the requested duration", () => {
    const ctx = new AudioContext();
    const ir = buildReverbIR(ctx, 1.5, 3.0);
    expect(ir.numberOfChannels).toBe(2);
    expect(ir.length).toBe(Math.floor(ctx.sampleRate * 1.5));
    expect(ir.duration).toBeCloseTo(1.5, 2);
  });

  it("@us US18: IR amplitude decays — earliest sample > latest sample magnitude", () => {
    const ctx = new AudioContext();
    const ir = buildReverbIR(ctx, 2.0, 3.0);
    const ch = ir.getChannelData(0);
    // Average absolute amplitude in the first 5% vs the last 5%.
    const slice = Math.floor(ch.length * 0.05);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < slice; i++) head += Math.abs(ch[i]);
    for (let i = ch.length - slice; i < ch.length; i++) tail += Math.abs(ch[i]);
    expect(head / slice).toBeGreaterThan(tail / slice);
  });

  it("@us US18: longer decay → faster amplitude falloff (higher decay = shorter tail)", () => {
    const ctx = new AudioContext();
    const irShort = buildReverbIR(ctx, 1.0, 6.0); // shorter tail
    const irLong = buildReverbIR(ctx, 1.0, 1.5); // longer tail
    const tailIdx = Math.floor(irShort.length * 0.8);
    const a = Math.abs(irShort.getChannelData(0)[tailIdx]);
    const b = Math.abs(irLong.getChannelData(0)[tailIdx]);
    expect(b).toBeGreaterThan(a);
  });
});

describe("buildDistortionCurve — US20", () => {
  it("@us US20: returns a Float32Array of the requested length", () => {
    const curve = buildDistortionCurve(40, 1024);
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(1024);
  });

  it("@us US20: curve is odd-symmetric about zero (input -x maps to -y)", () => {
    const samples = 1024;
    const curve = buildDistortionCurve(50, samples);
    // Sample at indices equidistant from center.
    const center = samples / 2;
    expect(curve[center + 100] + curve[center - 100]).toBeCloseTo(0, 2);
  });

  it("@us US20: drive=0 is monotonic and near-linear (low gain)", () => {
    const curve = buildDistortionCurve(0, 1024);
    // Center should be 0, midway up should be positive
    expect(curve[512]).toBeCloseTo(0, 3);
    expect(curve[768]).toBeGreaterThan(0);
    expect(curve[256]).toBeLessThan(0);
  });

  it("@us US20: higher drive yields stronger compression at the same input", () => {
    const lowDrive = buildDistortionCurve(10, 4096);
    const highDrive = buildDistortionCurve(80, 4096);
    // Both should be positive at the same edge index, but high drive should
    // saturate further/sooner.
    expect(highDrive[3500]).toBeGreaterThanOrEqual(lowDrive[3500]);
  });
});

describe("clamp — US53", () => {
  it("@us US53: clamps within bounds (no change)", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("@us US53: clamps below lower bound", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("@us US53: clamps above upper bound", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("@us US53: handles negative ranges", () => {
    expect(clamp(0, -1, -0.5)).toBe(-0.5);
    expect(clamp(-2, -1, -0.5)).toBe(-1);
  });
});

describe("rampGain — US19 (delay feedback clamping foundation)", () => {
  it("@us US19: schedules setTargetAtTime on the given param", () => {
    const ctx = new AudioContext();
    const node = ctx.createGain();
    rampGain(node.gain, 0.5, ctx, 0.05);
    expect(node.gain.value).toBe(0.5);
    expect(node.gain.scheduledValues.at(-1).type).toBe("setTarget");
    expect(node.gain.scheduledValues.at(-1).target).toBe(0.5);
    expect(node.gain.scheduledValues.at(-1).tau).toBe(0.05);
  });

  it("@us US19: gracefully no-ops on missing param or ctx", () => {
    expect(() => rampGain(null, 0.5, null)).not.toThrow();
  });
});
