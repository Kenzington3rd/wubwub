import Slider from "./Slider.jsx";
import { CROSSFADE_CURVES } from "../data.js";

export default function Crossfader({
  value,
  onChange,
  isMobile,
  curve,
  onCurveChange,
}) {
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
      <span style={{ fontSize: 9, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1 }}>
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
          color="#a78bfa"
          className="wc-crossfader-slider"
        />
      </div>
      <span style={{ fontSize: 9, color: "#8892b0", textTransform: "uppercase", letterSpacing: 1 }}>
        B
      </span>
      <span
        style={{
          fontSize: 9,
          color: "#a78bfa",
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
        title="Crossfade curve"
        style={{
          background: "rgba(15,18,35,0.6)",
          color: "#a78bfa",
          border: "1px solid rgba(167,139,250,0.25)",
          borderRadius: 6,
          fontSize: 9,
          padding: "2px 4px",
          fontFamily: "'Exo 2', sans-serif",
          cursor: "pointer",
          marginTop: isMobile ? 0 : 4,
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
