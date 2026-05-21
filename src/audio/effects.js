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
//
// A5 — `setTargetAtTime` is an exponential asymptote: it approaches target but
// never lands. For target === 0 (crossfader fully out, effect bypassed, etc.)
// that residual is audible: ~5% of signal still passes after one τ and only
// decays from there. To actually reach silence, chase the asymptote with a
// hard `setValueAtTime(0, t + 5τ)` once the natural curve has decayed to
// ~0.7% — far enough below audibility that the pin is inaudible while still
// nailing the floor exactly. Non-zero targets keep the original smooth curve
// so volume / mix adjustments stay glitch-free.
export function rampGain(param, target, ctx, tau = 0.02) {
  if (!param || !ctx) return;
  const now = ctx.currentTime;
  param.setTargetAtTime(target, now, tau);
  if (target === 0) {
    param.setValueAtTime(0, now + 5 * tau);
  }
}

// Hard-clamp helper.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
