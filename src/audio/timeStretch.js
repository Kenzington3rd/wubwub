// W3.1 — WSOLA time-stretch core.
//
// Pure, engine-free DSP so it can be unit-tested and shared verbatim by the
// stretch worklet (src/worklets/stretch-worklet.js) and any offline render.
// WSOLA, deliberately NOT a phase vocoder — CPU headroom on mobile is the
// binding constraint (see BACKLOG W3.1).
//
// Model:
//   - Output is synthesized in grains of GRAIN samples at 75% overlap
//     (hop OUT = GRAIN/4), each windowed by a periodic Hann window scaled by
//     OLA_GAIN so the four overlapping windows sum to exactly 1.
//   - Grain N is NOMINALLY read from the input at N × hopOut × rate — so
//     rate > 1 plays faster (grains sample the input further apart) and
//     rate < 1 slower, while each grain itself plays at its natural pitch.
//   - Waveform-similarity alignment (the "WS" in WSOLA): plain OLA lands
//     each grain at an arbitrary phase relative to the one it overlaps, so
//     the overlap comb-filters at the grain rate (measured ~11–16 dB of AM on
//     a 440 Hz sine, and every transient printed twice ~2.8 ms apart). Before
//     overlap-adding, the grain's start is nudged within ±SEARCH samples of
//     its nominal position to the offset whose opening CORR_LEN samples best
//     match the natural continuation of the previous grain (normalized
//     cross-correlation, coarse-to-fine). Candidates lie on the natural
//     continuation's sub-sample grid, so the winning grain is interpolated
//     at the same fraction as the one it overlaps. The nudge never accumulates: the
//     next grain's nominal position still comes from N × hopOut × rate, so
//     tempo is exact over time. At rate 1 / pitch 1 the natural continuation
//     IS the nominal position, the search is skipped and the output equals
//     the input in the steady state.
//   - Independent pitch shift: grains are read through a linear-interp
//     resampler at pitchRatio (2^(semitones/12)); rate and pitchRatio are
//     fully independent knobs (keylock = rate ≠ 1, pitchRatio = 1).

export const GRAIN_SIZE = 2048; // 46 ms @ 44.1 kHz
export const HOP_OUT = GRAIN_SIZE / 4; // 75% overlap
// Four periodic-Hann windows at hop N/4 sum to 2 → scale each by ½.
export const OLA_GAIN = (2 * HOP_OUT) / GRAIN_SIZE;
// Alignment search radius in output samples (±8.7 ms @ 44.1 kHz). Wide
// enough to phase-align anything down to ~57 Hz (half a period), narrow
// enough that the timing jitter it introduces stays below audibility.
export const SEARCH = 384;
// Correlate the candidate grain's first half against the continuation.
export const CORR_LEN = GRAIN_SIZE - HOP_OUT;
// Coarse pass decimation (box-summed blocks). SEARCH and CORR_LEN must be
// multiples of it.
const DECIM = 4;

// Periodic Hann (denominator n, not n − 1) — the form whose shifted copies
// sum to a constant, so OLA has no gain ripple.
export function hannWindow(n = GRAIN_SIZE) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
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

