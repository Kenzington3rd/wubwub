import { useCallback, useEffect, useRef, useState } from "react";
import Slider from "./Slider.jsx";
import Icon from "./Icon.jsx";
import { LOOPER_BAR_OPTIONS } from "../data.js";

const SLOT_COUNT = 4;
const SLOT_COLORS = ["#00f5d4", "#a78bfa", "#f0c040", "#f472b6"];
const DEFAULT_BPM = 128;
// Edge fades (per-source GainNode), setTargetAtTime with tau = 1 ms:
// 95% settled at 3*tau (3 ms), 98% at 4*tau (4 ms), 99.3% at 5*tau (5 ms).
const LOOP_FADE_IN_TAU = 0.001; // fade-in ~95% in 3 ms
const LOOP_FADE_OUT_TAU = 0.001; // fade-out ~99.3% in 5 ms
// src.stop() fires 16 ms out: the fade is ≈ -43 dB at 5 ms and below -130 dB by 16 ms, and the rest is margin
// so a late-scheduled automation (busy main thread) can't clip the tail.
const LOOP_STOP_DELAY = 0.016;

// Build an AudioBuffer from two Float32Array channels (raw PCM from the worklet).
function pcmToAudioBuffer(ctx, left, right, sampleRate) {
  const len = left.length;
  const buf = ctx.createBuffer(2, len, sampleRate);
  buf.copyToChannel(left, 0);
  buf.copyToChannel(right, 1);
  return buf;
}

