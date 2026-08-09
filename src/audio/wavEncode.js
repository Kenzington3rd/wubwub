// W3.6 — minimal AudioBuffer → WAV (RIFF, 16-bit PCM) encoder. Zero
// dependencies; used by the sound-bite WAV download (and available to the
// looper / sample-pad export when that lands). Interleaves up to the
// buffer's channel count and clamps samples to [-1, 1].
export function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// W3.6 — copy a sample range out of a decoded buffer into a fresh
// AudioBuffer, with a short equal-power fade at each edge so an extracted
// bite never clicks. `startSec`/`endSec` are clamped to the buffer.
export function sliceBuffer(ctx, audioBuffer, startSec, endSec, fadeSec = 0.005) {
  const sr = audioBuffer.sampleRate;
  const start = Math.max(0, Math.min(Math.floor(startSec * sr), audioBuffer.length));
  const end = Math.max(start, Math.min(Math.floor(endSec * sr), audioBuffer.length));
  const frames = end - start;
  if (frames <= 0) return null;
  const out = ctx.createBuffer(audioBuffer.numberOfChannels, frames, sr);
  const fade = Math.min(Math.floor(fadeSec * sr), Math.floor(frames / 2));
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < frames; i++) dst[i] = src[start + i];
    for (let i = 0; i < fade; i++) {
      // Equal-power (sin/cos) edges.
      const g = Math.sin(((i / fade) * Math.PI) / 2);
      dst[i] *= g;
      dst[frames - 1 - i] *= g;
    }
  }
  return out;
}
