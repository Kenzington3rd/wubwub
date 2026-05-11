import { BASS_DROP_PRESETS } from "../data.js";

export default function BassDropMenu({ preset, onChange, color }) {
  return (
    <select
      value={preset}
      onChange={(e) => onChange(e.target.value)}
      title="Bass drop preset"
      style={{
        background: "rgba(15,18,35,0.6)",
        color,
        border: `1px solid ${color}33`,
        borderRadius: 6,
        fontSize: 9,
        padding: "2px 4px",
        fontFamily: "'Exo 2', sans-serif",
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: 1,
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
