// Compute gain coefficients for crossfader position x in [0, 1].
//
// Curves:
//   equal-power     — cos(x·π/2) / sin(x·π/2). Constant perceived loudness through
//                     uncorrelated signals. The classic DJ default.
//   linear          — 1-x / x. Sums to 1.0 amplitude (highly correlated signals can
//                     phase-cancel at center). Useful for stems and same-track mixing.
//   constant-power  — sqrt(1-x) / sqrt(x). 3 dB drop at center. Bright, present.
export function crossfadeGains(x, curve = "equal-power") {
  const clamped = Math.max(0, Math.min(1, x));
  switch (curve) {
    case "linear":
      return { gainA: 1 - clamped, gainB: clamped };
    case "constant-power-3db":
      return { gainA: Math.sqrt(1 - clamped), gainB: Math.sqrt(clamped) };
    case "equal-power":
    default:
      return {
        gainA: Math.cos((clamped * Math.PI) / 2),
        gainB: Math.sin((clamped * Math.PI) / 2),
      };
  }
}

// W3.8 — crossfader-assign gain for a single deck. With three decks the
// crossfader stays a two-ended control; each deck instead carries an assign:
//   "A"    — follow the crossfader's A-side curve (today's Deck A behavior)
//   "B"    — follow the B-side curve (today's Deck B behavior)
//   "THRU" — bypass the crossfader entirely: multiplier is exactly 1.0, the
//            deck is volume-fader-only and stays audible at any fader position
// The A/B legs reuse crossfadeGains verbatim so the audited two-deck math is
// untouched.
export const CROSSFADE_ASSIGNS = ["A", "THRU", "B"];

export function assignGain(x, curve, assign) {
  if (assign === "THRU") return 1;
  const { gainA, gainB } = crossfadeGains(x, curve);
  return assign === "B" ? gainB : gainA;
}
