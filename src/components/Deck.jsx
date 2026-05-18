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
import { buildReverbIR, buildDistortionCurve, clamp, rampGain } from "../audio/effects.js";
import { detectBpm } from "../audio/bpmDetect.js";
import { detectKey } from "../audio/keyDetect.js";
import { BASS_DROP_PRESETS } from "../data.js";

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
    ensureMasterCtx,
    crossfadeGain,
    focused,
    onFocus,
    onSync,
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
  const [loadError, setLoadError] = useState(null);
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
  const filterFreqRef = useRef(20000);
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

  // ─── Audio graph construction ───
  const buildChain = useCallback(async () => {
    const ctx = await ensureMasterCtx();
    if (!chainRef.current) {
      chainRef.current = buildDeckChain(ctx, masterCompressorRef.current);
      // Signal the chain-mutating useEffects to re-run with the live chain
      // so any state set before now (effects toggled, EQ tweaked, etc.)
      // gets applied.
      setChainTick((t) => t + 1);
    }
    return chainRef.current;
  }, [ensureMasterCtx, masterCompressorRef]);

  // ─── Apply gain (volume × crossfade) ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    rampGain(chain.gain.gain, volume * crossfadeGain, ctx);
  }, [volume, crossfadeGain, audioCtxRef, chainTick]);

  // ─── EQ ───
  useEffect(() => {
    const chain = chainRef.current;
    if (!chain) return;
    chain.eqLow.gain.value = eq.low;
    chain.eqMid.gain.value = eq.mid;
    chain.eqHigh.gain.value = eq.high;
  }, [eq, chainTick]);

  // ─── Filter sweep ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    chain.filter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.03);
  }, [filterFreq, audioCtxRef, chainTick]);

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
      chain.reverbConv.buffer = buildReverbIR(ctx, effects.reverb.size, 3.0);
    }, 200);
    return () => clearTimeout(reverbSizeDebounceRef.current);
  }, [effects.reverb.size, audioCtxRef, chainTick]);

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

  // ─── Effects: distortion ───
  useEffect(() => {
    const chain = chainRef.current;
    const ctx = audioCtxRef.current;
    if (!chain || !ctx) return;
    const { on, mix, drive } = effects.distortion;
    const targetWet = on ? mix : 0;
    const targetDry = on ? 1 - mix : 1;
    rampGain(chain.distortionWet.gain, targetWet, ctx);
    rampGain(chain.distortionDry.gain, targetDry, ctx);
    chain.distortion.curve = buildDistortionCurve(drive);
  }, [effects.distortion.on, effects.distortion.mix, effects.distortion.drive, audioCtxRef, chainTick]);

  // ─── Source lifecycle ───
  const stopAndDisconnectSource = useCallback(() => {
    const src = sourceRef.current;
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

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = isLoopingRef.current;
      src.playbackRate.value = speedRef.current;
      src.connect(chain.gain);
      src.start(0, target);
      sourceRef.current = src;
      startTimeRef.current = ctx.currentTime - target / speedRef.current;
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
        const elapsed = (c.currentTime - startTimeRef.current) * speedRef.current;
        const d = durationRef.current;
        const t =
          isLoopingRef.current && d > 0
            ? elapsed % d
            : Math.min(elapsed, d || elapsed);
        currentTimeRef.current = t;
        setCurrentTime(t);
      }, 100);
    },
    [audioCtxRef, buildChain, ensureMasterCtx, stopAndDisconnectSource]
  );

  // ─── File loading ───
  // Shared between <input> change and drag-drop on the deck.
  const loadFile = useCallback(
    async (file) => {
      if (!file) return;
      if (
        !file.type.startsWith("audio/") &&
        !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)
      ) {
        // Wrong file type is routine user feedback — show it inline (cleared
        // on the next successful load) rather than blocking with alert().
        setLoadError("Please choose an audio file (MP3, WAV, OGG, FLAC, M4A, AAC).");
        return;
      }
      const ctx = await ensureMasterCtx();
      await buildChain();
      stopAndDisconnectSource();
      isPlayingRef.current = false;
      setIsPlaying(false);
      clearInterval(timeIntervalRef.current);

      const arrayBuf = await file.arrayBuffer();
      try {
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        bufferRef.current = audioBuf;
        setLoadError(null);
        setFileName(file.name);
        setDuration(audioBuf.duration);
        durationRef.current = audioBuf.duration;
        setCurrentTime(0);
        currentTimeRef.current = 0;
        offsetRef.current = 0;
        setCues([]);
        cuesRef.current = [];
        setBpmConfidence(null);
        setDetectedKey(null);
      } catch {
        alert("Could not decode audio file. Try WAV, MP3, OGG, or FLAC.");
      }
    },
    [buildChain, ensureMasterCtx, stopAndDisconnectSource]
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
    if (!sourceRef.current || !isPlayingRef.current) return;
    const c = audioCtxRef.current;
    if (c) {
      const elapsed = (c.currentTime - startTimeRef.current) * speedRef.current;
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

  // ─── Re-anchor on speed change ───
  useEffect(() => {
    if (sourceRef.current && isPlayingRef.current) {
      sourceRef.current.playbackRate.value = speed;
      const c = audioCtxRef.current;
      if (c) startTimeRef.current = c.currentTime - currentTimeRef.current / speed;
    }
  }, [speed, audioCtxRef]);

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
    // Clamp every scheduled ramp endpoint to >= now. A very short preset
    // buildSec can otherwise put `t1 - 0.1` in the past, which the Web Audio
    // automation API rejects.
    const at = (t) => Math.max(now, t);
    const t1 = at(now + preset.buildSec); // end of build
    const t2 = at(t1 + 0.05); // drop snap
    const t3 = at(t2 + preset.decaySec); // end of decay
    // exponentialRampToValueAtTime throws on a target <= 0; floor the LPF
    // endpoints to a small strictly-positive frequency.
    const lpfStart = Math.max(1, preset.lpfStart);

    chain.filter.frequency.cancelScheduledValues(now);
    chain.filter.frequency.setValueAtTime(20000, now);
    chain.filter.frequency.exponentialRampToValueAtTime(lpfStart, t1);
    chain.filter.frequency.setValueAtTime(lpfStart, t1);
    chain.filter.frequency.exponentialRampToValueAtTime(20000, t2);

    chain.eqLow.gain.cancelScheduledValues(now);
    chain.eqLow.gain.setValueAtTime(eq.low, now);
    chain.eqLow.gain.linearRampToValueAtTime(preset.eqLowKill, at(t1 - 0.1));
    chain.eqLow.gain.setValueAtTime(preset.eqLowKill, t1);
    chain.eqLow.gain.linearRampToValueAtTime(preset.eqLowPostDrop, t2);
    chain.eqLow.gain.linearRampToValueAtTime(eq.low, t3);

    // Wobble preset: LFO modulating filter freq after the drop
    if (preset.wobble) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = preset.wobble.freq;
      const depthGain = ctx.createGain();
      depthGain.gain.value = preset.wobble.depth;
      osc.connect(depthGain);
      depthGain.connect(chain.filter.frequency);
      // After the drop, hold filter at baseFreq and let LFO ride on top
      chain.filter.frequency.setValueAtTime(preset.wobble.baseFreq, t2 + 0.01);
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
    }, (preset.buildSec + preset.decaySec) * 1000);
  }, [audioCtxRef, bassDropPreset, eq.low]);

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
    // Run BPM + key detection in parallel — both read the same buffer offline.
    try {
      const [bpmResult, keyResult] = await Promise.all([
        // Widen the detection range so low-BPM tracks (lo-fi, half-time
        // dubstep ~70) and very fast genres aren't misdetected.
        detectBpm(bufferRef.current, { minBpm: 60, maxBpm: 200 }).catch(() => null),
        detectKey(bufferRef.current).catch(() => null),
      ]);
      let applied = false;
      if (bpmResult && bpmRef.current === bpmAtStart) {
        setBpm(bpmResult.bpm);
        setBpmConfidence(bpmResult.confidence);
        applied = true;
      }
      let announcedKey = null;
      if (keyResult && keyResult.confidence > 0.3) {
        setDetectedKey(keyResult);
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
      clearInterval(timeIntervalRef.current);
      clearTimeout(bassDropTimeoutRef.current);
      clearTimeout(reverbSizeDebounceRef.current);
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
      isReady: () => !!bufferRef.current,
      isPlaying: () => isPlayingRef.current,
      getBpm: () => bpmRef.current,
      getEffectiveBpm: () => bpmRef.current * speedRef.current,
      nudgeVolume: (delta) => setVolumeState((v) => clamp(v + delta, 0, 1)),
      setVolume: (v) => setVolumeState(clamp(v, 0, 1)),
      setFilterFreq: (f) => setFilterFreq(clamp(f, 60, 20000)),
      setSpeed: (s) => setSpeedState(clamp(s, 0.5, 2.0)),
      setCue: setCueAtCurrent,
      jumpCue,
      syncTo: (otherBpm) => {
        if (!otherBpm) return;
        setSpeedState((s) => clamp(s * (otherBpm / Math.max(40, bpmRef.current)), 0.5, 2.0));
      },
    }),
    [play, pause, stop, cues]
  );

  // ─── Render ───
  const deckSide = id === "A" ? "left" : "right";
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
        minWidth: 0,
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
          <span style={{ fontFamily: "'Audiowide', sans-serif", fontSize: 13, color: "#8892b0" }}>
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
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={tapBpm}
            className="wc-btn-hover"
            title="Tap to set BPM by ear"
            aria-label={`Tap BPM for deck ${id}`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "#8892b0",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "'Exo 2', sans-serif",
            }}
          >
            TAP
          </button>
          <button
            onClick={onSync}
            disabled={!fileName}
            title="Sync speed to the other deck's BPM"
            aria-label={`Sync deck ${id} to other deck`}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${color}33`,
              borderRadius: 6,
              padding: "4px 8px",
              color: fileName ? color : "#4a5580",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.5,
            }}
          >
            SYNC
          </button>
          <button
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
              color: autoBpmRunning ? color : "#8892b0",
              fontSize: 10,
              cursor: fileName && !autoBpmRunning ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.5,
            }}
          >
            {autoBpmRunning ? "…" : "AUTO"}
          </button>
          <button
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
              color: fileName ? "#8892b0" : "#4a5580",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.5,
            }}
          >
            ÷2
          </button>
          <button
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
              color: fileName ? "#8892b0" : "#4a5580",
              fontSize: 10,
              cursor: fileName ? "pointer" : "not-allowed",
              fontFamily: "'Exo 2', sans-serif",
              opacity: fileName ? 1 : 0.5,
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
            {bpmConfidence != null && (
              <span style={{ fontSize: 9, color }} aria-label="BPM detection confidence">
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
        onClick={() => fileInputRef.current?.click()}
        style={{
          background: fileName ? `${color}11` : `${color}18`,
          border: `1px dashed ${color}44`,
          borderRadius: 10,
          padding: "10px 12px",
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
        <div
          role="alert"
          style={{
            color: "#f87171",
            fontSize: 11,
            fontFamily: "'Exo 2', sans-serif",
          }}
        >
          {loadError}
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
        onSeek={fileName ? handleSeek : undefined}
      />

      {/* Time + cues */}
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Exo 2', sans-serif", fontSize: 11, color: "#8892b0" }}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <CuePanel
        cues={cues}
        color={color}
        disabled={!fileName || cues.length >= MAX_CUES}
        maxReached={cues.length >= MAX_CUES}
        onSet={setCueAtCurrent}
        onJump={jumpCue}
        onDelete={deleteCue}
      />

      {/* Transport */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }} role="group" aria-label={`Deck ${id} transport`}>
        {[
          { icon: "play", action: play, active: isPlaying, label: "Play" },
          { icon: "pause", action: pause, active: false, label: "Pause" },
          { icon: "stop", action: stop, active: false, label: "Stop" },
          { icon: "loop", action: () => setIsLooping((v) => !v), active: isLooping, label: "Loop" },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={() => btn.action()}
            className={btn.active ? undefined : "wc-btn-hover"}
            title={btn.label}
            aria-label={`${btn.label} deck ${id}`}
            aria-pressed={btn.active}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "none",
              background: btn.active ? `${color}33` : "rgba(255,255,255,0.05)",
              cursor: "pointer",
              boxShadow: btn.active ? `0 0 12px ${color}33` : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={btn.icon} size={18} color={btn.active ? color : "#8892b0"} />
          </button>
        ))}
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
        <Knob value={eq.low} onChange={(v) => setEq((p) => ({ ...p, low: v }))} label="LOW" color={color} />
        <Knob value={eq.mid} onChange={(v) => setEq((p) => ({ ...p, mid: v }))} label="MID" color={color} />
        <Knob value={eq.high} onChange={(v) => setEq((p) => ({ ...p, high: v }))} label="HIGH" color={color} />
      </div>

      {/* Effects rack */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <EffectCard
          title="Reverb"
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
          onClick={triggerBassDrop}
          disabled={!fileName || bassDropActive}
          style={{
            flex: 1,
            background: bassDropActive
              ? `linear-gradient(135deg, ${color}, ${color}88)`
              : `linear-gradient(135deg, ${color}22, ${color}11)`,
            border: `1px solid ${bassDropActive ? color : color + "44"}`,
            borderRadius: 10,
            padding: "10px 16px",
            cursor: fileName ? "pointer" : "not-allowed",
            color: bassDropActive ? "#0a0e1a" : color,
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
            color={bassDropActive ? "#0a0e1a" : color}
          />
          {bassDropActive ? "DROPPING" : "BASS DROP"}
        </button>
        <BassDropMenu preset={bassDropPreset} onChange={setBassDropPreset} color={color} />
      </div>
    </div>
  );
});

export default Deck;
