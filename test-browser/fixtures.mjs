// Deterministic audio fixtures, generated in-process.
//
// Committing binary audio to the repo would be dead weight and would rot; these
// build the bytes on the fly instead, so the fixtures are reproducible, tiny in
// git, and — crucially — have a BPM we KNOW rather than one we measured.

const SR = 44100;

/** Minimal 16-bit PCM WAV encoder. Returns a Uint8Array. */
export function encodeWav(channels, sampleRate = SR) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytes = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(bytes);
  const ascii = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * A four-on-the-floor kick pattern at an exact BPM.
 *
 * The app's detector lowpasses to 150 Hz to isolate the kick, so the fixture is
 * a pitch-swept sine in that range — the same shape a real kick has. `bars` is
 * chosen so the file is long enough for autocorrelation to have several periods
 * to work with.
 */
export function kickLoop({ bpm, bars = 8, sampleRate = SR }) {
  const beat = (60 / bpm) * sampleRate;
  const total = Math.round(bars * 4 * beat);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const kickLen = Math.round(0.32 * sampleRate);

  for (let b = 0; b < bars * 4; b++) {
    const start = Math.round(b * beat);
    let phase = 0;
    for (let i = 0; i < kickLen && start + i < total; i++) {
      const t = i / sampleRate;
      const f = 50 + 110 * Math.exp(-t / 0.03);   // pitch sweep, kick-shaped
      phase += (2 * Math.PI * f) / sampleRate;
      const env = Math.exp(-t / 0.10);
      const s = Math.sin(phase) * env * 0.85;
      L[start + i] += s;
      R[start + i] += s;
    }
  }
  return { bytes: encodeWav([L, R], sampleRate), seconds: total / sampleRate, bpm };
}

/** Silence — the negative fixture: decodes fine, but carries no beat. */
export function silence({ seconds = 2, sampleRate = SR } = {}) {
  const n = Math.round(seconds * sampleRate);
  return { bytes: encodeWav([new Float32Array(n), new Float32Array(n)], sampleRate), seconds };
}

/** Not audio at all — for the rejection path. */
export function notAudio() {
  return new TextEncoder().encode("this is definitely not an audio file\n");
}
