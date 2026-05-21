// Looper ring buffer — AudioWorkletProcessor.
// Continuously writes incoming audio into a circular buffer. On a `capture`
// message, copies the most-recent N seconds into an ArrayBuffer and posts back.
//
// Memory cost: sampleRate * seconds * 2 channels * 4 bytes
//   At 48 kHz, 60 s stereo → ~23 MB. Tune `seconds` from the caller.

// Ring-buffer wrap math, extracted as a pure function so it is unit-testable
// without an AudioWorkletGlobalScope. Given the current write position, the
// number of samples to capture, and the ring-buffer size, returns the index
// where the capture window starts (handles the wrap-around case).
export function captureStartIndex(writePos, samples, bufferSize) {
  return (writePos - samples + bufferSize) % bufferSize;
}

// `AudioWorkletProcessor` only exists inside an AudioWorkletGlobalScope. Guard
// the class + registration so importing this file from a test (plain Node /
// happy-dom) to exercise `captureStartIndex` doesn't throw a ReferenceError.
if (typeof AudioWorkletProcessor !== "undefined") {

class LooperProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    const seconds = options?.processorOptions?.seconds ?? 30;
    this.bufferSize = Math.max(1, Math.floor(sampleRate * seconds));
    this.left = new Float32Array(this.bufferSize);
    this.right = new Float32Array(this.bufferSize);
    this.writePos = 0;
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    if (!msg || msg.type !== "capture") return;
    const seconds = Math.max(0.1, msg.seconds ?? 4);
    const samples = Math.min(
      this.bufferSize,
      Math.floor(sampleRate * seconds)
    );
    const start = captureStartIndex(this.writePos, samples, this.bufferSize);
    const l = new Float32Array(samples);
    const r = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const idx = (start + i) % this.bufferSize;
      l[i] = this.left[idx];
      r[i] = this.right[idx];
    }
    this.port.postMessage(
      { type: "capture", slot: msg.slot, sampleRate, left: l.buffer, right: r.buffer },
      [l.buffer, r.buffer]
    );
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const left = input[0];
    const right = input[1] ?? input[0];
    const n = left.length;
    let w = this.writePos;
    for (let i = 0; i < n; i++) {
      this.left[w] = left[i];
      this.right[w] = right[i];
      w++;
      if (w >= this.bufferSize) w = 0;
    }
    this.writePos = w;
    return true;
  }
}

registerProcessor("looper-processor", LooperProcessor);

}
