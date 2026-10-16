// W3.1 — KEYLOCK time-stretch AudioWorklet (streaming WSOLA).
//
// Registered exactly like the looper worklet: imported `?raw`, wrapped in a
// Blob, addModule'd via an object URL (never a static path — file:// and
// PWA-subpath builds depend on this).
//
// Protocol (port messages, host → worklet):
//   { type: "load", channels: [Float32Array…], sampleRate, loop? }
//        adopt a track; resets to not-playing at 0. `loop: true` loops the
//        whole track; anything else clears any loop (a region belongs to the
//        track it was set on).
//   { type: "play", offset }   — start synthesis from `offset` seconds
//   { type: "pause" }          — stop producing (emit silence)
//   { type: "seek", offset }   — jump the read position
//   { type: "setLoop", enabled, start?, end? }
//        seconds in source time. enabled + no start/end → whole track;
//        enabled + start/end → that region (clamped to the track; a region
//        shorter than one hop, or end ≤ start, is ignored — the previous loop
//        state stands); enabled: false → no loop, play to the end.
// Worklet → host:
//   { type: "position", seconds }  ~every 100 ms: the source position of the
//        sample about to leave the node (the AUDIBLE playhead, not the
//        synthesis write head, which runs one hop ahead).
//   { type: "looped", seconds }    once per wrap, when the audible position
//        wraps; `seconds` is the loop start (0 for a whole-track loop).
//   { type: "ended" }              no loop enabled and the audible position
//        reached the end of the track. Playback stops.
// AudioParams:
//   rate       — tempo ratio (0.5–2.0); track time advances at this rate
//   pitchRatio — resample ratio (2^(semitones/12)); 1 = keylock
//
// The synthesis mirrors src/audio/timeStretch.js: 2048-sample periodic-Hann
// grains at 75% overlap (× ½ so the overlap sums to exactly 1), each grain's
// start nudged within ±SEARCH samples of its nominal position to the offset
// that best matches the natural continuation of the previous grain (WSOLA,
// normalized cross-correlation on the channel sum, coarse-to-fine), then read
// through a linear-interp resampler at pitchRatio. At rate 1 / pitch 1 the
// search is skipped and output equals input after the 3-hop fade-in.
//
// Looping happens here, not in the host: the read position wraps modulo the
// loop region inside synthesizeBlock and grain reads wrap with it, so grains
// straddling the seam read continuous material — no ended → play(0) round
// trip, no gap, no abandoned tail.
//
// Buffers at a sample rate other than the context's are read at
// sourceSampleRate / sampleRate frames per output frame (pitch AND tempo), so
// they play at the right pitch and speed; for the usual same-rate buffer the
// factor is exactly 1.
//
// W3.1 status: wired into the Deck transport as the opt-in KEYLOCK mode
// (replaces the deck's AudioBufferSource while engaged; VARI stays the
// bit-identical default). Still flagged experimental in the UI pending real
// listening tests.

