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

// ─── W3.7 — component isolation stage (US68) ───
describe("buildDeckChain isolation stage — US68", () => {
  const build = () => {
    const ctx = new AudioContext();
    return buildDeckChain(ctx, ctx.createGain());
  };

  it("@us US68: OFF state is bit-transparent — dry gain exactly 1, every gate 0", () => {
    const chain = build();
    expect(chain.isoDry.gain.value).toBe(1);
    expect(chain.isoOut.gain.value).toBe(1);
    for (const gate of [
      chain.isoBassGate,
      chain.isoVocalGate,
      chain.isoInstGate,
      chain.isoDrumGate,
    ]) {
      expect(gate.gain.value).toBe(0);
    }
  });

  it("@us US68: the stage sits between the deck gain and the EQ", () => {
    const chain = build();
    expect(chain.gain.connections).toContain(chain.isoDry);
    expect(chain.isoDry.connections).toContain(chain.isoOut);
    expect(chain.isoOut.connections).toContain(chain.eqLow);
    // The deck gain no longer feeds the EQ directly.
    expect(chain.gain.connections).not.toContain(chain.eqLow);
  });

  it("@us US68: BASS is a 24 dB/oct cascade — two lowpass biquads at 180 Hz", () => {
    const chain = build();
    for (const f of [chain.isoBassF1, chain.isoBassF2]) {
      expect(f.type).toBe("lowpass");
      expect(f.frequency.value).toBe(180);
    }
    expect(chain.isoBassGate.connections).toContain(chain.isoBassF1);
    expect(chain.isoBassF1.connections).toContain(chain.isoBassF2);
    expect(chain.isoBassF2.connections).toContain(chain.isoOut);
  });

  it("@us US68: VOCAL downmixes to mono mid and band-passes 200 Hz – 8 kHz", () => {
    const chain = build();
    expect(chain.isoVocalGate.channelCount).toBe(1);
    expect(chain.isoVocalGate.channelCountMode).toBe("explicit");
    expect(chain.isoVocalHp.type).toBe("highpass");
    expect(chain.isoVocalHp.frequency.value).toBe(200);
    expect(chain.isoVocalLp.type).toBe("lowpass");
    expect(chain.isoVocalLp.frequency.value).toBe(8000);
    expect(chain.isoVocalLp.connections).toContain(chain.isoOut);
  });

  it("@us US68: INSTRUMENTAL sums the signal with an inverted mono mid (side extraction)", () => {
    const chain = build();
    expect(chain.isoInstInv.gain.value).toBe(-1);
    expect(chain.isoInstInv.channelCount).toBe(1);
    // gate feeds the sum directly AND via the inverted mid → sum = side.
    expect(chain.isoInstGate.connections).toContain(chain.isoInstSum);
    expect(chain.isoInstGate.connections).toContain(chain.isoInstInv);
    expect(chain.isoInstInv.connections).toContain(chain.isoInstSum);
    expect(chain.isoInstSum.connections).toContain(chain.isoOut);
  });

  it("@us US68: DRUMS is the side construction through a +6 dB treble tilt", () => {
    const chain = build();
    expect(chain.isoDrumTilt.type).toBe("highshelf");
    expect(chain.isoDrumTilt.frequency.value).toBe(3000);
    expect(chain.isoDrumTilt.gain.value).toBe(6);
    expect(chain.isoDrumSum.connections).toContain(chain.isoDrumTilt);
    expect(chain.isoDrumTilt.connections).toContain(chain.isoOut);
  });
});
