// W3.6 × W3.7 — render a buffer offline through one of the component-
// isolation paths, so an extracted sound-bite captures the isolated
// component rather than the full mix. The node topology and constants
// mirror the live isolation stage in chain.js (buildDeckChain) — any change
// there must be reflected here (both are pinned by tests).
export const ISOLATION_MODES = ["bass", "vocal", "instrumental", "drums"];

export async function renderIsolated(audioBuffer, mode) {
  if (!ISOLATION_MODES.includes(mode)) return audioBuffer;
  const Offline =
    typeof OfflineAudioContext !== "undefined"
      ? OfflineAudioContext
      : typeof webkitOfflineAudioContext !== "undefined"
        ? webkitOfflineAudioContext
        : null;
  if (!Offline) return audioBuffer;

  const ctx = new Offline(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;

  if (mode === "bass") {
    const f1 = ctx.createBiquadFilter();
    f1.type = "lowpass";
    f1.frequency.value = 180;
    const f2 = ctx.createBiquadFilter();
    f2.type = "lowpass";
    f2.frequency.value = 180;
    src.connect(f1);
    f1.connect(f2);
    f2.connect(ctx.destination);
  } else if (mode === "vocal") {
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = "explicit";
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 200;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 8000;
    src.connect(mono);
    mono.connect(hp);
    hp.connect(lp);
    lp.connect(ctx.destination);
  } else {
    // instrumental / drums — side extraction: signal + inverted mono mid.
    const sum = ctx.createGain();
    const inv = ctx.createGain();
    inv.gain.value = -1;
    inv.channelCount = 1;
    inv.channelCountMode = "explicit";
    src.connect(sum);
    src.connect(inv);
    inv.connect(sum);
    if (mode === "drums") {
      const tilt = ctx.createBiquadFilter();
      tilt.type = "highshelf";
      tilt.frequency.value = 3000;
      tilt.gain.value = 6;
      sum.connect(tilt);
      tilt.connect(ctx.destination);
    } else {
      sum.connect(ctx.destination);
    }
  }

  src.start();
  return ctx.startRendering();
}
