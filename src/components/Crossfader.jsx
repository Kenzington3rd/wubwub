import { useState } from "react";
import Slider from "./Slider.jsx";
import { CROSSFADE_CURVES } from "../data.js";

// The crossfader is a shared control, not Deck B — its body is neutral slate.
// The A / B end-labels are tinted with the respective deck's accent color so
// the fader visually reads as a bridge between the two decks.
const NEUTRAL = "#8892b0";

export default function Crossfader({
  value,
  onChange,
  isMobile,
  curve,
  onCurveChange,
  deckAColor = NEUTRAL,
  deckBColor = NEUTRAL,
}) {
  // D6 — hover state for the native curve <select>.
  const [curveHover, setCurveHover] = useState(false);
  return (
    <div
      className="wc-crossfader-column"
      style={{
        display: "flex",
        flexDirection: isMobile ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minWidth: isMobile ? undefined : 84,
        padding: "0 4px",
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: deckAColor,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        A
      </span>
      <div
        style={{
          position: "relative",
          display: "flex",
          flex: isMobile ? 1 : undefined,
          width: isMobile ? "auto" : undefined,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Slider
          value={value}
          onChange={onChange}
          min={0}
          max={1}
          step={0.01}
          vertical={!isMobile}
          height={200}
          color={NEUTRAL}
          ariaLabel="Crossfade A to B"
          className="wc-crossfader-slider"
        />
      </div>
      <span
        style={{
          fontSize: 9,
          color: deckBColor,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        B
      </span>
      <span
        style={{
          fontSize: 9,
          color: NEUTRAL,
          letterSpacing: 1,
          marginTop: isMobile ? 0 : 4,
          marginLeft: isMobile ? 6 : 0,
        }}
      >
        X-FADE
      </span>
      <select
        value={curve}
        onChange={(e) => onCurveChange(e.target.value)}
        onPointerEnter={() => setCurveHover(true)}
        onPointerLeave={() => setCurveHover(false)}
        title="Crossfade curve"
        aria-label="Crossfade curve"
        style={{
          background: curveHover
            ? "rgba(255,255,255,0.08)"
            : "rgba(15,18,35,0.6)",
          color: NEUTRAL,
          border: `1px solid rgba(136,146,176,${curveHover ? "0.5" : "0.25"})`,
          borderRadius: 6,
          fontSize: 9,
          // D6 — the crossfader column has vertical room, so the curve select
          // can meet the 38px control-floor.
          minHeight: 38,
          padding: "2px 6px",
          fontFamily: "'Exo 2', sans-serif",
          cursor: "pointer",
          marginTop: isMobile ? 0 : 4,
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
      >
        {Object.entries(CROSSFADE_CURVES).map(([id, c]) => (
          <option key={id} value={id} style={{ background: "#0d1225" }}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
