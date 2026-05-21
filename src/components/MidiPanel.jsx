import { useEffect, useRef, useState } from "react";
import { MIDI_SUPPORTED, MIDI_TARGETS } from "../midi/midiMap.js";
import Icon from "./Icon.jsx";

// Visually hidden, still announced by screen readers.
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

  // Announce MIDI learn transitions for screen readers: entering learn mode,
  // and when a mapping is captured (learnTarget clears with a mapping now set).
  const [learnAnnounce, setLearnAnnounce] = useState("");
  const prevLearnRef = useRef(learnTarget);
  useEffect(() => {
    const prev = prevLearnRef.current;
    const labelFor = (id) => MIDI_TARGETS.find((t) => t.id === id)?.label || id;
    if (learnTarget && learnTarget !== prev) {
      setLearnAnnounce(`Learning ${labelFor(learnTarget)} — twist a control`);
    } else if (!learnTarget && prev) {
      // Learn mode just ended. If a mapping now exists for the previous
      // target, it was captured; otherwise it was cancelled.
      if (mappings[prev]) setLearnAnnounce(`${labelFor(prev)} mapped`);
    }
    prevLearnRef.current = learnTarget;
  }, [learnTarget, mappings]);

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
      <div role="status" aria-live="polite" style={SR_ONLY}>
        {learnAnnounce}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="midi-panel-body"
        aria-label="MIDI settings"
        style={{
          background: "transparent",
          border: "none",
          color: "#60a5fa",
          fontFamily: "'Audiowide', sans-serif",
          fontSize: 12,
          letterSpacing: 2,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "flex",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <Icon name="chevron" size={12} color="#60a5fa" />
        </span>
        <span>MIDI</span>
        <span style={{ fontSize: 10, color: "#8892b0", letterSpacing: 0, textTransform: "none" }}>
          {!MIDI_SUPPORTED
            ? "(not supported in this browser)"
            : enabled
            ? `(active${inputName ? ` — ${inputName}` : ""})`
            : "(disabled)"}
        </span>
      </button>
      {open && (
        <div id="midi-panel-body" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {!MIDI_SUPPORTED && (
            <p style={{ fontSize: 11, color: "#8892b0" }}>
              Web MIDI isn't available here. Try Chrome, Edge, or Opera.
            </p>
          )}
          {MIDI_SUPPORTED && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={enabled ? onDisable : onEnable}
                aria-pressed={enabled}
                style={{
                  background: enabled ? "#60a5fa22" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${enabled ? "#60a5fa55" : "rgba(255,255,255,0.1)"}`,
                  color: enabled ? "#60a5fa" : "#8892b0",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "'Exo 2', sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {enabled ? "Disable MIDI" : "Enable MIDI"}
              </button>
              {error && <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>}
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
                        ? "rgba(96,165,250,0.12)"
                        : "rgba(255,255,255,0.03)",
                      border: `1px solid ${learning ? "#60a5fa66" : "rgba(255,255,255,0.06)"}`,
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ flex: 1, color: "#8892b0" }}>{t.label}</span>
                    {m ? (
                      <span style={{ color: "#60a5fa", fontFamily: "'Exo 2', sans-serif" }}>
                        ch{m.channel + 1} cc{m.cc}
                      </span>
                    ) : learning ? (
                      <span style={{ color: "#60a5fa", fontStyle: "italic" }}>twist…</span>
                    ) : (
                      <span style={{ color: "#4a5580" }}>—</span>
                    )}
                    <button
                      onClick={() => (learning ? onCancelLearn() : onStartLearn(t.id))}
                      aria-pressed={learning}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#8892b0",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "1px 6px",
                        minHeight: 38,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                      }}
                    >
                      {learning ? "Cancel" : "Learn"}
                    </button>
                    {m && (
                      <button
                        onClick={() => onClearMapping(t.id)}
                        title="Remove mapping"
                        aria-label={`Remove MIDI mapping for ${t.label}`}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 4,
                          padding: "3px 5px",
                          minWidth: 38,
                          minHeight: 38,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="close" size={10} color="#4a5580" />
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
