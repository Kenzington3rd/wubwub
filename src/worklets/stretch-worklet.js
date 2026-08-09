// W3.1 — KEYLOCK time-stretch AudioWorklet (streaming granular OLA).
//
// Registered exactly like the looper worklet: imported `?raw`, wrapped in a
// Blob, addModule'd via an object URL (never a static path — file:// and
// PWA-subpath builds depend on this).
//
// Protocol (port messages):
//   { type: "load", channels: [Float32Array…], sampleRate }  — adopt a track
//   { type: "play", offset }   — start synthesis from `offset` seconds
//   { type: "pause" }          — stop producing (emit silence)
//   { type: "seek", offset }   — jump the read position
// AudioParams:
//   rate       — tempo ratio (0.5–2.0); track time advances at this rate
//   pitchRatio — resample ratio (2^(semitones/12)); 1 = keylock
//
// The synthesis mirrors src/audio/timeStretch.js: 4096-sample Hann grains at
// 50% overlap; grain g reads the source at outPos × rate through a linear-
// interp resampler at pitchRatio. Position reports are posted every ~100 ms
// as { type: "position", seconds } so a host can drive its playhead.
//
// NOTE (W3.1 status): this worklet is registered and unit-covered but not
// yet wired into the Deck transport — that integration replaces the deck's
// AudioBufferSource in KEYLOCK mode and is gated on the Audio Engine
// Architect review + real listening tests (see BACKLOG W3.1).

const GRAIN = 4096;
const HOP = GRAIN / 2;

class StretchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rate", defaultValue: 1, minValue: 0.25, maxValue: 4 },
      { name: "pitchRatio", defaultValue: 1, minValue: 0.25, maxValue: 4 },
    ];
  }

  constructor() {
    super();
    this.channels = null;
    this.sourceSampleRate = sampleRate;
    this.playing = false;
    // Output-domain sample counter since play(); source position derives as
    // outSamples × rate (integrated per block so rate changes are honoured).
    this.sourcePos = 0; // fractional source frames
    this.window = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (GRAIN - 1)));
    }
    // Ring of synthesized-but-unread output per channel.
    this.pending = null;
    this.pendingRead = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "load") {
        this.channels = m.channels || null;
        this.sourceSampleRate = m.sampleRate || sampleRate;
        this.playing = false;
        this.sourcePos = 0;
        this.pending = null;
      } else if (m.type === "play") {
        this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
        this.pending = null;
        this.playing = true;
      } else if (m.type === "pause") {
        this.playing = false;
      } else if (m.type === "seek") {
        this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
        this.pending = null;
      }
    };
  }

  synthesizeBlock(rate, pitchRatio) {
    // Produce HOP fresh output samples per call by overlap-adding two
    // half-overlapped grains' worth of contribution. To keep the streaming
    // state simple we synthesize one full grain each hop and carry the tail.
    const chs = this.channels;
    const n = chs.length;
    if (!this.pending) {
      this.pending = Array.from({ length: n }, () => new Float32Array(GRAIN + HOP));
      this.pendingRead = HOP; // first grain's first half fades in from zero
    }
    // Shift the pending buffers left by HOP and synthesize a grain at the
    // write position (overlap-add of the new grain over the carried tail).
    for (let c = 0; c < n; c++) {
      const buf = this.pending[c];
      // Shift left by one hop: [0..HOP) becomes the fresh half ready to
      // stream out once this grain is added; the carried tail sits under it.
      buf.copyWithin(0, HOP);
      buf.fill(0, GRAIN);
      const src = chs[c];
      const start = this.sourcePos;
      // Overlap-add the new windowed grain across [0..GRAIN): its first half
      // sums with the previous grain's carried tail (50% Hann overlap → the
      // pair sums to unity), its second half becomes the next carried tail.
      for (let i = 0; i < GRAIN; i++) {
        const p = start + i * pitchRatio;
        const i0 = Math.floor(p);
        const frac = p - i0;
        const a = i0 >= 0 && i0 < src.length ? src[i0] : 0;
        const b = i0 + 1 >= 0 && i0 + 1 < src.length ? src[i0 + 1] : 0;
        buf[i] += (a + (b - a) * frac) * this.window[i];
      }
    }
    // Advance the source read head by HOP output samples' worth of material.
    this.sourcePos += HOP * rate;
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    if (!this.playing || !this.channels || this.channels.length === 0) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    // k-rate is fine for tempo/pitch — read the block's first value.
    const rate = parameters.rate[0];
    const pitchRatio = parameters.pitchRatio[0];

    for (let f = 0; f < frames; f++) {
      if (!this.pending || this.pendingRead >= HOP) {
        this.synthesizeBlock(rate, pitchRatio);
        this.pendingRead = 0;
      }
      for (let c = 0; c < out.length; c++) {
        const srcCh = this.pending[Math.min(c, this.pending.length - 1)];
        out[c][f] = srcCh[this.pendingRead];
      }
      this.pendingRead++;
    }

    // Position report (~10 Hz) in source-track seconds.
    const nowSec = currentTime;
    if (nowSec - this.lastReport > 0.1) {
      this.lastReport = nowSec;
      this.port.postMessage({
        type: "position",
        seconds: this.sourcePos / this.sourceSampleRate,
      });
    }
    // End of track → report and stop producing.
    if (this.sourcePos >= this.channels[0].length) {
      this.playing = false;
      this.port.postMessage({ type: "ended" });
    }
    return true;
  }
}

registerProcessor("stretch-processor", StretchProcessor);
