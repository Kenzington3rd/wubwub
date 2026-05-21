import { useState } from "react";
import { BASS_DROP_PRESETS } from "../data.js";

export default function BassDropMenu({ preset, onChange, color }) {
  // D6 — hover state for the native <select> (inline styles can't carry a
  // CSS :hover with a dynamic accent color).
  const [hover, setHover] = useState(false);
  return (
    <select
      value={preset}
      onChange={(e) => onChange(e.target.value)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title="Bass drop preset"
      aria-label="Bass drop preset"
      style={{
        background: hover ? `${color}1a` : "rgba(15,18,35,0.6)",
        color,
        border: `1px solid ${color}${hover ? "66" : "33"}`,
        borderRadius: 6,
        fontSize: 9,
        // 38×38 minimum hit area (WCAG 2.5.8). The BASS DROP button next to
        // it is already a tall primary action, so a full-floor select sits
        // comfortably alongside it.
        minHeight: 38,
        padding: "2px 4px",
        fontFamily: "'Exo 2', sans-serif",
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: 1,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      {Object.entries(BASS_DROP_PRESETS).map(([id, p]) => (
        <option key={id} value={id} style={{ background: "#0d1225" }}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
