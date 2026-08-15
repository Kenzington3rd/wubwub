import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Knob from "./Knob.jsx";
import Slider from "./Slider.jsx";
import WaveformCanvas from "./WaveformCanvas.jsx";
import Icon from "./Icon.jsx";
import EffectCard from "./EffectCard.jsx";
import CuePanel from "./CuePanel.jsx";
import BassDropMenu from "./BassDropMenu.jsx";
import { buildDeckChain, disconnectChain } from "../audio/chain.js";
// W3.1 — KEYLOCK time-stretch worklet. Same delivery contract as the looper
// worklet: `?raw` source, Blob-URL registration, never a static path.
import stretchWorkletSrc from "../worklets/stretch-worklet.js?raw";
import { encodeWav, sliceBuffer } from "../audio/wavEncode.js";
import { renderIsolated } from "../audio/isolationRender.js";
import { downloadBlob } from "../audio/recorder.js";
import { buildReverbIR, buildDistortionCurve, clamp, rampGain } from "../audio/effects.js";
import { detectBpm } from "../audio/bpmDetect.js";
import { detectKey } from "../audio/keyDetect.js";
import { BASS_DROP_PRESETS, camelotCompatible } from "../data.js";

// Momentary pitch-bend offset applied on top of the deck's base speed while a
// NUDGE button is held. ±4% is enough to slide a track into phase by ear.
const NUDGE_OFFSET = 0.04;

const MAX_CUES = 8;

const CUE_PALETTE = ["#00f5d4", "#a78bfa", "#f0c040", "#f472b6", "#4ade80", "#fb923c", "#60a5fa", "#fde047"];

// Visually hidden, but still announced by screen readers.
const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// W3.3 — gain (dB) a killed EQ band ramps to. Deliberately below the knob's
// −12 dB floor: a DJ "kill" silences the band, it doesn't just duck it. The
// BiquadFilter gain param accepts values past the UI range.
const EQ_KILL_DB = -26;

// W3.1 — one stretch-worklet module registration per AudioContext, shared by
// all three decks. Keyed by ctx so a rebuilt context re-registers cleanly.
const stretchModulePromises = new WeakMap();
function ensureStretchModule(ctx) {
  if (!ctx?.audioWorklet?.addModule) return Promise.resolve(false);
  if (!stretchModulePromises.has(ctx)) {
    stretchModulePromises.set(
      ctx,
      (async () => {
        let url = null;
        try {
          url = URL.createObjectURL(
            new Blob([stretchWorkletSrc], { type: "text/javascript" })
          );
          await ctx.audioWorklet.addModule(url);
          return true;
        } catch (err) {
          console.warn("Stretch worklet failed to load — KEYLOCK unavailable.", err);
          return false;
        } finally {
          if (url) { try { URL.revokeObjectURL(url); } catch {} }
        }
      })()
    );
  }
  return stretchModulePromises.get(ctx);
}

