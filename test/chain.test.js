import { describe, it, expect } from "vitest";
import { buildDeckChain, disconnectChain } from "../src/audio/chain.js";

describe("buildDeckChain — US55, US18–US20", () => {
  it("@us US55: returns the documented set of nodes", () => {
    const ctx = new AudioContext();
    const out = ctx.createDynamicsCompressor();
    const chain = buildDeckChain(ctx, out);
    for (const key of [
      "gain",
      "eqLow",
      "eqMid",
      "eqHigh",
      "filter",
      "reverbConv",
      "reverbDry",
      "reverbWet",
      "reverbOut",
      "delay",
      "delayFb",
      "delayDry",
      "delayWet",
      "delayOut",
      "distortion",
      "distortionDry",
      "distortionWet",
      "distortionOut",
      "analyser",
    ]) {
      expect(chain[key]).toBeTruthy();
    }
  });

  it("@us US55: EQ filters use the documented frequencies", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.eqLow.type).toBe("lowshelf");
    expect(chain.eqLow.frequency.value).toBe(200);
    expect(chain.eqMid.type).toBe("peaking");
    expect(chain.eqMid.frequency.value).toBe(1500);
    expect(chain.eqHigh.type).toBe("highshelf");
    expect(chain.eqHigh.frequency.value).toBe(6000);
  });

  it("@us US5: lowpass filter starts wide open (20000 Hz)", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.filter.type).toBe("lowpass");
    expect(chain.filter.frequency.value).toBe(20000);
  });

  it("@us US18: reverb starts fully bypassed (wet=0, dry=1)", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.reverbWet.gain.value).toBe(0);
    expect(chain.reverbDry.gain.value).toBe(1);
  });

  it("@us US19: delay starts fully bypassed and feedback is at 0", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.delayWet.gain.value).toBe(0);
    expect(chain.delayDry.gain.value).toBe(1);
    expect(chain.delayFb.gain.value).toBe(0);
    expect(chain.delay.maxDelayTime).toBe(2.0);
  });

  it("@us US20: distortion starts bypassed and uses 2× oversample (A8 — 2x is audibly transparent; 4x reserved for non-realtime export)", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.distortionWet.gain.value).toBe(0);
    expect(chain.distortion.oversample).toBe("2x");
  });

  it("@us US10: analyser uses fftSize 2048", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.analyser.fftSize).toBe(2048);
  });

  it("@us US55: the final analyser is connected to the output node", () => {
    const ctx = new AudioContext();
    const out = ctx.createDynamicsCompressor();
    const chain = buildDeckChain(ctx, out);
    expect(chain.analyser.connections).toContain(out);
  });

  it("@us US19 (feedback loop): delay → delayFb → delay forms the feedback loop", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(chain.delay.connections).toContain(chain.delayFb);
    expect(chain.delayFb.connections).toContain(chain.delay);
  });

  it("@us US61 (W1.7): analyser fans out to the pre-limiter record tap when supplied", () => {
    const ctx = new AudioContext();
    const out = ctx.createDynamicsCompressor();
    const recordTap = ctx.createGain();
    const chain = buildDeckChain(ctx, out, recordTap);
    // Audible path is intact AND the parallel tap branch exists.
    expect(chain.analyser.connections).toContain(out);
    expect(chain.analyser.connections).toContain(recordTap);
  });

  it("@us US61 (W1.7): omitting the record tap leaves the audible path unchanged", () => {
    const ctx = new AudioContext();
    const out = ctx.createGain();
    const chain = buildDeckChain(ctx, out);
    expect(chain.analyser.connections).toContain(out);
    // Only the single audible connection — no stray parallel branch.
    expect(chain.analyser.connections).toHaveLength(1);
  });
});

describe("disconnectChain", () => {
  it("disconnects every node in the chain object", () => {
    const ctx = new AudioContext();
    const out = ctx.createGain();
    const chain = buildDeckChain(ctx, out);
    expect(chain.gain.connections.length).toBeGreaterThan(0);
    disconnectChain(chain);
    for (const node of Object.values(chain)) {
      expect(node.connections).toHaveLength(0);
    }
  });

  it("tolerates null/undefined input", () => {
    expect(() => disconnectChain(null)).not.toThrow();
    expect(() => disconnectChain(undefined)).not.toThrow();
  });

  it("is idempotent — calling it twice on the same chain does not throw", () => {
    const ctx = new AudioContext();
    const chain = buildDeckChain(ctx, ctx.createGain());
    expect(() => {
      disconnectChain(chain);
      disconnectChain(chain);
    }).not.toThrow();
    for (const node of Object.values(chain)) {
      expect(node.connections).toHaveLength(0);
    }
  });
});
