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
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// Soft-clip distortion curve. `drive` in [0, 100].
export function buildDistortionCurve(drive = 40, samples = 4096) {
  const curve = new Float32Array(samples);
  const k = Math.max(0, drive);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Smoothly ramp a gain AudioParam toward target. tau in seconds.
export function rampGain(param, target, ctx, tau = 0.02) {
  if (!param || !ctx) return;
  param.setTargetAtTime(target, ctx.currentTime, tau);
}

// Hard-clamp helper.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
