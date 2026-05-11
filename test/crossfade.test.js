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
