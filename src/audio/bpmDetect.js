// Autocorrelation-based BPM detection.
//
// Pipeline:
//   1. Offline-render the buffer through a low-pass filter (kick range, < 150 Hz)
//   2. Full-wave rectify and downsample to ~200 Hz envelope
//   3. Subtract mean (DC block)
//   4. Autocorrelate over lag range corresponding to [minBpm, maxBpm]
//   5. Pick highest peak → BPM = 60 / lag (in seconds)
//
// Returns { bpm, confidence } where confidence is the normalized peak strength.
// Confidence > 0.6 is reasonably trustworthy. Half-time / double-time errors are
// common for syncopated genres — the caller should expose a 2× / ½× nudge.
export async function detectBpm(audioBuffer, { minBpm = 70, maxBpm = 180 } = {}) {
  if (!audioBuffer) throw new Error("detectBpm: audioBuffer is required");

  const sr = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const Offline =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("OfflineAudioContext not supported");

  // Render through a lowpass at 150 Hz to isolate the kick. Use 1-channel offline ctx
  // to avoid wasted work; we'll read channel 0 only.
  const offline = new Offline(1, length, sr);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 150;
  src.connect(lp);
  lp.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);

  // Downsample to a ~200 Hz envelope by averaging absolute values.
  const targetSr = 200;
  const downFactor = Math.max(1, Math.floor(sr / targetSr));
  const downLen = Math.floor(data.length / downFactor);
  const env = new Float32Array(downLen);
  for (let i = 0; i < downLen; i++) {
    let sum = 0;
    const start = i * downFactor;
    const end = Math.min(start + downFactor, data.length);
    for (let j = start; j < end; j++) sum += Math.abs(data[j]);
    env[i] = sum / (end - start);
  }

  // DC-block
  let mean = 0;
  for (let i = 0; i < downLen; i++) mean += env[i];
  mean /= Math.max(1, downLen);
  let energy = 0;
  for (let i = 0; i < downLen; i++) {
    env[i] -= mean;
    energy += env[i] * env[i];
  }

  // Autocorrelate over BPM range
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * targetSr));
  const maxLag = Math.min(downLen - 1, Math.ceil((60 / minBpm) * targetSr));
  // If the downsampled envelope is too short to hold even one minLag-spaced
  // pair, the autocorrelation loop never runs and bestCorr stays -Infinity,
  // yielding a meaningless BPM. Return an explicit finite default instead.
  if (downLen < minLag || maxLag < minLag) {
    const defaultBpm = Math.round((minBpm + maxBpm) / 2);
    return { bpm: defaultBpm, confidence: 0 };
  }
  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const cap = downLen - lag;
    for (let i = 0; i < cap; i++) sum += env[i] * env[i + lag];
    // Normalize by the pair count: `cap` shrinks as `lag` grows, so the raw
    // sum is systematically larger for short lags (fast BPM) — a double-time
    // bias. Comparing the MEAN correlation (sum / cap) instead removes that
    // bias so a steady 120-BPM signal detects ~120, not ~240.
    const corr = cap > 0 ? sum / cap : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = Math.round((60 / bestLag) * targetSr);
  // Confidence: the best mean correlation relative to the signal's mean
  // energy (energy / downLen), keeping the [0,1] semantics intact after the
  // switch from raw sum to mean.
  const meanEnergy = energy / Math.max(1, downLen);
  const confidence =
    meanEnergy > 0 ? Math.max(0, Math.min(1, bestCorr / meanEnergy)) : 0;
  return { bpm, confidence };
}
