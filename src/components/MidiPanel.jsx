import { useState } from "react";
import { MIDI_SUPPORTED, MIDI_TARGETS } from "../midi/midiMap.js";

export default function MidiPanel({
  enabled,
  onEnable,
  onDisable,
  mappings,
  learnTarget,
  onStartLearn,
  onCancelLearn,
  onClearMapping,
  inputName,
  error,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: "rgba(15,18,35,0.6)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.04)",
        padding: 12,
        marginTop: 16,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          border: "none",
          color: "#a78bfa",
          fontFamily: "'Audiowide', sans-serif",
          fontSize: 12,
          letterSpacing: 2,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{open ? "▼" : "▶"}</span>
        <span>MIDI</span>
        <span style={{ fontSize: 10, color: "#4a5580", letterSpacing: 0, textTransform: "none" }}>
          {!MIDI_SUPPORTED
            ? "(not supported in this browser)"
            : enabled
            ? `(active${inputName ? ` — ${inputName}` : ""})`
            : "(disabled)"}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {!MIDI_SUPPORTED && (
            <p style={{ fontSize: 11, color: "#8892b0" }}>
              Web MIDI isn't available here. Try Chrome, Edge, or Opera.
            </p>
          )}
          {MIDI_SUPPORTED && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={enabled ? onDisable : onEnable}
                style={{
                  background: enabled ? "#a78bfa22" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${enabled ? "#a78bfa55" : "rgba(255,255,255,0.1)"}`,
                  color: enabled ? "#a78bfa" : "#8892b0",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "'Exo 2', sans-serif",
                }}
              >
                {enabled ? "Disable MIDI" : "Enable MIDI"}
              </button>
              {error && <span style={{ fontSize: 11, color: "#f472b6" }}>{error}</span>}
            </div>
          )}
          {MIDI_SUPPORTED && enabled && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 6,
              }}
            >
              {MIDI_TARGETS.map((t) => {
                const m = mappings[t.id];
                const learning = learnTarget === t.id;
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      background: learning
                        ? "rgba(167,139,250,0.12)"
                        : "rgba(255,255,255,0.03)",
                      border: `1px solid ${learning ? "#a78bfa66" : "rgba(255,255,255,0.06)"}`,
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ flex: 1, color: "#8892b0" }}>{t.label}</span>
                    {m ? (
                      <span style={{ color: "#a78bfa", fontFamily: "'Exo 2', sans-serif" }}>
                        ch{m.channel + 1} cc{m.cc}
                      </span>
                    ) : learning ? (
                      <span style={{ color: "#a78bfa", fontStyle: "italic" }}>twist…</span>
                    ) : (
                      <span style={{ color: "#4a5580" }}>—</span>
                    )}
                    <button
                      onClick={() => (learning ? onCancelLearn() : onStartLearn(t.id))}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#8892b0",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "1px 6px",
                        cursor: "pointer",
                      }}
                    >
                      {learning ? "Cancel" : "Learn"}
                    </button>
                    {m && (
                      <button
                        onClick={() => onClearMapping(t.id)}
                        title="Remove mapping"
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#4a5580",
                          borderRadius: 4,
                          fontSize: 10,
                          padding: "1px 6px",
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
