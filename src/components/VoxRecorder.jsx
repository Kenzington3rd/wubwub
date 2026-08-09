import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// W3.2 — VOX: record your own voice into the session.
//
// Mic capture is a LOCAL device API — no network is involved, and the
// captured audio follows the same contract as file loads: it lives only in
// AudioBuffers in memory, is never persisted anywhere, and never leaves the
// device. A take can be sent to a deck (full deck feature set incl. speed),
// to the session crate, or to a sample pad.
//
// getUserMedia requires a secure context (https / localhost). The PWA build
// qualifies; the single-file build opened from file:// does not — there the
// panel renders a capability notice instead of the controls.
//
// Capture constraints are tuned for MUSIC, not calls: echo cancellation,
// noise suppression, and auto-gain would all chew up a sung vocal.
const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

// Panel identity accent (DESIGN_GUIDE §4 heading-only pattern) — pink, the
// registered palette accent not yet claimed by another shared panel.
const PANEL_ACCENT = "#f472b6";
const NEUTRAL = "#8892b0";
const DANGER = "#f87171";

export function micCapability() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "unsupported" };
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { ok: false, reason: "insecure" };
  }
  return { ok: true, reason: null };
}

export default function VoxRecorder({
  audioCtxRef,
  masterCompressorRef,
  ensureMasterCtx,
  onSendToDeck, // (deckId, audioBuffer, name)
  onSendToCrate, // (audioBuffer, name)
  onSendToPad, // (padIndex, audioBuffer, name)
}) {
  const [capability] = useState(micCapability);
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [take, setTake] = useState(null); // { name, seconds }
  const [takeCount, setTakeCount] = useState(0);
  const [error, setError] = useState("");
  const [padIndex, setPadIndex] = useState(0);
  const [previewing, setPreviewing] = useState(false);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const takeBufferRef = useRef(null);
  const monitorNodesRef = useRef(null); // { source, gain }
  const previewSourceRef = useRef(null);
  const mountedRef = useRef(true);

  const releaseStream = useCallback(() => {
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
  }, []);

  const stopMonitor = useCallback(() => {
    const nodes = monitorNodesRef.current;
    if (nodes) {
      try { nodes.source.disconnect(); } catch {}
      try { nodes.gain.disconnect(); } catch {}
      monitorNodesRef.current = null;
    }
  }, []);

  const stopPreview = useCallback(() => {
    const src = previewSourceRef.current;
    if (src) {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
      previewSourceRef.current = null;
    }
    setPreviewing(false);
  }, []);

  // ── ARM / DISARM ──
  const onArm = useCallback(async () => {
    setError("");
    try {
      await ensureMasterCtx?.();
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setArmed(true);
    } catch (err) {
      // Permission denied / no device. Inline, recoverable, never a throw.
      setError(
        err?.name === "NotAllowedError"
          ? "Mic permission was denied. Allow microphone access and try again."
          : "Couldn't open a microphone. Check that one is connected and allowed."
      );
    }
  }, [ensureMasterCtx]);

  const onDisarm = useCallback(() => {
    if (recording) return; // stop the take first
    stopMonitor();
    setMonitoring(false);
    releaseStream();
    setArmed(false);
  }, [recording, releaseStream, stopMonitor]);

  // ── Monitor toggle (armed only; OFF by default — open-speaker feedback) ──
  const onToggleMonitor = useCallback(async () => {
    if (!armed || !streamRef.current) return;
    if (monitoring) {
      stopMonitor();
      setMonitoring(false);
      return;
    }
    const ctx = await ensureMasterCtx?.();
    const out = masterCompressorRef?.current;
    if (!ctx || !out) return;
    const source = ctx.createMediaStreamSource(streamRef.current);
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(out);
    monitorNodesRef.current = { source, gain };
    setMonitoring(true);
  }, [armed, monitoring, ensureMasterCtx, masterCompressorRef, stopMonitor]);

  // ── RECORD / STOP ──
  const onRecord = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recording) return;
    if (typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this browser.");
      return;
    }
    setError("");
    stopPreview();
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      try {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        const ctx = audioCtxRef.current;
        if (!ctx || blob.size === 0) return;
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (!mountedRef.current) return;
        takeBufferRef.current = buf;
        setTakeCount((n) => {
          const next = n + 1;
          setTake({ name: `vox take ${next}`, seconds: buf.duration });
          return next;
        });
      } catch {
        if (mountedRef.current) {
          setError("Couldn't decode the recording. Try again.");
        }
      } finally {
        if (mountedRef.current) setRecording(false);
      }
    };
    recorderRef.current = rec;
    rec.start();
    setRecording(true);
  }, [recording, audioCtxRef, stopPreview]);

  const onStop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    try { rec.stop(); } catch {}
    recorderRef.current = null;
  }, []);

  // ── Preview the take through the master bus ──
  const onPreview = useCallback(() => {
    if (previewing) {
      stopPreview();
      return;
    }
    const ctx = audioCtxRef.current;
    const buf = takeBufferRef.current;
    const out = masterCompressorRef?.current;
    if (!ctx || !buf || !out) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.onended = () => {
      try { src.disconnect(); } catch {}
      if (previewSourceRef.current === src) {
        previewSourceRef.current = null;
        if (mountedRef.current) setPreviewing(false);
      }
    };
    previewSourceRef.current = src;
    setPreviewing(true);
    src.start();
  }, [previewing, audioCtxRef, masterCompressorRef, stopPreview]);

  // ── Send the take somewhere ──
  const sendTo = useCallback(
    (where) => {
      const buf = takeBufferRef.current;
      if (!buf || !take) return;
      stopPreview();
      if (where === "crate") onSendToCrate?.(buf, take.name);
      else if (where === "pad") onSendToPad?.(padIndex, buf, take.name);
      else onSendToDeck?.(where, buf, take.name);
    },
    [take, padIndex, onSendToCrate, onSendToPad, onSendToDeck, stopPreview]
  );

  const onDiscard = useCallback(() => {
    stopPreview();
    takeBufferRef.current = null;
    setTake(null);
  }, [stopPreview]);

  // ── Cleanup ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { recorderRef.current?.stop(); } catch {}
      recorderRef.current = null;
      stopMonitor();
      stopPreview();
      releaseStream();
      takeBufferRef.current = null;
    };
  }, [releaseStream, stopMonitor, stopPreview]);

  const btn = (active, activeColor = PANEL_ACCENT) => ({
    background: active ? `${activeColor}22` : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? activeColor : "rgba(136,146,176,0.3)"}`,
    color: active ? activeColor : NEUTRAL,
    borderRadius: 6,
    padding: "4px 12px",
    minHeight: 38,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 1,
    cursor: "pointer",
    fontFamily: "'Exo 2', sans-serif",
  });

  return (
    <div
      role="region"
      aria-label="Voice recorder"
      style={{
        marginTop: 16,
        background: "rgba(15,18,35,0.6)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "'Audiowide', sans-serif",
            fontSize: 13,
            color: PANEL_ACCENT,
            letterSpacing: 2,
          }}
        >
          VOX
        </span>
        <span style={{ fontSize: 10, color: NEUTRAL }}>
          record your own voice — stays on this device, never saved, never sent
        </span>
      </div>

      {!capability.ok ? (
        <p style={{ fontSize: 11, color: NEUTRAL, margin: 0 }}>
          {capability.reason === "insecure"
            ? "Mic capture needs a secure context — open WAVECRAFT as the installed PWA, over https, or from localhost (the single-file build opened from disk can't access the microphone)."
            : "This browser doesn't support microphone capture."}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!armed ? (
              <button type="button" onClick={onArm} style={btn(false)} aria-label="Arm the microphone">
                <Icon name="speaker" size={12} /> ARM MIC
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={recording ? onStop : onRecord}
                  aria-label={recording ? "Stop the voice recording" : "Start recording your voice"}
                  aria-pressed={recording}
                  style={btn(recording, DANGER)}
                >
                  {recording ? "■ STOP" : "● RECORD"}
                </button>
                <button
                  type="button"
                  onClick={onToggleMonitor}
                  aria-pressed={monitoring}
                  aria-label="Monitor the microphone through the speakers"
                  title="Hear the mic through the output — headphones recommended (speakers can feed back)"
                  style={btn(monitoring)}
                >
                  MONITOR
                </button>
                <button
                  type="button"
                  onClick={onDisarm}
                  disabled={recording}
                  aria-label="Release the microphone"
                  style={{ ...btn(false), opacity: recording ? 0.5 : 1, cursor: recording ? "not-allowed" : "pointer" }}
                >
                  DISARM
                </button>
                <span style={{ fontSize: 9, color: recording ? DANGER : NEUTRAL }}>
                  {recording ? "recording…" : monitoring ? "mic live — monitor on (watch for feedback)" : "mic live"}
                </span>
              </>
            )}
          </div>

          {take && (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                background: "rgba(0,0,0,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              <span style={{ fontSize: 11, color: "#ccd6f6", fontWeight: 600 }}>
                {take.name} · {take.seconds.toFixed(1)}s
              </span>
              <button type="button" onClick={onPreview} aria-pressed={previewing} aria-label="Preview the take" style={btn(previewing)}>
                {previewing ? "■ STOP" : "▶ PREVIEW"}
              </button>
              {["A", "B", "C"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => sendTo(d)}
                  aria-label={`Send the take to deck ${d}`}
                  style={btn(false)}
                >
                  {`→ ${d}`}
                </button>
              ))}
              <button type="button" onClick={() => sendTo("crate")} aria-label="Send the take to the crate" style={btn(false)}>
                → CRATE
              </button>
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <button type="button" onClick={() => sendTo("pad")} aria-label={`Send the take to sample pad ${padIndex + 1}`} style={btn(false)}>
                  → PAD
                </button>
                <select
                  value={padIndex}
                  onChange={(e) => setPadIndex(Number(e.target.value))}
                  aria-label="Sample pad to send the take to"
                  style={{
                    background: "rgba(15,18,35,0.6)",
                    color: NEUTRAL,
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
              <button type="button" onClick={onDiscard} aria-label="Discard the take" style={btn(false)}>
                DISCARD
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 10, color: DANGER, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
