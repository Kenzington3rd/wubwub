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
//   { type: "pause" }          — stop producing; the output ramps to zero over
//        ~4 ms (state reads playing=false at once, audio tails for the fade)
//   { type: "seek", offset }   — jump the read position
//   { type: "setLoop", enabled, start?, end? }
//        seconds in source time. enabled + no start/end → whole track;
//        enabled + start/end → that region (clamped to the track; a region
//        shorter than one hop, or end ≤ start, is ignored — the previous loop
//        state stands); enabled: false → no loop, play to the end.
// Worklet → host:
//   { type: "position", seconds, at }  ~every 100 ms: the source position of
//        the sample about to leave the node (the AUDIBLE playhead), and `at`,
//        the AudioWorkletGlobalScope currentTime (context seconds) of the
//        render quantum it was measured in — anchor to `at`, not to message
//        arrival, which lags by an unknown thread hop. That sample is
//        an overlap-add of up to four grains, each reading the source at its
//        own aligned start + offset × pitch; the playhead is their window-
//        weighted mean read position (exact for a linear ramp). This includes
//        the overlap-add group delay ≈ (GRAIN/2)·(pitch − rate) plus the mean
//        WSOLA nudge, which a write-head estimate (nominal + emitted × rate)
//        misses by up to ~27 ms at rate 2.
//   { type: "looped", seconds, at }  once per wrap, when the audible position
//        crosses the seam (or at once when play / seek / a region change
//        lands past the region end); `seconds` is the loop start (0 for a
//        whole-track loop). Never posted by a fading tail.
//   { type: "ended" }              no loop enabled and the audible position
//        reached the end of the track. Playback stops with the ~4 ms fade
//        (the grains still hold signal at that point).
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
// Alignment grid: candidates are read on the natural continuation's
// sub-sample grid (natural + m × pitch), not the nominal one. When HOP × rate
// is non-integer the two sit on different fractional positions, every
// candidate is interpolated at a different fraction than the grain it
// overlaps, and high frequencies never line up (white noise lost 2.0–2.5 dB,
// its HF band 3–4 dB, at rates 0.9–1.3).
//
// Edge fades (~4 ms, FADE samples): the host fades its VARI BufferSources on
// start / stop / seek, so this node has to do the same for itself. pause and
// end-of-track keep rendering the live grain state down to zero; seek /
// play-over-sound / load (including eject, `channels: null`) / a loop change
// that moves the read position render the OLD stream's
// next FADE samples into a tail ramped to zero while the NEW stream fades in
// (a short crossfade, ≤ 5 ms total, still instant to the ear). A fresh
// stream's partial-overlap start is level-normalised so the new position is
// at full level within ~3 ms instead of rising over three hops. The loop
// wrap itself is already continuous and is not touched.
//
// Looping happens here, not in the host: the read position wraps modulo the
// loop region inside synthesizeBlock and grain reads wrap with it, so grains
// straddling the seam read continuous material — no ended → play(0) round
// trip, no gap, no abandoned tail. Grain positions are kept in "stream"
// coordinates that never wrap (each wrap adds the region length); each wrap
// queues its seam in those coordinates and is announced, and subtracted from
// the reported position, only once the audible playhead crosses it. Turning
// the loop off while wrapped material is already in flight re-anchors the
// stream at the audible position, so the track does not restart once.
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
// ~4 ms edge fade, in samples at the context rate.
const FADE = Math.max(1, Math.round(sampleRate * 0.004));
// Start-of-stream level normalisation floor (see synthesizeBlock).
const NORM_FLOOR = 0.02;

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
    // Actual (aligned) read position of the previous grain; null right after
    // play / seek / load, when there is nothing to align to.
    this.prevActual = null;
    // Loop request: null (off) or { start, end } in seconds (null = track
    // edge). Resolved against the loaded track per block.
    this.loop = null;
    this.window = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++) {
      this.window[i] = OLA_GAIN * 0.5 * (1 - Math.cos((2 * Math.PI * i) / GRAIN));
    }
    // Overlap-add accumulator per channel; [0..HOP) is final after each
    // synthesizeBlock and streams out. Allocated per channel layout (the
    // first block after a load that changes the channel count) and reused —
    // play / seek / loop jumps only clear it. `streaming` says it holds a live
    // stream.
    this.pending = [];
    this.streaming = false;
    this.pendingRead = 0;
    // Stream coordinates (see header): unwrapped start (gPos) and pitch of
    // the last four grains, ring-indexed by grainCount & 3; lapFrames is the
    // total wrapped off sourcePos since the stream began.
    this.gPos = new Float64Array(4);
    this.gPitch = new Float64Array(4);
    this.lapFrames = 0;
    // Seams queued by the write head, not yet audible: stream coordinate and
    // the amount to subtract once crossed. audLap = sum of crossed seams.
    this.seamAt = new Float64Array(16);
    this.seamShift = new Float64Array(16);
    this.seamHead = 0;
    this.seamCount = 0;
    this.audLap = 0;
    // A stream that started past the region end wrapped at once.
    this.startWrapped = false;
    this.lastReport = 0;
    // Edge-fade state. release: samples of pause fade-out left. inPos: how
    // far the current stream's fade-in has progressed. tail: the previous
    // stream's fading remainder after a seek / re-play / loop jump.
    this.release = 0;
    this.inPos = FADE;
    this.tail = null;
    // Two preallocated tail slots (a capture during a fading tail mixes the
    // old slot into the other one). Re-allocated only if the output channel
    // count changes.
    this.tails = [0, 1].map(() => ({ buf: [new Float32Array(FADE), new Float32Array(FADE)], pos: 0 }));
    this.tailIdx = 0;
    this.lastRate = 1;
    this.lastPitch = 1;
    this.outCh = 0;
    // Window-sum bookkeeping for the first (partially overlapped) hops.
    this.wsum = new Float32Array(GRAIN);
    this.norm = new Float32Array(HOP);
    this.normOn = false;
    this.grainCount = 0;
    // WSOLA scratch (allocated once).
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
      // A load (eject included) over a sounding stream fades the OLD
      // channels out — the tail is rendered before they are dropped.
      this.captureTail();
      this.channels = m.channels || null;
      this.sourceSampleRate = m.sampleRate || sampleRate;
      this.playing = false;
      this.sourcePos = 0;
      this.loop = m.loop ? { start: null, end: null } : null;
      this.release = 0;
      this.resetStream();
    } else if (m.type === "play") {
      this.captureTail(); // play over a sounding stream / fade crossfades
      this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
      this.resetStream();
      this.release = 0;
      this.playing = true;
    } else if (m.type === "pause") {
      if (this.playing && this.streaming && this.channels) this.release = FADE;
      this.playing = false;
    } else if (m.type === "seek") {
      this.captureTail();
      this.sourcePos = (m.offset || 0) * this.sourceSampleRate;
      this.resetStream();
      this.release = 0;
    } else if (m.type === "setLoop") {
      this.setLoop(m);
    }
  }

  setLoop(m) {
    if (!m.enabled) {
      this.disableLoop();
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
      const b = this.loopBounds();
      if (!b) {
        this.loop = prev;
        return;
      }
      // A region that leaves the audible playhead past its end moves the read
      // position (next grain wraps to the region start): crossfade it, the
      // tail rendered under the OLD loop state. The synth then wraps the
      // position itself and announces `looped` once.
      if (this.playing && this.streaming) {
        this.loop = prev;
        const p = this.audibleFrame();
        if (p >= b.end) {
          this.captureTail();
          this.sourcePos = p;
          this.resetStream();
        }
        this.loop = next;
      }
      return;
    }
    if (next.end !== null && (next.end - s) * this.sourceSampleRate < HOP) return;
    this.loop = next;
  }

  // Loop off. If the write head has already wrapped, or grains in flight
  // already read past the seam, while the audible playhead has not reached
  // it, re-anchor the stream (crossfaded) at the audible position so the
  // wrap never becomes audible; otherwise just drop the loop.
  disableLoop() {
    const b = this.loopBounds();
    if (b && this.playing && this.streaming) {
      const p = this.audibleFrame();
      const ahead = 2 * GRAIN * Math.max(1, this.lastRate, this.lastPitch);
      if (this.seamCount > 0 || p + ahead >= b.end) {
        this.captureTail();
        this.loop = null;
        this.sourcePos = p;
        this.resetStream();
        return;
      }
    }
    this.loop = null;
  }

  resetStream() {
    this.streaming = false;
    this.prevActual = null;
    this.lapFrames = 0;
    this.seamHead = 0;
    this.seamCount = 0;
    this.audLap = 0;
    this.startWrapped = false;
    this.pendingRead = 0;
    this.inPos = 0; // new stream fades in over FADE samples
    this.grainCount = 0;
    this.normOn = false;
    this.wsum.fill(0);
  }

  // Render the old stream's next FADE samples (everything it would emit —
  // pause fade, an in-flight crossfade — continuing seamlessly from the last
  // sample out) ramped linearly to zero, to be mixed under the new stream.
  // Side-effect free beyond the stream state every caller discards right
  // after (resetStream): produce() posts nothing, and seams it queues while
  // rendering are dropped with the stream, so a wrap inside the tail never
  // announces `looped`.
  //
  // With no live stream (the previous message already re-anchored it and
  // nothing has been heard since — a roll's setLoop + seek, seek + seek in
  // one quantum — or a paused stream with a tail still fading) only the
  // existing tail is sounding, and it already ramps to zero on its own: keep
  // it as is. Rendering here would start the not-yet-heard stream (at the old
  // or wrapped position) under fade-in × fade-out — ~−12 dB of ghost
  // material for 4 ms — and ramp the real tail a second time.
  captureTail() {
    const hasTrack = this.channels && this.channels.length;
    if (!(hasTrack && this.streaming && (this.playing || this.release > 0))) return;
    const n = this.outCh || this.channels.length;
    this.tailIdx ^= 1;
    const t = this.tails[this.tailIdx];
    if (t.buf.length !== n) t.buf = Array.from({ length: n }, () => new Float32Array(FADE));
    this.produce(FADE, this.lastRate, this.lastPitch, t.buf, 0);
    for (let c = 0; c < t.buf.length; c++) {
      const ch = t.buf[c];
      for (let k = 0; k < FADE; k++) ch[k] *= (FADE - k) / FADE;
    }
    t.pos = 0;
    this.tail = t;
  }

  // Loop region in source frames, or null when no (valid) loop is active.
  loopBounds() {
    if (!this.loop || !this.channels || this.channels.length === 0) return null;
    const len = this.channels[0].length;
    const sr = this.sourceSampleRate;
    const start = this.loop.start === null ? 0 : Math.min(len, Math.max(0, Math.round(this.loop.start * sr)));
    const end = this.loop.end === null ? len : Math.min(len, Math.max(0, Math.round(this.loop.end * sr)));
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
    let bestOff = SEARCH;
    let best = this.fullScore(SEARCH);
    const lo = Math.max(0, bestD * DECIM - (DECIM - 1));
    const hi = Math.min(2 * SEARCH, bestD * DECIM + (DECIM - 1));
    for (let off = lo; off <= hi; off++) {
      if (off === SEARCH) continue;
      const s = this.fullScore(off);
      if (s > best * (1 + 1e-9) + 1e-12) {
        best = s;
        bestOff = off;
      }
    }
    return bestOff - SEARCH;
  }

  // Full-resolution normalized cross-correlation of the reference against
  // the search region at offset `off` (a method, not a per-grain closure).
  fullScore(off) {
    const ref = this.ref;
    const region = this.region;
    let c = 0;
    let e = 0;
    for (let j = 0; j < CORR; j++) {
      const v = region[off + j];
      c += ref[j] * v;
      e += v * v;
    }
    return c / Math.sqrt(e + EPS);
  }

  queueSeam(at, shift) {
    // Unheard seams span at most ~GRAIN × rate of write-head lead over a
    // region ≥ HOP long: a handful even at the extreme rate, never 16.
    if (this.seamCount >= this.seamAt.length) return;
    const k = (this.seamHead + this.seamCount) % this.seamAt.length;
    this.seamAt[k] = at;
    this.seamShift[k] = shift;
    this.seamCount++;
  }

  // Produce HOP fresh output samples: shift the accumulator left by one hop,
  // overlap-add one aligned grain across [0..GRAIN), and advance the nominal
  // read head by HOP × rate (wrapping inside an active loop).
  synthesizeBlock(rate, pitch) {
    const chs = this.channels;
    const n = chs.length;
    if (!this.streaming) {
      if (this.pending.length !== n) {
        this.pending = Array.from({ length: n }, () => new Float32Array(GRAIN));
      } else {
        for (let c = 0; c < n; c++) this.pending[c].fill(0);
      }
      this.streaming = true;
    }
    this.grainCount++;
    this.normOn = this.grainCount < 4;
    if (this.normOn) {
      // Hops 1-3 after a (re)start overlap fewer than four grains, so the
      // window sum is < 1 there; divide it back out (floored at the very
      // first samples, where the window is ~0) for a full-level start.
      const ws = this.wsum;
      ws.copyWithin(0, HOP);
      ws.fill(0, GRAIN - HOP);
      for (let i = 0; i < GRAIN; i++) ws[i] += this.window[i];
      for (let i = 0; i < HOP; i++) this.norm[i] = 1 / Math.max(ws[i], NORM_FLOOR);
    }
    const b = this.loopBounds();
    let nominal = this.sourcePos;
    if (b && nominal >= b.end) {
      const w = this.wrap(nominal, b, false);
      if (this.prevActual === null) {
        // play / seek landed at or past the region end → jump to its start.
        this.startWrapped = true;
      } else {
        // A region change put the write head past the end: a real wrap.
        this.queueSeam(b.end + this.lapFrames, nominal - w);
        this.lapFrames += nominal - w;
      }
      nominal = w;
    }
    const both = !!b && nominal >= b.start && nominal < b.end;
    let actual = nominal;
    let delta = 0; // actual − nominal before wrapping (small, wrap-free)
    if (this.prevActual !== null) {
      const natural = this.wrap(this.prevActual + HOP * pitch, b, both);
      if (Math.abs(natural - nominal) > 1e-9) {
        // Candidates on the natural continuation's sub-sample grid, within
        // ½ pitch of the nominal start (natural and nominal may sit a loop
        // length apart across the seam; the rounding absorbs that).
        const base =
          pitch === 1
            ? natural + Math.round(nominal - natural)
            : natural + Math.round((nominal - natural) / pitch) * pitch;
        this.readMono(natural, pitch, CORR, this.ref, b, both);
        this.readMono(base - SEARCH * pitch, pitch, CORR + 2 * SEARCH, this.region, b, both);
        const pre = base + this.bestLag() * pitch;
        delta = pre - nominal;
        actual = this.wrap(pre, b, both);
      } else {
        actual = natural;
        delta = natural - nominal;
      }
    }
    this.gPos[this.grainCount & 3] = nominal + this.lapFrames + delta;
    this.gPitch[this.grainCount & 3] = pitch;
    for (let c = 0; c < n; c++) {
      const buf = this.pending[c];
      buf.copyWithin(0, HOP);
      buf.fill(0, GRAIN - HOP);
      this.read(chs[c], actual, pitch, GRAIN, buf, b, both, this.window);
    }
    this.prevActual = actual;
    let next = nominal + HOP * rate;
    if (b && next >= b.end) {
      // The write head wraps now; the seam becomes audible later (process()
      // announces it when the audible playhead crosses it).
      const w = this.wrap(next, b, false);
      this.queueSeam(b.end + this.lapFrames, next - w);
      this.lapFrames += next - w;
      next = w;
    }
    this.sourcePos = next;
  }

  // Stream coordinate of the sample about to leave the node: the window-
  // weighted mean read position of the (up to four) grains it is summed
  // from — the overlap-add group delay included.
  audibleStream() {
    if (!this.streaming) return this.sourcePos + this.audLap;
    const live = Math.min(this.grainCount, 4);
    let sw = 0;
    let sp = 0;
    for (let k = 0; k < live; k++) {
      const d = this.pendingRead + k * HOP;
      if (d >= GRAIN) break;
      const g = (this.grainCount - k) & 3;
      const w = this.window[d];
      sw += w;
      sp += w * (this.gPos[g] + d * this.gPitch[g]);
    }
    return sw > 1e-9 ? sp / sw : this.gPos[this.grainCount & 3];
  }

  // Source frame of the sample about to leave the node.
  audibleFrame() {
    return Math.max(0, this.audibleStream() - this.audLap);
  }

  // Fill `out[c][off .. off+frames)` with the stream (edge-faded), plus any
  // fading tail. Shared by process() and captureTail(); posts no messages.
  produce(frames, rate, pitch, out, off) {
    const hasTrack = this.channels && this.channels.length;
    for (let f = 0; f < frames; f++) {
      // Per sample: a pause fade-out can run dry mid-quantum.
      if (hasTrack && (this.playing || this.release > 0)) {
        if (!this.streaming || this.pendingRead >= HOP) {
          this.synthesizeBlock(rate, pitch);
          this.pendingRead = 0;
        }
        let g = this.inPos < FADE ? this.inPos++ / FADE : 1;
        if (this.normOn) g *= this.norm[this.pendingRead];
        if (!this.playing) {
          g *= this.release / FADE;
          this.release--;
        }
        for (let c = 0; c < out.length; c++) {
          const srcCh = this.pending[Math.min(c, this.pending.length - 1)];
          out[c][off + f] = srcCh[this.pendingRead] * g;
        }
        this.pendingRead++;
      } else {
        for (let c = 0; c < out.length; c++) out[c][off + f] = 0;
      }
      if (this.tail) {
        const t = this.tail;
        for (let c = 0; c < out.length; c++) {
          out[c][off + f] += t.buf[Math.min(c, t.buf.length - 1)][t.pos];
        }
        if (++t.pos >= FADE) this.tail = null;
      }
    }
    if (!this.playing && this.release <= 0) this.streaming = false; // faded out
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const live = (this.playing || this.release > 0) && this.channels && this.channels.length;
    if (!live && !this.tail) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    // k-rate is fine for tempo/pitch — read the block's first value. Scale
    // both by the source/context rate ratio (exactly 1 for same-rate
    // buffers) so foreign-rate buffers keep their pitch and tempo.
    const srRatio = this.sourceSampleRate / sampleRate;
    const rate = parameters.rate[0] * srRatio;
    const pitch = parameters.pitchRatio[0] * srRatio;
    this.lastRate = rate;
    this.lastPitch = pitch;
    this.outCh = out.length;

    this.produce(frames, rate, pitch, out, 0);
    // Pause fade-out / tail only: no transport bookkeeping while not playing.
    if (!this.playing || !this.channels || this.channels.length === 0) return true;

    // Seams the audible playhead has crossed this quantum → `looped`.
    const u = this.audibleStream();
    let wrapped = this.startWrapped;
    this.startWrapped = false;
    while (this.seamCount > 0 && u >= this.seamAt[this.seamHead]) {
      this.audLap += this.seamShift[this.seamHead];
      this.seamHead = (this.seamHead + 1) % this.seamAt.length;
      this.seamCount--;
      wrapped = true;
    }
    if (wrapped) {
      const b = this.loopBounds();
      this.port.postMessage({ type: "looped", seconds: b ? b.start / this.sourceSampleRate : 0, at: currentTime });
    }
    const audible = Math.max(0, u - this.audLap);
    // Position report (~10 Hz) in source-track seconds, stamped with the
    // render quantum's context time so the host can anchor to worklet time
    // rather than to whenever the message happens to arrive.
    const nowSec = currentTime;
    if (nowSec - this.lastReport > 0.1) {
      this.lastReport = nowSec;
      this.port.postMessage({
        type: "position",
        seconds: audible / this.sourceSampleRate,
        at: nowSec,
      });
    }
    // End of track (no loop) → report and fade out: the grains still hold
    // signal here, and a hard stop would click.
    if (!this.loopBounds() && audible >= this.channels[0].length) {
      this.playing = false;
      this.release = FADE;
      this.port.postMessage({ type: "ended" });
    }
    return true;
  }
}

registerProcessor("stretch-processor", StretchProcessor);
