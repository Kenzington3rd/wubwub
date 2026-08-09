import { buildReverbIR, buildDistortionCurve } from "./effects.js";

/**
 * Build the full per-deck signal chain.
 *
 * Signal flow:
 *   gain → [W3.7 isolation stage: dry ∥ bass/vocal/inst/drums gates] → isoOut
 *     → eqLow → eqMid → eqHigh → filter
 *     → pumpGain (W3.5 — beat-rate ducking; idle 1.0)
 *     → reverb(dry/wet, parallel) → reverbOut
 *     → delay(dry/wet, parallel; wet path has feedback loop) → delayOut
 *     → distortion(dry/wet, parallel) → distortionOut
 *     → analyser → outputNode (caller-provided; typically master compressor)
 *
 * If `recordTap` is supplied, the analyser ALSO fans out to it — a parallel
 * pre-limiter sum point used by the "Clean" recorder tap (W1.7). This is a
 * pure parallel branch: it does not alter the audible signal path, which
 * still runs analyser → outputNode unchanged.
 *
 * All effects start fully bypassed (wet=0, dry=1). Toggle via rampGain on
 * wet/dry pairs — never disconnect, to avoid clicks.
 */
export function buildDeckChain(ctx, outputNode, recordTap) {
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
  // Decay omitted — derived from duration so SIZE genuinely lengthens the
  // tail (A5).
  reverbConv.buffer = buildReverbIR(ctx, 2.0);
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
  // A8 — 2x is the audibly transparent cost-of-business setting; 4x reserved
  // for non-realtime export if added later.
  distortion.oversample = "2x";
  distortion.curve = buildDistortionCurve(40);
  const distortionDry = ctx.createGain();
  const distortionWet = ctx.createGain();
  const distortionOut = ctx.createGain();
  distortionDry.gain.value = 1;
  distortionWet.gain.value = 0;
  distortionOut.gain.value = 1;

  // ─── W3.7 — component isolation stage (post-source, pre-EQ) ───
  // Pure Web Audio "filter the track down to a component" — EQ/phase math,
  // NOT ML stem separation; bleed is expected and documented. One dry path
  // at 1.0 plus four gated wet paths, all summed into isoOut. Bypass is the
  // dry/wet-gain convention: the Deck ramps the gates with setTargetAtTime,
  // never disconnects. OFF state (dry 1, every gate 0) is bit-transparent.
  const isoDry = ctx.createGain();
  isoDry.gain.value = 1;
  const isoOut = ctx.createGain();
  isoOut.gain.value = 1;

  // BASS — steep lowpass: two cascaded 12 dB/oct biquads ≈ 24 dB/oct @180 Hz.
  const isoBassGate = ctx.createGain();
  isoBassGate.gain.value = 0;
  const isoBassF1 = ctx.createBiquadFilter();
  isoBassF1.type = "lowpass";
  isoBassF1.frequency.value = 180;
  const isoBassF2 = ctx.createBiquadFilter();
  isoBassF2.type = "lowpass";
  isoBassF2.frequency.value = 180;

  // VOCAL — centre (mid) extraction. A gain forced to one channel downmixes
  // stereo as (L+R)/2 per spec — the mid signal — then band-passed to the
  // vocal range (200 Hz highpass → 8 kHz lowpass). Pop vocals sit centre.
  const isoVocalGate = ctx.createGain();
  isoVocalGate.gain.value = 0;
  isoVocalGate.channelCount = 1;
  isoVocalGate.channelCountMode = "explicit";
  const isoVocalHp = ctx.createBiquadFilter();
  isoVocalHp.type = "highpass";
  isoVocalHp.frequency.value = 200;
  const isoVocalLp = ctx.createBiquadFilter();
  isoVocalLp.type = "lowpass";
  isoVocalLp.frequency.value = 8000;

  // INSTRUMENTAL — side extraction (the karaoke trick): signal − mid.
  // The gate feeds the sum directly AND through a mono-downmix inverted
  // gain; the sum is therefore (L−(L+R)/2, R−(L+R)/2) — the side signal,
  // which cancels centre-panned content (usually the vocal).
  const isoInstGate = ctx.createGain();
  isoInstGate.gain.value = 0;
  const isoInstInv = ctx.createGain();
  isoInstInv.gain.value = -1;
  isoInstInv.channelCount = 1;
  isoInstInv.channelCountMode = "explicit";
  const isoInstSum = ctx.createGain();
  isoInstSum.gain.value = 1;

  // DRUMS ("percussive", best-effort) — the same side construction with a
  // transient-favouring treble tilt. Kick often sits centre with the bass,
  // so bleed is expected; the UI labels this honestly.
  const isoDrumGate = ctx.createGain();
  isoDrumGate.gain.value = 0;
  const isoDrumInv = ctx.createGain();
  isoDrumInv.gain.value = -1;
  isoDrumInv.channelCount = 1;
  isoDrumInv.channelCountMode = "explicit";
  const isoDrumSum = ctx.createGain();
  isoDrumSum.gain.value = 1;
  const isoDrumTilt = ctx.createBiquadFilter();
  isoDrumTilt.type = "highshelf";
  isoDrumTilt.frequency.value = 3000;
  isoDrumTilt.gain.value = 6;

  // ─── Analyser tap (for visualization) ───
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;

  // W3.5 — PUMP gain. A unity gain between the filter sweep and the effects
  // rack whose value the Deck modulates with beat-rate setValueCurveAtTime
  // windows (sidechain-style ducking). Idle value is exactly 1.0 (bypass).
  const pumpGain = ctx.createGain();
  pumpGain.gain.value = 1;

  // ─── Wire it ───
  // W3.7 — isolation stage sits between the deck gain and the EQ.
  gain.connect(isoDry);
  isoDry.connect(isoOut);
  gain.connect(isoBassGate);
  isoBassGate.connect(isoBassF1);
  isoBassF1.connect(isoBassF2);
  isoBassF2.connect(isoOut);
  gain.connect(isoVocalGate);
  isoVocalGate.connect(isoVocalHp);
  isoVocalHp.connect(isoVocalLp);
  isoVocalLp.connect(isoOut);
  gain.connect(isoInstGate);
  isoInstGate.connect(isoInstSum);
  isoInstGate.connect(isoInstInv);
  isoInstInv.connect(isoInstSum);
  isoInstSum.connect(isoOut);
  gain.connect(isoDrumGate);
  isoDrumGate.connect(isoDrumSum);
  isoDrumGate.connect(isoDrumInv);
  isoDrumInv.connect(isoDrumSum);
  isoDrumSum.connect(isoDrumTilt);
  isoDrumTilt.connect(isoOut);

  isoOut.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(filter);

  // Reverb stage: filter feeds the pump gain, which feeds both reverb paths
  // (W3.5 — pump sits post-EQ/filter, pre-effects).
  filter.connect(pumpGain);
  pumpGain.connect(reverbDry);
  pumpGain.connect(reverbConv);
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
  // Parallel pre-limiter record tap (W1.7) — the summed deck signal *before*
  // the shared master compressor. Audible path above is untouched.
  if (recordTap) analyser.connect(recordTap);

  return {
    gain,
    isoDry,
    isoOut,
    isoBassGate,
    isoBassF1,
    isoBassF2,
    isoVocalGate,
    isoVocalHp,
    isoVocalLp,
    isoInstGate,
    isoInstInv,
    isoInstSum,
    isoDrumGate,
    isoDrumInv,
    isoDrumSum,
    isoDrumTilt,
    pumpGain,
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
