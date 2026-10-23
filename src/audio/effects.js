// A5 — pick a decay exponent that scales modestly with IR duration. The decay
// exponent shapes the tail of `(1-t)^decay` across the buffer: a fixed value
// means a longer buffer still decays to silence just as fast (in fractional
// terms), so a "large" reverb sounds no longer than a small one. Scaling the
// exponent DOWN as duration grows gives a genuinely longer-sustaining tail for
// a bigger SIZE. Tuned around the previous fixed 3.0 at the ~2 s default.
export function reverbDecayForDuration(durationSec) {
  // ~4.0 at 0.5 s … ~3.0 at 2 s … ~1.8 at 5 s. Clamped so the tail never
  // becomes non-decaying or unnaturally abrupt.
  return clamp(3.6 - 0.36 * durationSec, 1.6, 4.2);
}

// Generate a synthetic stereo reverb impulse response — zero network, no asset load.
// Decaying noise. `decay` shapes the tail: higher = shorter tail. If `decay`
// is omitted, it is derived from `durationSec` via reverbDecayForDuration so a
// larger SIZE yields a genuinely longer tail (A5).
//
// A4 — each channel is peak-normalised to unit amplitude. Without this the
// total RMS of the IR scales with `length` (longer buffer = more samples
// summed by the convolver = louder wet signal), so cranking SIZE made the wet
// signal louder rather than just longer. Peak-normalising per channel pins the
// loudness so SIZE controls tail length only.
export function buildReverbIR(
  audioContext,
  durationSec = 2.0,
  decay = reverbDecayForDuration(durationSec)
) {
  const sr = audioContext.sampleRate;
  const length = Math.max(1, Math.floor(sr * durationSec));
  const buf = audioContext.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      data[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    // Guard against the (vanishingly unlikely) all-zero channel.
    if (peak > 0) {
      const inv = 1 / peak;
      for (let i = 0; i < length; i++) data[i] *= inv;
    }
  }
  return buf;
}

// Soft-clip distortion curve. `drive` in [0, 100].
//
// Shape is tanh(a*x) with a = 1 + drive/20: odd-symmetric, monotonic, and
// bounded inside [-1, 1] on the WaveShaper's input domain.
//
// Level: a bare tanh(a*x)/a has unity small-signal gain but caps its output at
// 1/a, so DRIVE turned loud material DOWN (-9.5 dBFS ceiling at drive 40,
// -15.6 at drive 100; measured -2 to -12 dB on hot/dense program). The earlier
// rational curve went the other way (+13.6 dB at drive 40). We now add makeup
// so a loud reference level passes through at the same level at every drive:
// the curve is scaled by a*X_REF/tanh(a*X_REF), so an input of X_REF (0.4,
// about -8 dBFS peak) maps to itself. 0.4 balances the two failure modes: a
// pure sine at -3 dBFS still loses ~2.5 dB at drive 100 (tanh flattens its
// peaks) while a high-crest multi-tone gains ~2.6 dB (its small-signal gain
// dominates); a larger X_REF would push the dense case past +3 dB. Consequence: quiet passages gain up to
// a*X_REF/tanh(a*X_REF) of small-signal gain (about +7.7 dB at drive 100),
// which is what a distortion's DRIVE is expected to do, and drive 0 is within
// 0.5 dB of unity. Loud material (peaks at or above X_REF) stays near its
// original level instead of collapsing.
const DISTORTION_X_REF = 0.4;
// `samples` is clamped to >= 2: the x grid divides by (N-1), so N = 1 (and 0 /
// negative / NaN) would yield NaN. Two points is the smallest curve that still
// spans [-1, 1]. Non-finite input falls back to the 4096 default.
export function buildDistortionCurve(drive = 40, samples = 4096) {
  samples = Number.isFinite(samples) ? Math.max(2, Math.floor(samples)) : 4096;
  const curve = new Float32Array(samples);
  const k = Math.max(0, drive);
  const a = 1 + k / 20;
  const makeup = (a * DISTORTION_X_REF) / Math.tanh(a * DISTORTION_X_REF);
  for (let i = 0; i < samples; i++) {
    // WaveShaper reads index (N-1)(x+1)/2, so x must span [-1, 1] over N-1
    // steps; the integer numerator keeps curve[i] === -curve[N-1-i] exactly.
    const x = (2 * i - (samples - 1)) / (samples - 1);
    curve[i] = (Math.tanh(a * x) / a) * makeup;
  }
  return curve;
}

// Smoothly ramp a gain AudioParam toward target. tau in seconds.
//
// A5 — `setTargetAtTime` is an exponential asymptote: it approaches target but
// never lands. For target === 0 (crossfader fully out, effect bypassed, etc.)
// that residual is audible: ~5% of signal still passes after one τ and only
// decays from there. To actually reach silence, chase the asymptote with a
// hard `setValueAtTime(0, t + 5τ)` once the natural curve has decayed to
// ~0.7% — far enough below audibility that the pin is inaudible while still
// nailing the floor exactly. Non-zero targets keep the original smooth curve
// so volume / mix adjustments stay glitch-free.
//
// W1 (R20) — every call begins by cancelling any pending future events on the
// param so a new ramp cleanly supersedes the previous one. Without this, a
// prior `rampGain(param, 0)` left a `setValueAtTime(0, now + 5τ)` pin queued
// in the future. A subsequent `rampGain(param, nonZero)` within that window
// (e.g. rapidly toggling an effect on→off→on) used to slam the param to 0
// mid-ramp-up when the stale pin fired. Cancel-and-hold (or its
// cancelScheduledValues + setValueAtTime fallback) freezes whatever value the
// existing automation is currently producing, drops all future events, and
// hands the schedule over to the new ramp.
export function rampGain(param, target, ctx, tau = 0.02) {
  if (!param || !ctx) return;
  const now = ctx.currentTime;
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    // Fallback for engines without cancelAndHoldAtTime. Cancel from just
    // AFTER `now` so a caller's same-instant pin (setValueAtTime(0, now), used
    // to duck the wet path before an IR / curve swap) survives, and do NOT
    // re-anchor with `param.value` — that is still the pre-pin value and, being
    // scheduled later at the same time, would override the pin. The new
    // setTargetAtTime starts from whatever the surviving timeline yields.
    param.cancelScheduledValues(now + 1e-6);
  }
  param.setTargetAtTime(target, now, tau);
  if (target === 0) {
    param.setValueAtTime(0, now + 5 * tau);
  }
}

// Hard-clamp helper.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
