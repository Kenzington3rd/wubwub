// W3.1 — granular (windowed overlap-add) time-stretch core.
//
// Pure, engine-free DSP so it can be unit-tested and shared verbatim by the
// stretch worklet (src/worklets/stretch-worklet.js) and any offline render.
// WSOLA-class, deliberately NOT a phase vocoder — CPU headroom on mobile is
// the binding constraint (see BACKLOG W3.1).
//
// Model:
//   - Output is synthesized in grains of GRAIN samples with 50% overlap
//     (hop OUT = GRAIN/2), each windowed by a Hann window.
//   - Grain N is READ from the input at position N × hopOut × rate — so
//     rate > 1 plays faster (grains sample the input further apart) and
//     rate < 1 slower, while each grain itself plays at its natural pitch.
//   - Independent pitch shift: grains are read through a linear-interp
//     resampler at pitchRatio (2^(semitones/12)); rate and pitchRatio are
//     fully independent knobs (keylock = rate ≠ 1, pitchRatio = 1).

export const GRAIN_SIZE = 4096;
export const HOP_OUT = GRAIN_SIZE / 2;

export function hannWindow(n = GRAIN_SIZE) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export function semitonesToRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

// Read `count` samples from `input` starting at fractional `pos`, resampled
// by `pitchRatio` with linear interpolation. Out-of-range reads are 0.
export function readGrain(input, pos, count, pitchRatio, out) {
  const dst = out || new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = pos + i * pitchRatio;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const a = i0 >= 0 && i0 < input.length ? input[i0] : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < input.length ? input[i0 + 1] : 0;
    dst[i] = a + (b - a) * frac;
  }
  return dst;
}

// Offline stretch of a whole channel. Returns a new Float32Array of length
// ≈ input.length / rate. `rate` > 0 (1 = original tempo); `pitchRatio` > 0
// (1 = original pitch). The 50% Hann overlap-add sums to unity gain, so no
// makeup normalization is needed.
export function stretchChannel(input, rate, pitchRatio = 1, grainSize = GRAIN_SIZE) {
  const hopOut = grainSize / 2;
  const outLength = Math.max(grainSize, Math.round(input.length / rate));
  const out = new Float32Array(outLength);
  const win = hannWindow(grainSize);
  const grain = new Float32Array(grainSize);
  const grainCount = Math.ceil((outLength - grainSize) / hopOut) + 1;
  for (let g = 0; g < grainCount; g++) {
    const outPos = g * hopOut;
    const readPos = outPos * rate;
    readGrain(input, readPos, grainSize, pitchRatio, grain);
    const n = Math.min(grainSize, outLength - outPos);
    for (let i = 0; i < n; i++) {
      out[outPos + i] += grain[i] * win[i];
    }
  }
  return out;
}
