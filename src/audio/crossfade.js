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