const GRAIN = 2048;
const HOP = GRAIN / 4;
const OLA_GAIN = (2 * HOP) / GRAIN;
const SEARCH = 384;
const CORR = GRAIN - HOP;
const DECIM = 4;
const EPS = 1e-12;

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
    // Nominal source position (fractional source frames) of the NEXT grain.
    this.sourcePos = 0;
    // Nominal position + effective rate of the grain currently streaming
    // out — the audible playhead derives from these and pendingRead.
    this.grainNominal = 0;
    this.grainRate = 1;
    // Actual (aligned) read position of the previous grain; null right after
    // play / seek / load, when there is nothing to align to.
    this.prevActual = null;
    // Loop request: null (off) or { start, end } in seconds (null = track
    // edge). Resolved against the loaded track per block.
    this.loop = null;
    // Index within the current block at which the audible position wraps
    // (−1 = none pending).
    this.wrapAt = -1;
    this.window = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++) {
      this.window[i] = OLA_GAIN * 0.5 * (1 - Math.cos((2 * Math.PI * i) / GRAIN));
    }
    // Overlap-add accumulator per channel; [0..HOP) is final after each
    // synthesizeBlock and streams out.
    this.pending = null;
    this.pendingRead = 0;
    this.lastReport = 0;
    // WSOLA scratch (allocated once — no garbage on the audio thread).
    this.ref = new Float32Array(CORR);
    this.region = new Float32Array(CORR + 2 * SEARCH);
    this.tmp = new Float32Array(CORR + 2 * SEARCH);
    this.refD = new Float32Array(CORR / DECIM);
    this.regD = new Float32Array((CORR + 2 * SEARCH) / DECIM);
    this.scores = new Float64Array((2 * SEARCH) / DECIM + 1);
    this.port.onmessage = (e) => this.onMessage(e.data || {});
  }

  onMessage(m) {
    if (m.type === "load") {
      this.channels = m.channels || null;
      this.sourceSampleRate = m.sampleRate || sampleRate;
      this.playing = false;
      this.sourcePos = 0;
      this.loop = m.loop ? { start: null, end: null } : null;
      this.resetStream();
    } else if (m.type === "play") {
      this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
      this.resetStream();
      this.playing = true;
    } else if (m.type === "pause") {
      this.playing = false;
    } else if (m.type === "seek") {
      this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
      this.resetStream();
    } else if (m.type === "setLoop") {
      this.setLoop(m);
    }
  }

  setLoop(m) {
    if (!m.enabled) {
      this.loop = null;
      return;
    }
    const hasStart = typeof m.start === "number" && Number.isFinite(m.start);
    const hasEnd = typeof m.end === "number" && Number.isFinite(m.end);
    if (!hasStart && !hasEnd) {
      this.loop = { start: null, end: null };
      return;
    }
    const next = { start: hasStart ? m.start : null, end: hasEnd ? m.end : null };
    const s = next.start ?? 0;
    if (next.end !== null && next.end <= s) return; // degenerate → ignore
    if (this.channels && this.channels.length) {
      // Validate against the loaded track now; with no track yet the region
      // is re-checked (and dropped if too short) once one arrives.
      const prev = this.loop;
      this.loop = next;
      if (!this.loopBounds()) this.loop = prev;
      return;
    }
    if (next.end !== null && (next.end - s) * this.sourceSampleRate < HOP) return;
    this.loop = next;
  }

  resetStream() {
    this.pending = null;
    this.prevActual = null;
    this.wrapAt = -1;
    this.grainNominal = this.sourcePos;
    this.pendingRead = 0;
  }

  // Loop region in source frames, or null when no (valid) loop is active.
  loopBounds() {
    if (!this.loop || !this.channels || this.channels.length === 0) return null;
    const len = this.channels[0].length;
    const sr = this.sourceSampleRate;
    const clamp = (v) => Math.min(len, Math.max(0, v));
    const start = this.loop.start === null ? 0 : clamp(Math.round(this.loop.start * sr));
    const end = this.loop.end === null ? len : clamp(Math.round(this.loop.end * sr));
    if (end - start < HOP) return null;
    return { start, end, len: end - start };
  }

  // Wrap a position into the loop region. Positions at/after the end always
  // wrap; positions before the start wrap only for a stream that is inside
  // the region (`both`), so a play/seek before the region reads the real
  // pre-region material.
  wrap(p, b, both) {
    if (!b) return p;
    if (p >= b.end || (both && p < b.start)) {
      let r = (p - b.start) % b.len;
      if (r < 0) r += b.len;
      return b.start + r;
    }
    return p;
  }

  sampleAt(src, i, b, both) {
    if (b && (i >= b.end || (both && i < b.start))) {
      let r = (i - b.start) % b.len;
      if (r < 0) r += b.len;
      i = b.start + r;
    }
    return i >= 0 && i < src.length ? src[i] : 0;
  }

  // Linear-interp read of `count` samples at `step` per sample into dst,
  // optionally multiplied by the window and ACCUMULATED (overlap-add).
  read(src, pos, step, count, dst, b, both, win) {
    for (let i = 0; i < count; i++) {
      const p = pos + i * step;
      const i0 = Math.floor(p);
      const frac = p - i0;
      let a, c;
      if (b) {
        a = this.sampleAt(src, i0, b, both);
        c = this.sampleAt(src, i0 + 1, b, both);
      } else {
        a = i0 >= 0 && i0 < src.length ? src[i0] : 0;
        c = i0 + 1 >= 0 && i0 + 1 < src.length ? src[i0 + 1] : 0;
      }
      const v = a + (c - a) * frac;
      if (win) dst[i] += v * win[i];
      else dst[i] = v;
    }
  }

  // Channel-summed read for the alignment search.
  readMono(pos, step, count, dst, b, both) {
    const chs = this.channels;
    this.read(chs[0], pos, step, count, dst, b, both, null);
    for (let c = 1; c < chs.length; c++) {
      this.read(chs[c], pos, step, count, this.tmp, b, both, null);
      for (let i = 0; i < count; i++) dst[i] += this.tmp[i];
    }
  }

  // WSOLA lag search — same algorithm as timeStretch.js#findBestLag.
  bestLag() {
    const ref = this.ref;
    const region = this.region;
    const refD = this.refD;
    const regD = this.regD;
    const nRefD = refD.length;
    const nRegD = regD.length;
    for (let j = 0; j < nRefD; j++) {
      const k = j * DECIM;
      refD[j] = ref[k] + ref[k + 1] + ref[k + 2] + ref[k + 3];
    }
    for (let j = 0; j < nRegD; j++) {
      const k = j * DECIM;
      regD[j] = region[k] + region[k + 1] + region[k + 2] + region[k + 3];
    }
    const centreD = SEARCH / DECIM;
    const nLagsD = 2 * centreD + 1;
    let energy = 0;
    for (let j = 0; j < nRefD; j++) energy += regD[j] * regD[j];
    for (let o = 0; o < nLagsD; o++) {
      if (o > 0) {
        const out = regD[o - 1];
        const inn = regD[o + nRefD - 1];
        energy += inn * inn - out * out;
      }
      let c = 0;
      for (let j = 0; j < nRefD; j++) c += refD[j] * regD[o + j];
      this.scores[o] = c / Math.sqrt(Math.max(energy, 0) + EPS);
    }
    let bestD = centreD;
    let bestScore = this.scores[centreD];
    for (let o = 0; o < nLagsD; o++) {
      if (this.scores[o] > bestScore * (1 + 1e-9) + 1e-12) {
        bestScore = this.scores[o];
        bestD = o;
      }
    }
    const fullScore = (off) => {
      let c = 0;
      let e = 0;
      for (let j = 0; j < CORR; j++) {
        const v = region[off + j];
        c += ref[j] * v;
        e += v * v;
      }
      return c / Math.sqrt(e + EPS);
    };
    let bestOff = SEARCH;
    let best = fullScore(SEARCH);
    const lo = Math.max(0, bestD * DECIM - (DECIM - 1));
    const hi = Math.min(2 * SEARCH, bestD * DECIM + (DECIM - 1));
    for (let off = lo; off <= hi; off++) {
      if (off === SEARCH) continue;
      const s = fullScore(off);
      if (s > best * (1 + 1e-9) + 1e-12) {
        best = s;
        bestOff = off;
      }
    }
    return bestOff - SEARCH;
  }

  // Produce HOP fresh output samples: shift the accumulator left by one hop,
  // overlap-add one aligned grain across [0..GRAIN), and advance the nominal
  // read head by HOP × rate (wrapping inside an active loop).
  synthesizeBlock(rate, pitch) {
    const chs = this.channels;
    const n = chs.length;
    if (!this.pending) {
      this.pending = Array.from({ length: n }, () => new Float32Array(GRAIN));
    }
    const b = this.loopBounds();
    let nominal = this.sourcePos;
    if (b && nominal >= b.end) {
      // play / seek landed at or past the region end → wrap to its start.
      nominal = this.wrap(nominal, b, false);
      this.wrapAt = 0;
    }
    const both = !!b && nominal >= b.start && nominal < b.end;
    let actual = nominal;
    if (this.prevActual !== null) {
      const natural = this.wrap(this.prevActual + HOP * pitch, b, both);
      if (Math.abs(natural - nominal) > 1e-9) {
        this.readMono(natural, pitch, CORR, this.ref, b, both);
        this.readMono(nominal - SEARCH * pitch, pitch, CORR + 2 * SEARCH, this.region, b, both);
        actual = this.wrap(nominal + this.bestLag() * pitch, b, both);
      } else {
        actual = natural;
      }
    }
    for (let c = 0; c < n; c++) {
      const buf = this.pending[c];
      buf.copyWithin(0, HOP);
      buf.fill(0, GRAIN - HOP);
      this.read(chs[c], actual, pitch, GRAIN, buf, b, both, this.window);
    }
    this.prevActual = actual;
    this.grainNominal = nominal;
    this.grainRate = rate;
    let next = nominal + HOP * rate;
    if (b && next >= b.end) {
      // First sample of this block whose audible position is ≥ end (a wrap
      // landing exactly on the next block's first sample is announced with
      // this block's last one — one sample early, never a block late).
      this.wrapAt = Math.min(HOP - 1, Math.max(0, Math.ceil((b.end - nominal) / rate)));
      next = this.wrap(next, b, false);
    }
    this.sourcePos = next;
  }

  // Source frame of the sample about to leave the node.
  audibleFrame() {
    let p = this.grainNominal + this.pendingRead * this.grainRate;
    const b = this.loopBounds();
    if (b && p >= b.end) p = this.wrap(p, b, false);
    return Math.max(0, p);
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    if (!this.playing || !this.channels || this.channels.length === 0) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    // k-rate is fine for tempo/pitch — read the block's first value. Scale
    // both by the source/context rate ratio (exactly 1 for same-rate
    // buffers) so foreign-rate buffers keep their pitch and tempo.
    const srRatio = this.sourceSampleRate / sampleRate;
    const rate = parameters.rate[0] * srRatio;
    const pitch = parameters.pitchRatio[0] * srRatio;

    for (let f = 0; f < frames; f++) {
      if (!this.pending || this.pendingRead >= HOP) {
        this.synthesizeBlock(rate, pitch);
        this.pendingRead = 0;
      }
      for (let c = 0; c < out.length; c++) {
        const srcCh = this.pending[Math.min(c, this.pending.length - 1)];
        out[c][f] = srcCh[this.pendingRead];
      }
      this.pendingRead++;
      if (this.wrapAt >= 0 && this.pendingRead > this.wrapAt) {
        this.wrapAt = -1;
        const b = this.loopBounds();
        this.port.postMessage({
          type: "looped",
          seconds: b ? b.start / this.sourceSampleRate : 0,
        });
      }
    }

    const audible = this.audibleFrame();
    // Position report (~10 Hz) in source-track seconds.
    const nowSec = currentTime;
    if (nowSec - this.lastReport > 0.1) {
      this.lastReport = nowSec;
      this.port.postMessage({
        type: "position",
        seconds: audible / this.sourceSampleRate,
      });
    }
    // End of track (no loop) → report and stop producing.
    if (!this.loopBounds() && audible >= this.channels[0].length) {
      this.playing = false;
      this.port.postMessage({ type: "ended" });
    }
    return true;
  }
}

registerProcessor("stretch-processor", StretchProcessor);
