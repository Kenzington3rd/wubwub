import { useEffect, useRef, useState } from "react";
import Slider from "./Slider.jsx";
import ThemePicker from "./ThemePicker.jsx";
import Icon from "./Icon.jsx";
import { parseSettings } from "../settings.js";

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

// Sample value above which the signal is treated as clipping.
const CLIP_THRESHOLD = 0.99;

function fmtElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MasterBus({
  masterVol,
  onMasterVolChange,
  deckAColor,
  deckBColor,
  onDeckAColorChange,
  onDeckBColorChange,
  isRecording,
  onToggleRecord,
  recordSupported,
  recordStartedAt,
  recordTapMode,
  onRecordTapModeChange,
  markerCount,
  onDropMarker,
  clipAnalyserRef,
  onExportSettings,
  onImportSettings,
}) {
  const [elapsed, setElapsed] = useState(0);
  // W1.4 — hidden file input for Import Settings + an inline error slot.
  const settingsInputRef = useRef(null);
  const [settingsError, setSettingsError] = useState("");
  // Announce only the start/stop transition — never the per-250ms timer text,
  // which would be far too chatty for a live region.
  const [recordAnnounce, setRecordAnnounce] = useState("");
  const wasRecordingRef = useRef(isRecording);
  // W1.7 — true while the live signal is clipping (peak > CLIP_THRESHOLD).
  const [clipping, setClipping] = useState(false);
  // Previous marker count — used to announce only an actual marker *drop*
  // (count increasing), covering both the MARKER button and the `M` key.
  const prevMarkerCountRef = useRef(markerCount);

  useEffect(() => {
    if (!isRecording || !recordStartedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Date.now() - recordStartedAt), 250);
    return () => clearInterval(id);
  }, [isRecording, recordStartedAt]);

  useEffect(() => {
    if (isRecording && !wasRecordingRef.current) {
      setRecordAnnounce("Recording started");
    } else if (!isRecording && wasRecordingRef.current) {
      setRecordAnnounce("Recording stopped, mix saved");
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  // Announce a marker drop on the recording live region. Scoped to the drop
  // event only (count increased) — works for both the MARKER button and the
  // `M` key, since both flow through the same markerCount prop. A count reset
  // to 0 on record stop is intentionally not announced.
  useEffect(() => {
    if (markerCount > prevMarkerCountRef.current) {
      setRecordAnnounce(`Marker ${markerCount} dropped`);
    }
    prevMarkerCountRef.current = markerCount;
  }, [markerCount]);

  // ── W1.7 — clip meter ──
  // A single lightweight rAF loop reads peak sample level off the master
  // analyser. Runs whenever the analyser exists (i.e. audio engine started),
  // not just while recording — clipping matters during plain playback too.
  // rAF is cancelled on unmount; no AudioNode is created here.
  useEffect(() => {
    let rafId = 0;
    const buf = new Float32Array(1024);
    const tick = () => {
      const analyser = clipAnalyserRef?.current;
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
        }
        setClipping((prev) => {
          const next = peak > CLIP_THRESHOLD;
          return prev === next ? prev : next;
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [clipAnalyserRef]);

  // ── W1.4 — import settings from a user-picked .json file ──
  // Reads the file, validates it via parseSettings (which never throws), and
  // either applies the valid config or shows an inline --danger error. Bad
  // input never crashes the app.
  const onSettingsFile = (e) => {
    const file = e.target.files?.[0];
    if (settingsInputRef.current) settingsInputRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseSettings(String(reader.result || ""));
      if (!result.ok) {
        setSettingsError(result.error);
        return;
      }
      setSettingsError("");
      onImportSettings?.(result.config);
    };
    reader.onerror = () => setSettingsError("Could not read that file.");
    reader.readAsText(file);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "8px 20px",
        background: "rgba(15,18,35,0.5)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.04)",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: 9, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1 }}>
          MASTER
        </span>
        <Slider
          value={masterVol}
          onChange={onMasterVolChange}
          min={0}
          max={1}
          step={0.01}
          color="#f0c040"
        />
        <span style={{ fontSize: 12, color: "#f0c040", fontWeight: 700, minWidth: 36, textAlign: "right" }}>
          {Math.round(masterVol * 100)}%
        </span>
      </div>

      {/* W1.7 — clip indicator. Lit in --danger when the signal clips.
          Purely visual: no live region — a hot signal flips on/off many
          times a second, which would flood a polite announcer. The title
          attribute carries the explanation for pointer users. */}
      <div
        title={
          clipping
            ? "Clipping — the master signal is too hot. Lower deck or master volume."
            : "Clip meter — lights up when the master signal clips"
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          color: clipping ? "#f87171" : "#4a5580",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: clipping ? "#f87171" : "#4a5580",
            boxShadow: clipping ? "0 0 8px #f87171aa" : "none",
            transition: "background 0.1s",
          }}
        />
        CLIP
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <ThemePicker deckId="A" value={deckAColor} onChange={onDeckAColorChange} />
        <ThemePicker deckId="B" value={deckBColor} onChange={onDeckBColorChange} />
      </div>

      {/* W1.7 — recorder tap toggle. Disabled while recording: the tap point
          can't be switched mid-record. */}
      <div
        role="group"
        aria-label="Recorder tap point"
        style={{
          display: "flex",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          overflow: "hidden",
          opacity: isRecording ? 0.5 : 1,
        }}
      >
        {[
          { mode: "pre", label: "Clean", title: "Record the pre-limiter signal (before the master compressor)" },
          { mode: "post", label: "Radio", title: "Record the post-limiter signal (after the master compressor)" },
        ].map((opt) => {
          const active = recordTapMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => onRecordTapModeChange(opt.mode)}
              disabled={isRecording}
              aria-pressed={active}
              title={
                isRecording
                  ? "Tap point is locked while recording"
                  : opt.title
              }
              style={{
                background: active ? "rgba(240,192,64,0.18)" : "rgba(255,255,255,0.04)",
                border: "none",
                borderRight: opt.mode === "pre" ? "1px solid rgba(255,255,255,0.12)" : "none",
                color: active ? "#f0c040" : "#8892b0",
                padding: "6px 10px",
                minHeight: 38,
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
                fontFamily: "'Exo 2', sans-serif",
                cursor: isRecording ? "not-allowed" : "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* W1.3 — marker / cue-drop button. Enabled only while recording. */}
      <button
        type="button"
        onClick={onDropMarker}
        disabled={!isRecording}
        aria-label="Drop a cue marker at the current recording time"
        title={
          isRecording
            ? "Drop a cue marker (also: M key) — exported as a cue sheet on stop"
            : "Start recording to drop cue markers"
        }
        style={{
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${isRecording ? "#f0c040" : "rgba(255,255,255,0.12)"}`,
          color: isRecording ? "#f0c040" : "#4a5580",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          cursor: isRecording ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="flag" size={12} color={isRecording ? "#f0c040" : "#4a5580"} />
        MARKER
        {markerCount > 0 && (
          <span
            style={{
              background: "#f0c040",
              color: "#070a14",
              borderRadius: 8,
              padding: "0 6px",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {markerCount}
          </span>
        )}
      </button>

      <button
        onClick={onToggleRecord}
        disabled={!recordSupported}
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop recording" : "Record the master mix"}
        title={
          recordSupported
            ? "Record the master mix to a local file"
            : "MediaRecorder not supported in this browser"
        }
        style={{
          background: isRecording ? "rgba(248,113,113,0.18)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${isRecording ? "#f87171" : "rgba(255,255,255,0.12)"}`,
          color: isRecording ? "#f87171" : recordSupported ? "#ccd6f6" : "#4a5580",
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          cursor: recordSupported ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: isRecording ? "#f87171" : "#4a5580",
            boxShadow: isRecording ? "0 0 8px #f87171aa" : "none",
            animation: isRecording ? "pulse 0.8s infinite alternate" : "none",
          }}
        />
        {isRecording ? `REC ${fmtElapsed(elapsed)}` : "RECORD"}
      </button>

      {/* W1.4 — settings export / import. Config only (themes, crossfade
          curve, MIDI maps, recorder tap) — no audio is ever written. */}
      <div
        role="group"
        aria-label="Settings export and import"
        style={{ display: "flex", gap: 6, alignItems: "center" }}
      >
        <input
          ref={settingsInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onSettingsFile}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => onExportSettings?.()}
          aria-label="Export settings to a JSON file"
          title="Save your themes, crossfade curve and MIDI mappings to a file"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#8892b0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontFamily: "'Exo 2', sans-serif",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            minHeight: 38,
          }}
        >
          <Icon name="download" size={12} color="#8892b0" />
          Export
        </button>
        <button
          type="button"
          onClick={() => settingsInputRef.current?.click()}
          aria-label="Import settings from a JSON file"
          title="Restore themes, crossfade curve and MIDI mappings from a file"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#8892b0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontFamily: "'Exo 2', sans-serif",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            minHeight: 38,
          }}
        >
          <Icon name="upload" size={12} color="#8892b0" />
          Import
        </button>
      </div>

      {settingsError && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "#f87171",
            fontFamily: "'Exo 2', sans-serif",
          }}
        >
          {settingsError}
        </span>
      )}

      <div role="status" aria-live="polite" style={SR_ONLY}>
        {recordAnnounce}
      </div>
    </div>
  );
}
