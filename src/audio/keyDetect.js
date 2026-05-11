// Auto-key detection via Krumhansl-Schmuckler chroma correlation.
//
// Algorithm:
//   1. Take the first ~30 s of the track at channel 0 (skip the intro hash).
//   2. For each of 12 pitch classes × 3 octaves (C3..B5), run the Goertzel
//      single-frequency DFT to get the energy at that pitch.
//   3. Sum across octaves per pitch class → 12-dim chroma vector. Normalize.
//   4. Correlate against 24 Krumhansl-Schmuckler key profiles (12 major +
//      12 minor). Highest correlation = detected key.
//   5. Map to Camelot. Return { key, camelot, confidence } where confidence
//      is the correlation strength of the best match.
//
// Confidence > 0.6 is reasonably reliable. Below that, treat as a hint.

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Schmuckler profiles. Rotated by index for each tonic.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot mapping (chosen to match the wheel in data.js / TheoryPanel).
const MAJOR_CAMELOT = {
  C: "8B", "C#": "3B", "Db": "3B", D: "10B", "D#": "5B", Eb: "5B",
  E: "12B", F: "7B", "F#": "2B", Gb: "2B", G: "9B", "G#": "4B", Ab: "4B",
  A: "11B", "A#": "6B", Bb: "6B", B: "1B",
};
const MINOR_CAMELOT = {
  C: "5A", "C#": "12A", Db: "12A", D: "7A", "D#": "2A", Eb: "2A",
  E: "9A", F: "4A", "F#": "11A", Gb: "11A", G: "6A", "G#": "1A", Ab: "1A",
  A: "8A", "A#": "3A", Bb: "3A", B: "10A",
};

// Goertzel single-frequency DFT magnitude². O(N) per frequency.
function goertzelEnergy(samples, sr, freq) {
  const N = samples.length;
  const omega = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function pearsonCorrelation(a, b) {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom > 0 ? num / denom : 0;
}

export async function detectKey(audioBuffer, { sampleSec = 30 } = {}) {
  if (!audioBuffer) throw new Error("detectKey: audioBuffer is required");
  const sr = audioBuffer.sampleRate;

  // Downsample-via-render to ~11025 Hz to make Goertzel cheap and reduce
  // sensitivity to high-frequency noise. (Half the standard 22050, which is
  // sufficient since our top pitch frequency is ~1976 Hz.)
  const Offline =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("OfflineAudioContext not supported");

  const targetSr = 11025;
  const seconds = Math.min(sampleSec, audioBuffer.duration);
  // Skip the first 5 s — many tracks have a quiet intro that throws off chroma.
  const startOffset = Math.min(5, Math.max(0, audioBuffer.duration - seconds));
  const renderLen = Math.floor(seconds * targetSr);
  const offline = new Offline(1, renderLen, targetSr);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offline.destination);
  src.start(0, startOffset, seconds);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  // C3 = 130.81 Hz. Take 3 octaves: C3..B5.
  const C3 = 130.81278265;
  const chroma = new Float32Array(12);
  for (let p = 0; p < 12; p++) {
    const baseFreq = C3 * Math.pow(2, p / 12);
    let energy = 0;
    for (let oct = 0; oct < 3; oct++) {
      energy += goertzelEnergy(samples, targetSr, baseFreq * Math.pow(2, oct));
    }
    chroma[p] = energy;
  }

  // Normalize chroma (so absolute energy doesn't dominate correlation).
  let maxC = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > maxC) maxC = chroma[i];
  if (maxC > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxC;

  // Correlate against all 24 keys (12 major rotations + 12 minor rotations).
  let best = { score: -2, tonic: 0, mode: "maj" };
  const major = new Float32Array(12);
  const minor = new Float32Array(12);
  for (let tonic = 0; tonic < 12; tonic++) {
    for (let i = 0; i < 12; i++) major[i] = MAJOR_PROFILE[(i - tonic + 12) % 12];
    for (let i = 0; i < 12; i++) minor[i] = MINOR_PROFILE[(i - tonic + 12) % 12];
    const sMaj = pearsonCorrelation(chroma, major);
    const sMin = pearsonCorrelation(chroma, minor);
    if (sMaj > best.score) best = { score: sMaj, tonic, mode: "maj" };
    if (sMin > best.score) best = { score: sMin, tonic, mode: "min" };
  }

  const tonicName = PITCH_CLASSES[best.tonic];
  const camelotMap = best.mode === "maj" ? MAJOR_CAMELOT : MINOR_CAMELOT;
  const camelot = camelotMap[tonicName];
  const keyLabel = `${tonicName} ${best.mode}`;
  return {
    key: keyLabel,
    camelot,
    confidence: Math.max(0, Math.min(1, best.score)),
  };
}
