import { useEffect, useRef, useState } from "react";
import Slider from "./Slider.jsx";
import ThemePicker from "./ThemePicker.jsx";

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
}) {
  const [elapsed, setElapsed] = useState(0);
  // Announce only the start/stop transition — never the per-250ms timer text,
  // which would be far too chatty for a live region.
  const [recordAnnounce, setRecordAnnounce] = useState("");
  const wasRecordingRef = useRef(isRecording);

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

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <ThemePicker deckId="A" value={deckAColor} onChange={onDeckAColorChange} />
        <ThemePicker deckId="B" value={deckBColor} onChange={onDeckBColorChange} />
      </div>

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

      <div role="status" aria-live="polite" style={SR_ONLY}>
        {recordAnnounce}
      </div>
    </div>
  );
}
