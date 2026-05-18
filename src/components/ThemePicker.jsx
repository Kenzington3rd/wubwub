import { COLOR_THEMES } from "../data.js";

export default function ThemePicker({ deckId, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          color: "#8892b0",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {deckId}
      </span>
      {COLOR_THEMES.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.value)}
            title={c.name}
            aria-label={`Deck ${deckId} color: ${c.name}`}
            aria-pressed={active}
            style={{
              width: 16,
              height: 16,
              padding: 0,
              borderRadius: "50%",
              border: active ? `2px solid #ccd6f6` : "1px solid rgba(255,255,255,0.1)",
              background: c.value,
              cursor: "pointer",
              boxShadow: active ? `0 0 10px ${c.value}` : "none",
            }}
          />
        );
      })}
    </div>
  );
}
