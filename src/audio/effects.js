// Generate a synthetic stereo reverb impulse response — zero network, no asset load.
// Decaying noise. `decay` shapes the tail: higher = shorter tail.
export function buildReverbIR(audioContext, durationSec = 2.0, decay = 3.0) {
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
