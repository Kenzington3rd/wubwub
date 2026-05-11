import { buildReverbIR, buildDistortionCurve } from "./effects.js";

/**
 * Build the full per-deck signal chain.
 *
 * Signal flow:
 *   gain → eqLow → eqMid → eqHigh → filter
 *     → reverb(dry/wet, parallel) → reverbOut
 *     → delay(dry/wet, parallel; wet path has feedback loop) → delayOut
 *     → distortion(dry/wet, parallel) → distortionOut
 *     → analyser → outputNode (caller-provided; typically master compressor)
 *
 * All effects start fully bypassed (wet=0, dry=1). Toggle via rampGain on
 * wet/dry pairs — never disconnect, to avoid clicks.
 */
export function buildDeckChain(ctx, outputNode) {
  const gain = ctx.createGain();

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = 200;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = 1500;
  eqMid.Q.value = 0.7;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = 6000;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 20000;
  filter.Q.value = 1;

  // ─── Reverb ───
  const reverbConv = ctx.createConvolver();
  reverbConv.buffer = buildReverbIR(ctx, 2.0, 3.0);
  const reverbDry = ctx.createGain();
  const reverbWet = ctx.createGain();
  const reverbOut = ctx.createGain();
  reverbDry.gain.value = 1;
  reverbWet.gain.value = 0;
  reverbOut.gain.value = 1;

  // ─── Delay ───
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.375;
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0;
  const delayDry = ctx.createGain();
  const delayWet = ctx.createGain();
  const delayOut = ctx.createGain();
  delayDry.gain.value = 1;
  delayWet.gain.value = 0;
  delayOut.gain.value = 1;

  // ─── Distortion ───
  const distortion = ctx.createWaveShaper();
  distortion.oversample = "4x";
  distortion.curve = buildDistortionCurve(40);
  const distortionDry = ctx.createGain();
  const distortionWet = ctx.createGain();
  const distortionOut = ctx.createGain();
  distortionDry.gain.value = 1;
  distortionWet.gain.value = 0;
  distortionOut.gain.value = 1;

  // ─── Analyser tap (for visualization) ───
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;

  // ─── Wire it ───
  gain.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(filter);

  // Reverb stage: filter feeds both dry path and wet path
  filter.connect(reverbDry);
  filter.connect(reverbConv);
  reverbConv.connect(reverbWet);
  reverbDry.connect(reverbOut);
  reverbWet.connect(reverbOut);

  // Delay stage
  reverbOut.connect(delayDry);
  reverbOut.connect(delay);
  delay.connect(delayWet);
  // Feedback loop — feedback gain clamped ≤ 0.9 by the UI
  delay.connect(delayFb);
  delayFb.connect(delay);
  delayDry.connect(delayOut);
  delayWet.connect(delayOut);

  // Distortion stage
  delayOut.connect(distortionDry);
  delayOut.connect(distortion);
  distortion.connect(distortionWet);
  distortionDry.connect(distortionOut);
  distortionWet.connect(distortionOut);

  // Final: distortion → analyser → master output (compressor)
  distortionOut.connect(analyser);
  analyser.connect(outputNode);

  return {
    gain,
    eqLow,
    eqMid,
    eqHigh,
    filter,
    reverbConv,
    reverbDry,
    reverbWet,
    reverbOut,
    delay,
    delayFb,
    delayDry,
    delayWet,
    delayOut,
    distortion,
    distortionDry,
    distortionWet,
    distortionOut,
    analyser,
  };
}

// Disconnect every node in the chain. Safe to call repeatedly.
export function disconnectChain(nodes) {
  if (!nodes) return;
  for (const node of Object.values(nodes)) {
    if (node && typeof node.disconnect === "function") {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}
