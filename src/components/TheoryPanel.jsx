import { useState } from "react";
import { CAMELOT_WHEEL, GENRE_BPM, TIPS, KEYBOARD_HINTS } from "../data.js";
import Icon from "./Icon.jsx";

// Fixed identity accent for the TheoryPanel — orange, the registered shared-
// panel accent distinct from Looper-purple, SamplePad-cyan and Crate-green
// (DESIGN_GUIDE §4). Used for HEADING / tab text and the active-tab state
// only; the panel body stays neutral slate.
const PANEL_ACCENT = "#fb923c";

export default function TheoryPanel({
  deckKeys = { A: null, B: null, C: null },
  focusedDeck = null,
  deckAColor = "#00f5d4",
  deckBColor = "#a78bfa",
  deckCColor = "#4ade80",
}) {
  const [activeTab, setActiveTab] = useState("theory");
  const [tipIdx, setTipIdx] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);

  const selectedKeyData = selectedKey != null ? CAMELOT_WHEEL[selectedKey] : null;

  // The focused deck's auto-detected key drives a live highlight on the wheel.
  // Falls back to whichever deck has a key when none is focused.
  const liveDeck =
    focusedDeck || (deckKeys.A ? "A" : deckKeys.B ? "B" : deckKeys.C ? "C" : null);
  const liveKey = liveDeck ? deckKeys[liveDeck] : null;
  const liveColor =
    liveDeck === "B" ? deckBColor : liveDeck === "C" ? deckCColor : deckAColor;
  const liveKeyData = liveKey
    ? CAMELOT_WHEEL.find((w) => w.camelot === liveKey) || null
    : null;

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
      <div
        role="tablist"
        aria-label="Theory and reference"
        style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
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
              type="button"
              id={`theory-tab-${tab.id}`}
              role="tab"
              aria-selected={active}
              aria-controls={`theory-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              // Standard hover step. Applied only to inactive tabs — the active
              // tab keeps its accent-tinted background, which wc-btn-hover's
              // !important rule would otherwise stomp.
              className={active ? undefined : "wc-btn-hover"}
              style={{
                flex: 1,
                padding: "10px 8px",
                minHeight: 38,
                border: "none",
                cursor: "pointer",
                fontFamily: "'Exo 2', sans-serif",
                fontSize: 11,
                letterSpacing: 1,
                background: active ? `${PANEL_ACCENT}14` : "transparent",
                color: active ? PANEL_ACCENT : "#8892b0",
                borderBottom: active
                  ? `2px solid ${PANEL_ACCENT}`
                  : "2px solid transparent",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Icon name={tab.icon} size={13} color={active ? PANEL_ACCENT : "#8892b0"} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`theory-panel-${activeTab}`}
        aria-labelledby={`theory-tab-${activeTab}`}
        style={{ padding: 16 }}
      >
        {activeTab === "theory" && (
          <div>
            <p style={{ fontSize: 11, color: "#8892b0", marginBottom: 12 }}>
              Select a key to see compatible keys for harmonic mixing (Camelot Wheel).
              Mixing between compatible keys creates smooth, professional-sounding
              transitions.
            </p>
            {liveKeyData && (
              <p
                style={{
                  fontSize: 11,
                  color: liveColor,
                  marginBottom: 10,
                  fontFamily: "'Exo 2', sans-serif",
                }}
              >
                Deck {liveDeck} detected{" "}
                <strong>
                  {liveKeyData.camelot} ({liveKeyData.key})
                </strong>{" "}
                — its key and compatible neighbours are highlighted below.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              {CAMELOT_WHEEL.map((item, i) => {
                const isSelected = selectedKey === i;
                const isCompat = selectedKeyData?.compatible.includes(item.camelot);
                // Live deck-key highlight layer, independent of click selection.
                const isLiveKey = liveKeyData?.camelot === item.camelot;
                const isLiveCompat =
                  !isLiveKey && liveKeyData?.compatible.includes(item.camelot);
                let borderColor = "rgba(255,255,255,0.08)";
                let background = "rgba(255,255,255,0.02)";
                // P6 (R16) — neutral-state key text uses text-muted, not
                // text-dim (#4a5580 → ~2.7:1 vs the card bg, fails WCAG 1.4.3
                // for small text). Selected / compatible tiers below still
                // ride their accent colors.
                let color = "#8892b0";
                let boxShadow = "none";
                // A key in any highlighted state (selected / live / compatible)
                // already carries an accent background; only a plain neutral
                // key gets the wc-btn-hover step, so the !important hover rule
                // doesn't stomp an accent tint.
                const isHighlighted =
                  isSelected || isLiveKey || isCompat || isLiveCompat;
                if (isSelected) {
                  borderColor = PANEL_ACCENT;
                  background = `${PANEL_ACCENT}22`;
                  color = PANEL_ACCENT;
                  boxShadow = `0 0 10px ${PANEL_ACCENT}33`;
                } else if (isLiveKey) {
                  borderColor = liveColor;
                  background = `${liveColor}26`;
                  color = liveColor;
                  boxShadow = `0 0 10px ${liveColor}3a`;
                } else if (isCompat) {
                  borderColor = `${PANEL_ACCENT}66`;
                  background = `${PANEL_ACCENT}0e`;
                  color = `${PANEL_ACCENT}cc`;
                } else if (isLiveCompat) {
                  borderColor = `${liveColor}66`;
                  background = `${liveColor}12`;
                  color = `${liveColor}cc`;
                }
                return (
                  <button
                    key={item.camelot}
                    type="button"
                    onClick={() => setSelectedKey(isSelected ? null : i)}
                    aria-pressed={isSelected}
                    className={isHighlighted ? undefined : "wc-btn-hover"}
                    title={
                      isLiveKey
                        ? `Deck ${liveDeck} detected key`
                        : isLiveCompat
                        ? `Compatible with Deck ${liveDeck}'s key`
                        : undefined
                    }
                    style={{
                      // 38px minimum hit area — the wheel is a free-flowing
                      // flex-wrap row, so a taller button just reflows; it
                      // does not break the layout (DESIGN_GUIDE §3).
                      padding: "8px 10px",
                      minHeight: 38,
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor,
                      background,
                      color,
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "'Exo 2', sans-serif",
                      transition: "all 0.15s",
                      boxShadow,
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
                  background: `${PANEL_ACCENT}10`,
                  borderRadius: 10,
                  border: `1px solid ${PANEL_ACCENT}26`,
                }}
              >
                <span style={{ fontSize: 12, color: PANEL_ACCENT, fontWeight: 700 }}>
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
                    color: "#8892b0",
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
                <div style={{ fontSize: 10, color: "#8892b0" }}>{g.feel}</div>
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
              type="button"
              onClick={() => setTipIdx((i) => (i + 1) % TIPS.length)}
              // P10 (R16) — reuse the project hover idiom so the button has a
              // distinct default/hover state, matching the transport pattern.
              className="wc-btn-hover"
              style={{
                background: `${PANEL_ACCENT}1a`,
                border: `1px solid ${PANEL_ACCENT}33`,
                borderRadius: 8,
                padding: "6px 16px",
                minHeight: 38,
                color: PANEL_ACCENT,
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "'Exo 2', sans-serif",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Next Tip
              <Icon name="chevron" size={12} color={PANEL_ACCENT} />
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
                    color: "#8892b0",
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
