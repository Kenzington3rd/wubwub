// Deterministic Web Audio API mock for unit tests.
//
// Coverage: AudioContext + OfflineAudioContext + AudioParam scheduling +
// every node WAVECRAFT touches (Gain, BiquadFilter, BufferSource, Convolver,
// Delay, WaveShaper, DynamicsCompressor, Analyser, Oscillator,
// MediaStreamDestination, AudioWorklet).
//
// Behavioral choices:
//   - Param scheduling methods all record into `scheduledValues` for inspection
//     AND update `.value` immediately so assertions can read final state.
//   - OfflineAudioContext.startRendering() passes the most-recently-started
//     buffer source through unchanged. Tests that need real signal processing
//     (bpmDetect, keyDetect) can therefore feed a synthetic buffer and verify
//     the algorithm's downstream math.
//   - MediaRecorder is feature-detected via isTypeSupported('audio/webm*').

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.defaultValue = defaultValue;
    this.scheduledValues = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: "setValue", value: v, time: t });
    return this;
  }
  setTargetAtTime(target, t, tau) {
    this.value = target;
    this.scheduledValues.push({ type: "setTarget", target, time: t, tau });
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: "linearRamp", value: v, time: t });
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: "expRamp", value: v, time: t });
    return this;
  }
  cancelScheduledValues(t) {
    this.scheduledValues.push({ type: "cancel", time: t });
    return this;
  }
}

class MockAudioNode {
  constructor(ctx, type = "AudioNode") {
    this.context = ctx;
    this.nodeType = type;
    this.connections = [];
    this.disposed = false;
  }
  connect(target) {
    this.connections.push(target);
    return target;
  }
  disconnect(target) {
    if (target) {
      this.connections = this.connections.filter((c) => c !== target);
    } else {
      this.connections = [];
    }
  }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "GainNode");
    this.gain = new MockAudioParam(1);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "BiquadFilterNode");
    this.type = "lowpass";
    this.frequency = new MockAudioParam(350);
    this.detune = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockBufferSourceNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "AudioBufferSourceNode");
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new MockAudioParam(1);
    this.detune = new MockAudioParam(0);
    this.onended = null;
    this.started = false;
    this.startedAt = 0;
    this.startOffset = 0;
    this.stopped = false;
  }
  start(when = 0, offset = 0) {
    this.started = true;
    this.startedAt = when;
    this.startOffset = offset;
    // Remember the latest started source on the context (used by
    // OfflineAudioContext.startRendering pass-through).
    if (this.context) this.context._lastStartedSource = this;
  }
  stop() {
    this.stopped = true;
  }
}

class MockConvolverNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "ConvolverNode");
    this.buffer = null;
    this.normalize = true;
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(ctx, maxDelay = 1) {
    super(ctx, "DelayNode");
    this.delayTime = new MockAudioParam(0);
    this.maxDelayTime = maxDelay;
  }
}

class MockWaveShaperNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "WaveShaperNode");
    this.curve = null;
    this.oversample = "none";
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "DynamicsCompressorNode");
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
    this.reduction = 0;
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "AnalyserNode");
    this._fftSize = 2048;
    this.smoothingTimeConstant = 0.8;
    this.minDecibels = -100;
    this.maxDecibels = -30;
  }
  get fftSize() { return this._fftSize; }
  set fftSize(v) { this._fftSize = v; }
  get frequencyBinCount() { return this._fftSize / 2; }
  getByteTimeDomainData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = 128; }
  getByteFrequencyData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = 0; }
  getFloatTimeDomainData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = 0; }
  getFloatFrequencyData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = -100; }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "OscillatorNode");
    this.type = "sine";
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
    this.onended = null;
    this.started = false;
    this.stopped = false;
  }
  start() { this.started = true; }
  stop() {
    this.stopped = true;
    if (this.onended) setTimeout(() => this.onended(), 0);
  }
}

class MockMediaStreamAudioDestinationNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, "MediaStreamAudioDestinationNode");
    this.stream = { id: "mock-stream" };
  }
}

class MockAudioWorklet {
  constructor() {
    this.loadedModules = [];
  }
  async addModule(url) {
    this.loadedModules.push(url);
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  constructor(ctx, name, options = {}) {
    super(ctx, "AudioWorkletNode");
    this.name = name;
    this.processorOptions = options?.processorOptions;
    this.port = {
      onmessage: null,
      _listeners: new Set(),
      // Records every postMessage payload so tests can assert what the app
      // sent to the worklet (e.g. capture seconds clamping).
      postedMessages: [],
      addEventListener(type, fn) {
        if (type === "message") this._listeners.add(fn);
      },
      removeEventListener(type, fn) {
        if (type === "message") this._listeners.delete(fn);
      },
      postMessage(msg) {
        this.postedMessages.push(msg);
      },
      start() {},
    };
  }
}

class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channels = Array.from(
      { length: channels },
      () => new Float32Array(length)
    );
  }
  getChannelData(ch) { return this._channels[ch]; }
  copyToChannel(source, ch) { this._channels[ch].set(source); }
  copyFromChannel(dest, ch, offset = 0) {
    dest.set(this._channels[ch].subarray(offset, offset + dest.length));
  }
}

