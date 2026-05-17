import { useState } from "react";
import { CAMELOT_WHEEL, GENRE_BPM, TIPS, KEYBOARD_HINTS } from "../data.js";
import Icon from "./Icon.jsx";

export default function TheoryPanel() {
  const [activeTab, setActiveTab] = useState("theory");
  const [tipIdx, setTipIdx] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);

  const selectedKeyData = selectedKey != null ? CAMELOT_WHEEL[selectedKey] : null;

  return (
    <div
      style={{
        marginTop: 16,
        background: "rgba(15,18,35,0.6)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {[
          { id: "theory", icon: "music", label: "Harmonic Mixing" },
          { id: "bpm", icon: "bolt", label: "Genre BPM Guide" },
          { id: "tips", icon: "bulb", label: "DJ Tips" },
          { id: "keys", icon: "keyboard", label: "Shortcuts" },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={active}
              style={{
                flex: 1,
                padding: "10px 8px",
                border: "none",
                cursor: "pointer",
                fontFamily: "'Exo 2', sans-serif",
                fontSize: 11,
                letterSpacing: 1,
                background: active ? "rgba(0,245,212,0.08)" : "transparent",
                color: active ? "#00f5d4" : "#4a5580",
                borderBottom: active ? "2px solid #00f5d4" : "2px solid transparent",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Icon name={tab.icon} size={13} color={active ? "#00f5d4" : "#4a5580"} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16 }}>
        {activeTab === "theory" && (
          <div>
            <p style={{ fontSize: 11, color: "#8892b0", marginBottom: 12 }}>
              Select a key to see compatible keys for harmonic mixing (Camelot Wheel).
              Mixing between compatible keys creates smooth, professional-sounding
              transitions.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              {CAMELOT_WHEEL.map((item, i) => {
                const isSelected = selectedKey === i;
                const isCompat = selectedKeyData?.compatible.includes(item.camelot);
                return (
                  <button
                    key={item.camelot}
                    onClick={() => setSelectedKey(isSelected ? null : i)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: isSelected
                        ? "#00f5d4"
                        : isCompat
                        ? "#00f5d466"
                        : "rgba(255,255,255,0.08)",
                      background: isSelected
                        ? "#00f5d422"
                        : isCompat
                        ? "#00f5d40e"
                        : "rgba(255,255,255,0.02)",
                      color: isSelected
                        ? "#00f5d4"
                        : isCompat
                        ? "#00f5d4cc"
                        : "#4a5580",
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "'Exo 2', sans-serif",
                      transition: "all 0.15s",
                      boxShadow: isSelected ? "0 0 10px rgba(0,245,212,0.2)" : "none",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{item.camelot}</span> {item.key}
                  </button>
                );
              })}
            </div>
            {selectedKeyData && (
              <div
                style={{
                  padding: 12,
                  background: "rgba(0,245,212,0.06)",
                  borderRadius: 10,
                  border: "1px solid rgba(0,245,212,0.15)",
                }}
              >
                <span style={{ fontSize: 12, color: "#00f5d4", fontWeight: 700 }}>
                  {selectedKeyData.camelot} — {selectedKeyData.key}
                </span>
                <p style={{ fontSize: 11, color: "#8892b0", margin: "6px 0 0" }}>
                  Compatible keys:{" "}
                  {selectedKeyData.compatible
                    .map((c) => {
                      const match = CAMELOT_WHEEL.find((w) => w.camelot === c);
                      return match ? `${c} (${match.key})` : c;
                    })
                    .join("  ·  ")}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "bpm" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            {GENRE_BPM.map((g) => (
              <div
                key={g.genre}
                style={{
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Audiowide', sans-serif",
                    fontSize: 12,
                    color: "#a78bfa",
                  }}
                >
                  {g.genre}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: "#ccd6f6",
                    fontWeight: 700,
                    margin: "2px 0",
                  }}
                >
                  {g.bpm}
                </div>
                <div style={{ fontSize: 10, color: "#4a5580" }}>{g.feel}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "tips" && (
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                padding: "20px 24px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                marginBottom: 12,
                minHeight: 60,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p style={{ fontSize: 14, color: "#ccd6f6", lineHeight: 1.6, margin: 0 }}>
                "{TIPS[tipIdx]}"
              </p>
            </div>
            <button
              onClick={() => setTipIdx((i) => (i + 1) % TIPS.length)}
              style={{
                background: "rgba(0,245,212,0.1)",
                border: "1px solid rgba(0,245,212,0.2)",
                borderRadius: 8,
                padding: "6px 16px",
                color: "#00f5d4",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "'Exo 2', sans-serif",
              }}
            >
              Next Tip →
            </button>
          </div>
        )}

        {activeTab === "keys" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 6,
            }}
          >
            {KEYBOARD_HINTS.map((h) => (
              <div
                key={h.key}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "6px 10px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              >
                <kbd
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    padding: "1px 8px",
                    borderRadius: 6,
                    minWidth: 80,
                    textAlign: "center",
                    color: "#a78bfa",
                    fontFamily: "'Exo 2', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {h.key}
                </kbd>
                <span style={{ color: "#8892b0" }}>{h.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
