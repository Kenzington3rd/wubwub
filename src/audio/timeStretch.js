// W3.1 — WSOLA time-stretch core.
//
// Pure, engine-free DSP so it can be unit-tested and shared verbatim by the
// stretch worklet (src/worklets/stretch-worklet.js) and any offline render.
// WSOLA, deliberately NOT a phase vocoder — CPU headroom on mobile is the
// binding constraint (see BACKLOG W3.1).
//
// Model:
//   - Output is synthesized in grains of defaultGrainSize(sampleRate)
//     samples (2048 at 44.1 / 48 kHz, 4096 at 88.2 / 96 kHz — ~43–46 ms at
//     44.1 / 48 / 88.2 / 96 / 176.4 / 192 kHz; the power-of-two step gives
//     64 ms at 32 or 64 kHz and 85–93 ms at 22.05 / 24 kHz) at 75% overlap
//     (hop OUT = grain/4), each windowed by a periodic Hann window scaled by
//     OLA_GAIN so the four overlapping windows sum to exactly 1.
//   - Grain N is NOMINALLY read from the input at N × hopOut × rate — so
//     rate > 1 plays faster (grains sample the input further apart) and
//     rate < 1 slower, while each grain itself plays at its natural pitch.
//   - Waveform-similarity alignment (the "WS" in WSOLA): plain OLA lands
//     each grain at an arbitrary phase relative to the one it overlaps, so
//     the overlap comb-filters at the grain rate (measured ~11–16 dB of AM on
//     a 440 Hz sine, and every transient printed twice ~2.8 ms apart). Before
//     overlap-adding, the grain's start is nudged within ±searchRadius() of
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

