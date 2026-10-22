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

  it("@us US18 (A4): each channel is peak-normalised — peak ≈ 1.0 regardless of size", () => {
    // A4 — without per-channel peak-normalisation the convolver's wet
    // loudness scales with IR length, so cranking SIZE made the wet signal
    // louder instead of just longer. The fix pins every channel to unit peak
    // so SIZE controls tail length only.
    const ctx = new AudioContext();
    for (const dur of [0.5, 1.0, 2.0, 3.5, 5.0]) {
      const ir = buildReverbIR(ctx, dur);
      for (let ch = 0; ch < ir.numberOfChannels; ch++) {
        const data = ir.getChannelData(ch);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i]);
          if (a > peak) peak = a;
        }
        expect(peak).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("@us US18 (A4): the tail still decays to ~zero — normalisation preserves the envelope shape", () => {
    // The normalisation is a uniform scale; the (1-t)^decay envelope shape is
    // unchanged, so the last 5% of the buffer must still be dramatically
    // quieter than the first 5%. Tests a property of the audible result —
    // "tail decays toward silence" — not exact sample values.
    const ctx = new AudioContext();
    const ir = buildReverbIR(ctx, 2.0);
    const ch = ir.getChannelData(0);
    const slice = Math.floor(ch.length * 0.05);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < slice; i++) head += Math.abs(ch[i]);
    for (let i = ch.length - slice; i < ch.length; i++) tail += Math.abs(ch[i]);
    // The head should be at least 10× louder than the tail — a normalisation
    // that destroyed the envelope (e.g. dividing by RMS) would equalise them.
    expect(head / slice).toBeGreaterThan((tail / slice) * 10);
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
    // Mirror pairs are (i, N-1-i): the WaveShaper maps x to index (N-1)(x+1)/2.
    expect(curve[412] + curve[samples - 1 - 412]).toBeCloseTo(0, 6);
  });

  it("@us US20: exact odd symmetry — odd N has a zero centre, curve[i] === -curve[N-1-i]", () => {
    for (const n of [1025, 4095, 1024, 4096]) {
      for (const drive of [0, 40, 100]) {
        const c = buildDistortionCurve(drive, n);
        if (n % 2 === 1) expect(c[(n - 1) / 2]).toBe(0);
        for (let i = 0; i < n; i++) {
          expect(Math.abs(c[i] + c[n - 1 - i])).toBeLessThanOrEqual(1e-12);
        }
        expect(c[0]).toBeLessThan(0);
        expect(c[n - 1]).toBeGreaterThan(0);
      }
    }
  });

  it("@us US20: drive=0 is monotonic and near-linear (low gain)", () => {
    const curve = buildDistortionCurve(0, 1024);
    // Centre (between samples 511 and 512) is 0, midway up should be positive
    expect(curve[511] + curve[512]).toBeCloseTo(0, 6);
    expect(Math.abs(curve[512])).toBeLessThan(0.002);
    expect(curve[768]).toBeGreaterThan(0);
    expect(curve[256]).toBeLessThan(0);
  });

  it("@us US20: higher drive saturates harder (flatter toward the edge)", () => {
    const lowDrive = buildDistortionCurve(10, 4096);
    const highDrive = buildDistortionCurve(80, 4096);
    // Both are unity-gain near zero; compare how much of the linear value
    // survives at x ~ 0.71 — the harder-driven curve keeps less of it.
    const xi = 3500;
    const x = (xi * 2) / 4096 - 1;
    expect(highDrive[xi] / x).toBeLessThan(lowDrive[xi] / x);
  });

  it("@us US20: low-drive small-signal gain stays ~unity (MIX is not a loudness boost)", () => {
    // Makeup gain (see buildDistortionCurve) deliberately raises small-signal
    // gain at high drive, so this slope bound only holds for low drives.
    const n = 4096;
    for (const drive of [0, 5, 10]) {
      const c = buildDistortionCurve(drive, n);
      const i = n / 2 + 8; // x = 8*2/n
      const x = (i * 2) / n - 1;
      const slope = c[i] / x;
      expect(slope, `drive ${drive}`).toBeGreaterThan(0.8);
      expect(slope, `drive ${drive}`).toBeLessThan(1.25);
    }
  });

  it("@us US20: DRIVE keeps loud material at ~constant level (wet/dry RMS within 3 dB, drives 0-100)", () => {
    const n = 4096;
    const apply = (curve, x) => {
      const pos = ((Math.max(-1, Math.min(1, x)) + 1) / 2) * (curve.length - 1);
      const i = Math.floor(pos);
      const f = pos - i;
      return curve[i] * (1 - f) + (curve[Math.min(i + 1, curve.length - 1)]) * f;
    };
    const rms = (arr) => Math.sqrt(arr.reduce((t, v) => t + v * v, 0) / arr.length);
    const N = 48000;
    const peak3 = Math.pow(10, -3 / 20);
    const sine = Float32Array.from({ length: N }, (_, i) => peak3 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    // Dense multi-tone: 6 partials, scaled to a -3 dBFS peak.
    const freqs = [110, 247, 523, 1100, 2300, 4200];
    const raw = Float32Array.from({ length: N }, (_, i) =>
      freqs.reduce((t, f, k) => t + Math.sin((2 * Math.PI * f * i) / 48000 + k), 0)
    );
    let mx = 0;
    for (const v of raw) mx = Math.max(mx, Math.abs(v));
    const dense = raw.map((v) => (v / mx) * peak3);
    for (const [name, sig] of [["sine", sine], ["dense", dense]]) {
      for (const drive of [0, 25, 50, 100]) {
        const c = buildDistortionCurve(drive, n);
        const wet = Float32Array.from(sig, (v) => apply(c, v));
        const db = 20 * Math.log10(rms(wet) / rms(sig));
        expect(Math.abs(db), `${name} drive ${drive}: ${db.toFixed(2)} dB`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("@us US20: curve is bounded in [-1, 1], monotonic and odd-symmetric", () => {
    const n = 4096;
    for (const drive of [0, 40, 100]) {
      const c = buildDistortionCurve(drive, n);
      for (let i = 0; i < n; i++) {
        expect(Math.abs(c[i])).toBeLessThanOrEqual(1);
        if (i > 0) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      }
      for (let d = 1; d < 1000; d += 97) {
        expect(c[n / 2 + d] + c[n / 2 - 1 - d]).toBeCloseTo(0, 6);
      }
    }
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

describe("rampGain — fallback without cancelAndHoldAtTime", () => {
  it("@us US19: a same-instant wet pin survives and is not overridden by a stale param.value anchor", () => {
    const ctx = new AudioContext();
    ctx._currentTime = 2.0;
    const node = ctx.createGain();
    const param = node.gain;
    param.cancelAndHoldAtTime = undefined; // older engine
    param.value = 0.8; // stale pre-pin value
    param.setValueAtTime(0, ctx.currentTime); // caller's duck pin
    const before = param.scheduledValues.length;
    rampGain(param, 0.5, ctx, 0.02);
    const added = param.scheduledValues.slice(before);
    const cancel = added.find((e) => e.type === "cancel");
    // Cancel starts strictly AFTER now, so an event at exactly now survives.
    expect(cancel.time).toBeGreaterThan(ctx.currentTime);
    // No re-anchor to the stale value at `now`.
    expect(
      added.some((e) => e.type === "setValue" && e.time === ctx.currentTime)
    ).toBe(false);
    expect(added.at(-1).type).toBe("setTarget");
  });
});

describe("rampGain — US19 (delay feedback clamping foundation)", () => {
  it("@us US19: schedules setTargetAtTime on the given param", () => {
    const ctx = new AudioContext();
    const node = ctx.createGain();
    rampGain(node.gain, 0.5, ctx, 0.05);
    expect(node.gain.value).toBe(0.5);
    // Non-zero target: only the smooth setTargetAtTime — no hard pin.
    const events = node.gain.scheduledValues;
    expect(events.at(-1).type).toBe("setTarget");
    expect(events.at(-1).target).toBe(0.5);
    expect(events.at(-1).tau).toBe(0.05);
    expect(events.filter((e) => e.type === "setValue")).toHaveLength(0);
  });

  it("@us US19: gracefully no-ops on missing param or ctx", () => {
    expect(() => rampGain(null, 0.5, null)).not.toThrow();
  });

  it("@us US19 (A5): a target of exactly 0 is pinned to silence after 5τ", () => {
    // A5 — setTargetAtTime is exponential-asymptotic and never lands at 0
    // (~5% of the original level remains after one τ). For target === 0
    // rampGain follows up with a setValueAtTime(0, now + 5τ) so the gain
    // actually hits the floor — eliminating residual signal at crossfader
    // extremes / effect bypass.
    const ctx = new AudioContext();
    ctx._currentTime = 1.0;
    const node = ctx.createGain();
    rampGain(node.gain, 0, ctx, 0.04);
    const events = node.gain.scheduledValues;
    // Last event is the hard pin at 5τ in the future.
    const last = events.at(-1);
    expect(last.type).toBe("setValue");
    expect(last.value).toBe(0);
    expect(last.time).toBeCloseTo(1.0 + 5 * 0.04, 6);
    // The smooth glide is still scheduled first.
    const setTarget = events.find((e) => e.type === "setTarget");
    expect(setTarget).toBeTruthy();
    expect(setTarget.target).toBe(0);
  });

  // @us US19 (W1 R20) — rampGain to 0 used to leave a setValueAtTime(0, now+5τ)
  // pin queued in the future. A subsequent rampGain(param, nonZero) within
  // that window (rapidly toggling reverb on→off→on) saw the stale pin fire
  // mid-ramp-up and audibly slam the param to 0. Fix: every rampGain call now
  // begins with cancelAndHoldAtTime(now) (or the cancelScheduledValues +
  // setValueAtTime fallback) so the new ramp cleanly supersedes the old.
  // Regression assertion: after rampGain(param, 0) → rampGain(param, 0.5),
  // the second call emitted a cancel before its setTarget. The mock's queue
  // records every call verbatim (it can't simulate the engine's
  // drop-future-events behavior on cancel), so the contract under test is
  // "did we issue the cancel signal that hands ownership to the new ramp."
  // The real engine drops the stale 0-pin once cancelAndHoldAtTime fires.
  it("@us US19 (W1 R20): a second ramp issues cancelAndHold before its setTarget so the prior zero-pin is dropped", () => {
    const ctx = new AudioContext();
    ctx._currentTime = 1.0;
    const node = ctx.createGain();
    // First call: ramp to 0 — queues a setValueAtTime(0, now+5τ) pin.
    rampGain(node.gain, 0, ctx, 0.02);
    // Snapshot the queue at the boundary — anything appended after this
    // belongs to the second rampGain call.
    const beforeSecondCall = node.gain.scheduledValues.length;

    // Second call lands immediately after — must cancel the stale pin first.
    rampGain(node.gain, 0.5, ctx, 0.02);

    const appended = node.gain.scheduledValues.slice(beforeSecondCall);
    // The second call's very first appended event is the cancel — proof the
    // engine was told to drop pending future events before the new ramp
    // starts. Without the W1 fix the second call would jump straight to
    // setTarget and the first call's zero-pin would slam the gain at 1.10.
    const cancelIdx = appended.findIndex(
      (e) => e.type === "cancelAndHold" || e.type === "cancel"
    );
    expect(cancelIdx).toBe(0);
    // And the new setTarget is queued AFTER the cancel, with the new target.
    const setTargetIdx = appended.findIndex((e) => e.type === "setTarget");
    expect(setTargetIdx).toBeGreaterThan(cancelIdx);
    expect(appended[setTargetIdx].target).toBe(0.5);
    // The second call (target 0.5, non-zero) must NOT itself append another
    // setValueAtTime(0, …) pin — that's the 5τ floor only for target=0.
    const ownZeroPin = appended.find(
      (e) => e.type === "setValue" && e.value === 0
    );
    expect(ownZeroPin).toBeUndefined();
  });
});