// WSOLA alignment search. `ref` holds the natural continuation of the
// previous grain (corrLen samples); `region` holds the candidate material
// starting `search` samples BEFORE the nominal grain start (corrLen + 2 ×
// search samples). Returns the lag in [−search, search] (output samples)
// that maximizes ref·cand / ‖cand‖. Ties — including all-silence — keep lag
// 0, so silence and perfectly-continuous material never get nudged.
// `scratch` (optional) avoids per-call allocation: { refD, regD }.
export function findBestLag(ref, region, corrLen = CORR_LEN, search = SEARCH, scratch) {
  const nRefD = corrLen / DECIM;
  const nRegD = (corrLen + 2 * search) / DECIM;
  const refD = scratch?.refD || new Float32Array(nRefD);
  const regD = scratch?.regD || new Float32Array(nRegD);
  for (let j = 0; j < nRefD; j++) {
    const k = j * DECIM;
    refD[j] = ref[k] + ref[k + 1] + ref[k + 2] + ref[k + 3];
  }
  for (let j = 0; j < nRegD; j++) {
    const k = j * DECIM;
    regD[j] = region[k] + region[k + 1] + region[k + 2] + region[k + 3];
  }
  const EPS = 1e-12;
  // Coarse: lags in steps of DECIM on the box-summed signals. Running energy
  // of the candidate window is updated incrementally.
  const centreD = search / DECIM;
  let energy = 0;
  for (let j = 0; j < nRefD; j++) energy += regD[j] * regD[j];
  let bestD = centreD;
  let bestScore = -Infinity;
  const nLagsD = 2 * centreD + 1;
  const scores = scratch?.scores || new Float64Array(nLagsD);
  for (let o = 0; o < nLagsD; o++) {
    if (o > 0) {
      const out = regD[o - 1];
      const inn = regD[o + nRefD - 1];
      energy += inn * inn - out * out;
    }
    let c = 0;
    for (let j = 0; j < nRefD; j++) c += refD[j] * regD[o + j];
    scores[o] = c / Math.sqrt(Math.max(energy, 0) + EPS);
  }
  // Prefer the nominal position on ties: start from it, replace only on a
  // strictly better score.
  bestScore = scores[centreD];
  for (let o = 0; o < nLagsD; o++) {
    if (scores[o] > bestScore * (1 + 1e-9) + 1e-12) {
      bestScore = scores[o];
      bestD = o;
    }
  }
  // Fine: full resolution around the coarse winner, against the full-res
  // score at the nominal position.
  const fullScore = (off) => {
    let c = 0;
    let e = 0;
    for (let j = 0; j < corrLen; j++) {
      const v = region[off + j];
      c += ref[j] * v;
      e += v * v;
    }
    return c / Math.sqrt(e + EPS);
  };
  let bestOff = search;
  let best = fullScore(search);
  const lo = Math.max(0, bestD * DECIM - (DECIM - 1));
  const hi = Math.min(2 * search, bestD * DECIM + (DECIM - 1));
  for (let off = lo; off <= hi; off++) {
    if (off === search) continue;
    const s = fullScore(off);
    if (s > best * (1 + 1e-9) + 1e-12) {
      best = s;
      bestOff = off;
    }
  }
  return bestOff - search;
}

// Offline stretch of a whole channel. Returns a new Float32Array of length
// ≈ input.length / rate. `rate` > 0 (1 = original tempo); `pitchRatio` > 0
// (1 = original pitch). The 75% periodic-Hann overlap-add (× OLA_GAIN) sums
// to exactly unity gain, so no makeup normalization is needed.
export function stretchChannel(input, rate, pitchRatio = 1, grainSize = GRAIN_SIZE) {
  const hopOut = grainSize / 4;
  const gain = (2 * hopOut) / grainSize;
  const corrLen = grainSize - hopOut;
  // SEARCH is ¾ of the default hop; smaller grains scale it down (multiple
  // of DECIM so the coarse pass lands on the nominal position).
  const search = Math.floor(Math.min(SEARCH, (3 * hopOut) / 4) / DECIM) * DECIM;
  const outLength = Math.max(grainSize, Math.round(input.length / rate));
  const out = new Float32Array(outLength);
  const win = hannWindow(grainSize);
  const grain = new Float32Array(grainSize);
  const ref = new Float32Array(corrLen);
  const region = new Float32Array(corrLen + 2 * search);
  const scratch = {
    refD: new Float32Array(corrLen / DECIM),
    regD: new Float32Array((corrLen + 2 * search) / DECIM),
    scores: new Float64Array((2 * search) / DECIM + 1),
  };
  const grainCount = Math.ceil((outLength - grainSize) / hopOut) + 1;
  let prevActual = null;
  for (let g = 0; g < grainCount; g++) {
    const outPos = g * hopOut;
    const nominal = outPos * rate;
    let actual = nominal;
    if (prevActual !== null) {
      const natural = prevActual + hopOut * pitchRatio;
      if (Math.abs(natural - nominal) > 1e-9 && search > 0) {
        // Search on the natural continuation's sub-sample grid (natural +
        // m × pitchRatio, the point nearest the nominal start). Candidates on
        // the nominal grid sit at a different fractional position than the
        // grain they overlap whenever hopOut × rate is non-integer, so the
        // interpolation differs and high frequencies never line up (white
        // noise lost ~2.5 dB, its HF band ~4 dB, at rates 0.9–1.3).
        const base =
          pitchRatio === 1
            ? natural + Math.round(nominal - natural)
            : natural + Math.round((nominal - natural) / pitchRatio) * pitchRatio;
        readGrain(input, natural, corrLen, pitchRatio, ref);
        readGrain(input, base - search * pitchRatio, region.length, pitchRatio, region);
        actual = base + findBestLag(ref, region, corrLen, search, scratch) * pitchRatio;
      } else {
        actual = natural;
      }
    }
    prevActual = actual;
    readGrain(input, actual, grainSize, pitchRatio, grain);
    const n = Math.min(grainSize, outLength - outPos);
    for (let i = 0; i < n; i++) {
      out[outPos + i] += grain[i] * win[i] * gain;
    }
  }
  return out;
}
