import { useEffect, useMemo, useRef, useState } from "react";
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

const MODE_OPTIONS = [
  { value: "absolute", label: "Absolute" },
  { value: "relative2c", label: "Relative 2c" },
  { value: "signedMag", label: "Signed Mag" },
];

export default function MidiPanel({
  enabled,
  onEnable,
  onDisable,
  mappings,
  // Map of MIDIInput.id → display name. Only used to disambiguate the per-
  // mapping summary when more than one controller has bound mappings.
  inputNames = {},
  learnTarget,
  onStartLearn,
  onCancelLearn,
  onClearMapping,
  // Update a single mapping's CC mode (absolute / relative2c / signedMag).
  // Optional — when omitted, the mode dropdown is hidden.
  onChangeMode,
  inputName,
  error,
  // R17 Q1 — non-empty when a Learn capture was rejected (today: a Note On
  // arrived but note-target routing is deferred). Rendered as an inline hint
  // beneath the active learn row. Empty string when there's nothing to show.
  learnHint = "",
}) {
  const [open, setOpen] = useState(false);

  // Distinct controllers actually referenced by bound mappings. When two or
  // more, each row labels its mapping with the controller name so the user
  // can tell two controllers' "ch1 cc7" apart.
  const distinctInputCount = useMemo(() => {
    const ids = new Set();
    for (const m of Object.values(mappings)) {
      if (m && m.inputId) ids.add(m.inputId);
    }
    return ids.size;
  }, [mappings]);

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

  // Compact "ch1 cc7" / "ch1 note36" summary; appends "· <controller>" only
  // when more than one input is bound, so the single-controller case stays
  // tidy.
  const summarize = (m) => {
    const kind = m.kind || "cc";
    const number = m.number ?? m.cc;
    const suffix = kind === "note" ? `note${number}` : `cc${number}`;
    const base = `ch${m.channel + 1} ${suffix}`;
    if (distinctInputCount > 1 && m.inputId) {
      const name = inputNames[m.inputId];
      if (name) return `${base} · ${name}`;
    }
    return base;
  };

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
        type="button"
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
                type="button"
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
                // Mode dropdown only makes sense for CC mappings — note pads
                // don't have an absolute-vs-relative axis.
                const showMode =
                  m && (m.kind || "cc") === "cc" && typeof onChangeMode === "function";
                // R17 Q1 — surface the rejection hint only on the active
                // learn row (so it's visually tied to the right target).
                const showHint = learning && learnHint;
                return (
                  <div
                    key={t.id}
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                  <div
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
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ flex: 1, color: "#8892b0", minWidth: 80 }}>{t.label}</span>
                    {m ? (
                      <span style={{ color: "#60a5fa", fontFamily: "'Exo 2', sans-serif" }}>
                        {summarize(m)}
                      </span>
                    ) : learning ? (
                      <span style={{ color: "#60a5fa", fontStyle: "italic" }}>twist…</span>
                    ) : (
                      <span style={{ color: "#8892b0" }}>—</span>
                    )}
                    {showMode && (
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10,
                          color: "#8892b0",
                        }}
                      >
                        <span style={SR_ONLY}>Mode for {t.label}</span>
                        <span aria-hidden="true">Mode</span>
                        <select
                          value={m.mode || "absolute"}
                          onChange={(e) => onChangeMode(t.id, e.target.value)}
                          aria-label={`Mode for ${t.label}`}
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#8892b0",
                            borderRadius: 4,
                            fontSize: 10,
                            padding: "1px 4px",
                            cursor: "pointer",
                          }}
                        >
                          {MODE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => (learning ? onCancelLearn() : onStartLearn(t.id))}
                      aria-pressed={learning}
                      aria-label={
                        learning
                          ? `Cancel MIDI learn for ${t.label}`
                          : `Learn MIDI mapping for ${t.label}`
                      }
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
                        type="button"
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
                        <Icon name="close" size={10} color="#8892b0" />
                      </button>
                    )}
                  </div>
                  {showHint && (
                    <div
                      role="status"
                      style={{
                        fontSize: 10,
                        color: "#f0c040",
                        padding: "0 8px",
                        lineHeight: 1.4,
                      }}
                    >
                      {learnHint}
                    </div>
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
