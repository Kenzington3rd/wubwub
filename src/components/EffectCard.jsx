import Knob from "./Knob.jsx";

// Generic effect card. `params` is an array of:
//   { key, label, min, max, step, format }
// Each becomes a Knob bound to settings[key].
//
// `settings` shape (minimum): { on: boolean, ...paramKeys }.
export default function EffectCard({ title, color, settings, onChange, params }) {
  const setOn = (on) => onChange({ ...settings, on });
  const setParam = (key, v) => onChange({ ...settings, [key]: v });

  return (
    <div
      style={{
        flex: 1,
        minWidth: 110,
        padding: 8,
        borderRadius: 10,
        background: settings.on ? `${color}10` : "rgba(255,255,255,0.02)",
        border: `1px solid ${settings.on ? color + "55" : "rgba(255,255,255,0.06)"}`,
        boxShadow: settings.on ? `0 0 12px ${color}22` : "none",
        transition: "all 0.2s",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => setOn(!settings.on)}
        aria-pressed={settings.on}
        aria-label={`${title} effect ${settings.on ? "on" : "off"}`}
        // Standard hover step. Applied only when the effect is off — an active
        // toggle keeps its accent-tinted background, which wc-btn-hover's
        // !important rule would otherwise stomp (matches TheoryPanel's tabs).
        className={settings.on ? undefined : "wc-btn-hover"}
        style={{
          background: settings.on ? `${color}33` : "rgba(255,255,255,0.04)",
          border: `1px solid ${settings.on ? color : "rgba(255,255,255,0.08)"}`,
          borderRadius: 6,
          padding: "4px 8px",
          // Z1 (R23) — all text buttons meet the 38×38 floor.
          minHeight: 38,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          fontWeight: 700,
          color: settings.on ? color : "#8892b0",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 9, opacity: 0.8 }}>{settings.on ? "ON" : "OFF"}</span>
      </button>
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          gap: 4,
          opacity: settings.on ? 1 : 0.4,
          pointerEvents: settings.on ? "auto" : "none",
        }}
      >
        {params.map((p) => (
          <Knob
            key={p.key}
            value={settings[p.key]}
            onChange={(v) => setParam(p.key, v)}
            min={p.min}
            max={p.max}
            label={p.label}
            color={color}
            size={36}
            format={p.format}
            disabled={!settings.on}
          />
        ))}
      </div>
    </div>
  );
}