// W3.6 — shared style for the bite-row buttons.
function biteBtnStyle(active, color, enabled) {
  return {
    background: active ? `${color}22` : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? color : `${color}33`}`,
    color: !enabled ? "#8892b0" : active ? color : "#8892b0",
    borderRadius: 6,
    padding: "4px 10px",
    minHeight: 38,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.6,
    fontFamily: "'Exo 2', sans-serif",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const Deck = forwardRef(function Deck(
  {
    id,
    color,
    audioCtxRef,
    masterCompressorRef,
    recordTapRef,
    ensureMasterCtx,
    crossfadeGain,
    // W3.8 — crossfader assign for this deck ("A" | "THRU" | "B") and its
    // change handler. Rendered as a 3-position segmented control in the
    // header. Optional: when omitted the control is hidden (legacy two-deck
    // rendering in isolated component tests).
    assign,
    onAssignChange,
    // W3.6 — sound-bite routing (same adoption paths the VOX panel uses).
    // Optional; the BITE send buttons that need them hide when absent.
    onSendToCrate,
    onSendToPad,
    focused,
    onFocus,
    onSync,
    onKeyDetected,
  },
  ref
) {
  // ─── UI state ───
  const [fileName, setFileName] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 });
  const [speed, setSpeedState] = useState(1.0);
  const [filterFreq, setFilterFreq] = useState(20000);
  const [isLooping, setIsLooping] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bassDropActive, setBassDropActive] = useState(false);
  const [bassDropPreset, setBassDropPreset] = useState("standard");
  // Error state carries an id alongside the text so a repeated identical error
  // re-announces on screen readers. A role="alert" region only triggers on a
  // DOM diff — identical text alone wouldn't re-announce. The id is used as a
  // `key` on the alert wrapper so each new error remounts the node.
  const [loadError, setLoadError] = useState(null);
  const loadErrorIdRef = useRef(0);
  const showLoadError = useCallback((text) => {
    setLoadError({ id: ++loadErrorIdRef.current, text });
  }, []);
  const [bpm, setBpm] = useState(128);
  const [bpmConfidence, setBpmConfidence] = useState(null);
  const [autoBpmRunning, setAutoBpmRunning] = useState(false);
  // Screen-reader announcement scoped to auto-detect completion only. TAP
  // writes the same {bpm} number into the visible UI but must NOT announce,
  // so the live region is separate from the always-present BPM display.
  const [bpmAnnounce, setBpmAnnounce] = useState("");
  const [detectedKey, setDetectedKey] = useState(null);
  const [effects, setEffects] = useState({
    reverb: { on: false, mix: 0.3, size: 2.0 },
    delay: { on: false, mix: 0.3, time: 0.375, feedback: 0.4 },
    distortion: { on: false, mix: 0.4, drive: 40 },
  });
  const [cues, setCues] = useState([]);
  const cueIdRef = useRef(0);
  // Incremented every time `chainRef.current` is (re)constructed. Used as a
  // dep on every chain-mutating useEffect so that UI state set before the
  // chain existed (e.g. user toggles reverb before loading a file) gets
  // applied as soon as the chain comes into existence.
  const [chainTick, setChainTick] = useState(0);

  // ─── Refs for non-rendering state ───
  const bufferRef = useRef(null);
  const sourceRef = useRef(null);
  const chainRef = useRef(null); // The full graph from buildDeckChain
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const speedRef = useRef(speed);
  // Temporary pitch-bend offset (NUDGE buttons). Added on top of `speed`;
  // never persisted to the speed state. 0 when no nudge is held.
  const bendRef = useRef(0);
  const isLoopingRef = useRef(isLooping);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const cuesRef = useRef([]);
  const bpmRef = useRef(bpm);
  const timeIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const bassDropTimeoutRef = useRef(null);
  const wobbleNodesRef = useRef(null);
  const reverbSizeDebounceRef = useRef(null);
  // R18 T3 — debounce for the distortion DRIVE curve hot-swap. Mirrors the
  // reverb-size debounce: a rapid knob spin would otherwise rebuild the
  // WaveShaper transfer function on every onChange tick and produce an
  // audible step whenever wet > 0. The debounce coalesces fast spins into
  // one swap, and the swap itself uses the duck-swap-restore pattern.
  const distortionDriveDebounceRef = useRef(null);
  const filterFreqRef = useRef(20000);
  // X4 (R21) — mirror effects.reverb.mix / effects.distortion.mix into refs.
  // The reverb-size and distortion-drive debounces (R20) intentionally do NOT
  // list mix in their deps to avoid spurious rebuilds on MIX-knob moves, so
  // the timer body's closure captures the mix value at the moment the timer
  // was *scheduled*. If the user spins MIX inside the 200 ms debounce window,
  // the ramp-back endpoint would otherwise pin wet to the STALE captured
  // value, overriding the live wet ramp from the non-debounced mix effect.
  // Reading from these refs in the timer body keeps the ramp-back aligned
  // with the user's current MIX position. Mirrors the eqLowRef / filterFreqRef
  // pattern above.
  const reverbMixRef = useRef(0.3);
  const distortionMixRef = useRef(0.4);
  // V5 (R19) — mirror the EQ knob values into refs so the bass-drop's t3
  // recovery endpoint reads the user's CURRENT value (not the closure value
  // captured when triggerBassDrop was called). Without these refs, moving an
  // EQ knob during a running drop is "snapped back" to the old value the
  // moment the drop's recovery ramp lands. The mirror useEffect below also
  // breaks the closed-loop: when a drop is running, the EQ/filter effects
  // cancel the live schedule before re-applying setTargetAtTime so the user
  // change takes effect immediately while the bass-drop schedule still owns
  // the recovery point.
  const eqLowRef = useRef(0);
  const eqMidRef = useRef(0);
  const eqHighRef = useRef(0);
  // W3.3 — per-band EQ kill switches. Kill state is deliberately SEPARATE
  // from the knob state: killing a band ramps the filter gain to KILL_DB
  // without moving the knob, and un-killing restores the knob's exact prior
  // value (which may have been turned while killed — the effective gain
  // always re-derives from the live pair).
  const [eqKills, setEqKills] = useState({ low: false, mid: false, high: false });
  // W3.7 — component isolation mode. null = OFF (dry path, bit-transparent);
  // otherwise one of "bass" | "vocal" | "instrumental" | "drums". Mutually
  // exclusive (radio-style) — engaging one disengages the others.
  const [isolate, setIsolate] = useState(null);
  // W3.6 — sound-bite region (seconds). Set from the playhead via the IN /
  // OUT buttons; drawn on the waveform via biteRegionRef; extracted as an
  // in-memory slice (through the active isolation mode, if any).
  const [bite, setBite] = useState({ in: null, out: null });
  const [bitePreviewing, setBitePreviewing] = useState(false);
  const [bitePad, setBitePad] = useState(0);
  const biteRegionRef = useRef({ in: null, out: null });
  const bitePreviewSourceRef = useRef(null);
  const biteCountRef = useRef(0);
  // W3.5 — sidechain-style PUMP: { on, depth 0..1 }. When on, the chain's
  // pumpGain is driven by one setValueCurveAtTime window per beat (fast dip →
  // exponential recovery), armed a few beats ahead by an interval timer and
  // re-read from the live effective BPM so tempo/speed changes track. Phase
  // is free-running (no beat-grid alignment), matching the beat indicator.
  const [pump, setPump] = useState({ on: false, depth: 0.6 });
  const pumpTimerRef = useRef(null);
  const pumpArmedUntilRef = useRef(0);
  // W3.4 — momentary loop roll. While held, the main source is silenced but
  // the deck's wall-clock timeline keeps running; a loop source repeats the
  // last N beats; releasing re-anchors playback at the advanced position
  // ("the timeline kept running underneath"). Press-time quantization —
  // free-running phase, per the spike findings.
  const [rollActive, setRollActive] = useState(null); // beats value while held
  const rollRef = useRef(null); // { source }
  // W3.1 — playback mode. "vari" (default) is the classic varispeed
  // BufferSource path, bit-for-bit unchanged. "keylock" routes playback
  // through the stretch worklet: tempo follows the speed slider while pitch
  // stays at the track's original (experimental — opt-in, session-only).
  const [playMode, setPlayMode] = useState("vari");
  const playModeRef = useRef("vari");
  const stretchNodeRef = useRef(null);
  // Which AudioBuffer has been posted into the worklet (avoid re-transfer).
  const stretchLoadedBufferRef = useRef(null);
  // R17 Q2 — mirror of `volume` for the MIDI relative-encoder getter so the
  // App can always read the *current* deck volume at CC-dispatch time without
  // depending on the imperative handle being re-created (it isn't gated on
  // `volume` in deps). speed/filter already have their own refs above.
  const volumeRef = useRef(0.8);
  // Synchronous re-entry guard for auto-detect. `autoBpmRunning` state lags a
  // render, so a programmatic / MIDI double-trigger could start two detections
  // before the disabled attribute updates.
  const autoDetectRunningRef = useRef(false);
  // Same race for the bass drop: `bassDropActive` state lags a render, so a
  // programmatic / MIDI double-fire could schedule two overlapping automation
  // envelopes and leak a wobble oscillator. This ref guards synchronously.
  const bassDropRunningRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => {
    isLoopingRef.current = isLooping;
    if (sourceRef.current) sourceRef.current.loop = isLooping;
  }, [isLooping]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { cuesRef.current = cues; }, [cues]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { filterFreqRef.current = filterFreq; }, [filterFreq]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  // V5 (R19) — EQ ref mirrors. Kept on every tick so the bass-drop's t3
  // recovery reads the LIVE user value even when the user moved the knob
  // during the drop's automation window.
  // W3.3 — the refs mirror the EFFECTIVE gain (kill overrides knob) so the
  // bass-drop's t3 recovery lands on the killed value while a kill is held,
  // not on a knob value the listener can't currently hear.
  useEffect(() => {
    eqLowRef.current = eqKills.low ? EQ_KILL_DB : eq.low;
    eqMidRef.current = eqKills.mid ? EQ_KILL_DB : eq.mid;
    eqHighRef.current = eqKills.high ? EQ_KILL_DB : eq.high;
  }, [eq, eqKills]);
  // X4 (R21) — reverb / distortion MIX ref mirrors. The size-debounce and
  // drive-debounce timers (200 ms) read MIX from these refs when computing
  // the ramp-back target, so a MIX slide during the debounce window lands at
  // the user's CURRENT value instead of the stale closure capture.
  useEffect(() => {
    reverbMixRef.current = effects.reverb.mix;
  }, [effects.reverb.mix]);
  useEffect(() => {
    distortionMixRef.current = effects.distortion.mix;
  }, [effects.distortion.mix]);

  // ─── Audio graph construction ───
  const buildChain = useCallback(async () => {
    const ctx = await ensureMasterCtx();
    if (!chainRef.current) {
      chainRef.current = buildDeckChain(
        ctx,
        masterCompressorRef.current,
        recordTapRef?.current
      );
      // Signal the chain-mutating useEffects to re-run with the live chain
      // so any state set before now (effects toggled, EQ tweaked, etc.)
      // gets applied.
      setChainTick((t) => t + 1);
    }
    return chainRef.current;
  }, [ensureMasterCtx, masterCompressorRef, recordTapRef]);

  // ─── Apply gain (volume × crossfade) ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    rampGain(chain.gain.gain, volume * crossfadeGain, ctx);
  }, [volume, crossfadeGain, audioCtxRef, chainTick]);

  // V5 (R19) — apply a user-driven AudioParam change while another automation
  // schedule (e.g. a running bass drop) owns the same param. A plain
  // setTargetAtTime would queue BEHIND the existing schedule and only land
  // after the bass-drop's recovery ramp completed — the user's change appears
  // to "snap back". Prefer cancelAndHoldAtTime (newer spec) so the engine
  // freezes whatever value the existing automation is currently producing,
  // then we schedule the user's value from there. Falls back to
  // cancelScheduledValues + setValueAtTime(currentValue) on older engines.
  const reapplyParamThroughAutomation = useCallback((param, target, ctx, tau) => {
    const t = ctx.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(t);
    } else {
      const current = param.value;
      param.cancelScheduledValues(t);
      param.setValueAtTime(current, t);
    }
    param.setTargetAtTime(target, t, tau);
  }, []);

  // ─── EQ ───
  // R18 T1 — direct `.value =` writes on a live AudioParam produce audible
  // zipper noise on rapid knob turns (each write is a step in the param's
  // automation curve). Mirror the LPF-sweep / master-volume convention and
  // schedule a short-tau setTargetAtTime instead. 0.02 s matches the
  // rampGain default for gain params and keeps the response visually instant
  // while smoothing the inter-sample interpolation.
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    // V5 (R19) — during a bass drop the EQ-low schedule is owned by the drop
    // (a multi-leg linearRamp set). A plain setTargetAtTime here would queue
    // behind those ramps and not take effect until t3 — the user-perceived
    // "snap back". Cancel-and-hold first so the user's change applies now.
    // W3.3 — a killed band's effective gain is EQ_KILL_DB regardless of the
    // knob; the knob value is untouched and restores exactly on un-kill.
    const low = eqKills.low ? EQ_KILL_DB : eq.low;
    const mid = eqKills.mid ? EQ_KILL_DB : eq.mid;
    const high = eqKills.high ? EQ_KILL_DB : eq.high;
    if (bassDropRunningRef.current) {
      reapplyParamThroughAutomation(chain.eqLow.gain, low, ctx, 0.02);
      reapplyParamThroughAutomation(chain.eqMid.gain, mid, ctx, 0.02);
      reapplyParamThroughAutomation(chain.eqHigh.gain, high, ctx, 0.02);
    } else {
      chain.eqLow.gain.setTargetAtTime(low, ctx.currentTime, 0.02);
      chain.eqMid.gain.setTargetAtTime(mid, ctx.currentTime, 0.02);
      chain.eqHigh.gain.setTargetAtTime(high, ctx.currentTime, 0.02);
    }
  }, [eq, eqKills, audioCtxRef, chainTick, reapplyParamThroughAutomation]);

  // ─── W3.7 — component isolation gates ───
  // One dry gain + four gated wet paths built in chain.js. Engaging a mode
  // ramps the dry to 0 and that mode's gate to 1 (setTargetAtTime — the
  // dry/wet bypass convention, never disconnect); OFF restores dry = 1.0
  // exactly so the stage is bit-transparent when idle.
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx || !chain.isoDry) return;
    const t = ctx.currentTime;
    const gates = {
      bass: chain.isoBassGate,
      vocal: chain.isoVocalGate,
      instrumental: chain.isoInstGate,
      drums: chain.isoDrumGate,
    };
    chain.isoDry.gain.setTargetAtTime(isolate ? 0 : 1, t, 0.02);
    for (const [mode, gate] of Object.entries(gates)) {
      gate.gain.setTargetAtTime(isolate === mode ? 1 : 0, t, 0.02);
    }
  }, [isolate, audioCtxRef, chainTick]);

  // ─── W3.6 — sound-bite region ───
  useEffect(() => { biteRegionRef.current = bite; }, [bite]);

  const stopBitePreview = useCallback(() => {
    const src = bitePreviewSourceRef.current;
    if (src) {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
      bitePreviewSourceRef.current = null;
    }
    setBitePreviewing(false);
  }, []);

  // Loop-preview the region through the deck's own chain (EQ, effects and
  // any active isolation apply — so what you hear is what extraction saves).
  const toggleBitePreview = useCallback(() => {
    if (bitePreviewSourceRef.current) {
      stopBitePreview();
      return;
    }
    const ctx = audioCtxRef.current;
    const chain = chainRef.current;
    const buf = bufferRef.current;
    const { in: bIn, out: bOut } = biteRegionRef.current;
    if (!ctx || !chain || !buf || bIn == null || bOut == null || bOut <= bIn) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = bIn;
    src.loopEnd = bOut;
    src.connect(chain.gain);
    bitePreviewSourceRef.current = src;
    setBitePreviewing(true);
    src.start(0, bIn);
  }, [audioCtxRef, stopBitePreview]);

  // Extract the region: in-memory slice with equal-power edge fades; if an
  // isolation mode is engaged, the slice renders offline through the same
  // isolation path so the saved bite IS the isolated component.
  const extractBite = useCallback(async () => {
    const ctx = audioCtxRef.current;
    const buf = bufferRef.current;
    const { in: bIn, out: bOut } = biteRegionRef.current;
    if (!ctx || !buf || bIn == null || bOut == null || bOut <= bIn) return null;
    let slice = sliceBuffer(ctx, buf, bIn, bOut);
    if (!slice) return null;
    if (isolate) slice = await renderIsolated(slice, isolate);
    const n = ++biteCountRef.current;
    const base = (fileName || "track").replace(/\.[^.]+$/, "");
    return { buffer: slice, name: `${base} bite ${n}${isolate ? ` (${isolate})` : ""}` };
  }, [audioCtxRef, isolate, fileName]);

  const sendBite = useCallback(
    async (where) => {
      stopBitePreview();
      const bitePkg = await extractBite();
      if (!bitePkg) return;
      if (where === "crate") onSendToCrate?.(bitePkg.buffer, bitePkg.name);
      else if (where === "pad") onSendToPad?.(bitePad, bitePkg.buffer, bitePkg.name);
      else if (where === "wav") {
        downloadBlob(encodeWav(bitePkg.buffer), `${bitePkg.name.replace(/\s+/g, "-")}.wav`);
      }
    },
    [extractBite, onSendToCrate, onSendToPad, bitePad, stopBitePreview]
  );

  // ─── W3.5 — PUMP scheduler ───
  // Arms one gain-curve window per beat on chain.pumpGain, keeping ~4 beats
  // of schedule in flight (re-armed by an interval, so long sessions never
  // pile up an unbounded queue). The interval timer only PLANS the windows —
  // the audio-thread automation runs them; no setTimeout ever touches audio.
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx || !chain.pumpGain) return;
    const param = chain.pumpGain.gain;

    if (!pump.on || pump.depth <= 0) {
      // Bypass: drop any scheduled windows and return to exactly 1.0.
      clearInterval(pumpTimerRef.current);
      pumpTimerRef.current = null;
      try { param.cancelScheduledValues(ctx.currentTime); } catch {}
      param.setTargetAtTime(1, ctx.currentTime, 0.02);
      pumpArmedUntilRef.current = 0;
      return;
    }

    // One beat's curve: instant dip to (1 - depth), exponential recovery
    // to 1.0 across the beat. 64 points is plenty for a gain envelope.
    const makeCurve = (depth) => {
      const N = 64;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const phase = i / (N - 1);
        curve[i] = 1 - depth * Math.exp(-5 * phase);
      }
      curve[N - 1] = 1;
      return curve;
    };

    const arm = () => {
      const now = ctx.currentTime;
      // Effective BPM = detected BPM × current speed; re-read every arm pass
      // so SYNC / speed-slider changes retune the pump within a beat or two.
      const effBpm = Math.max(40, bpmRef.current * (speedRef.current || 1));
      const period = 60 / effBpm;
      const curve = makeCurve(pump.depth);
      let t = Math.max(pumpArmedUntilRef.current, now + 0.02);
      // Keep ~4 beats armed ahead.
      while (t < now + 4 * period) {
        try {
          param.setValueCurveAtTime(curve, t, period * 0.98);
        } catch {
          // Overlapping-window race (e.g. depth changed mid-arm) — skip this
          // window; the next arm pass recovers.
        }
        t += period;
      }
      pumpArmedUntilRef.current = t;
    };

    // Fresh engage: clear stale schedule, start phase now.
    try { param.cancelScheduledValues(ctx.currentTime); } catch {}
    pumpArmedUntilRef.current = 0;
    arm();
    pumpTimerRef.current = setInterval(arm, 500);
    return () => {
      clearInterval(pumpTimerRef.current);
      pumpTimerRef.current = null;
    };
  }, [pump, audioCtxRef, chainTick]);

  // ─── Filter sweep ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    // V5 (R19) — same contention path as EQ: while a bass drop is running its
    // LPF schedule owns the param. Cancel-and-hold so the user's slider move
    // applies immediately, not after t3.
    if (bassDropRunningRef.current) {
      reapplyParamThroughAutomation(chain.filter.frequency, filterFreq, ctx, 0.03);
    } else {
      chain.filter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.03);
    }
  }, [filterFreq, audioCtxRef, chainTick, reapplyParamThroughAutomation]);

  // ─── Effects: reverb mix/on ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    const { on, mix } = effects.reverb;
    const targetWet = on ? mix : 0;
    const targetDry = on ? 1 - mix : 1;
    rampGain(chain.reverbWet.gain, targetWet, ctx);
    rampGain(chain.reverbDry.gain, targetDry, ctx);
  }, [effects.reverb.on, effects.reverb.mix, audioCtxRef, chainTick]);

  // ─── Effects: reverb size (rebuild IR, debounced) ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    clearTimeout(reverbSizeDebounceRef.current);
    reverbSizeDebounceRef.current = setTimeout(() => {
      // P1 (R16) / V1 (R19) — swapping the convolver buffer mid-tail truncates
      // the live decay and produces an audible thump whenever wet > 0. The
      // earlier two-ramp pattern (ramp to 0, swap, ramp back) anchored BOTH
      // setTargetAtTime calls at the same ctx.currentTime, so the restore
      // ramp replaced the duck ramp on the same param at the same instant —
      // the duck never actually happened. Synchronous-pin approach: pin wet
      // to 0 instantaneously with setValueAtTime, swap the buffer while the
      // convolver sees a 0-input window, then ramp wet back to target.
      // setValueAtTime + setTargetAtTime applied back-to-back are an atomic
      // step+ramp in the Web Audio engine, so the swap window is always
      // covered by zero input. If wet is already ~0 we skip the pin and
      // ramp-back and just swap (no audible click possible).
      const wetParam = chain.reverbWet.gain;
      // X4 (R21) — read MIX via the ref so a MIX slide during the 200 ms
      // debounce window lands at the user's CURRENT value, not the value
      // captured in this closure when the timer was scheduled. Without the
      // ref, the ramp-back would override the live wet ramp produced by the
      // non-debounced mix effect, snapping audio back to the stale capture.
      const targetWet = effects.reverb.on ? reverbMixRef.current : 0;
      const liveWet = wetParam.value;
      if (liveWet > 0.001) {
        wetParam.setValueAtTime(0, ctx.currentTime);
        // A5 — decay omitted so it scales with SIZE.
        chain.reverbConv.buffer = buildReverbIR(ctx, effects.reverb.size);
        rampGain(wetParam, targetWet, ctx, 0.003);
      } else {
        chain.reverbConv.buffer = buildReverbIR(ctx, effects.reverb.size);
      }
    }, 200);
    return () => clearTimeout(reverbSizeDebounceRef.current);
    // W2 (R20) — MIX is owned by the separate non-debounced wet-gain effect
    // above (lines ~269-278). Listing effects.reverb.mix here caused a
    // 200 ms-debounced duck-swap-restore to fire every time the MIX knob
    // moved, audibly dipping the wet bus. Deps are now ONLY the size value
    // plus on + chainTick (size is what actually requires the IR rebuild;
    // on is kept so the effect runs on first toggle if it ever needs to,
    // and chainTick re-runs after a chain rebuild). MIX changes continue to
    // ramp the wet gain directly via the dedicated effect.
  }, [effects.reverb.size, effects.reverb.on, audioCtxRef, chainTick]);

  // ─── Effects: delay (on/mix/time/feedback) ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    const { on, mix, time, feedback } = effects.delay;
    const targetWet = on ? mix : 0;
    const targetDry = on ? 1 - mix : 1;
    rampGain(chain.delayWet.gain, targetWet, ctx);
    rampGain(chain.delayDry.gain, targetDry, ctx);
    chain.delay.delayTime.setTargetAtTime(time, ctx.currentTime, 0.05);
    // Clamp feedback ≤ 0.9 to prevent runaway
    rampGain(chain.delayFb.gain, on ? clamp(feedback, 0, 0.9) : 0, ctx, 0.05);
  }, [effects.delay.on, effects.delay.mix, effects.delay.time, effects.delay.feedback, audioCtxRef, chainTick]);

  // ─── Effects: distortion mix/on ───
  // Split from the drive-curve swap below: mix/on changes ramp the wet/dry
  // gain pair the usual way; the drive change goes through a duck-swap-
  // restore (see below) so a curve hot-swap mid-signal is inaudible.
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    const { on, mix } = effects.distortion;
    const targetWet = on ? mix : 0;
    const targetDry = on ? 1 - mix : 1;
    rampGain(chain.distortionWet.gain, targetWet, ctx);
    rampGain(chain.distortionDry.gain, targetDry, ctx);
  }, [effects.distortion.on, effects.distortion.mix, audioCtxRef, chainTick]);

  // ─── Effects: distortion drive (rebuild curve, debounced) ───
  // R18 T3 — instantly assigning `chain.distortion.curve = new Float32Array`
  // while wet > 0 produces an audible discontinuity at the swap sample (the
  // WaveShaper transfer function changes shape between two consecutive input
  // samples). Mirror the reverb-size pattern: when wet is non-trivial, ramp
  // wet to 0, swap the curve, then ramp wet back to the user's target. When
  // wet is already ~0 the swap is silent and we skip the duck. The 200 ms
  // debounce coalesces rapid knob spins into a single swap and gives the
  // ~3 ms ramps plenty of headroom on either side.
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    clearTimeout(distortionDriveDebounceRef.current);
    distortionDriveDebounceRef.current = setTimeout(() => {
      // V1 (R19) — same race the reverb-size swap had: a ramp-to-0 followed
      // by an immediate ramp-back, both anchored at ctx.currentTime, leaves
      // the restore ramp replacing the duck ramp on the same param at the
      // same instant — the duck never happened. Synchronous-pin: setValueAtTime
      // jams wet to 0 atomically, the curve swap lands while the WaveShaper
      // sees a 0-input window, then ramp wet back to target.
      const wetParam = chain.distortionWet.gain;
      const { on, drive } = effects.distortion;
      // X4 (R21) — read MIX via the ref so a slide during the 200 ms debounce
      // window lands at the user's CURRENT value, not the stale closure
      // capture. Mirrors the reverb-size fix above.
      const targetWet = on ? distortionMixRef.current : 0;
      const liveWet = wetParam.value;
      if (liveWet > 0.001) {
        wetParam.setValueAtTime(0, ctx.currentTime);
        chain.distortion.curve = buildDistortionCurve(drive);
        rampGain(wetParam, targetWet, ctx, 0.003);
      } else {
        chain.distortion.curve = buildDistortionCurve(drive);
      }
    }, 200);
    return () => clearTimeout(distortionDriveDebounceRef.current);
    // W2 (R20) — same fix as the reverb-size debounce above. MIX is owned by
    // the separate non-debounced wet-gain effect (lines ~333-342). Listing
    // effects.distortion.mix here caused a 200 ms-debounced duck-swap-restore
    // to fire on every MIX knob move, audibly dipping the wet bus. Deps are
    // now ONLY drive + on + chainTick.
  }, [effects.distortion.drive, effects.distortion.on, audioCtxRef, chainTick]);

  // ─── Source lifecycle ───
  const stopAndDisconnectSource = useCallback(() => {
    // W3.4 — any transport action that silences the main source also ends a
    // held roll (pause/stop/load must never leave a loop source ringing).
    const roll = rollRef.current;
    if (roll) {
      rollRef.current = null;
      setRollActive(null);
      try { roll.source.stop(); } catch {}
      try { roll.source.disconnect(); } catch {}
    }
    const src = sourceRef.current;
    // W3.1 — silencing the deck also pauses a live KEYLOCK worklet stream
    // (harmless no-op when the node is idle or absent).
    try { stretchNodeRef.current?.port?.postMessage({ type: "pause" }); } catch {}
    if (!src) return;
    try {
      src.onended = null;
      src.stop();
    } catch {}
    try {
      src.disconnect();
    } catch {}
    sourceRef.current = null;
  }, []);

  // ─── W3.1 — KEYLOCK stretch node ───
  // Lazily create this deck's AudioWorkletNode (module registration is
  // shared per-context) and keep the current buffer's channel data loaded
  // into it. Returns null when worklets are unavailable — the caller falls
  // back to VARI.
  const ensureStretchNode = useCallback(
    async (ctx, chain) => {
      if (stretchNodeRef.current) return stretchNodeRef.current;
      const ok = await ensureStretchModule(ctx);
      if (!ok) return null;
      let node;
      try {
        node = new AudioWorkletNode(ctx, "stretch-processor", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
      } catch (err) {
        console.warn("Stretch node construction failed — KEYLOCK unavailable.", err);
        return null;
      }
      node.connect(chain.gain);
      node.port.onmessage = (e) => {
        const m = e.data || {};
        if (playModeRef.current !== "keylock") return;
        if (m.type === "position" && isPlayingRef.current) {
          // Drift correction: the worklet's own read head is the truth in
          // KEYLOCK. Re-anchor the wall-clock so the interval agrees.
          const c = audioCtxRef.current;
          const effRate = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
          currentTimeRef.current = m.seconds;
          setCurrentTime(m.seconds);
          if (c) startTimeRef.current = c.currentTime - m.seconds / effRate;
        } else if (m.type === "ended") {
          if (isLoopingRef.current) {
            // Coarse loop support: restart from the top.
            const c = audioCtxRef.current;
            node.port.postMessage({ type: "play", offset: 0 });
            currentTimeRef.current = 0;
            if (c) {
              const effRate = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
              startTimeRef.current = c.currentTime - 0 / effRate;
            }
          } else if (isPlayingRef.current) {
            isPlayingRef.current = false;
            setIsPlaying(false);
            offsetRef.current = 0;
            currentTimeRef.current = 0;
            setCurrentTime(0);
            clearInterval(timeIntervalRef.current);
          }
        }
      };
      stretchNodeRef.current = node;
      return node;
    },
    [audioCtxRef]
  );

  const postBufferToStretch = useCallback((node) => {
    const buf = bufferRef.current;
    if (!node || !buf || stretchLoadedBufferRef.current === buf) return;
    // Copy the channel data (the deck keeps its own buffer for VARI /
    // bites / rolls) and transfer the copies into the worklet.
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      channels.push(buf.getChannelData(c).slice());
    }
    node.port.postMessage(
      { type: "load", channels, sampleRate: buf.sampleRate },
      channels.map((ch) => ch.buffer)
    );
    stretchLoadedBufferRef.current = buf;
  }, []);

  // Write the effective rate (speed + held bend) to the stretch worklet's
  // rate param — tempo modulation with pitch untouched (that's the point).
  const updateStretchRate = useCallback(() => {
    const node = stretchNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!node || !ctx) return;
    const effRate = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
    try {
      node.parameters.get("rate").setTargetAtTime(effRate, ctx.currentTime, 0.015);
    } catch {}
  }, [audioCtxRef]);

  const seekTo = useCallback(
    async (targetSeconds, { autoplay = false } = {}) => {
      const buffer = bufferRef.current;
      if (!buffer) return;
      const target = Math.max(0, Math.min(buffer.duration, targetSeconds));
      const shouldPlay = isPlayingRef.current || autoplay;

      const ctx = await ensureMasterCtx();
      const chain = await buildChain();

      stopAndDisconnectSource();
      offsetRef.current = target;
      currentTimeRef.current = target;
      setCurrentTime(target);

      if (!shouldPlay) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        clearInterval(timeIntervalRef.current);
        return;
      }

      // ── W3.1 — KEYLOCK branch: stream through the stretch worklet ──
      if (playModeRef.current === "keylock") {
        const node = await ensureStretchNode(ctx, chain);
        if (node) {
          postBufferToStretch(node);
          updateStretchRate();
          node.port.postMessage({ type: "play", offset: target });
          const effRate = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
          startTimeRef.current = ctx.currentTime - target / effRate;
          isPlayingRef.current = true;
          setIsPlaying(true);
          clearInterval(timeIntervalRef.current);
          timeIntervalRef.current = setInterval(() => {
            const c = audioCtxRef.current;
            if (!c || !isPlayingRef.current) return;
            const r = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
            const elapsed = (c.currentTime - startTimeRef.current) * r;
            const d = durationRef.current;
            const t = isLoopingRef.current && d > 0 ? elapsed % d : Math.min(elapsed, d || elapsed);
            currentTimeRef.current = t;
            setCurrentTime(t);
          }, 100);
          return;
        }
        // Worklet unavailable → fall back to VARI silently but visibly.
        playModeRef.current = "vari";
        setPlayMode("vari");
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = isLoopingRef.current;
      // Honour an in-progress pitch-bend so a seek mid-nudge doesn't snap the
      // pitch. bendRef is 0 unless a NUDGE button is currently held.
      const effRate = clamp(speedRef.current + bendRef.current, 0.5, 2.0);
      src.playbackRate.value = effRate;
      src.connect(chain.gain);
      src.start(0, target);
      sourceRef.current = src;
      // A3 — anchor startTimeRef against the *effective* rate the source is
      // actually running at. The position interval will recompute elapsed as
      // (ctx.currentTime - startTimeRef) * effRate, so the two must use the
      // same divisor or the displayed time drifts by ±4% relative to the
      // audible playback whenever the user seeks mid-nudge.
      startTimeRef.current = ctx.currentTime - target / effRate;
      isPlayingRef.current = true;
      setIsPlaying(true);

      src.onended = () => {
        if (!isLoopingRef.current && sourceRef.current === src) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          offsetRef.current = 0;
          currentTimeRef.current = 0;
          setCurrentTime(0);
          clearInterval(timeIntervalRef.current);
        }
      };

      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = setInterval(() => {
        const c = audioCtxRef.current;
        if (!c || !isPlayingRef.current) return;
        // A3 — multiply by the *effective* rate (base + bend), matching the
        // rate seekTo anchored startTimeRef against and the rate the source
        // is actually running at. Otherwise a seek-while-bent (or any held
        // bend after seek) makes the displayed time drift relative to the
        // audible playback.
        const effRate = clamp(
          speedRef.current + (bendRef?.current || 0),
          0.5,
          2.0
        );
        const elapsed = (c.currentTime - startTimeRef.current) * effRate;
        const d = durationRef.current;
        const t =
          isLoopingRef.current && d > 0
            ? elapsed % d
            : Math.min(elapsed, d || elapsed);
        currentTimeRef.current = t;
        setCurrentTime(t);
      }, 100);
    },
    [audioCtxRef, buildChain, ensureMasterCtx, stopAndDisconnectSource, ensureStretchNode, postBufferToStretch, updateStretchRate]
  );

  // ─── File loading ───
  // Adopt an already-decoded AudioBuffer as this deck's track. Shared by the
  // File-decode path (loadFile) and the crate quick-load path (loadBuffer):
  // it resets transport, cues and detected metadata for the new track. It
  // does NOT decode and never touches the network.
  const adoptBuffer = useCallback(
    (audioBuf, name) => {
      stopAndDisconnectSource();
      isPlayingRef.current = false;
      setIsPlaying(false);
      clearInterval(timeIntervalRef.current);

      bufferRef.current = audioBuf;
      // W3.1 — the worklet holds the OLD track's channels; re-post on next
      // KEYLOCK play.
      stretchLoadedBufferRef.current = null;
      setLoadError(null);
      setFileName(name);
      setDuration(audioBuf.duration);
      durationRef.current = audioBuf.duration;
      setCurrentTime(0);
      currentTimeRef.current = 0;
      offsetRef.current = 0;
      setCues([]);
      cuesRef.current = [];
      setBpmConfidence(null);
      setDetectedKey(null);
      onKeyDetected?.(null);
      // W3.6 — a new track invalidates any pending bite region / preview.
      try { bitePreviewSourceRef.current?.stop(); } catch {}
      bitePreviewSourceRef.current = null;
      setBitePreviewing(false);
      setBite({ in: null, out: null });
    },
    [stopAndDisconnectSource, onKeyDetected]
  );

  // Load this deck from a pre-decoded AudioBuffer (crate quick-load, W1.5).
  // Builds the deck chain if needed, then adopts the buffer — no re-decode.
  const loadBuffer = useCallback(
    async (audioBuf, name) => {
      if (!audioBuf) return;
      await ensureMasterCtx();
      await buildChain();
      adoptBuffer(audioBuf, name || "crate track");
    },
    [ensureMasterCtx, buildChain, adoptBuffer]
  );

  // Load this deck from a raw File. Shared between the <input> change and
  // drag-drop on the deck card. Decodes once, then hands off to adoptBuffer.
  const loadFile = useCallback(
    async (file) => {
      if (!file) return;
      if (
        !file.type.startsWith("audio/") &&
        !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)
      ) {
        // Wrong file type is routine user feedback — show it inline (cleared
        // on the next successful load) rather than blocking with alert().
        showLoadError("Please choose an audio file (MP3, WAV, OGG, FLAC, M4A, AAC).");
        return;
      }
      const ctx = await ensureMasterCtx();
      await buildChain();

      const arrayBuf = await file.arrayBuffer();
      try {
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        adoptBuffer(audioBuf, file.name);
      } catch {
        // A decode failure is routine user feedback — show it inline (cleared
        // on the next successful load by adoptBuffer) rather than blocking
        // with alert(). Mirrors the wrong-file-type branch above and Crate.
        showLoadError("Could not decode this audio file. Try WAV, MP3, OGG, or FLAC.");
      }
    },
    [buildChain, ensureMasterCtx, adoptBuffer, showLoadError]
  );

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    await loadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Drag-and-drop on the deck card.
  const [isDragOver, setIsDragOver] = useState(false);
  const onDragOver = useCallback((e) => {
    if (e.dataTransfer?.items?.length) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, []);
  const onDragLeave = useCallback(() => setIsDragOver(false), []);
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  // ─── Transport ───
  const play = useCallback(() => {
    if (!bufferRef.current || isPlayingRef.current) return;
    seekTo(offsetRef.current, { autoplay: true });
  }, [seekTo]);

  const pause = useCallback(() => {
    // W3.4 — mid-roll there is no main source (it was silenced while the
    // timeline ran underneath), but pause must still land: it ends the roll
    // (via stopAndDisconnectSource) and freezes the advanced position.
    if (!isPlayingRef.current) return;
    // W3.1 — in KEYLOCK there is no BufferSource; the stretch node carries
    // playback (stopAndDisconnectSource pauses it below).
    if (!sourceRef.current && !rollRef.current && playModeRef.current !== "keylock") return;
    const c = audioCtxRef.current;
    if (c) {
      // A2 — while a NUDGE bend is held the live playbackRate is
      // `speed + bend`, not the base `speed`. Multiplying elapsed by the bare
      // `speedRef.current` mid-bend would mis-translate the audio-clock delta
      // into the buffer-position offset by up to ±4% of the held interval,
      // snapping the resume position the moment the user pauses. Use the same
      // effective rate the source is actually running at — clamped to the
      // same [0.5, 2.0] band applyBend uses — and the offset stays accurate.
      const effRate = clamp(
        speedRef.current + (bendRef?.current || 0),
        0.5,
        2.0
      );
      const elapsed = (c.currentTime - startTimeRef.current) * effRate;
      const d = durationRef.current;
      let off = isLoopingRef.current && d > 0 ? elapsed % d : Math.min(elapsed, d);
      if (!Number.isFinite(off) || off < 0) off = 0;
      offsetRef.current = off;
      currentTimeRef.current = off;
      setCurrentTime(off);
    }
    stopAndDisconnectSource();
    isPlayingRef.current = false;
    setIsPlaying(false);
    clearInterval(timeIntervalRef.current);
  }, [audioCtxRef, stopAndDisconnectSource]);

  const stop = useCallback(() => {
    stopAndDisconnectSource();
    isPlayingRef.current = false;
    setIsPlaying(false);
    offsetRef.current = 0;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    clearInterval(timeIntervalRef.current);
  }, [stopAndDisconnectSource]);

  const handleSeek = useCallback(
    (norm) => {
      const dur = durationRef.current;
      if (!dur) return;
      seekTo(norm * dur, { autoplay: isPlayingRef.current });
    },
    [seekTo]
  );

  // ─── W3.1 — VARI / KEYLOCK mode switch ───
  // Write the ref synchronously so an immediate reseek branches into the
  // right engine; a playing deck hops engines in place at the same position.
  const onTogglePlayMode = useCallback(
    (mode) => {
      if (mode === playModeRef.current) return;
      const wasPlaying = isPlayingRef.current;
      const pos = currentTimeRef.current;
      playModeRef.current = mode;
      setPlayMode(mode);
      if (wasPlaying && bufferRef.current) {
        seekTo(pos, { autoplay: true });
      }
    },
    [seekTo]
  );

  // ─── W3.4 — momentary loop roll ───
  const endRoll = useCallback(() => {
    const roll = rollRef.current;
    if (!roll) return;
    rollRef.current = null;
    setRollActive(null);
    try { roll.source.stop(); } catch {}
    try { roll.source.disconnect(); } catch {}
    // The deck's time interval kept advancing currentTimeRef while the roll
    // played (isPlayingRef stayed true), so re-anchoring at the live playhead
    // resumes exactly where the un-rolled timeline would be.
    if (isPlayingRef.current) {
      seekTo(currentTimeRef.current, { autoplay: true });
    }
  }, [seekTo]);

  const startRoll = useCallback(
    (beats) => {
      const ctx = audioCtxRef.current;
      const chain = chainRef.current;
      const buf = bufferRef.current;
      // Roll is a performance move on a playing deck — no-op otherwise.
      if (!ctx || !chain || !buf || !isPlayingRef.current) return;
      if (rollRef.current) endRoll();
      // Loop span in BUFFER seconds uses the track's own BPM (the source
      // plays at effRate, so the audible roll lasts beats × 60 / effectiveBPM
      // of wall time — the beat-synced length).
      const trackBpm = Math.max(40, bpmRef.current || 128);
      const len = (beats * 60) / trackBpm;
      const pos = currentTimeRef.current;
      const loopStart = Math.max(0, pos - len);
      const loopEnd = Math.max(loopStart + 0.01, pos);
      const effRate = clamp(speedRef.current + (bendRef?.current || 0), 0.5, 2.0);
      // Silence the main source WITHOUT touching play state — the wall-clock
      // interval keeps the timeline running underneath the roll.
      stopAndDisconnectSource();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
      src.playbackRate.value = effRate;
      src.connect(chain.gain);
      rollRef.current = { source: src };
      setRollActive(beats);
      src.start(0, loopStart);
    },
    [audioCtxRef, endRoll, stopAndDisconnectSource]
  );

  // ─── Re-anchor on speed change ───
  useEffect(() => {
    // W3.1 — KEYLOCK: the stretch worklet's rate param carries tempo; the
    // wall-clock anchor uses the same effective rate as the interval.
    if (playModeRef.current === "keylock" && isPlayingRef.current) {
      const c = audioCtxRef.current;
      updateStretchRate();
      if (c) {
        const effRate = clamp(speed + bendRef.current, 0.5, 2.0);
        startTimeRef.current = c.currentTime - currentTimeRef.current / effRate;
      }
      return;
    }
    if (sourceRef.current && isPlayingRef.current) {
      // Keep any held pitch-bend layered on top of the new base speed.
      const effRate = clamp(speed + bendRef.current, 0.5, 2.0);
      const c = audioCtxRef.current;
      // R18 T2 — a direct `.value =` write on the live source's playbackRate
      // produces audible zipper noise under rapid slider drags. Use the same
      // setTargetAtTime tau applyBend uses for the same param (0.015 s) so
      // both pitch-change paths share a single smoothing constant. The
      // re-anchor below must still treat the *target* effRate as the rate the
      // source is moving toward — the position interval also uses effRate —
      // otherwise the displayed time would lag the audible pitch ramp.
      if (c) {
        sourceRef.current.playbackRate.setTargetAtTime(
          effRate,
          c.currentTime,
          0.015
        );
        // A3 — anchor against the effective rate so the position interval
        // (also multiplying by effRate) stays consistent across a speed
        // change made while a NUDGE bend is held.
        startTimeRef.current = c.currentTime - currentTimeRef.current / effRate;
      } else {
        // No ctx (shouldn't happen mid-playback, but be defensive).
        sourceRef.current.playbackRate.value = effRate;
      }
    }
  }, [speed, audioCtxRef, updateStretchRate]);

  // ─── Pitch-bend nudge (momentary) ───
  // Smoothly ramp the live playbackRate to base speed + bend offset, clamping
  // the *effective* rate to [0.5, 2.0]. The bend is a transient offset held in
  // bendRef — it never touches the persisted `speed` state, so releasing the
  // button returns the deck to exactly the speed the user set on the slider.
  const applyBend = useCallback((offset) => {
    const src = sourceRef.current;
    const ctx = audioCtxRef.current;
    // W3.1 — KEYLOCK: the bend modulates the worklet's rate param (tempo
    // bend at constant pitch — the DJ-correct nudge). Same re-anchor math.
    if (playModeRef.current === "keylock" && ctx) {
      const newEff = clamp(speedRef.current + offset, 0.5, 2.0);
      if (isPlayingRef.current) {
        const prevRate = clamp(speedRef.current + bendRef.current, 0.5, 2.0);
        const pos = (ctx.currentTime - startTimeRef.current) * prevRate;
        const d = durationRef.current;
        const known =
          isLoopingRef.current && d > 0 ? ((pos % d) + d) % d : Math.max(0, pos);
        currentTimeRef.current = known;
        startTimeRef.current = ctx.currentTime - known / newEff;
      }
      bendRef.current = offset;
      updateStretchRate();
      return;
    }
    if (!src || !ctx) {
      bendRef.current = offset;
      return;
    }
    // A2 / A3 — the play-position interval anchors elapsed time on
    //   elapsed = (ctx.currentTime - startTimeRef) * effRate
    // where effRate = clamp(speed + bend, 0.5, 2.0) is the rate the source is
    // actually running at. The anchor must be recomputed whenever effRate
    // changes (bend start AND end). Snapshot the position the OLD effRate has
    // advanced to, switch the bend, then re-anchor startTimeRef as if the NEW
    // effRate had produced that position — keeping time display and cue math
    // accurate across the bend.
    const newEff = clamp(speedRef.current + offset, 0.5, 2.0);
    if (isPlayingRef.current) {
      const prevRate = clamp(speedRef.current + bendRef.current, 0.5, 2.0);
      const pos = (ctx.currentTime - startTimeRef.current) * prevRate;
      const d = durationRef.current;
      const known =
        isLoopingRef.current && d > 0 ? ((pos % d) + d) % d : Math.max(0, pos);
      currentTimeRef.current = known;
      startTimeRef.current = ctx.currentTime - known / newEff;
    }
    bendRef.current = offset;
    const target = newEff;
    // setTargetAtTime (not a hard .value write) avoids an audible click as the
    // pitch slides in/out.
    src.playbackRate.setTargetAtTime(target, ctx.currentTime, 0.015);
  }, [audioCtxRef, updateStretchRate]);

  const [bendActive, setBendActive] = useState(0); // -1 | 0 | +1, for UI state
  const startNudge = useCallback(
    (dir) => {
      if (!bufferRef.current) return;
      setBendActive(dir);
      applyBend(dir * NUDGE_OFFSET);
    },
    [applyBend]
  );
  const endNudge = useCallback(() => {
    if (bendRef.current === 0) return;
    setBendActive(0);
    applyBend(0);
  }, [applyBend]);

  // ─── Bass drop (preset-aware) ───
  const triggerBassDrop = useCallback(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    if (bassDropRunningRef.current) return;
    bassDropRunningRef.current = true;
    const preset = BASS_DROP_PRESETS[bassDropPreset] || BASS_DROP_PRESETS.standard;
    setBassDropActive(true);
    const now = ctx.currentTime;
    // A1 — every ramp endpoint must sit at least MIN_RAMP_S after its prior
    // anchor on the same param. Otherwise a short preset.buildSec (or a slip
    // in scheduling between `at(t1 - 0.1)` and `at(t1)`) collapses the ramp
    // to a 0-duration jump, which the Web Audio engine renders as an audible
    // step/click instead of a glide. 0.02 s (~one audio quantum at 48k) is
    // small enough to be inaudible on default-buildSec presets and big enough
    // to keep the ramp a ramp.
    const MIN_RAMP_S = 0.02;
    // Clamp every scheduled ramp endpoint to >= now. A very short preset
    // buildSec can otherwise put `t1 - 0.1` in the past, which the Web Audio
    // automation API rejects.
    const at = (t) => Math.max(now, t);
    // safeRamp(param, startVal, endVal, startT, endT, kind)
    // Anchors `param` at `startVal` at `startT`, then ramps to `endVal` at
    // max(endT, startT + MIN_RAMP_S) so the ramp duration is always strictly
    // positive. `kind` is "linear" | "exp"; expRamp targets <= 0 are floored
    // by the caller upstream (filter freq path), this helper does not clamp.
    const safeRamp = (param, startVal, endVal, startT, endT, kind) => {
      const sT = at(startT);
      const eT = Math.max(at(endT), sT + MIN_RAMP_S);
      param.setValueAtTime(startVal, sT);
      if (kind === "exp") param.exponentialRampToValueAtTime(endVal, eT);
      else param.linearRampToValueAtTime(endVal, eT);
      return eT;
    };
    const t1 = at(now + preset.buildSec); // end of build
    const t2 = at(t1 + 0.05); // drop snap
    const t3 = at(t2 + preset.decaySec); // end of decay
    // exponentialRampToValueAtTime throws on a target <= 0; floor the LPF
    // endpoints to a small strictly-positive frequency.
    const lpfStart = Math.max(1, preset.lpfStart);

    chain.filter.frequency.cancelScheduledValues(now);
    // LPF: 20k → lpfStart over the build. For non-wobble presets, recover to
    // 20k over the drop window. For wobble, ramp directly to the LFO's
    // baseFreq at t2 — the recovery-to-20k then snap-to-baseFreq path
    // produced a ~50 ms chirp on every drop (P2, R16). Going straight to
    // baseFreq hands off cleanly to the LFO, which sums its depth onto the
    // filter param from t2 onwards.
    safeRamp(chain.filter.frequency, 20000, lpfStart, now, t1, "exp");
    if (preset.wobble) {
      safeRamp(
        chain.filter.frequency,
        lpfStart,
        Math.max(1, preset.wobble.baseFreq),
        t1,
        t2,
        "exp"
      );
    } else {
      safeRamp(chain.filter.frequency, lpfStart, 20000, t1, t2, "exp");
    }

    chain.eqLow.gain.cancelScheduledValues(now);
    // EQ low: hold user value, kill, snap-hold at kill, recover post-drop, restore.
    // V5 (R19) — read EQ low from the ref so a knob move during the drop's
    // automation window lands on the recovery endpoint instead of being
    // snapped back to the closure value captured at triggerBassDrop call time.
    const eqLowAtStart = eqLowRef.current;
    const t1kill = safeRamp(chain.eqLow.gain, eqLowAtStart, preset.eqLowKill, now, t1 - 0.1, "linear");
    safeRamp(chain.eqLow.gain, preset.eqLowKill, preset.eqLowPostDrop, t1kill, t2, "linear");
    // Recovery endpoint reads the LIVE eqLowRef value at the time the t3 ramp
    // is scheduled (which is now — Web Audio doesn't re-poll closure vars at
    // ramp time). The user-driven EQ effect above cancel-and-holds and lays
    // down its own setTargetAtTime when the knob moves, which now wins
    // because the drop's t3 ramp was overwritten by the user's schedule.
    safeRamp(chain.eqLow.gain, preset.eqLowPostDrop, eqLowRef.current, t2, t3, "linear");

    // Wobble preset: LFO modulating filter freq after the drop
    if (preset.wobble) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = preset.wobble.freq;
      const depthGain = ctx.createGain();
      depthGain.gain.value = preset.wobble.depth;
      osc.connect(depthGain);
      depthGain.connect(chain.filter.frequency);
      // P2 (R16) — the filter ramp above already lands at baseFreq at t2, so
      // no snap-set is needed (the old set produced an audible chirp when the
      // ramp ended at 20k). The LFO then sums its depth on top of baseFreq.
      osc.start(t2);
      osc.stop(t3);
      wobbleNodesRef.current = { osc, depthGain };
      // Cleanup
      osc.onended = () => {
        try {
          depthGain.disconnect();
        } catch {}
        try {
          osc.disconnect();
        } catch {}
        wobbleNodesRef.current = null;
        // Restore the filter to the user's *current* slider value (read via
        // ref, not the closure, in case it moved during the wobble).
        chain.filter.frequency.setValueAtTime(filterFreqRef.current, ctx.currentTime);
        bassDropRunningRef.current = false;
      };
    }

    clearTimeout(bassDropTimeoutRef.current);
    bassDropTimeoutRef.current = setTimeout(() => {
      setBassDropActive(false);
      // For wobble presets, `osc.onended` is the sole owner of clearing the
      // re-entry guard. This setTimeout fires ~50 ms *before* `osc.onended`;
      // clearing the guard here too would open a window where a second
      // triggerBassDrop passes the guard, overwrites wobbleNodesRef, and the
      // first oscillator's onended then nulls the ref — orphaning the second
      // wobble's nodes. Let onended clear it for the wobble path.
      if (!preset.wobble) bassDropRunningRef.current = false;
      // P3 (R16) — add the 50 ms LPF recovery-split-point so the visual state
      // flip matches the audible end of the drop (the audio ramp ends at
      // now + buildSec + 0.05 + decaySec).
    }, (preset.buildSec + 0.05 + preset.decaySec) * 1000);
    // V5 (R19) — eq.low intentionally not in deps: read via eqLowRef in the
    // recovery ramp so the user's CURRENT value wins, not the closure value
    // at trigger-time.
  }, [audioCtxRef, bassDropPreset]);

  // ─── BPM ───
  const tapTimesRef = useRef([]);
  const tapBpm = async () => {
    await ensureMasterCtx();
    const now = Date.now();
    const taps = tapTimesRef.current;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      // Guard: two taps in the same millisecond → avg === 0 → bpm = Infinity,
      // which poisons the beat-pulse animation and Looper capture math. Only
      // commit a finite BPM, clamped to a sane musical range.
      if (avg > 0) {
        setBpm(clamp(Math.round(60000 / avg), 40, 220));
        setBpmConfidence(null);
      }
    }
  };

  const runAutoBpm = async () => {
    if (!bufferRef.current || autoDetectRunningRef.current) return;
    autoDetectRunningRef.current = true;
    setAutoBpmRunning(true);
    // Capture the BPM at detection start. If the user presses ÷2 / ×2 / TAP
    // while detection is in flight, the live bpm will differ from this — in
    // that case we honour the user's manual change and skip the auto result.
    const bpmAtStart = bpmRef.current;
    // Q2 — capture the buffer being analysed. A crate quick-load (or any new
    // track) replaces bufferRef.current mid-detection; if the new track
    // happens to share the old BPM, the `bpmRef === bpmAtStart` guard alone
    // would still let the stale key result apply to the wrong track. Bail on
    // any result if the buffer is no longer the one we started analysing.
    const bufferAtStart = bufferRef.current;
    // Run BPM + key detection in parallel — both read the same buffer offline.
    try {
      const [bpmResult, keyResult] = await Promise.all([
        // Widen the detection range so low-BPM tracks (lo-fi, half-time
        // dubstep ~70) and very fast genres aren't misdetected.
        detectBpm(bufferAtStart, { minBpm: 60, maxBpm: 200 }).catch(() => null),
        detectKey(bufferAtStart).catch(() => null),
      ]);
      // The track was swapped while detection was in flight — discard the
      // whole (now stale) result rather than applying it to a new buffer.
      if (bufferRef.current !== bufferAtStart) return;
      let applied = false;
      if (bpmResult && bpmRef.current === bpmAtStart) {
        setBpm(bpmResult.bpm);
        setBpmConfidence(bpmResult.confidence);
        applied = true;
      }
      let announcedKey = null;
      if (keyResult && keyResult.confidence > 0.3) {
        setDetectedKey(keyResult);
        onKeyDetected?.(keyResult.camelot);
        announcedKey = keyResult;
      }
      // Announce the auto-detect outcome for screen readers (this is the only
      // path that updates the dedicated live region — TAP never does).
      if (applied) {
        setBpmAnnounce(
          `Detected ${bpmResult.bpm} BPM` +
            (announcedKey ? `, key ${announcedKey.camelot}` : "")
        );
      } else if (bpmResult) {
        setBpmAnnounce("Auto-detect complete; manual BPM kept");
      }
    } catch (err) {
      console.warn("auto-detect failed", err);
    } finally {
      autoDetectRunningRef.current = false;
      setAutoBpmRunning(false);
    }
  };

  // ─── Cues ───
  const setCueAtCurrent = () => {
    if (!bufferRef.current) return;
    if (cues.length >= MAX_CUES) return;
    const id = ++cueIdRef.current;
    const time = currentTimeRef.current;
    const color = CUE_PALETTE[cues.length % CUE_PALETTE.length];
    setCues((prev) => [...prev, { id, time, color }]);
  };
  const jumpCue = (i) => {
    const cue = cues[i];
    if (!cue) return;
    seekTo(cue.time, { autoplay: isPlayingRef.current });
  };
  const deleteCue = (id) => {
    setCues((prev) => prev.filter((c) => c.id !== id));
  };

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      stopAndDisconnectSource();
      // W3.1 — tear down the stretch node.
      try { stretchNodeRef.current?.port?.postMessage({ type: "pause" }); } catch {}
      try { stretchNodeRef.current?.disconnect(); } catch {}
      stretchNodeRef.current = null;
      stretchLoadedBufferRef.current = null;
      // W3.6 — release any looping bite-preview source.
      try { bitePreviewSourceRef.current?.stop(); } catch {}
      try { bitePreviewSourceRef.current?.disconnect(); } catch {}
      bitePreviewSourceRef.current = null;
      clearInterval(timeIntervalRef.current);
      clearTimeout(bassDropTimeoutRef.current);
      clearTimeout(reverbSizeDebounceRef.current);
      clearTimeout(distortionDriveDebounceRef.current);
      if (wobbleNodesRef.current) {
        try { wobbleNodesRef.current.osc.stop(); } catch {}
        try { wobbleNodesRef.current.depthGain.disconnect(); } catch {}
        try { wobbleNodesRef.current.osc.disconnect(); } catch {}
        wobbleNodesRef.current = null;
      }
      disconnectChain(chainRef.current);
      chainRef.current = null;
      bufferRef.current = null;
    };
  }, [stopAndDisconnectSource]);

  // ─── Imperative API for keyboard shortcuts ───
  useImperativeHandle(
    ref,
    () => ({
      togglePlay: () => (isPlayingRef.current ? pause() : play()),
      play,
      pause,
      stop,
      // W1.5 — load this deck from a pre-decoded AudioBuffer (crate quick-load).
      loadBuffer,
      isReady: () => !!bufferRef.current,
      isPlaying: () => isPlayingRef.current,
      getBpm: () => bpmRef.current,
      // Effective BPM = base BPM × persisted speed. A held pitch-bend (bendRef)
      // is intentionally excluded: it is a transient, sub-bar offset released
      // the moment the NUDGE button is let go, so folding it in here would only
      // jitter the Looper's capture-window math for no real benefit — and the
      // bend never touches the persisted `speed` the user actually set.
      getEffectiveBpm: () => bpmRef.current * speedRef.current,
      nudgeVolume: (delta) => setVolumeState((v) => clamp(v + delta, 0, 1)),
      setVolume: (v) => setVolumeState(clamp(v, 0, 1)),
      setFilterFreq: (f) => setFilterFreq(clamp(f, 60, 20000)),
      setSpeed: (s) => setSpeedState(clamp(s, 0.5, 2.0)),
      // R17 Q2 — live getters for the MIDI relative-encoder reseed path. The
      // relative branch reads the *current* value at dispatch time (rather
      // than trusting a stale running ref) so the first twist after the user
      // moved a slider doesn't teleport the parameter back toward the default.
      // All three read from refs so the values are always live regardless of
      // the imperative-handle's dep array.
      getVolume: () => volumeRef.current,
      getSpeed: () => speedRef.current,
      getFilterFreq: () => filterFreqRef.current,
      setCue: setCueAtCurrent,
      jumpCue,
      // W3.6 — expose the seek primitive (seconds). Used by tests and any
      // future external control; mirrors the waveform click-to-seek contract.
      seekTo: (sec) => seekTo(sec, { autoplay: isPlayingRef.current }),
      syncTo: (otherBpm) => {
        if (!otherBpm) return;
        setSpeedState((s) => clamp(s * (otherBpm / Math.max(40, bpmRef.current)), 0.5, 2.0));
      },
      // P11 (R16) — momentary pitch-bend exposed for keyboard shortcuts.
      // Hold-to-bend semantics: caller fires startNudge on keydown, endNudge
      // on keyup. The pointer UI flows through the same callbacks.
      startNudge: (dir) => startNudge(dir),
      endNudge: () => endNudge(),
    }),
    [play, pause, stop, loadBuffer, cues, startNudge, endNudge]
  );

  // ─── Render ───
  // Deck B sits on the crossfader's right; A and C read left-aligned.
  const deckSide = id === "B" ? "right" : "left";
  const beatSeconds = bpm > 0 ? 60 / bpm : 0.5;

  return (
    <div
      onPointerDown={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="region"
      aria-label={`Deck ${id}${focused ? " (focused)" : ""}`}
      style={{
        flex: 1,
        // W3.8 — a real wrap floor (was 0). With three decks in the flex row,
        // a deck that can't get ~320px wraps to the next line (2+1 at mid
        // widths) instead of all three crushing into one row. `min(…, 100%)`
        // keeps the deck from overflowing very narrow mobile viewports.
        minWidth: "min(320px, 100%)",
        background: "rgba(15,18,35,0.7)",
        borderRadius: 16,
        padding: 16,
        border: `1px solid ${
          isDragOver ? color : focused ? color + "88" : color + "22"
        }`,
        backdropFilter: "blur(10px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: isDragOver
          ? `0 0 60px ${color}88`
          : focused
          ? `0 0 40px ${color}44`
          : `0 0 30px ${color}08`,
        transition: "border 0.2s, box-shadow 0.2s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `${color}22`,
              border: `2px solid ${color}66`,
              fontFamily: "'Audiowide', sans-serif",
              fontSize: 14,
              color,
            }}
          >
            {id}
          </div>
          <span style={{ fontFamily: "'Audiowide', sans-serif", fontSize: 13, color: "#8892b0", whiteSpace: "nowrap" }}>
            DECK {id}
          </span>
          <div
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color,
              marginLeft: 4,
              boxShadow: `0 0 10px ${color}aa`,
              animation: isPlaying ? `beatPulse ${beatSeconds}s infinite ease-in-out` : "none",
              opacity: isPlaying ? 1 : 0.25,
            }}
          />
          {/* W3.8 — crossfader assign: route this deck to the crossfader's A
              side, its B side, or THRU (—) which bypasses the fader entirely.
              Hidden when the assign props aren't threaded (isolated tests). */}
          {assign !== undefined && onAssignChange && (
            <div
              role="group"
              aria-label={`Deck ${id} crossfader assign`}
              style={{
                display: "flex",
                marginLeft: 6,
                border: "1px solid rgba(136,146,176,0.3)",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {[
                { v: "A", label: "A", title: "Follow crossfader side A" },
                { v: "THRU", label: "—", title: "Bypass the crossfader (always audible)" },
                { v: "B", label: "B", title: "Follow crossfader side B" },
              ].map(({ v, label, title }) => {
                const active = assign === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onAssignChange(v)}
                    aria-pressed={active}
                    aria-label={`Assign deck ${id} to ${v === "THRU" ? "THRU (bypass crossfader)" : `crossfader side ${v}`}`}
                    title={title}
                    style={{
                      background: active ? `${color}22` : "transparent",
                      color: active ? color : "#8892b0",
                      border: "none",
                      borderRight: v !== "B" ? "1px solid rgba(136,146,176,0.2)" : "none",
                      padding: "0 8px",
                      minHeight: 38,
                      minWidth: 26,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: "pointer",
                      fontFamily: "'Exo 2', sans-serif",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={tapBpm}
            className="wc-btn-hover"
            title="Tap to set BPM by ear"
            aria-label={`Tap BPM for deck ${id}`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 8px",
              // Z1 (R23) — all text buttons meet the 38×38 floor.
              minHeight: 38,
              color: "#8892b0",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "'Exo 2', sans-serif",
            }}
          >
            TAP
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={!fileName}
            title="Sync speed to the dominant playing deck's BPM"
            aria-label={`Sync deck ${id} to the dominant playing deck`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${color}33`,
              borderRadius: 6,
              padding: "4px 8px",
              // Z1 (R23) — all text buttons meet the 38×38 floor.
              minHeight: 38,
              // Disabled label uses text-muted (#8892b0) instead of text-dim
              // (#4a5580 → ~2.7:1 on the deep bg, fails WCAG 1.4.11). The
              // `opacity: 0.6` together with #8892b0 keeps the visual
              // disabled-state appearance while staying above 3:1.
              color: fileName ? color : "#8892b0",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.6,
            }}
          >
            SYNC
          </button>
          <button
            type="button"
            onClick={runAutoBpm}
            disabled={!fileName || autoBpmRunning}
            aria-busy={autoBpmRunning}
            title="Auto-detect BPM + key from track"
            aria-label={`Auto-detect BPM and key for deck ${id}`}
            style={{
              background: autoBpmRunning ? `${color}22` : "rgba(255,255,255,0.05)",
              border: `1px solid ${color}33`,
              borderRadius: 6,
              padding: "4px 8px",
              // Z1 (R23) — all text buttons meet the 38×38 floor.
              minHeight: 38,
              // Disabled label uses text-muted (#8892b0) + reduced opacity —
              // never text-dim #4a5580 on the deep bg (fails WCAG 1.4.11).
              color: autoBpmRunning ? color : "#8892b0",
              fontSize: 10,
              cursor: fileName && !autoBpmRunning ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.6,
            }}
          >
            {autoBpmRunning ? "…" : "AUTO"}
          </button>
          <button
            type="button"
            onClick={() => setBpm((b) => Math.max(40, Math.round(b / 2)))}
            disabled={!fileName}
            className="wc-btn-hover"
            title="Half BPM (fix double-time detection)"
            aria-label={`Halve BPM for deck ${id}`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 6px",
              // Z1 (R23) — all text buttons meet the 38×38 floor.
              minHeight: 38,
              // Disabled label uses text-muted + opacity, never text-dim
              // #4a5580 on the deep bg (fails WCAG 1.4.11).
              color: "#8892b0",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.6,
            }}
          >
            ÷2
          </button>
          <button
            type="button"
            onClick={() => setBpm((b) => Math.min(220, Math.round(b * 2)))}
            disabled={!fileName}
            className="wc-btn-hover"
            title="Double BPM (fix half-time detection)"
            aria-label={`Double BPM for deck ${id}`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 6px",
              // Z1 (R23) — all text buttons meet the 38×38 floor.
              minHeight: 38,
              color: "#8892b0",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.6,
            }}
          >
            ×2
          </button>
          {/* Always-present BPM / key display. No role="status" here: TAP
              writes into this region too, and a polite live region would
              announce on every rhythmic tap. Auto-detect completion is
              announced via the dedicated SR-only region below instead. */}
          <span
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 14, color, fontWeight: 700 }}>
              {bpm} BPM
            </span>
            {detectedKey && (
              <span
                title={`Detected key: ${detectedKey.key} (Camelot ${detectedKey.camelot})`}
                style={{
                  fontSize: 10,
                  color: color,
                  fontFamily: "'Exo 2', sans-serif",
                  background: `${color}11`,
                  border: `1px solid ${color}33`,
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontWeight: 700,
                }}
              >
                {detectedKey.camelot}
              </span>
            )}
            {detectedKey && camelotCompatible(detectedKey.camelot).length > 0 && (
              <span
                title="Harmonically compatible keys — mixing into these sounds smooth"
                style={{
                  fontSize: 9,
                  color: "#8892b0",
                  fontFamily: "'Exo 2', sans-serif",
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                }}
              >
                mix{" → "}
                {camelotCompatible(detectedKey.camelot).join(" · ")}
              </span>
            )}
            {bpmConfidence != null && (
              // R18 T7 — no aria-label on a non-interactive <span>. The
              // confidence percentage is already announced via the SR-only
              // role="status" live region below; carrying an aria-label on
              // a static span just bloats the AT tree without adding info.
              <span style={{ fontSize: 9, color }}>
                {Math.round(bpmConfidence * 100)}%
              </span>
            )}
          </span>
          {/* Dedicated live region — updates only on auto-detect completion,
              never on TAP. Mirrors the recording / MIDI-learn pattern. */}
          <span role="status" aria-live="polite" style={SR_ONLY}>
            {bpmAnnounce}
          </span>
        </div>
      </div>

      {/* File */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        // X2 (R21) — once a file is loaded the button's visible text becomes
        // just the filename, leaving the accessible name without a verb.
        // Override with an action-shaped aria-label so screen-reader users
        // hear what the button *does* (load / replace) and which deck it's
        // for, instead of just hearing the bare track filename.
        aria-label={
          fileName
            ? `Loaded: ${fileName} — click to replace (Deck ${id})`
            : `Load audio for Deck ${id}`
        }
        style={{
          background: fileName ? `${color}11` : `${color}18`,
          border: `1px dashed ${color}44`,
          borderRadius: 10,
          padding: "10px 12px",
          minHeight: 38,
          color: fileName ? "#ccd6f6" : "#8892b0",
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "'Exo 2', sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: deckSide === "left" ? "flex-start" : "flex-end",
          gap: 8,
        }}
      >
        {fileName ? (
          <>
            <Icon name="music" size={13} color={color} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileName}
            </span>
          </>
        ) : (
          `Drop audio here or click to load — Deck ${id}`
        )}
      </button>

      {loadError && (
        // Keyed by error id so a repeated identical error re-announces:
        // a polite role="alert" only fires on DOM diff, so without the
        // key swap an identical text wouldn't reach the screen reader.
        <div
          key={`deck-${id}-err-${loadError.id}`}
          role="alert"
          style={{
            color: "#f87171",
            fontSize: 11,
            fontFamily: "'Exo 2', sans-serif",
          }}
        >
          {loadError.text}
        </div>
      )}

      {/* Waveform */}
      <WaveformCanvas
        chainRef={chainRef}
        color={color}
        isLooping={isLooping}
        currentTimeRef={currentTimeRef}
        durationRef={durationRef}
        cuesRef={cuesRef}
        biteRegionRef={biteRegionRef}
        onSeek={fileName ? handleSeek : undefined}
        ariaLabel={`Seek position in deck ${id} track`}
      />

      {/* Time + cues */}
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Exo 2', sans-serif", fontSize: 11, color: "#8892b0" }}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <CuePanel
        cues={cues}
        color={color}
        deckId={id}
        disabled={!fileName || cues.length >= MAX_CUES}
        maxReached={cues.length >= MAX_CUES}
        onSet={setCueAtCurrent}
        onJump={jumpCue}
        onDelete={deleteCue}
      />

      {/* W3.6 — sound-bite extraction: mark IN/OUT at the playhead, preview
          the loop, then keep the slice (pad / crate / WAV download). */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#8892b0", letterSpacing: 1, textTransform: "uppercase" }}>
          Bite
        </span>
        <button
          type="button"
          disabled={!fileName}
          onClick={() => {
            stopBitePreview();
            setBite((b) => {
              const t = currentTimeRef.current;
              // Setting IN past OUT clears OUT — regions are always forward.
              return { in: t, out: b.out != null && b.out > t ? b.out : null };
            });
          }}
          aria-label={`Set bite in point on deck ${id}`}
          style={biteBtnStyle(bite.in != null, color, fileName)}
        >
          {bite.in != null ? `IN ${formatTime(bite.in)}` : "SET IN"}
        </button>
        <button
          type="button"
          disabled={!fileName || bite.in == null}
          onClick={() => {
            stopBitePreview();
            setBite((b) => {
              const t = currentTimeRef.current;
              return t > (b.in ?? 0) ? { ...b, out: t } : b;
            });
          }}
          aria-label={`Set bite out point on deck ${id}`}
          style={biteBtnStyle(bite.out != null, color, fileName && bite.in != null)}
        >
          {bite.out != null ? `OUT ${formatTime(bite.out)}` : "SET OUT"}
        </button>
        {bite.in != null && bite.out != null && (
          <>
            <button
              type="button"
              onClick={toggleBitePreview}
              aria-pressed={bitePreviewing}
              aria-label={`Preview the bite on deck ${id}`}
              style={biteBtnStyle(bitePreviewing, color, true)}
            >
              {bitePreviewing ? "■ STOP" : "▶ LOOP"}
            </button>
            {onSendToPad && (
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => sendBite("pad")}
                  aria-label={`Send the bite from deck ${id} to sample pad ${bitePad + 1}`}
                  style={biteBtnStyle(false, color, true)}
                >
                  → PAD
                </button>
                <select
                  value={bitePad}
                  onChange={(e) => setBitePad(Number(e.target.value))}
                  aria-label={`Sample pad for deck ${id} bites`}
                  style={{
                    background: "rgba(15,18,35,0.6)",
                    color: "#8892b0",
                    border: "1px solid rgba(136,146,176,0.25)",
                    borderRadius: 6,
                    fontSize: 10,
                    minHeight: 38,
                    padding: "2px 6px",
                    fontFamily: "'Exo 2', sans-serif",
                    cursor: "pointer",
                  }}
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i} style={{ background: "#0d1225" }}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </span>
            )}
            {onSendToCrate && (
              <button
                type="button"
                onClick={() => sendBite("crate")}
                aria-label={`Send the bite to the crate from deck ${id}`}
                style={biteBtnStyle(false, color, true)}
              >
                → CRATE
              </button>
            )}
            <button
              type="button"
              onClick={() => sendBite("wav")}
              aria-label={`Download the bite as WAV from deck ${id}`}
              style={biteBtnStyle(false, color, true)}
            >
              <Icon name="download" size={10} /> WAV
            </button>
            <button
              type="button"
              onClick={() => {
                stopBitePreview();
                setBite({ in: null, out: null });
              }}
              aria-label={`Clear the bite region on deck ${id}`}
              style={biteBtnStyle(false, color, true)}
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Transport */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }} role="group" aria-label={`Deck ${id} transport`}>
        {[
          // X1 (R21) — `toggle: true` entries are real toggle controls and
          // emit aria-pressed (Play tracks isPlaying, Loop tracks isLooping).
          // `toggle: false` entries (Pause, Stop) are MOMENTARY actions per
          // DESIGN_GUIDE §6 — they MUST NOT carry aria-pressed at all (a
          // hardcoded "false" on every render incorrectly tells AT users the
          // button is a toggle that happens to be off).
          { icon: "play", action: play, active: isPlaying, toggle: true, label: "Play" },
          { icon: "pause", action: pause, active: false, toggle: false, label: "Pause" },
          { icon: "stop", action: stop, active: false, toggle: false, label: "Stop" },
          { icon: "loop", action: () => setIsLooping((v) => !v), active: isLooping, toggle: true, label: "Loop" },
        ].map((btn) => {
          // X3 (R21) — gate transport on a loaded buffer just like SYNC / AUTO /
          // ÷2 / ×2 / NUDGE / BASS DROP. Disabled palette matches the rest of
          // the deck (text-muted #8892b0 + opacity 0.6 for label, opacity 0.4
          // + cursor not-allowed for the whole button).
          const disabled = !fileName;
          // X1 — only attach aria-pressed for true toggles. Spreading a
          // conditional object keeps the attribute off the rendered DOM when
          // it shouldn't be there (vs passing `undefined`, which some testing
          // matchers still treat as present).
          const ariaPressedProps = btn.toggle ? { "aria-pressed": btn.active } : {};
          return (
            <button
              key={btn.label}
              type="button"
              onClick={() => btn.action()}
              disabled={disabled}
              className={btn.active ? undefined : "wc-btn-hover"}
              title={btn.label}
              aria-label={`${btn.label} deck ${id}`}
              {...ariaPressedProps}
              style={{
                width: 38,
                minHeight: 38,
                borderRadius: 10,
                border: "none",
                background: btn.active ? `${color}33` : "rgba(255,255,255,0.05)",
                cursor: disabled ? "not-allowed" : "pointer",
                boxShadow: btn.active ? `0 0 12px ${color}33` : "none",
                opacity: disabled ? 0.4 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={btn.icon}
                size={18}
                color={btn.active ? color : "#8892b0"}
              />
            </button>
          );
        })}
      </div>

      {/* W3.4 — momentary loop roll: hold to repeat the last N beats while
          the timeline runs underneath; release resumes where the track
          would have been. Press-time quantized (free-running phase). */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#8892b0", letterSpacing: 1, textTransform: "uppercase" }}>
          Roll
        </span>
        {[
          { beats: 0.25, label: "¼" },
          { beats: 0.5, label: "½" },
          { beats: 1, label: "1" },
          { beats: 2, label: "2" },
        ].map(({ beats, label }) => {
          const active = rollActive === beats;
          const enabled = !!fileName && isPlaying;
          return (
            <button
              key={beats}
              type="button"
              disabled={!enabled}
              onPointerDown={() => startRoll(beats)}
              onPointerUp={endRoll}
              onPointerLeave={() => rollActive === beats && endRoll()}
              onPointerCancel={endRoll}
              aria-pressed={active}
              aria-label={`Hold to roll ${label} beat${beats === 1 ? "" : "s"} on deck ${id}`}
              title={`Hold: loop the last ${label} beat${beats === 1 ? "" : "s"}; release: resume the timeline`}
              style={{
                ...biteBtnStyle(active, color, enabled),
                minWidth: 40,
                touchAction: "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Pitch-bend nudge — momentary ±4% speed offset while held */}
      <div
        style={{ display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}
        role="group"
        aria-label={`Deck ${id} pitch bend`}
      >
        {[
          { dir: -1, label: "NUDGE −", icon: "chevron", rotate: 180, aria: `Pitch bend down deck ${id}` },
          { dir: 1, label: "NUDGE +", icon: "chevron", rotate: 0, aria: `Pitch bend up deck ${id}` },
        ].map((btn) => {
          const held = bendActive === btn.dir;
          return (
            <button
              key={btn.dir}
              type="button"
              disabled={!fileName}
              onPointerDown={(e) => {
                if (!fileName) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                startNudge(btn.dir);
              }}
              onPointerUp={endNudge}
              onPointerLeave={endNudge}
              onPointerCancel={endNudge}
              title="Hold to nudge the track into phase (temporary ±4% pitch bend)"
              aria-label={btn.aria}
              aria-pressed={held}
              className={held ? undefined : "wc-btn-hover"}
              style={{
                flex: 1,
                minHeight: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: 8,
                border: `1px solid ${held ? color : color + "33"}`,
                background: held ? `${color}33` : "rgba(255,255,255,0.05)",
                // Disabled label uses text-muted + opacity, never text-dim
                // #4a5580 on the deep bg (fails WCAG 1.4.11 contrast).
                color: held ? color : "#8892b0",
                fontSize: 10,
                letterSpacing: 1,
                fontFamily: "'Exo 2', sans-serif",
                cursor: fileName ? "pointer" : "not-allowed",
                opacity: fileName ? 1 : 0.6,
                boxShadow: held ? `0 0 12px ${color}44` : "none",
                touchAction: "none",
                userSelect: "none",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  transform: btn.rotate ? `rotate(${btn.rotate}deg)` : undefined,
                }}
              >
                <Icon name={btn.icon} size={11} color={held ? color : "#8892b0"} />
              </span>
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* W3.1 — playback mode: VARI (classic varispeed — pitch follows
          speed) vs KEYLOCK (experimental — tempo changes, pitch stays). */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#8892b0", letterSpacing: 1, textTransform: "uppercase" }}>
          Mode
        </span>
        {[
          { mode: "vari", label: "VARI", title: "Varispeed — pitch follows the speed slider (classic)" },
          { mode: "keylock", label: "KEYLOCK", title: "Experimental — tempo follows the speed slider, pitch stays at the track's original" },
        ].map(({ mode, label, title }) => {
          const active = playMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onTogglePlayMode(mode)}
              disabled={!fileName}
              aria-pressed={active}
              aria-label={`Set deck ${id} playback mode to ${label.toLowerCase()}`}
              title={title}
              style={biteBtnStyle(active, color, !!fileName)}
            >
              {label}
            </button>
          );
        })}
        {playMode === "keylock" && (
          <span style={{ fontSize: 8, color: "#8892b0" }}>
            experimental — trust your ears
          </span>
        )}
      </div>

      {/* Volume / Speed / Filter */}
      {[
        { label: "VOL", ariaLabel: `Deck ${id} volume`, value: volume, onChange: setVolumeState, min: 0, max: 1, step: 0.01, display: Math.round(volume * 100) },
        { label: "SPD", ariaLabel: `Deck ${id} speed`, value: speed, onChange: (v) => setSpeedState(Math.round(v * 100) / 100), min: 0.5, max: 2.0, step: 0.01, display: `${speed.toFixed(2)}x` },
        { label: "FLT", ariaLabel: `Deck ${id} filter frequency`, value: filterFreq, onChange: setFilterFreq, min: 60, max: 20000, step: 10, display: filterFreq >= 1000 ? (filterFreq / 1000).toFixed(1) + "k" : filterFreq },
      ].map((row) => (
        <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1, width: 32 }}>
            {row.label}
          </span>
          <Slider
            value={row.value}
            onChange={row.onChange}
            min={row.min}
            max={row.max}
            step={row.step}
            color={color}
            ariaLabel={row.ariaLabel}
          />
          <span style={{ fontSize: 11, color, fontFamily: "'Exo 2', sans-serif", width: 36, textAlign: "right" }}>
            {row.display}
          </span>
        </div>
      ))}

      {/* EQ knobs */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 20,
          padding: "8px 0",
          background: "rgba(0,0,0,0.2)",
          borderRadius: 10,
        }}
      >
        {[
          { band: "low", label: "LOW", value: eq.low },
          { band: "mid", label: "MID", value: eq.mid },
          { band: "high", label: "HIGH", value: eq.high },
        ].map(({ band, label, value }) => {
          const killed = eqKills[band];
          return (
            <div
              key={band}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
            >
              <Knob
                value={value}
                onChange={(v) => setEq((p) => ({ ...p, [band]: v }))}
                label={label}
                ariaLabel={`${label} EQ on deck ${id}`}
                color={color}
              />
              {/* W3.3 — one-tap band kill. Toggling never moves the knob. */}
              <button
                type="button"
                onClick={() => setEqKills((p) => ({ ...p, [band]: !p[band] }))}
                aria-pressed={killed}
                aria-label={`Kill ${label.toLowerCase()} EQ on deck ${id}`}
                title={killed ? `Restore the ${label} band` : `Kill the ${label} band`}
                style={{
                  background: killed ? "#f8717122" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${killed ? "#f87171" : "rgba(136,146,176,0.3)"}`,
                  color: killed ? "#f87171" : "#8892b0",
                  borderRadius: 6,
                  padding: "2px 10px",
                  // Z1 — meets the DESIGN_GUIDE 38px control floor.
                  minHeight: 38,
                  minWidth: 44,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: 1,
                  cursor: "pointer",
                  fontFamily: "'Exo 2', sans-serif",
                  boxShadow: killed ? "0 0 12px #f8717144" : "none",
                }}
              >
                KILL
              </button>
            </div>
          );
        })}
      </div>

      {/* W3.7 — component isolation. EQ/phase math, not stem separation —
          bleed is normal and depends on how the track was mixed/panned. */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9,
            color: "#8892b0",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Isolate
        </span>
        {[
          { mode: "bass", label: "BASS", title: "Solo the low end (steep 180 Hz lowpass)" },
          { mode: "vocal", label: "VOCAL", title: "Solo the centre channel, band-passed to the vocal range — bleed is normal" },
          { mode: "instrumental", label: "INSTR", title: "Cancel the centre channel (karaoke trick) — keeps the sides" },
          { mode: "drums", label: "PERC", title: "Best-effort percussive solo (sides + treble tilt) — kick may bleed" },
        ].map(({ mode, label, title }) => {
          const active = isolate === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setIsolate((cur) => (cur === mode ? null : mode))}
              disabled={!fileName}
              aria-pressed={active}
              aria-label={`Isolate ${label.toLowerCase()} on deck ${id}`}
              title={title}
              style={{
                background: active ? `${color}22` : "rgba(255,255,255,0.05)",
                border: `1px solid ${active ? color : `${color}33`}`,
                color: !fileName ? "#8892b0" : active ? color : "#8892b0",
                borderRadius: 6,
                padding: "4px 10px",
                minHeight: 38,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1,
                cursor: fileName ? "pointer" : "not-allowed",
                opacity: fileName ? 1 : 0.6,
                fontFamily: "'Exo 2', sans-serif",
                boxShadow: active ? `0 0 12px ${color}44` : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Effects rack */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <EffectCard
          title="Reverb"
          scope={`deck ${id}`}
          color={color}
          settings={effects.reverb}
          onChange={(s) => setEffects((p) => ({ ...p, reverb: s }))}
          params={[
            { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
            { key: "size", label: "SIZE", min: 0.5, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)}s` },
          ]}
        />
        <EffectCard
          title="Delay"
          scope={`deck ${id}`}
          color={color}
          settings={effects.delay}
          onChange={(s) => setEffects((p) => ({ ...p, delay: s }))}
          params={[
            { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
            { key: "time", label: "TIME", min: 0.05, max: 1.5, step: 0.01, format: (v) => `${(v * 1000).toFixed(0)}ms` },
            { key: "feedback", label: "FB", min: 0, max: 0.9, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
          ]}
        />
        <EffectCard
          title="Distortion"
          scope={`deck ${id}`}
          color={color}
          settings={effects.distortion}
          onChange={(s) => setEffects((p) => ({ ...p, distortion: s }))}
          params={[
            { key: "mix", label: "MIX", min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
            { key: "drive", label: "DRIVE", min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}` },
          ]}
        />
      </div>

      {/* Bass drop */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={triggerBassDrop}
          disabled={!fileName || bassDropActive}
          aria-pressed={bassDropActive}
          aria-label={`Trigger bass drop on deck ${id}`}
          style={{
            flex: 1,
            background: bassDropActive
              ? `linear-gradient(135deg, ${color}, ${color}88)`
              : `linear-gradient(135deg, ${color}22, ${color}11)`,
            border: `1px solid ${bassDropActive ? color : color + "44"}`,
            borderRadius: 10,
            padding: "10px 16px",
            minHeight: 38,
            cursor: fileName ? "pointer" : "not-allowed",
            color: bassDropActive ? "#070a14" : color,
            fontFamily: "'Audiowide', sans-serif",
            fontSize: 13,
            letterSpacing: 2,
            textTransform: "uppercase",
            boxShadow: bassDropActive ? `0 0 30px ${color}66` : "none",
            animation: bassDropActive ? "pulse 0.15s infinite alternate" : "none",
            opacity: fileName ? 1 : 0.4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Icon
            name={bassDropActive ? "bolt" : "speaker"}
            size={15}
            color={bassDropActive ? "#070a14" : color}
          />
          {bassDropActive ? "DROPPING" : "BASS DROP"}
        </button>
        <BassDropMenu preset={bassDropPreset} onChange={setBassDropPreset} color={color} deckId={id} />
        {/* W3.5 — sidechain-style PUMP: beat-rate ducking at the effective
            BPM. Free-running phase (matches the beat indicator's behavior). */}
        <button
          type="button"
          onClick={() => setPump((p) => ({ ...p, on: !p.on }))}
          disabled={!fileName}
          aria-pressed={pump.on}
          aria-label={`Toggle pump ducking on deck ${id}`}
          title="Duck this deck's level on every beat (sidechain-style pump)"
          style={biteBtnStyle(pump.on, color, !!fileName)}
        >
          PUMP
        </button>
        <Knob
          value={pump.depth}
          onChange={(v) => setPump((p) => ({ ...p, depth: v }))}
          min={0}
          max={1}
          step={0.01}
          label="DEPTH"
          ariaLabel={`Pump depth on deck ${id}`}
          color={color}
          size={36}
        />
      </div>
    </div>
  );
});

export default Deck;
