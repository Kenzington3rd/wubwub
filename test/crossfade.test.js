import { describe, it, expect } from "vitest";
import { crossfadeGains } from "../src/audio/crossfade.js";

describe("crossfadeGains — US7, US35", () => {
  it("@us US7: equal-power at center is √2/2 ≈ 0.707 on both decks", () => {
    const { gainA, gainB } = crossfadeGains(0.5, "equal-power");
    expect(gainA).toBeCloseTo(Math.SQRT1_2, 4);
    expect(gainB).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it("@us US7: equal-power at x=0 is fully Deck A; at x=1 fully Deck B", () => {
    const left = crossfadeGains(0, "equal-power");
    const right = crossfadeGains(1, "equal-power");
    expect(left.gainA).toBeCloseTo(1, 5);
    expect(left.gainB).toBeCloseTo(0, 5);
    expect(right.gainA).toBeCloseTo(0, 5);
    expect(right.gainB).toBeCloseTo(1, 5);
  });

  it("@us US7: equal-power preserves total power (a² + b² ≈ 1) across the sweep", () => {
    for (let x = 0; x <= 1; x += 0.05) {
      const { gainA, gainB } = crossfadeGains(x, "equal-power");
      expect(gainA * gainA + gainB * gainB).toBeCloseTo(1, 4);
    }
  });

  it("@us US35: linear curve sums to 1.0 amplitude at center", () => {
    const { gainA, gainB } = crossfadeGains(0.5, "linear");
    expect(gainA + gainB).toBeCloseTo(1, 5);
    expect(gainA).toBeCloseTo(0.5, 5);
    expect(gainB).toBeCloseTo(0.5, 5);
  });

  it("@us US35: constant-power-3dB drops 3 dB at center (sqrt curve)", () => {
    const { gainA, gainB } = crossfadeGains(0.5, "constant-power-3db");
    expect(gainA).toBeCloseTo(Math.SQRT1_2, 4);
    expect(gainB).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it("@us US7: out-of-range input is clamped to [0, 1]", () => {
    const low = crossfadeGains(-0.5, "equal-power");
    const high = crossfadeGains(1.5, "equal-power");
    expect(low.gainA).toBeCloseTo(1, 5);
    expect(low.gainB).toBeCloseTo(0, 5);
    expect(high.gainA).toBeCloseTo(0, 5);
    expect(high.gainB).toBeCloseTo(1, 5);
  });

  it("@us US7: unknown curve falls back to equal-power (sensible default)", () => {
    const result = crossfadeGains(0.5, "bogus-curve-name");
    const ep = crossfadeGains(0.5, "equal-power");
    expect(result.gainA).toBeCloseTo(ep.gainA);
    expect(result.gainB).toBeCloseTo(ep.gainB);
  });
});

// ─── W3.8 — crossfader assign (US65) ───
import { assignGain, CROSSFADE_ASSIGNS } from "../src/audio/crossfade.js";

describe("assignGain — US65 (three-deck crossfader assign)", () => {
  it("@us US65: THRU is exactly 1.0 at every fader position and curve", () => {
    for (const curve of ["equal-power", "linear", "constant-power-3db"]) {
      for (let x = 0; x <= 1; x += 0.1) {
        expect(assignGain(x, curve, "THRU")).toBe(1);
      }
    }
  });

  it("@us US65: the A and B legs match crossfadeGains verbatim", () => {
    for (const curve of ["equal-power", "linear", "constant-power-3db"]) {
      for (let x = 0; x <= 1; x += 0.05) {
        const { gainA, gainB } = crossfadeGains(x, curve);
        expect(assignGain(x, curve, "A")).toBeCloseTo(gainA, 10);
        expect(assignGain(x, curve, "B")).toBeCloseTo(gainB, 10);
      }
    }
  });

  it("@us US65: an unknown assign falls back to the A side (defensive)", () => {
    expect(assignGain(0, "equal-power", "bogus")).toBeCloseTo(1, 5);
  });

  it("@us US65: CROSSFADE_ASSIGNS enumerates the three positions in UI order", () => {
    expect(CROSSFADE_ASSIGNS).toEqual(["A", "THRU", "B"]);
  });
});
