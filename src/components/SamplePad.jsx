import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { SAMPLE_PAD_KEYS } from "../data.js";

const PAD_COUNT = 8;

const SamplePad = forwardRef(function SamplePad({ audioCtxRef, outputNodeRef, ensureMasterCtx }, ref) {
  const [pads, setPads] = useState(() =>
    Array.from({ length: PAD_COUNT }, () => ({ name: null, volume: 0.8 }))
  );
  const bufferRefs = useRef(Array(PAD_COUNT).fill(null));
  const gainRefs = useRef(Array(PAD_COUNT).fill(null));
  const fileInputRefs = useRef(Array(PAD_COUNT).fill(null));

  const ensureGain = useCallback(
    (i) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return null;
      let g = gainRefs.current[i];
      if (!g) {
        g = ctx.createGain();
        g.gain.value = pads[i].volume;
        const out = outputNodeRef.current;
        if (out) g.connect(out);
        gainRefs.current[i] = g;
      }
      return g;
    },
    [audioCtxRef, outputNodeRef, pads]
  );

  const loadPad = useCallback(
    async (i, file) => {
      if (!file) return;
      // Ensure the master AudioContext exists before decoding. If this is the
      // user's first interaction (e.g. drag-dropping a sample on a fresh page),
      // audioCtxRef.current is still null, and decodeAudioData would have
      // nothing to decode against.
      const ctx = ensureMasterCtx ? await ensureMasterCtx() : audioCtxRef.current;
      if (!ctx) return;
      try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        bufferRefs.current[i] = buf;
        setPads((p) =>
          p.map((row, idx) => (idx === i ? { ...row, name: file.name } : row))
        );
      } catch {
        alert(`Couldn't decode "${file.name}". Try WAV, MP3, OGG, or FLAC.`);
      }
    },
    [audioCtxRef, ensureMasterCtx]
  );

  const trigger = useCallback(
    (i) => {
      const ctx = audioCtxRef.current;
      const buffer = bufferRefs.current[i];
      if (!ctx || !buffer) return;
      const gain = ensureGain(i);
      if (!gain) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.onended = () => {
        try {
          src.disconnect();
        } catch {}
      };
      src.start();
    },
    [audioCtxRef, ensureGain]
  );

  const setVolume = (i, v) => {
    const ctx = audioCtxRef.current;
    const g = gainRefs.current[i];
    if (g && ctx) g.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    setPads((p) => p.map((row, idx) => (idx === i ? { ...row, volume: v } : row)));
  };

  const clearPad = (i) => {
    bufferRefs.current[i] = null;
    setPads((p) => p.map((row, idx) => (idx === i ? { ...row, name: null } : row)));
  };

  useImperativeHandle(ref, () => ({
    triggerByKey: (key) => {
      const i = SAMPLE_PAD_KEYS.indexOf(key.toLowerCase());
      if (i >= 0) trigger(i);
    },
  }));

  useEffect(() => {
    return () => {
      for (let i = 0; i < PAD_COUNT; i++) {
        const g = gainRefs.current[i];
        if (g) {
          try {
            g.disconnect();
          } catch {}
        }
        gainRefs.current[i] = null;
        bufferRefs.current[i] = null;
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h3
          style={{
            fontFamily: "'Audiowide', sans-serif",
            fontSize: 13,
            color: "#00f5d4",
            margin: 0,
            letterSpacing: 2,
          }}
        >
          SAMPLES
        </h3>
        <span style={{ fontSize: 10, color: "#4a5580" }}>
          Drop or click to load · trigger with Q W E R / A S D F
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 8,
        }}
      >
        {pads.map((pad, i) => {
          const key = SAMPLE_PAD_KEYS[i].toUpperCase();
          const loaded = !!pad.name;
          return (
            <div
              key={i}
              onDragOver={(e) => {
                if (e.dataTransfer.items?.length) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) loadPad(i, file);
              }}
              style={{
                padding: 10,
                background: loaded ? "rgba(0,245,212,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px dashed ${loaded ? "rgba(0,245,212,0.4)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <kbd
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "#a78bfa",
                    border: "1px solid rgba(255,255,255,0.12)",
                    padding: "0 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: "'Exo 2', sans-serif",
                  }}
                >
                  {key}
                </kbd>
                <button
                  onClick={() => clearPad(i)}
                  disabled={!loaded}
                  title="Clear pad"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#4a5580",
                    cursor: loaded ? "pointer" : "not-allowed",
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </div>
              <input
                ref={(el) => (fileInputRefs.current[i] = el)}
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadPad(i, f);
                  if (fileInputRefs.current[i]) fileInputRefs.current[i].value = "";
                }}
                style={{ display: "none" }}
              />
              <button
                onClick={() => {
                  if (loaded) trigger(i);
                  else fileInputRefs.current[i]?.click();
                }}
                style={{
                  background: loaded ? "rgba(0,245,212,0.18)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${loaded ? "rgba(0,245,212,0.5)" : "rgba(255,255,255,0.1)"}`,
                  color: loaded ? "#00f5d4" : "#8892b0",
                  borderRadius: 8,
                  padding: "10px 8px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "'Exo 2', sans-serif",
                  textAlign: "center",
                  minHeight: 40,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {loaded ? pad.name : "+ Load"}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={pad.volume}
                onChange={(e) => setVolume(i, parseFloat(e.target.value))}
                style={{ accentColor: "#00f5d4", width: "100%" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SamplePad;