export const GRAIN_SIZE = 2048; // 46 ms @ 44.1 kHz — the 44.1 / 48 kHz grain
export const HOP_OUT = GRAIN_SIZE / 4; // 75% overlap
// Four periodic-Hann windows at hop N/4 sum to 2 → scale each by ½.
export const OLA_GAIN = (2 * HOP_OUT) / GRAIN_SIZE;
// Alignment search radius. It must reach half a period of the lowest
// frequency that should stay keylocked: below that, no candidate one period
// away lies inside ±search, the lag sticks at the search edge every grain and
// the tone comes out at f0 × rate (a 55 Hz sub at +4% played 68 cents sharp
// when the radius was a fixed 384 samples, whose cutoff moved with the sample
// rate: ~57 Hz at 44.1 kHz, ~62 Hz at 48 kHz, ~125 Hz at 96 kHz). So the
// radius is defined in TIME — half the period of 40 Hz (12.5 ms) — giving
// 552 / 600 / 1200 samples at 44.1 / 48 / 96 kHz: keylocked down to ~40 Hz
// at any rate. SEARCH_FLOOR (384, the old fixed value) is the floor for
// low-rate contexts; searchRadius(sr) is the actual radius (the worklet's
// SEARCH). Multiple of coarseDecimation() so the coarse pass lands on lag 0.
export const SEARCH_FLOOR = 384;
export function searchRadius(sampleRate = 44100) {
  const d = coarseDecimation(sampleRate);
  return Math.max(SEARCH_FLOOR, d * Math.ceil(sampleRate / 80 / d));
}
// Correlate the candidate grain's first half against the continuation.
export const CORR_LEN = GRAIN_SIZE - HOP_OUT;
// Coarse pass decimation (box-summed blocks) at 44.1 / 48 kHz. The search
// radius and CORR_LEN must be multiples of the decimation in use.
export const DECIM = 4;
// The radius is fixed in TIME, so in samples it grows with the rate, and the
// coarse pass (one candidate per `decim` samples of lag, each a dot product
// of CORR_LEN / decim box sums) grew with it: at 96 kHz twice the grains per
// second × twice the candidates put a stereo KEYLOCK deck at ~10% of a core.
// Decimating in proportion to the rate keeps the coarse candidate count
// ~flat (277 / 301 / 301 at 44.1 / 48 / 96 kHz) and the box sum the same
// length in TIME (a 4-sample box at 44.1 kHz ≈ an 8-sample box at 96 kHz,
// both nulling at ~11–12 kHz), so the coarse pass sees the same signal.
// The fine pass still refines at full resolution within ±(decim − 1) of the
// coarse winner, so the chosen lag is exact. Power of two, so it divides
// CORR_LEN (1536) and the 384 floor.
export function coarseDecimation(sampleRate = 44100) {
  return DECIM * 2 ** Math.max(0, Math.round(Math.log2(sampleRate / 44100)));
}
// Grain size at a context rate: scales with the decimation (2048 at 44.1 /
// 48 kHz, 4096 at 88.2 / 96 kHz, 8192 at 192 kHz) so a grain spans ~43–46 ms
// at 44.1 / 48 / 88.2 / 96 / 176.4 / 192 kHz (the power-of-two step gives 64 ms
// at 32 or 64 kHz and 85–93 ms at 22.05 / 24 kHz). A fixed 2048 was 21 ms at
// 96 kHz while the radius (fixed in time) spanned 2.3 hops instead of ~1.1, so
// grains re-read transients and short kicks played twice (39 of 556 at 96 kHz;
// now 9 of 556).
export function defaultGrainSize(sampleRate = 44100) {
  return (GRAIN_SIZE * coarseDecimation(sampleRate)) / DECIM;
}
// Coarse candidates evaluated per grain search at a context rate.
export function coarseCandidates(sampleRate = 44100) {
  return (2 * searchRadius(sampleRate)) / coarseDecimation(sampleRate) + 1;
}

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
// starting `search + decim` samples BEFORE the nominal grain start (corrLen +
// 2 × (search + decim) samples — `decim` frames of padding on each side).
// Returns the lag in [−(search + decim − 1), search + decim − 1] (output
// samples) that maximizes ref·cand / ‖cand‖. The padding lets the fine pass
// refine past a coarse winner at ±search: on an exactly periodic tone the
// coarse scores tie, the first (−search) wins, and the true peak can sit
// just outside — clamped there, every grain of a 3 kHz sine at 96 kHz
// (rate 0.94) came out 22.5–33.75° off. Ties — including all-silence — keep lag
// 0, so silence and perfectly-continuous material never get nudged.
// `scratch` (optional) avoids per-call allocation: { refD, regD, scores };
// when given, its `coarse` field counts the coarse candidates evaluated.
// `decim` is the coarse decimation (coarseDecimation(); corrLen and search
// must be multiples of it).
export function findBestLag(ref, region, corrLen = CORR_LEN, search = SEARCH_FLOOR, scratch, decim = DECIM) {
  const nRefD = corrLen / decim;
  const nRegD = (corrLen + 2 * search) / decim;
  const refD = scratch?.refD || new Float32Array(nRefD);
  const regD = scratch?.regD || new Float32Array(nRegD);
  for (let j = 0; j < nRefD; j++) {
    const k = j * decim;
    let v = 0;
    for (let i = 0; i < decim; i++) v += ref[k + i];
    refD[j] = v;
  }
  for (let j = 0; j < nRegD; j++) {
    const k = j * decim;
    let v = 0;
    for (let i = 0; i < decim; i++) v += region[decim + k + i];
    regD[j] = v;
  }
  const EPS = 1e-12;
  // Coarse: lags in steps of `decim` on the box-summed signals. Running
  // energy of the candidate window is updated incrementally.
  const centreD = search / decim;
  let energy = 0;
  for (let j = 0; j < nRefD; j++) energy += regD[j] * regD[j];
  let bestD = centreD;
  let bestScore = -Infinity;
  const nLagsD = 2 * centreD + 1;
  if (scratch) scratch.coarse = (scratch.coarse || 0) + nLagsD;
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
      const v = region[decim + off + j];
      c += ref[j] * v;
      e += v * v;
    }
    return c / Math.sqrt(e + EPS);
  };
  let bestOff = search;
  let best = fullScore(search);
  const lo = bestD * decim - (decim - 1);
  const hi = bestD * decim + (decim - 1);
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
// (1 = original pitch). `sampleRate` is the rate of `input` (and of the
// output — the core never resamples) and sets the alignment search radius
// (searchRadius), coarse decimation (coarseDecimation) and, when
// `grainSize` is omitted, the grain (defaultGrainSize); it defaults to 44.1
// kHz — same API (default radius is now 552 at 44.1 kHz). The 75%
// periodic-Hann overlap-add (× OLA_GAIN) sums to exactly unity gain, so no
// makeup normalization is needed. `stats` (optional) receives
// { searches, coarse }: alignment searches run and coarse candidates
// evaluated in total (a cost probe for tests).
export function stretchChannel(input, rate, pitchRatio = 1, grainSize, sampleRate = 44100, stats) {
  grainSize ??= defaultGrainSize(sampleRate);
  const hopOut = grainSize / 4;
  const gain = (2 * hopOut) / grainSize;
  const corrLen = grainSize - hopOut;
  const decim = coarseDecimation(sampleRate);
  // Grains smaller than the rate's default scale the radius down in
  // proportion (multiple of decim so the coarse pass lands on the nominal
  // position).
  const search =
    Math.floor((searchRadius(sampleRate) * Math.min(1, grainSize / defaultGrainSize(sampleRate))) / decim) * decim;
  const outLength = Math.max(grainSize, Math.round(input.length / rate));
  const out = new Float32Array(outLength);
  const win = hannWindow(grainSize);
  const grain = new Float32Array(grainSize);
  const ref = new Float32Array(corrLen);
  const region = new Float32Array(corrLen + 2 * (search + decim));
  const scratch = {
    refD: new Float32Array(corrLen / decim),
    regD: new Float32Array((corrLen + 2 * search) / decim),
    scores: new Float64Array((2 * search) / decim + 1),
    coarse: 0,
  };
  let searches = 0;
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
        readGrain(input, base - (search + decim) * pitchRatio, region.length, pitchRatio, region);
        actual = base + findBestLag(ref, region, corrLen, search, scratch, decim) * pitchRatio;
        searches++;
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
  if (stats) {
    stats.searches = searches;
    stats.coarse = scratch.coarse;
  }
  return out;
}