export default function Looper({
  audioCtxRef,
  workletNodeRef,
  outputNodeRef,
  recordTapRef,
  workletReady,
  effectiveBpmRef,
}) {
  const [slots, setSlots] = useState(() =>
    Array.from({ length: SLOT_COUNT }, () => ({
      hasBuffer: false,
      isPlaying: false,
      bars: 4,
      volume: 0.8,
    }))
  );
  const bufferRefs = useRef(Array(SLOT_COUNT).fill(null));
  const sourceRefs = useRef(Array(SLOT_COUNT).fill(null));
  const gainRefs = useRef(Array(SLOT_COUNT).fill(null));
  // A6 — track whether each slot's cached gain is wired into the parallel
  // pre-limiter record tap. If the master bus / record tap wasn't ready when
  // the slot's gain was first created, the tap connection is silently skipped
  // and the slot's audio never reaches the "Clean" recorder. We cache the gain
  // anyway (so the audible-output connection isn't rebuilt), but flag the tap
  // attachment as pending — on every subsequent ensureGain call, if the tap is
  // now available we connect it then.
  const tapAttachedRefs = useRef(Array(SLOT_COUNT).fill(false));
  // State (not a ref) so the Capture button's busy state re-renders while a
  // capture is in flight.
  // Per-source edge-fade GainNodes (BufferSource -> fade -> slot gain), keyed by
  // slot. Start/stop fades live on THIS node, never on the shared slot gain,
  // which belongs to the volume slider alone (so a stop/restart or a volume
  // change can never race a fade).
  const fadeRefs = useRef(Array(SLOT_COUNT).fill(null));
  const [pendingSlot, setPendingSlot] = useState(null);
  // D6 — which slot's bars <select> is currently hovered (-1 = none). Native
  // selects can't carry a CSS :hover from inline styles.
  const [barsHover, setBarsHover] = useState(-1);

  // Ensure a gain node per slot exists and is wired to the output.
  const ensureGain = useCallback(
    (i) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return null;
      let g = gainRefs.current[i];
      if (!g) {
        const output = outputNodeRef.current;
        // If the master bus isn't built yet, do NOT cache the gain — an
        // unconnected node would leave the slot silent forever. Leave the ref
        // null so a later call retries once the output node exists.
        if (!output) return null;
        g = ctx.createGain();
        g.gain.value = slots[i].volume;
        g.connect(output);
        // W1.7 — also fan the slot into the parallel pre-limiter record tap so
        // the "Clean" recording captures looper audio, not just the decks. The
        // tap has no downstream connection, so this never doubles the audible
        // signal. Optional: if the tap isn't ready the slot still plays.
        //
        // A6 — track whether the tap was actually attached. If recordTapRef
        // wasn't ready at first ensureGain, the connection was silently
        // skipped — a subsequent call must retry once the tap exists, or the
        // slot would never reach the "Clean" recorder.
        if (recordTapRef?.current) {
          g.connect(recordTapRef.current);
          tapAttachedRefs.current[i] = true;
        } else {
          tapAttachedRefs.current[i] = false;
        }
        gainRefs.current[i] = g;
      } else if (!tapAttachedRefs.current[i] && recordTapRef?.current) {
        // A6 — the gain was cached before the record tap was built. Now that
        // it exists, fan the slot into the parallel pre-limiter tap so the
        // "Clean" recording finally captures looper audio.
        g.connect(recordTapRef.current);
        tapAttachedRefs.current[i] = true;
      }
      return g;
    },
    [audioCtxRef, outputNodeRef, recordTapRef, slots]
  );

  // Listen for worklet capture responses.
  // `workletReady` is in deps so this re-runs once the worklet loads (which
  // happens lazily on first user gesture, after Looper has already mounted).
  useEffect(() => {
    if (!workletReady) return;
    const node = workletNodeRef.current;
    if (!node) return;
    const onMessage = (e) => {
      const msg = e.data;
      if (!msg || msg.type !== "capture") return;
      const slot = msg.slot;
      const ctx = audioCtxRef.current;
      if (!ctx || slot == null) return;
      const left = new Float32Array(msg.left);
      const right = new Float32Array(msg.right);
      const buffer = pcmToAudioBuffer(ctx, left, right, msg.sampleRate);
      bufferRefs.current[slot] = buffer;
      setSlots((s) =>
        s.map((row, i) => (i === slot ? { ...row, hasBuffer: true } : row))
      );
      setPendingSlot(null);
    };
    node.port.addEventListener("message", onMessage);
    node.port.start();
    return () => node.port.removeEventListener("message", onMessage);
  }, [workletReady, workletNodeRef, audioCtxRef]);

  const capture = (slot) => {
    const node = workletNodeRef.current;
    if (!node || pendingSlot === slot) return;
    const bars = slots[slot].bars;
    const bpm = effectiveBpmRef.current || DEFAULT_BPM;
    // Clamp to the worklet ring-buffer duration (60 s) so long loops at low
    // BPMs aren't silently truncated. 60 s covers 16 bars down to 64 BPM.
    const seconds = Math.min(60, (bars * 4 * 60) / Math.max(40, bpm));
    setPendingSlot(slot);
    node.port.postMessage({ type: "capture", slot, seconds });
  };

  // Fade a slot's current source out on its own fade node and release it from
  // `onended`, once the tail has actually played. The slot gain is not touched.
  const stopSource = (slot) => {
    const src = sourceRefs.current[slot];
    if (!src) return;
    const fade = fadeRefs.current[slot];
    sourceRefs.current[slot] = null;
    fadeRefs.current[slot] = null;
    const ctx = audioCtxRef.current;
    const release = () => {
      try { src.disconnect(); } catch {}
      try { fade?.disconnect(); } catch {}
    };
    if (ctx && fade && fade.gain && typeof fade.gain.setTargetAtTime === "function") {
      const now = ctx.currentTime;
      // Freeze the live (possibly mid-fade-in) value, as rampGain does; never
      // re-anchor from the stale `.value` getter.
      if (typeof fade.gain.cancelAndHoldAtTime === "function") {
        fade.gain.cancelAndHoldAtTime(now);
      } else {
        fade.gain.cancelScheduledValues(now + 1e-6);
      }
      fade.gain.setTargetAtTime(0, now, LOOP_FADE_OUT_TAU);
      src.onended = release;
      try {
        src.stop(now + LOOP_STOP_DELAY);
      } catch {
        release();
      }
      return;
    }
    try { src.onended = null; } catch {}
    try { src.stop(); } catch {}
    release();
  };

  const togglePlay = (slot) => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRefs.current[slot];
    if (!ctx || !buffer) return;
    if (sourceRefs.current[slot]) {
      stopSource(slot);
      setSlots((s) =>
        s.map((row, i) => (i === slot ? { ...row, isPlaying: false } : row))
      );
      return;
    }
    const gain = ensureGain(slot);
    if (!gain) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // ~4 ms fade-in on the source's own node: starting a loop mid-waveform is a
    // step, and a re-play right after a stop must not inherit a fade-out.
    const fade = ctx.createGain();
    const now = ctx.currentTime;
    fade.gain.setValueAtTime(0, now);
    fade.gain.setTargetAtTime(1, now, LOOP_FADE_IN_TAU);
    src.connect(fade);
    fade.connect(gain);
    src.start();
    sourceRefs.current[slot] = src;
    fadeRefs.current[slot] = fade;
    setSlots((s) =>
      s.map((row, i) => (i === slot ? { ...row, isPlaying: true } : row))
    );
  };

  const setSlot = (slot, patch) => {
    setSlots((s) => s.map((row, i) => (i === slot ? { ...row, ...patch } : row)));
  };

  const setVolume = (slot, v) => {
    const ctx = audioCtxRef.current;
    const g = gainRefs.current[slot];
    if (g && ctx) g.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    setSlot(slot, { volume: v });
  };

  const clearSlot = (slot) => {
    stopSource(slot);
    bufferRefs.current[slot] = null;
    setSlot(slot, { hasBuffer: false, isPlaying: false });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (let i = 0; i < SLOT_COUNT; i++) {
        stopSource(i);
        const g = gainRefs.current[i];
        if (g) {
          try {
            g.disconnect();
          } catch {}
        }
        gainRefs.current[i] = null;
        bufferRefs.current[i] = null;
        tapAttachedRefs.current[i] = false;
      }
    };
  }, []);

  return (
    <div
      style={{
        padding: 16,
        background: "rgba(15,18,35,0.6)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.04)",
        marginTop: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontFamily: "'Audiowide', sans-serif",
            fontSize: 13,
            color: "#a78bfa",
            margin: 0,
            letterSpacing: 2,
          }}
        >
          LOOPER
        </h3>
        <span style={{ fontSize: 10, color: "#8892b0" }}>
          {workletReady
            ? "Captures from master bus — a fixed window sized from bars × BPM at capture time"
            : "Initializing audio worklet…"}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
        {slots.map((slot, i) => {
          const color = SLOT_COLORS[i];
          return (
            <div
              key={i}
              style={{
                padding: 10,
                background: slot.hasBuffer ? `${color}10` : "rgba(255,255,255,0.02)",
                border: `1px solid ${slot.hasBuffer ? color + "44" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong
                  style={{
                    color,
                    fontSize: 11,
                    fontFamily: "'Audiowide', sans-serif",
                  }}
                >
                  L{i + 1}
                </strong>
                <select
                  value={slot.bars}
                  onChange={(e) => setSlot(i, { bars: parseInt(e.target.value, 10) })}
                  onPointerEnter={() => setBarsHover(i)}
                  onPointerLeave={() => setBarsHover((h) => (h === i ? -1 : h))}
                  aria-label={`Loop ${i + 1} bar count`}
                  style={{
                    background:
                      barsHover === i
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(15,18,35,0.6)",
                    border: `1px solid rgba(255,255,255,${
                      barsHover === i ? "0.25" : "0.1"
                    })`,
                    borderRadius: 4,
                    color: "#8892b0",
                    fontSize: 10,
                    // The native <select> meets the 38×38 minimum hit area for
                    // interactive controls (WCAG 2.5.8). No sanctioned <select>
                    // exemption — the slot card header expands to fit.
                    minHeight: 38,
                    padding: "1px 6px",
                    cursor: "pointer",
                    transition: "background 0.15s ease, border-color 0.15s ease",
                  }}
                >
                  {LOOPER_BAR_OPTIONS.map((b) => (
                    <option key={b} value={b} style={{ background: "#0d1225" }}>
                      {b} bars
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => capture(i)}
                  // While a capture is in flight the button stays ENABLED and
                  // reports busy instead: `disabled` on the focused element
                  // drops keyboard focus to <body> for the whole capture
                  // window. capture() already ignores a repeat press on the
                  // pending slot, so this is inert, not re-entrant.
                  disabled={!workletReady}
                  aria-disabled={pendingSlot === i || undefined}
                  title={
                    !workletReady
                      ? "Audio worklet still initializing"
                      : pendingSlot === i
                        ? `Capturing loop ${i + 1}…`
                        : `Capture ${slot.bars} bars into loop ${i + 1}`
                  }
                  aria-label={
                    pendingSlot === i
                      ? `Capturing loop ${i + 1}`
                      : `Capture ${slot.bars} bars into loop ${i + 1}`
                  }
                  style={{
                    flex: 1,
                    // Busy dims the fill and border only — never `opacity`,
                    // which would fade the focus ring on the very button the
                    // keyboard user just pressed.
                    background: pendingSlot === i ? `${color}11` : `${color}22`,
                    border: `1px solid ${pendingSlot === i ? `${color}33` : `${color}55`}`,
                    color,
                    borderRadius: 6,
                    fontSize: 10,
                    padding: "4px 6px",
                    minHeight: 38,
                    cursor: workletReady && pendingSlot !== i ? "pointer" : "not-allowed",
                    fontFamily: "'Exo 2', sans-serif",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    opacity: workletReady ? 1 : 0.4,
                  }}
                >
                  {pendingSlot === i ? "…" : "Capture"}
                </button>
                <button
                  type="button"
                  onClick={() => togglePlay(i)}
                  disabled={!slot.hasBuffer}
                  title={slot.isPlaying ? "Stop loop" : "Play loop"}
                  aria-label={`${slot.isPlaying ? "Stop" : "Play"} loop ${i + 1}`}
                  style={{
                    flex: 1,
                    background: slot.isPlaying ? `${color}44` : "rgba(255,255,255,0.05)",
                    border: `1px solid ${slot.isPlaying ? color : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 6,
                    padding: "4px 6px",
                    minHeight: 38,
                    cursor: slot.hasBuffer ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon
                    name={slot.isPlaying ? "stop" : "play"}
                    size={13}
                    color={slot.isPlaying ? color : "#8892b0"}
                  />
                </button>
                {/* Only render the clear button once a loop is captured —
                    an always-visible disabled X reads as a dead affordance.
                    Matches MidiPanel's conditional clear and SamplePad. */}
                {slot.hasBuffer && (
                  <button
                    type="button"
                    onClick={() => clearSlot(i)}
                    title="Clear loop"
                    aria-label={`Clear loop ${i + 1}`}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      padding: "4px 6px",
                      minWidth: 38,
                      minHeight: 38,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {/* P9 (R16) — icon uses text-muted (#8892b0). When the
                        close button is rendered it's an enabled control; the
                        icon is its only visual affordance, so it needs to
                        meet WCAG 1.4.11 non-text contrast (≥3:1). #4a5580
                        sat at ~2.6:1 vs the panel bg. */}
                    <Icon name="close" size={12} color="#8892b0" />
                  </button>
                )}
              </div>
              <Slider
                value={slot.volume}
                onChange={(v) => setVolume(i, v)}
                min={0}
                max={1}
                step={0.01}
                color={color}
                ariaLabel={`Loop ${i + 1} volume`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
