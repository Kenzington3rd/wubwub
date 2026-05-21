import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { SAMPLE_PAD_KEYS } from "../data.js";
import Icon from "./Icon.jsx";
import Slider from "./Slider.jsx";

const PAD_COUNT = 8;

const SamplePad = forwardRef(function SamplePad({ audioCtxRef, outputNodeRef, recordTapRef, ensureMasterCtx }, ref) {
  const [pads, setPads] = useState(() =>
    Array.from({ length: PAD_COUNT }, () => ({ name: null, volume: 0.8 }))
  );
  // A decode failure is routine user feedback — surface it inline (cleared on
  // the next successful load) rather than blocking with alert(), matching the
  // loadError pattern in Deck.jsx and Crate.jsx. The error carries an id so a
  // repeated identical decode failure re-announces — a polite role="alert"
  // only fires on DOM diff, so identical text alone wouldn't reach the
  // screen reader without a unique key swap on the alert wrapper.
  const [loadError, setLoadError] = useState(null);
  const loadErrorIdRef = useRef(0);
  const bufferRefs = useRef(Array(PAD_COUNT).fill(null));
  const gainRefs = useRef(Array(PAD_COUNT).fill(null));
  // A6 — see Looper.jsx. Tracks whether each pad's cached gain has been wired
  // into the parallel pre-limiter record tap; deferred-attach on a later call
  // once the tap becomes available.
  const tapAttachedRefs = useRef(Array(PAD_COUNT).fill(false));
  const fileInputRefs = useRef(Array(PAD_COUNT).fill(null));

  const ensureGain = useCallback(
    (i) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return null;
      let g = gainRefs.current[i];
      if (!g) {
        const out = outputNodeRef.current;
        // If the master bus isn't built yet, do NOT cache the gain — an
        // unconnected node would leave the pad silent forever. Leave the ref
        // null so a later call retries once the output node exists.
        if (!out) return null;
        g = ctx.createGain();
        g.gain.value = pads[i].volume;
        g.connect(out);
        // W1.7 — also fan the pad into the parallel pre-limiter record tap so
        // the "Clean" recording captures sample-pad audio, not just the decks.
        // The tap has no downstream connection, so this never doubles the
        // audible signal. Optional: if the tap isn't ready the pad still plays.
        //
        // A6 — track whether the tap was actually attached. If recordTapRef
        // wasn't ready at first ensureGain, the connection was silently
        // skipped — a subsequent call must retry once the tap exists, or the
        // pad would never reach the "Clean" recorder.
        if (recordTapRef?.current) {
          g.connect(recordTapRef.current);
          tapAttachedRefs.current[i] = true;
        } else {
          tapAttachedRefs.current[i] = false;
        }
        gainRefs.current[i] = g;
      } else if (!tapAttachedRefs.current[i] && recordTapRef?.current) {
        // A6 — the gain was cached before the record tap was built. Now that
        // it exists, fan the pad into the parallel pre-limiter tap so the
        // "Clean" recording finally captures sample-pad audio.
        g.connect(recordTapRef.current);
        tapAttachedRefs.current[i] = true;
      }
      return g;
    },
    [audioCtxRef, outputNodeRef, recordTapRef, pads]
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
        setLoadError(null);
        setPads((p) =>
          p.map((row, idx) => (idx === i ? { ...row, name: file.name } : row))
        );
      } catch {
        setLoadError({
          id: ++loadErrorIdRef.current,
          text: `Couldn't decode "${file.name}". Try WAV, MP3, OGG, or FLAC.`,
        });
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

  useImperativeHandle(
    ref,
    () => ({
      triggerByKey: (key) => {
        const i = SAMPLE_PAD_KEYS.indexOf(key.toLowerCase());
        if (i >= 0) trigger(i);
      },
    }),
    [trigger]
  );

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
        <span style={{ fontSize: 10, color: "#8892b0" }}>
          Drop or click to load · trigger with Q W E R / A S D F
        </span>
      </div>
      {loadError && (
        // Keyed by error id so a repeated identical error re-announces:
        // a polite role="alert" only fires on DOM diff, so without the
        // key swap an identical text wouldn't reach the screen reader.
        <div
          key={`pad-err-${loadError.id}`}
          role="alert"
          style={{
            color: "#f87171",
            fontSize: 11,
            fontFamily: "'Exo 2', sans-serif",
            marginBottom: 8,
          }}
        >
          {loadError.text}
        </div>
      )}
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
              // The SamplePad heading carries the panel's cyan identity accent,
              // but the pad BODY is neutral slate — matching the Crate panel's
              // entry chrome (DESIGN_GUIDE §4). The loaded state reads as a
              // brighter neutral tint, not a cyan tint.
              style={{
                padding: 10,
                background: loaded
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(255,255,255,0.02)",
                border: `1px dashed ${
                  loaded ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)"
                }`,
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
                    color: "#8892b0",
                    border: "1px solid rgba(255,255,255,0.12)",
                    padding: "0 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: "'Exo 2', sans-serif",
                  }}
                >
                  {key}
                </kbd>
                {/* Only render the clear button when there's a loaded
                    sample to clear — an always-visible disabled X reads as a
                    dead affordance. Matches MidiPanel's conditional clear. */}
                {loaded && (
                  <button
                    type="button"
                    onClick={() => clearPad(i)}
                    title="Clear pad"
                    aria-label={`Clear sample pad ${i + 1}`}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 38,
                      minHeight: 38,
                      margin: -8,
                    }}
                  >
                    {/* P9 (R16) — icon uses text-muted (#8892b0) so the only
                        affordance for this enabled clear button meets WCAG
                        1.4.11 (#4a5580 fails at ~2.6:1 vs the panel bg). */}
                    <Icon name="close" size={12} color="#8892b0" />
                  </button>
                )}
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
                type="button"
                onClick={() => {
                  if (loaded) trigger(i);
                  else fileInputRefs.current[i]?.click();
                }}
                aria-label={
                  loaded ? `Play sample pad ${i + 1}` : `Load sample pad ${i + 1}`
                }
                // Neutral-slate body control — no cyan tint on the pad chrome.
                style={{
                  background: loaded
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${
                    loaded ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"
                  }`,
                  color: loaded ? "#ccd6f6" : "#8892b0",
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
              <Slider
                value={pad.volume}
                onChange={(v) => setVolume(i, v)}
                min={0}
                max={1}
                step={0.01}
                color="#8892b0"
                ariaLabel={`Pad ${i + 1} volume`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SamplePad;