class MockAudioContextBase {
  constructor() {
    this._currentTime = 0;
    this.sampleRate = 44100;
    this.state = "suspended";
    this.destination = new MockAudioNode(this, "AudioDestinationNode");
    this.audioWorklet = new MockAudioWorklet();
    this._lastStartedSource = null;
    // Every node created on this context, in creation order. Lets tests
    // inspect graphs (e.g. the master chain) built inline by app code.
    this._nodes = [];
  }
  get currentTime() { return this._currentTime; }
  advance(seconds) { this._currentTime += seconds; }
  _track(node) { this._nodes.push(node); return node; }
  createGain() { return this._track(new MockGainNode(this)); }
  createBiquadFilter() { return this._track(new MockBiquadFilterNode(this)); }
  createBufferSource() { return this._track(new MockBufferSourceNode(this)); }
  createConvolver() { return this._track(new MockConvolverNode(this)); }
  createDelay(maxDelay = 1) { return this._track(new MockDelayNode(this, maxDelay)); }
  createWaveShaper() { return this._track(new MockWaveShaperNode(this)); }
  createDynamicsCompressor() { return this._track(new MockDynamicsCompressorNode(this)); }
  createAnalyser() { return this._track(new MockAnalyserNode(this)); }
  createOscillator() { return this._track(new MockOscillatorNode(this)); }
  createMediaStreamDestination() {
    return this._track(new MockMediaStreamAudioDestinationNode(this));
  }
  createBuffer(channels, length, sr) {
    return new MockAudioBuffer(channels, length, sr);
  }
  decodeAudioData(arrayBuffer) {
    // Return a 1 s mono buffer; tests can override by stubbing decodeAudioData.
    return Promise.resolve(new MockAudioBuffer(1, this.sampleRate, this.sampleRate));
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}

class MockAudioContext extends MockAudioContextBase {}

class MockOfflineAudioContext extends MockAudioContextBase {
  constructor(channels, length, sampleRate) {
    super();
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  startRendering() {
    // Pass-through render: returns a buffer containing the data of the
    // most-recently-started BufferSource (truncated/padded to this.length).
    // This lets tests for bpmDetect/keyDetect feed synthetic input and verify
    // the algorithm against a known signal.
    const src = this._lastStartedSource;
    const out = new MockAudioBuffer(
      this.numberOfChannels,
      this.length,
      this.sampleRate
    );
    if (src && src.buffer) {
      const inChannels = src.buffer.numberOfChannels;
      for (let ch = 0; ch < out.numberOfChannels; ch++) {
        const inCh = Math.min(ch, inChannels - 1);
        const inData = src.buffer.getChannelData(inCh);
        const outData = out.getChannelData(ch);
        const cap = Math.min(inData.length, outData.length);
        for (let i = 0; i < cap; i++) outData[i] = inData[i];
      }
    }
    return Promise.resolve(out);
  }
}

class MockMediaRecorder {
  static isTypeSupported(mime) {
    if (!mime) return false;
    return mime.startsWith("audio/webm");
  }
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || "audio/webm";
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    setTimeout(() => {
      if (this.ondataavailable) {
        this.ondataavailable({
          data: new Blob([new Uint8Array([0, 0])], { type: this.mimeType }),
        });
      }
      if (this.onstop) this.onstop();
    }, 0);
  }
}

export function installWebAudioMock(target) {
  target.AudioContext = MockAudioContext;
  target.webkitAudioContext = MockAudioContext;
  target.OfflineAudioContext = MockOfflineAudioContext;
  target.webkitOfflineAudioContext = MockOfflineAudioContext;
  target.AudioWorkletNode = MockAudioWorkletNode;
  target.MediaRecorder = MockMediaRecorder;

  if (typeof target.window !== "undefined" && target.window !== target) {
    target.window.AudioContext = MockAudioContext;
    target.window.webkitAudioContext = MockAudioContext;
    target.window.OfflineAudioContext = MockOfflineAudioContext;
    target.window.webkitOfflineAudioContext = MockOfflineAudioContext;
    target.window.AudioWorkletNode = MockAudioWorkletNode;
    target.window.MediaRecorder = MockMediaRecorder;
  }
}

export {
  MockAudioContext,
  MockOfflineAudioContext,
  MockAudioBuffer,
  MockBufferSourceNode,
  MockAudioWorkletNode,
  MockMediaRecorder,
};
